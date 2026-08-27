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
  // Finansal hesap yaşam döngüsü (Issue #46). Bir hesabın oluşturulması/silinmesi ve
  // bakiyesinin elle değiştirilmesi, tenant içinde para akışını doğrudan etkileyen
  // işlemlerdir; "kim ne zaman değiştirdi" sorusunun yanıtsız kalmaması gerekir.
  ACCOUNT_CREATED: "ACCOUNT_CREATED",
  ACCOUNT_UPDATED: "ACCOUNT_UPDATED",
  ACCOUNT_DELETED: "ACCOUNT_DELETED",
  // Kategori yaşam döngüsü (Issue #49). Kategoriler işlemlerin sınıflandırmasıdır: bir
  // kategorinin yeniden adlandırılması veya silinmesi geçmiş raporların anlamını değiştirir,
  // bu yüzden "kim ne zaman değiştirdi" izi tutulur.
  CATEGORY_CREATED: "CATEGORY_CREATED",
  CATEGORY_UPDATED: "CATEGORY_UPDATED",
  CATEGORY_DELETED: "CATEGORY_DELETED",
  // İşlem yaşam döngüsü (Issue #53). Diğer finansal modellerden farkı: bu kayıtlar paranın
  // KENDİSİDİR — her biri bir hesabın bakiyesini değiştirir. Sonradan silinmiş veya tutarı
  // düzeltilmiş bir işlemin izi kalmasaydı, bakiyenin neden değiştiği yanıtsız kalırdı.
  TRANSACTION_CREATED: "TRANSACTION_CREATED",
  TRANSACTION_UPDATED: "TRANSACTION_UPDATED",
  TRANSACTION_DELETED: "TRANSACTION_DELETED",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const AUDIT_TARGET_TYPES = {
  USER: "USER",
  TENANT: "TENANT",
  MEMBERSHIP: "MEMBERSHIP",
  ACCOUNT: "ACCOUNT",
  CATEGORY: "CATEGORY",
  TRANSACTION: "TRANSACTION",
} as const;

export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[keyof typeof AUDIT_TARGET_TYPES];
