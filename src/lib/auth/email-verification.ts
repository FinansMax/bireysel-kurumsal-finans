import { createHash, randomBytes } from "node:crypto";

import { getAppBaseUrl } from "@/lib/config/app-url";
import { prisma } from "@/lib/prisma";

import { getEmailSender, type EmailSender } from "./email";

/**
 * E-posta doğrulama akışı (Issue #190).
 *
 * NEDEN VAR: `User.emailVerified` şemada vardı ama **hiçbir yerde yazılmıyor ve okunmuyordu**.
 * Kullanıcı yanlış yazdığı bir e-postayla kayıt olabiliyordu; şifre sıfırlama akışı o hesaba
 * sonsuza dek erişilemez hale geliyor ve destek yükü doğuruyordu. Sahte hesap üretimi de
 * serbestti.
 *
 * TOKEN DESENİ `password-reset.ts` İLE BİREBİR AYNI ve aynı gerekçelerle (invariant #6):
 * `randomBytes(32)`, DB'de yalnız SHA-256 hash'i, `expiresAt`, tek kullanımlık, tüketim TEK
 * atomik `updateMany` ile. Yeni bir desen icat edilmedi.
 *
 * NEDEN AYRI BİR MODEL (`PasswordResetToken`'ı yeniden kullanmak yerine): iki akışın ömürleri
 * ve iptal kuralları farklıdır. Şifre sıfırlama 30 dakika yaşar ve her yeni talepte eskisini
 * iptal eder (aynı anda tek geçerli token); doğrulama 24 saat yaşar. Tek modele sıkıştırmak,
 * "bu token hangi akışa ait" ayrımını bir `type` kolonuyla çözmeyi ve her sorguya o filtreyi
 * eklemeyi gerektirirdi — unutulduğu anda bir akışın token'ı diğerinde geçerli olurdu.
 */

// 256 bit entropi — `password-reset.ts` ile aynı.
const VERIFICATION_TOKEN_BYTES = 32;

/**
 * 24 saat.
 *
 * Şifre sıfırlamanın 30 dakikasından KASITLI olarak çok uzun: doğrulama linki, kullanıcının o
 * an online olmasını gerektirmez ve e-posta gecikmeleri (spam kutusu, kurumsal gateway) saatler
 * sürebilir. Aciliyet farkı da var — sızmış bir doğrulama token'ı en fazla "e-posta doğrulandı"
 * der, hesabı devralmaz.
 */
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export function hashVerificationToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function generateVerificationToken(): string {
  return randomBytes(VERIFICATION_TOKEN_BYTES).toString("hex");
}

export type SendVerificationOptions = {
  emailSender?: EmailSender;
  baseUrl?: string;
};

/**
 * Doğrulama e-postası gönderir (kayıt sonrası ve "tekrar gönder" akışları).
 *
 * KULLANICININ VAR OLUP OLMADIĞINI YANSITMAZ ve fırlatmaz — çağıran route her zaman aynı genel
 * mesajı döner. `forgot-password` ile aynı enumeration duruşu: aksi halde bu endpoint "şu
 * e-posta kayıtlı mı" sorusunun ücretsiz bir oracle'ı olurdu.
 *
 * ZATEN DOĞRULANMIŞ bir hesap için de sessizce hiçbir şey yapmaz. Bu da bilinçli: "bu hesap
 * zaten doğrulanmış" demek, hesabın varlığını VE durumunu sızdırırdı.
 *
 * YAPILANDIRMA ÇÖZÜMLEMESİ HER DB ERİŞİMİNDEN ÖNCE yapılır (`getAppBaseUrl()` +
 * `getEmailSender()`), `requestPasswordReset()` ile aynı sırayla ve aynı gerekçeyle: yanlış
 * yapılandırılmış bir production'da hata, kullanıcının kayıtlı olup olmamasından bağımsız
 * olarak aynı noktada oluşsun.
 */
export async function sendEmailVerification(
  email: unknown,
  options: SendVerificationOptions = {},
): Promise<void> {
  const baseUrl = options.baseUrl ?? getAppBaseUrl();
  const sender = options.emailSender ?? getEmailSender();

  if (typeof email !== "string") {
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, email: true, emailVerified: true },
  });

  // Token üretimi kullanıcı bulunamasa da yapılır: bu adımın CPU maliyeti kayıtlı/kayıtsız
  // e-posta arasında bariz bir timing farkı yaratmasın (`requestPasswordReset` ile aynı).
  const rawToken = generateVerificationToken();
  const tokenHash = hashVerificationToken(rawToken);

  if (!user || user.emailVerified) {
    return;
  }

  // Eski, kullanılmamış token'lar iptal edilir: aynı anda yalnızca en güncel talebin linki
  // çalışsın. Kullanıcı "tekrar gönder"e üç kez basarsa üç geçerli link dolaşımda kalmamalı.
  await prisma.$transaction([
    prisma.emailVerificationToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
      },
    }),
  ]);

  const verifyUrl = `${baseUrl}/verify-email?token=${rawToken}`;
  await sender.sendEmailVerificationEmail({ to: user.email, verifyUrl });
}

export type VerifyEmailResult = { ok: true } | { ok: false; status: 400; error: string };

/**
 * Token hatası AYRIŞTIRILMAZ (invariant #7): bulunamadı / süresi doldu / zaten kullanıldı —
 * hepsi aynı genel mesaj. Ayrıştırmak, geçerli token uzayını daraltmak için kullanılabilirdi.
 */
const INVALID_OR_EXPIRED_TOKEN_ERROR = "Invalid or expired token";

/**
 * Token'ı tüketir ve `emailVerified`'ı doldurur.
 *
 * RACE CONDITION: tüketim TEK atomik `updateMany` ile yapılır
 * (`WHERE tokenHash = ? AND usedAt IS NULL AND expiresAt > now()`). Aynı token eşzamanlı iki
 * kez gönderilse bile DB seviyesinde yalnızca biri `count === 1` görür. "Önce oku, sonra yaz"
 * (TOCTOU) deseninin aksine bu yaklaşım, iki isteğin aynı token'ı başarıyla tüketmesini
 * YAPISAL olarak imkânsız kılar (`resetPassword()` ile aynı desen).
 *
 * BAŞKA BİR KULLANICININ TOKEN'I İŞE YARAMAZ: hedef kullanıcı token kaydından okunur, çağıran
 * oturumdan DEĞİL. Bu yüzden endpoint kimlik doğrulaması bile istemez — token'ın kendisi
 * yetkidir ve yalnızca sahibinin hesabını doğrular.
 */
export async function verifyEmail(token: unknown): Promise<VerifyEmailResult> {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, status: 400, error: INVALID_OR_EXPIRED_TOKEN_ERROR };
  }

  const tokenHash = hashVerificationToken(token);

  const claim = await prisma.emailVerificationToken.updateMany({
    where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });

  if (claim.count !== 1) {
    return { ok: false, status: 400, error: INVALID_OR_EXPIRED_TOKEN_ERROR };
  }

  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
    select: { userId: true },
  });

  if (!record) {
    return { ok: false, status: 400, error: INVALID_OR_EXPIRED_TOKEN_ERROR };
  }

  // `credentialsChangedAt` BUMPLANMAZ: e-posta doğrulamak bir credential değişikliği değildir
  // ve kullanıcıyı tüm oturumlarından düşürmek (bkz. Issue #26/#186) burada yanlış olurdu —
  // linke tıklayan kişi zaten hesabın sahibidir.
  await prisma.user.updateMany({
    where: { id: record.userId },
    data: { emailVerified: new Date() },
  });

  return { ok: true };
}

/**
 * Bir kullanıcının e-postası doğrulanmış mı?
 *
 * TEK OKUMA NOKTASI: "doğrulanmamış hesap ne yapamaz" kuralı birden fazla yerde uygulanacağı
 * için (tenant oluşturma, davet kabulü) kontrolün kopyalanması, birinin unutulmasıyla sonuçlanır.
 */
export async function isEmailVerified(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailVerified: true },
  });
  return Boolean(user?.emailVerified);
}
