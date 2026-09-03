import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "@/lib/audit/actions";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { prisma } from "@/lib/prisma";

import { consumeRecoveryCode } from "./recovery-codes";
import { decryptTotpSecret } from "./totp-crypto";
import { verifyTotp } from "./totp";

/**
 * Giriş akışının ikinci adımı (Issue #193).
 *
 * Bu modül YALNIZCA "bu kullanıcı için bu ikinci faktör geçerli mi" sorusunu cevaplar.
 * Şifrenin doğrulanması `authenticate.ts`'te, ondan ÖNCE yapılır ve buraya asla şifre
 * doğrulanmadan gelinmez.
 */

export type SecondFactorStatus =
  /** 2FA aktif değil — giriş akışı değişmez. */
  | { required: false }
  /** 2FA aktif; ikinci faktör gerekiyor. */
  | { required: true };

/**
 * 2FA aktif mi? Giriş yolunda kullanılacak DAR bir sorgu.
 *
 * `confirmedAt` NULL OLAN KAYIT SAYILMAZ: kurulumu başlatıp yarıda bırakmış bir kullanıcının
 * girişini engellemek, onu kendi hesabından kilitlemek olurdu.
 */
export async function getSecondFactorStatus(userId: string): Promise<SecondFactorStatus> {
  const record = await prisma.userTotpSecret.findUnique({
    where: { userId },
    select: { confirmedAt: true },
  });

  return record?.confirmedAt ? { required: true } : { required: false };
}

export type SecondFactorInput = {
  /** Authenticator uygulamasından 6 haneli kod. */
  totp?: unknown;
  /** Alternatif: tek kullanımlık kurtarma kodu. */
  recoveryCode?: unknown;
};

/**
 * İkinci faktörü doğrular.
 *
 * TOTP VE KURTARMA KODU AYRI YOLLARDIR ve ikisi de denenir — kullanıcı hangisini
 * gönderdiyse o çalışır. Önce TOTP denenir çünkü olağan yol odur; kurtarma kodu tüketen bir
 * yan etki taşıdığı için gereksiz yere çalıştırılmaz.
 *
 * BAŞARISIZLIK NEDENİ AYRIŞTIRILMAZ: "kod yanlış" ile "kurtarma kodu zaten kullanılmış"
 * dışarıya aynı görünür (invariant #7). Çağıran taraf tek bir genel hata döner.
 *
 * REPLAY: başarılı bir TOTP doğrulamasında `lastUsedStep` KOŞULLU olarak ilerletilir
 * (`lastUsedStep < step`). Aynı kodla eşzamanlı iki giriş denemesinde yalnızca biri
 * `count === 1` görür; ikincisi reddedilir. "Önce oku, sonra yaz" ile bu yarış açık kalırdı.
 */
export async function verifySecondFactor(
  userId: string,
  input: SecondFactorInput,
): Promise<boolean> {
  const record = await prisma.userTotpSecret.findUnique({
    where: { userId },
    select: { secretCipher: true, confirmedAt: true, lastUsedStep: true },
  });

  if (!record?.confirmedAt) {
    // 2FA aktif değil — bu fonksiyona hiç gelinmemeliydi. Yine de `false` dönülür:
    // "aktif değilse her kod geçerli" gibi bir davranış, çağıran tarafın bir hatasında
    // ikinci faktörü tamamen atlatılabilir kılardı.
    return false;
  }

  if (typeof input.totp === "string" && input.totp.trim().length > 0) {
    const secret = decryptTotpSecret(record.secretCipher);

    if (secret) {
      const result = verifyTotp(secret, input.totp.trim(), {
        minStepExclusive: record.lastUsedStep === null ? null : Number(record.lastUsedStep),
      });

      if (result.valid) {
        const consumed = await prisma.userTotpSecret.updateMany({
          where: {
            userId,
            OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: BigInt(result.step) } }],
          },
          data: { lastUsedStep: BigInt(result.step) },
        });

        if (consumed.count === 1) {
          return true;
        }

        // Yarışı kaybettik: aynı adım bu arada başka bir istek tarafından tüketildi.
        // Bu bir replay girişimidir ve reddedilir.
        await writeFailureAudit(userId);
        return false;
      }
    }
  }

  if (typeof input.recoveryCode === "string" && input.recoveryCode.trim().length > 0) {
    if (await consumeRecoveryCode(userId, input.recoveryCode)) {
      return true;
    }
  }

  await writeFailureAudit(userId);
  return false;
}

/**
 * Başarısız ikinci faktör denemesi audit'e yazılır.
 *
 * LOGIN FAILURE'IN AKSİNE AKTÖR BURADA BİLİNİR: bu noktaya yalnızca ŞİFRESİ DOĞRU bir
 * istekle gelinir, yani kullanıcı kesindir ve kaydetmek enumeration yaratmaz. Arka arkaya
 * gelen `AUTH_TOTP_FAILURE`, sızmış bir şifreyle ikinci faktörü kırma girişiminin en
 * doğrudan göstergesidir (aynı gerekçe `AUTH_PASSWORD_CHANGE_FAILURE`'da da geçerlidir).
 */
async function writeFailureAudit(userId: string): Promise<void> {
  await writeAuditLog({
    actorUserId: userId,
    action: AUDIT_ACTIONS.AUTH_TOTP_FAILURE,
    targetType: AUDIT_TARGET_TYPES.USER,
    targetId: userId,
  });
}
