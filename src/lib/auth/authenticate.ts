import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "@/lib/audit/actions";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { prisma } from "@/lib/prisma";

import { verifyPassword } from "./password";
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
};

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string | null;
};

/**
 * E-posta + şifre kimlik bilgilerini doğrular (Issue #6).
 *
 * - Şifre karşılaştırması her zaman mevcut `verifyPassword` (hash-tabanlı) helper'ı üzerinden yapılır.
 * - Kullanıcı bulunamadı / şifre yok / şifre yanlış — HEPSİ AYNI ŞEKİLDE `null` döner.
 *   Çağıran taraf (Auth.js) bu üç durumu birbirinden ayırt edemez; böylece bir e-postanın
 *   sistemde kayıtlı olup olmadığı ne hata mesajıyla ne de yanıt süresiyle sızdırılmaz.
 */
export async function authenticateUser(input: AuthenticateInput): Promise<AuthenticatedUser | null> {
  if (typeof input.email !== "string" || typeof input.password !== "string") {
    return null;
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
    return null;
  }

  await writeAuditLog({
    actorUserId: user.id,
    action: AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS,
    targetType: AUDIT_TARGET_TYPES.USER,
    targetId: user.id,
  });

  return { id: user.id, email: user.email, name: user.name };
}
