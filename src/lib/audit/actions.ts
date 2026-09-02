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
  // Kullanıcının kendi iradesiyle tüm oturumlarını kapatması (Issue #186). Güvenlik açısından
  // kritik bir olaydır: "hesabım ele geçirildi mi" araştırmasında zaman çizelgesinin parçasıdır.
  AUTH_SESSIONS_REVOKED: "AUTH_SESSIONS_REVOKED",
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
  // Borç/alacak yaşam döngüsü (Issue #70). Bu kayıtlar paranın kendisi DEĞİLDİR (hiçbir
  // bakiyeyi değiştirmezler) ama bir YÜKÜMLÜLÜĞÜ temsil ederler: "kapandı" işaretlenen bir
  // borcun kim tarafından ve ne zaman kapatıldığı, tutarının sonradan düşürülmesi kadar
  // hesap sorulabilir olmalıdır.
  DEBT_CREDIT_CREATED: "DEBT_CREDIT_CREATED",
  DEBT_CREDIT_UPDATED: "DEBT_CREDIT_UPDATED",
  DEBT_CREDIT_DELETED: "DEBT_CREDIT_DELETED",
  // Modül açma/kapama (Issue #151). Bir modülü açmak tenant'ın ÜRÜN YÜZEYİNİ değiştirir: yeni
  // ekranlar, yeni izinler, yeni veri. Kapatmak ise o verinin görünmez olması demektir. İkisi
  // de "kim ne zaman karar verdi" sorusunun yanıtsız kalmaması gereken olaylardır.
  MODULE_ENABLED: "MODULE_ENABLED",
  MODULE_DISABLED: "MODULE_DISABLED",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const AUDIT_TARGET_TYPES = {
  USER: "USER",
  TENANT: "TENANT",
  MEMBERSHIP: "MEMBERSHIP",
  ACCOUNT: "ACCOUNT",
  CATEGORY: "CATEGORY",
  TRANSACTION: "TRANSACTION",
  DEBT_CREDIT: "DEBT_CREDIT",
  // `targetId` bir satır id'si DEĞİL, modül anahtarıdır ("crm"): modül kapalıyken satır hiç
  // olmayabilir ve kayıt yine de anlamlı olmalıdır.
  MODULE: "MODULE",
} as const;

export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[keyof typeof AUDIT_TARGET_TYPES];
