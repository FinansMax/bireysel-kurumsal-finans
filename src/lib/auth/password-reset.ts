import { createHash, randomBytes } from "node:crypto";

import { getAppBaseUrl } from "@/lib/config/app-url";
import { prisma } from "@/lib/prisma";

import { updateUserPassword } from "./credentials";
import { consoleEmailSender, type EmailSender } from "./email";
import { hashPassword } from "./password";
import { isValidPassword, normalizeEmail } from "./validation";

// 256 bit entropi — brute-force ile tahmin edilmesi hesaplama açısından imkansız.
const RESET_TOKEN_BYTES = 32;

// 30 dakika: kullanıcının e-postasını kontrol edip linke tıklaması için yeterli, ama
// token sızması/link'in e-posta istemcisi tarafından önceden getirilmesi gibi risklerin
// etki penceresini dar tutan, Issue #7'nin önerdiği 15-60 dakikalık aralığın ortası.
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

export function hashToken(rawToken: string): string {
  // Reset token'ı (parola gibi düşük entropili bir sır değil) kriptografik olarak
  // rastgele, yüksek entropili bir değerdir; brute-force edilebilirliği token'ın
  // kendi entropisiyle sınırlıdır. Bu yüzden parolalar için kullanılan yavaş/salt'lı
  // scrypt yerine, DB'de plaintext saklamamak için yeterli olan hızlı bir SHA-256
  // hash'i kullanılır (OWASP'ın reset token'lar için önerdiği yaklaşım).
  return createHash("sha256").update(rawToken).digest("hex");
}

export function generateRawToken(): string {
  return randomBytes(RESET_TOKEN_BYTES).toString("hex");
}

export type RequestPasswordResetOptions = {
  emailSender?: EmailSender;
  baseUrl?: string;
};

/**
 * "Şifremi unuttum" isteğini işler (Issue #7).
 *
 * GÜVENLİK: Bu fonksiyon kullanıcının var olup olmadığını YANSITAN hiçbir değer döndürmez
 * ve fırlatmaz — çağıran taraf (route handler) her zaman aynı genel mesajı döner. Kullanıcı
 * bulunamasa bile token üretimi/hash'lemesi yine de yapılır (DB'ye yazılmasa da) ki bu adımın
 * CPU maliyeti kayıtlı/kayıtsız e-posta arasında bariz bir timing farkı yaratmasın.
 */
export async function requestPasswordReset(
  email: unknown,
  options: RequestPasswordResetOptions = {},
): Promise<void> {
  const sender = options.emailSender ?? consoleEmailSender;
  // `getAppBaseUrl()` her DB erişiminden ÖNCE çağrılır: yanlış yapılandırılmış bir production
  // ortamında hata, kullanıcının kayıtlı olup olmamasından BAĞIMSIZ olarak aynı noktada oluşur.
  // Aksi halde "kayıtlı e-posta → 500, kayıtsız → 200" farkı, Issue #7'de kapatılan
  // user-enumeration oracle'ını geri getirirdi (bkz. `src/lib/config/app-url.ts`).
  const baseUrl = options.baseUrl ?? getAppBaseUrl();

  if (typeof email !== "string") {
    return;
  }

  const normalizedEmail = normalizeEmail(email);
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);

  if (!user) {
    return;
  }

  // Bu kullanıcı için daha önce oluşturulmuş, henüz kullanılmamış token'ları geçersiz kıl:
  // aynı anda yalnızca en güncel talebin token'ı geçerli olsun (eski taleplerin birikmesini
  // ve arka arkaya birden fazla geçerli token bulunmasını önler).
  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    }),
  ]);

  const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`;
  await sender.sendPasswordResetEmail({ to: user.email, resetUrl });
}

export type ResetPasswordResult = { ok: true } | { ok: false; status: 400; error: string };

const INVALID_OR_EXPIRED_TOKEN_ERROR = "Invalid or expired token";

/**
 * Geçerli bir reset token'ı ile yeni şifre belirler (Issue #7).
 *
 * GÜVENLİK: Token "bulunamadı" / "süresi dolmuş" / "zaten kullanılmış" durumlarının HEPSİ
 * için AYNI genel hata mesajı dönülür — token'ın hangi durumda olduğu dışarıya sızdırılmaz.
 *
 * RACE CONDITION: Token'ın tüketilmesi tek bir atomik `updateMany` (WHERE tokenHash = ? AND
 * usedAt IS NULL AND expiresAt > now()) ile yapılır. Aynı token eşzamanlı olarak iki kez
 * gönderilse bile veritabanı seviyesinde sadece biri `count === 1` görür; diğeri
 * "zaten kullanılmış" olarak reddedilir. "Önce oku, sonra yaz" deseninin (TOCTOU) aksine bu
 * yaklaşım, iki isteğin aynı token'ı aynı anda başarıyla tüketebilmesini yapısal olarak engeller.
 *
 * SESSION REVOCATION (Issue #26): Şifre hash'i `updateUserPassword()` ile güncellenir — bu
 * fonksiyon `credentialsChangedAt`'i AYNI UPDATE ifadesinde atomik olarak bumplar. Sonuç: reset
 * öncesi üretilmiş TÜM JWT session'ları bir sonraki istekte otomatik olarak geçersiz sayılır
 * (bkz. `src/lib/auth/session-revocation.ts` + `config.ts`'teki `session` callback'i).
 */
export async function resetPassword(
  token: unknown,
  newPassword: unknown,
): Promise<ResetPasswordResult> {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, status: 400, error: INVALID_OR_EXPIRED_TOKEN_ERROR };
  }

  if (typeof newPassword !== "string" || !isValidPassword(newPassword)) {
    return {
      ok: false,
      status: 400,
      error: "Password must be between 8 and 128 characters",
    };
  }

  const tokenHash = hashToken(token);

  const claim = await prisma.passwordResetToken.updateMany({
    where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });

  if (claim.count !== 1) {
    return { ok: false, status: 400, error: INVALID_OR_EXPIRED_TOKEN_ERROR };
  }

  const tokenRecord = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { userId: true },
  });

  if (!tokenRecord) {
    return { ok: false, status: 400, error: INVALID_OR_EXPIRED_TOKEN_ERROR };
  }

  const passwordHash = await hashPassword(newPassword);
  await updateUserPassword(prisma, tokenRecord.userId, passwordHash);

  return { ok: true };
}
