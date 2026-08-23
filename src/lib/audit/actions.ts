/**
 * Audit log event isimleri ve target türleri için merkezi, typed katalog (Issue #15).
 *
 * `AuditLog.action`/`targetType` DB'de düz `String` alanlardır (bkz. `prisma/schema.prisma`
 * dokümantasyonu) — yeni bir event türü eklemek migration gerektirmesin diye. Buradaki
 * union tipler, magic string'lerin kod tabanına dağılmasını engelleyen uygulama-seviyesi
 * tip güvenliğini sağlar. Değerler ileride DEĞİŞTİRİLMEDEN kullanılabilecek stabil isimlerdir.
 */
export const AUDIT_ACTIONS = {
  AUTH_LOGIN_SUCCESS: "AUTH_LOGIN_SUCCESS",
  AUTH_LOGIN_FAILURE: "AUTH_LOGIN_FAILURE",
  // Authenticated password change (Issue #33). Başarısız deneme de kaydedilir: login
  // failure'ın AKSİNE burada aktör kesin olarak bilinir (istek zaten authenticated'dır), bu
  // yüzden `actorUserId` doldurulur ve kayıt user enumeration sinyali taşımaz. Bir hesapta
  // arka arkaya gelen AUTH_PASSWORD_CHANGE_FAILURE, çalınmış bir session ile mevcut şifreyi
  // tahmin etme girişiminin en doğrudan göstergesidir.
  AUTH_PASSWORD_CHANGED: "AUTH_PASSWORD_CHANGED",
  AUTH_PASSWORD_CHANGE_FAILURE: "AUTH_PASSWORD_CHANGE_FAILURE",
  TENANT_CREATED: "TENANT_CREATED",
  MEMBERSHIP_ROLE_CHANGED: "MEMBERSHIP_ROLE_CHANGED",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const AUDIT_TARGET_TYPES = {
  USER: "USER",
  TENANT: "TENANT",
  MEMBERSHIP: "MEMBERSHIP",
} as const;

export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[keyof typeof AUDIT_TARGET_TYPES];
