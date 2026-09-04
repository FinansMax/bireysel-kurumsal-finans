import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "@/lib/audit/actions";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { prisma } from "@/lib/prisma";

import { verifyPassword } from "./password";
import { getSecondFactorStatus, verifySecondFactor } from "./totp-verification";
import { normalizeEmail } from "./validation";

// Kullanıcı bulunamadığında da verifyPassword'un aynı maliyetle çalışması için sabit,
// önceden hesaplanmış bir dummy hash. Bu olmadan "bilinmeyen e-posta" ile "yanlış şifre"
// yanıt süreleri farklı olur ve bu fark bir e-postanın sistemde kayıtlı olup olmadığını
// sızdırabilir (user enumeration / timing side-channel).
const DUMMY_PASSWORD_HASH =
  "a4fada355a6f73f0b683a448eb461e7f:a325e15a48774766495668660b39e95c93943ac93cd5a5cd6e70b11e72a9d4f098752f16f4959245d5ffba63001749330465b14c43f788a5482c9b0e8df8ff57";

export type AuthenticateInput = {
  email: unknown;
  password: unknown;
  /** İkinci faktör — authenticator kodu (Issue #193). */
  totp?: unknown;
  /** İkinci faktör — tek kullanımlık kurtarma kodu (Issue #193). */
  recoveryCode?: unknown;
};

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string | null;
};

/**
 * `null` yerine ayrıştırılmış union (Issue #193).
 *
 * NEDEN DEĞİŞTİ: 2FA'dan önce "başarısız" tek bir şeydi. Artık üç ayrı durum var ve
 * kullanıcıya farklı davranılmalı: şifre yanlış (genel hata), şifre doğru ama kod gerekiyor
 * (kod alanını göster), kod yanlış (kodu tekrar iste). Bunları `null` ile ifade etmek,
 * çağıranın 2FA'lı bir kullanıcıya "şifreniz yanlış" demesine yol açardı.
 *
 * ENUMERATION AÇISINDAN GÜVENLİ: `totp_required` ve `totp_invalid` durumlarına YALNIZCA
 * şifresi DOĞRU bir istekle ulaşılır. Yani bu iki cevap, zaten şifreyi bilen birine hesabın
 * 2FA kullandığını söyler — bilmediği bir şey değildir.
 */
export type AuthenticateResult =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; reason: "invalid_credentials" }
  | { ok: false; reason: "totp_required" }
  | { ok: false; reason: "totp_invalid" };

/**
 * E-posta + şifre (+ varsa ikinci faktör) doğrular (Issue #6, #193).
 *
 * - Şifre karşılaştırması her zaman `verifyPassword` (hash-tabanlı) üzerinden yapılır.
 * - Kullanıcı bulunamadı / şifre yok / şifre yanlış — HEPSİ AYNI `invalid_credentials`
 *   sonucunu verir. Çağıran taraf bu üç durumu ayırt edemez; bir e-postanın sistemde kayıtlı
 *   olup olmadığı ne hata mesajıyla ne de yanıt süresiyle sızdırılmaz.
 *
 * SIRA KRİTİK: şifre HER ZAMAN ikinci faktörden önce doğrulanır. Tersi, ikinci faktörü
 * şifreyi bilmeyen birine karşı da denenebilir kılar ve `AUTH_TOTP_FAILURE` audit kayıtlarını
 * (aktörü bilinen olaylar olarak) anlamsızlaştırırdı.
 *
 * `AUTH_LOGIN_SUCCESS` YALNIZCA HER İKİ FAKTÖR DE GEÇTİĞİNDE yazılır: bu olay "bir oturum
 * verildi" demektir. Şifresi doğru ama kodu yanlış bir denemeyi "login success" olarak
 * kaydetmek, audit log'u hiç var olmamış bir oturum hakkında yanıltırdı.
 */
export async function authenticateUser(input: AuthenticateInput): Promise<AuthenticateResult> {
  if (typeof input.email !== "string" || typeof input.password !== "string") {
    return { ok: false, reason: "invalid_credentials" };
  }

  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(input.email) },
  });

  const isValid = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);

  if (!user || !user.passwordHash || !isValid) {
    // GÜVENLİK: actorUserId bilerek null bırakılır ve girilen email metadata'ya KONMAZ —
    // bilinmeyen e-posta / yanlış şifre / şifresiz hesap durumları burada AYNI genel audit
    // olayına düşer, böylece audit kaydı da (response'un kendisi gibi) user enumeration'a
    // yol açacak bir sinyal taşımaz (bkz. yukarıdaki DUMMY_PASSWORD_HASH dokümantasyonu).
    await writeAuditLog({ action: AUDIT_ACTIONS.AUTH_LOGIN_FAILURE });
    return { ok: false, reason: "invalid_credentials" };
  }

  const secondFactor = await getSecondFactorStatus(user.id);

  if (secondFactor.required) {
    const submitted =
      (typeof input.totp === "string" && input.totp.trim().length > 0) ||
      (typeof input.recoveryCode === "string" && input.recoveryCode.trim().length > 0);

    if (!submitted) {
      // Henüz bir başarısızlık DEĞİL: akışın ikinci adımı isteniyor. Audit'e "failure"
      // yazmak, gerçek saldırı sinyalini gürültüye boğardı.
      return { ok: false, reason: "totp_required" };
    }

    // Başarısızlık audit'i `verifySecondFactor()` içinde yazılır (aktör orada bilinir).
    if (!(await verifySecondFactor(user.id, { totp: input.totp, recoveryCode: input.recoveryCode }))) {
      return { ok: false, reason: "totp_invalid" };
    }
  }

  await writeAuditLog({
    actorUserId: user.id,
    action: AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS,
    targetType: AUDIT_TARGET_TYPES.USER,
    targetId: user.id,
  });

  return { ok: true, user: { id: user.id, email: user.email, name: user.name } };
}
