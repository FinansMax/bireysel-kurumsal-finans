import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "@/lib/audit/actions";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { prisma } from "@/lib/prisma";

import { updateUserPassword } from "./credentials";
import { hashPassword, verifyPassword } from "./password";
import { isValidPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./validation";

// Mevcut şifrenin yanlış olması, gövdede hiç gönderilmemiş olması ve hesabın şifresiz olması
// AYNI genel hataya düşer — hangisinin geçerli olduğu dışarıya sızdırılmaz (bkz. password-reset
// akışındaki INVALID_OR_EXPIRED_TOKEN_ERROR ile aynı yaklaşım).
const INVALID_CURRENT_PASSWORD_ERROR = "Current password is incorrect";
const INVALID_NEW_PASSWORD_ERROR = `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`;

export type ChangePasswordResult = { ok: true } | { ok: false; status: 400 | 401; error: string };

/**
 * Giriş yapmış bir kullanıcının, MEVCUT şifresini doğrulayarak yeni bir şifre belirlemesi
 * (Issue #33). "Şifremi unuttum" akışından (#7) farklıdır: burada kanıt bir e-posta token'ı
 * değil, kullanıcının mevcut şifresidir.
 *
 * `userId`, çağıran route'ta `requireUser()`'dan gelen trusted session sahibidir — client'ın
 * gönderdiği bir değer DEĞİLDİR. Bu yüzden fonksiyon "bu kullanıcı kimdir?" sorusunu tekrar
 * sormaz; yalnızca "bu kullanıcı mevcut şifresini biliyor mu?" sorusunu yanıtlar.
 *
 * NEDEN mevcut şifre doğrulanır: session cookie'si çalınmış bir saldırgan, bu adım olmadan
 * şifreyi değiştirip hesabı kalıcı olarak devralabilirdi. Mevcut şifre kontrolü, session
 * hırsızlığı ile tam hesap devralma arasındaki adımı kapatır.
 *
 * KONTROL SIRASI: Önce mevcut şifre doğrulanır, sonra yeni şifre politikası kontrol edilir.
 * Mevcut şifreyi kanıtlayamayan bir çağrıya, yeni şifre hakkında geri bildirim dahil hiçbir
 * ek bilgi verilmez. (Password reset akışında sıra terstir — orada erken doğrulama, tek
 * kullanımlık token'ın zayıf bir şifre yüzünden boşa yanmasını engeller; burada yakılacak bir
 * token yoktur.)
 *
 * SESSION REVOCATION (Issue #26): Şifre `updateUserPassword()` ile güncellenir; bu fonksiyon
 * `credentialsChangedAt`'i AYNI UPDATE ifadesinde atomik olarak bumplar. Sonuç: değişiklikten
 * ÖNCE üretilmiş tüm JWT session'ları — kullanıcının bu isteği yaptığı session dahil — bir
 * sonraki istekte geçersiz sayılır (bkz. README "Session Revocation" ve orada belgelenen
 * "kullanıcı yeniden giriş yapmak zorundadır" sonucu).
 *
 * EŞZAMANLILIK: "Oku → scrypt ile doğrula → yaz" arasında teorik bir TOCTOU penceresi vardır
 * (bu adımlar tek bir SQL ifadesine indirgenemez; scrypt doğrulaması DB'de yapılamaz). Bu
 * bilinçli olarak kabul edilmiştir: pencereyi kullanabilecek tek senaryo, aynı anda çalışan
 * bir password reset (#7) veya ikinci bir change-password isteğidir ve HER İKİSİ de zaten
 * hesap sahibinin kendi yetkisiyle yapılan meşru credential değişiklikleridir — sonuç
 * "son yazan kazanır" olur, yetki yükselmesi doğmaz. Pahalı scrypt çağrısını bir DB
 * transaction'ı içinde tutmak bu nedenle gereksiz maliyet olurdu.
 */
export async function changePassword(
  userId: string,
  currentPassword: unknown,
  newPassword: unknown,
): Promise<ChangePasswordResult> {
  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    return rejectCurrentPassword(userId);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });

  // Şifresiz hesap (`passwordHash` nullable'dır — ileride OAuth ile oluşturulmuş hesaplar) bu
  // akışla şifre BELİRLEYEMEZ: doğrulanacak bir mevcut şifre yoktur, dolayısıyla endpoint
  // "mevcut şifreyi bilme" kanıtını sağlayamaz. Böyle bir hesaba şifre eklemek ayrı bir akış
  // gerektirir (kapsam dışı).
  if (!user?.passwordHash) {
    return rejectCurrentPassword(userId);
  }

  const isCurrentPasswordValid = await verifyPassword(currentPassword, user.passwordHash);
  if (!isCurrentPasswordValid) {
    return rejectCurrentPassword(userId);
  }

  if (typeof newPassword !== "string" || !isValidPassword(newPassword)) {
    return { ok: false, status: 400, error: INVALID_NEW_PASSWORD_ERROR };
  }

  const passwordHash = await hashPassword(newPassword);
  await updateUserPassword(prisma, userId, passwordHash);

  await writeAuditLog({
    actorUserId: userId,
    action: AUDIT_ACTIONS.AUTH_PASSWORD_CHANGED,
    targetType: AUDIT_TARGET_TYPES.USER,
    targetId: userId,
  });

  return { ok: true };
}

/**
 * Başarısız denemeyi audit'e yazar ve tek tip 401 döner. Ayrı bir fonksiyon olmasının nedeni,
 * üç farklı red sebebinin (eksik/boş giriş, şifresiz hesap, yanlış şifre) yanıt ve audit
 * açısından AYIRT EDİLEMEZ kalmasını yapısal olarak garanti etmektir.
 */
async function rejectCurrentPassword(userId: string): Promise<ChangePasswordResult> {
  await writeAuditLog({
    actorUserId: userId,
    action: AUDIT_ACTIONS.AUTH_PASSWORD_CHANGE_FAILURE,
    targetType: AUDIT_TARGET_TYPES.USER,
    targetId: userId,
  });

  return { ok: false, status: 401, error: INVALID_CURRENT_PASSWORD_ERROR };
}
