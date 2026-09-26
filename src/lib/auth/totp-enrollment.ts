import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "@/lib/audit/actions";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { prisma } from "@/lib/prisma";

import { verifyPassword } from "./password";
import { generateRecoveryCodes, replaceRecoveryCodes } from "./recovery-codes";
import { decryptTotpSecret, encryptTotpSecret } from "./totp-crypto";
import { buildOtpAuthUri, generateTotpSecret, verifyTotp } from "./totp";

/**
 * TOTP kurulum/kapatma akışı (Issue #193).
 *
 * ÜÇ ADIM, VE NEDEN ÜÇ: kurulum "başlat → doğrula → aktif" olarak ayrılmıştır. Tek adımda
 * aktifleştirmek, QR'ı okuyamamış ya da yanlış cihaza eklemiş bir kullanıcıyı kendi
 * hesabından KALICI olarak kilitlerdi. `confirmedAt` dolana kadar 2FA aktif sayılmaz ve
 * giriş akışı hiç değişmez.
 *
 * Servis sözleşmesi (docs/conventions.md): throw etmez, ayrıştırılmış union döner.
 */

const ISSUER = "FinansMax";

export type BeginTotpEnrollmentResult =
  | {
      ok: true;
      /** Kullanıcının elle girebilmesi için base32 sır. */
      secret: string;
      otpauthUri: string;
      /** SADECE BU YANITTA görünür — DB'de yalnızca hash'leri var. */
      recoveryCodes: string[];
    }
  | { ok: false; status: 404 | 409; error: string };

/**
 * Kurulumu başlatır: sır üretir, şifreler, kurtarma kodlarını yazar.
 *
 * KURTARMA KODLARI KURULUMUN BAŞINDA ÜRETİLİR, sonunda değil. Kullanıcı doğrulama kodunu
 * girmeden önce kodları görmüş olmalıdır — aksi halde "authenticator eklendi ama kurtarma
 * kodu görülmedi" penceresi oluşur ve o pencerede telefonunu kaybeden kullanıcı kilitlenir.
 *
 * İDEMPOTENT: doğrulanmamış bir kurulum varsa ÜZERİNE YAZILIR. Yarım kalmış kurulumlar
 * birikmemeli ve kullanıcı "baştan başla" diyebilmelidir.
 *
 * ZATEN AKTİF 2FA VARSA `409` — sessizce yeni bir sır üretmek, kullanıcının çalışan
 * authenticator'ını fark ettirmeden geçersiz kılardı. Yenilemek isteyen önce kapatmalıdır.
 */
export async function beginTotpEnrollment(userId: string): Promise<BeginTotpEnrollmentResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });

  if (!user) {
    return { ok: false, status: 404, error: "User not found" };
  }

  const existing = await prisma.userTotpSecret.findUnique({
    where: { userId },
    select: { confirmedAt: true },
  });

  if (existing?.confirmedAt) {
    return { ok: false, status: 409, error: "Two-factor authentication is already enabled" };
  }

  const secret = generateTotpSecret();
  const recoveryCodes = generateRecoveryCodes();

  // Sır ve kurtarma kodları TEK transaction'da yazılır: ikisi tek bir karardır.
  await prisma.$transaction(async (tx) => {
    await tx.userTotpSecret.upsert({
      where: { userId },
      create: { userId, secretCipher: encryptTotpSecret(secret) },
      // `confirmedAt` ve `lastUsedStep` bilerek SIFIRLANIR: yeni bir sır, eski doğrulama
      // durumunu taşımamalıdır.
      update: { secretCipher: encryptTotpSecret(secret), confirmedAt: null, lastUsedStep: null },
    });

    await replaceRecoveryCodes(tx, userId, recoveryCodes);
  });

  return {
    ok: true,
    secret,
    otpauthUri: buildOtpAuthUri({ secretBase32: secret, accountName: user.email, issuer: ISSUER }),
    recoveryCodes,
  };
}

export type ConfirmTotpEnrollmentResult =
  | { ok: true }
  | { ok: false; status: 400 | 404 | 409; error: string };

const INVALID_CODE_ERROR = "Invalid verification code";

/**
 * Kurulumu doğrular ve 2FA'yı AKTİFLEŞTİRİR.
 *
 * BAŞARILI DOĞRULAMADA `lastUsedStep` DE YAZILIR: aksi halde kurulumda kullanılan kod,
 * hemen ardından bir giriş denemesinde TEKRAR kullanılabilirdi. Kurulum ve giriş aynı replay
 * penceresini paylaşır.
 *
 * Aktifleştirme koşullu bir `updateMany` ile yapılır (`confirmedAt: null`): eşzamanlı iki
 * doğrulama isteğinden yalnızca biri aktifleştirir.
 */
export async function confirmTotpEnrollment(
  userId: string,
  code: unknown,
): Promise<ConfirmTotpEnrollmentResult> {
  const record = await prisma.userTotpSecret.findUnique({
    where: { userId },
    select: { secretCipher: true, confirmedAt: true, lastUsedStep: true },
  });

  if (!record) {
    return { ok: false, status: 404, error: "Two-factor setup has not been started" };
  }

  if (record.confirmedAt) {
    return { ok: false, status: 409, error: "Two-factor authentication is already enabled" };
  }

  const secret = decryptTotpSecret(record.secretCipher);
  if (!secret) {
    // Sır çözülemiyor (ör. AUTH_SECRET döndürülmüş). Kullanıcıya sebebi söylenmez;
    // kurulumu yeniden başlatması gerekir.
    return { ok: false, status: 400, error: INVALID_CODE_ERROR };
  }

  const result = verifyTotp(secret, code, {
    minStepExclusive: record.lastUsedStep === null ? null : Number(record.lastUsedStep),
  });

  if (!result.valid) {
    await writeAuditLog({
      actorUserId: userId,
      action: AUDIT_ACTIONS.AUTH_TOTP_FAILURE,
      targetType: AUDIT_TARGET_TYPES.USER,
      targetId: userId,
    });
    return { ok: false, status: 400, error: INVALID_CODE_ERROR };
  }

  const updated = await prisma.userTotpSecret.updateMany({
    where: { userId, confirmedAt: null },
    data: { confirmedAt: new Date(), lastUsedStep: BigInt(result.step) },
  });

  if (updated.count !== 1) {
    return { ok: false, status: 409, error: "Two-factor authentication is already enabled" };
  }

  // Audit transaction'dan SONRA, best-effort (invariant #8).
  await writeAuditLog({
    actorUserId: userId,
    action: AUDIT_ACTIONS.AUTH_TOTP_ENABLED,
    targetType: AUDIT_TARGET_TYPES.USER,
    targetId: userId,
  });

  return { ok: true };
}

export type DisableTotpResult = { ok: true } | { ok: false; status: 400 | 403 | 404; error: string };

/**
 * 2FA'yı kapatır. MEVCUT ŞİFREYİ İSTER.
 *
 * NEDEN ŞİFRE: 2FA'yı kapatmak, hesabın güvenlik seviyesini DÜŞÜREN bir işlemdir. Çalınmış
 * bir session cookie'si ile tek tıkla kapatılabilseydi, 2FA'nın koruduğu şeyi 2FA'nın kendisi
 * üzerinden aşmak mümkün olurdu. Aynı gerekçe `change-password` akışında da geçerlidir
 * (bkz. README).
 *
 * KURTARMA KODLARI DA SİLİNİR: 2FA kapalıyken duran kodlar, ileride yeniden açıldığında
 * kullanıcının artık sakladığını sanmadığı eski kodların geçerli kalmasına yol açardı.
 */
export async function disableTotp(userId: string, password: unknown): Promise<DisableTotpResult> {
  if (typeof password !== "string" || password.length === 0) {
    return { ok: false, status: 400, error: "Current password is required" };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });

  if (!user) {
    return { ok: false, status: 404, error: "User not found" };
  }

  if (!user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    await writeAuditLog({
      actorUserId: userId,
      action: AUDIT_ACTIONS.AUTH_TOTP_FAILURE,
      targetType: AUDIT_TARGET_TYPES.USER,
      targetId: userId,
    });
    return { ok: false, status: 403, error: "Current password is incorrect" };
  }

  const existing = await prisma.userTotpSecret.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!existing) {
    return { ok: false, status: 404, error: "Two-factor authentication is not enabled" };
  }

  await prisma.$transaction([
    prisma.userTotpSecret.deleteMany({ where: { userId } }),
    prisma.userRecoveryCode.deleteMany({ where: { userId } }),
  ]);

  await writeAuditLog({
    actorUserId: userId,
    action: AUDIT_ACTIONS.AUTH_TOTP_DISABLED,
    targetType: AUDIT_TARGET_TYPES.USER,
    targetId: userId,
  });

  return { ok: true };
}

/** 2FA bu kullanıcı için AKTİF mi (yalnızca `confirmedAt` dolu olanlar sayılır). */
export async function isTotpEnabled(userId: string): Promise<boolean> {
  const record = await prisma.userTotpSecret.findUnique({
    where: { userId },
    select: { confirmedAt: true },
  });

  return record?.confirmedAt != null;
}
