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
