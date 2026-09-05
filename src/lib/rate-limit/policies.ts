/**
 * Auth/tenant-creation endpoint'leri için merkezi, typed rate-limit policy katalogu (Issue #27).
 *
 * Magic number'ların route'lara dağılmasını önlemek için TEK kaynak burasıdır. Değerler bu
 * uygulamanın gerçek kullanım biçimine göre seçilmiştir (aşırı düşük TEST kolaylığı için
 * DEĞİL — bkz. her policy'nin yanındaki gerekçe):
 *
 * - SIGNIN 10/5dk: Şifre unutan/yanlış yazan meşru bir kullanıcı birkaç deneme yapabilir;
 *   10 deneme/5dk meşru kullanımı sınırlamazken scrypt tabanlı brute-force'u önemli ölçüde
 *   yavaşlatır (bkz. `src/lib/auth/authenticate.ts`'teki pahalı hash karşılaştırması).
 * - SIGNUP 5/10dk: Kayıt, kullanıcı başına ZATEN nadir bir işlemdir; 5/10dk otomatik hesap
 *   oluşturma/spam'i sınırlar, gerçek bir kullanıcının aynı IP'den birkaç kez denemesine
 *   (typo/farklı e-posta) izin verir.
 * - FORGOT_PASSWORD 5/15dk: E-posta gönderimi içerdiği için (gerçek sağlayıcıda maliyetli
 *   olabilir) ve zaten nadir kullanılan bir akış olduğu için en sıkı pencereye sahiptir.
 * - RESET_PASSWORD 10/15dk: Token'ın kendisi 256 bit olduğu için brute-force birincil tehdit
 *   DEĞİLDİR; buradaki amaç, kimlik doğrulaması gerektirmeyen ve her istekte DB'ye yazan
 *   (`passwordResetToken.updateMany`) bu credential-değiştirme endpoint'inin sınırsız
 *   çağrılabilmesini engellemektir. FORGOT_PASSWORD'dan (5) daha geniş tutulmasının nedeni,
 *   meşru bir kullanıcının yeni şifresi şifre politikasına takıldığında (400) aynı pencerede
 *   birkaç kez tekrar denemesinin normal olmasıdır.
 * - CHANGE_PASSWORD 10/15dk: Authenticated bir endpoint olmasına RAĞMEN limit gerekir —
 *   endpoint mevcut şifreyi doğruladığı için, çalınmış bir session cookie'siyle mevcut şifreyi
 *   online brute-force etme girişimi gerçek bir tehdittir (session hırsızlığını tam hesap
 *   devralmaya çeviren adım tam olarak budur). RESET_PASSWORD ile aynı değerler seçildi: her
 *   ikisi de credential değiştiren, meşru kullanımı nadir olan ve şifre politikası hatası
 *   nedeniyle birkaç kez tekrar denenebilen akışlardır.
 * - TENANT_CREATE 10/10dk: Authenticated bir kullanıcı meşru şekilde birden fazla tenant
 *   oluşturabilir (ör. hem kişisel hem kurumsal); 10/10dk otomatik toplu tenant oluşturmayı
 *   sınırlarken gerçek kullanımı kısıtlamaz.
 *
 * Bu repo'da issue'nun önerdiği başlangıç değerleri, mevcut kullanım biçimiyle tutarlı
 * bulunduğu için AYNEN kullanılmıştır.
 */
export type RateLimitPolicy = {
  limit: number;
  windowMs: number;
};

const MINUTES = 60 * 1000;

export const RATE_LIMIT_POLICIES = {
  SIGNIN: { limit: 10, windowMs: 5 * MINUTES },
  SIGNUP: { limit: 5, windowMs: 10 * MINUTES },
  FORGOT_PASSWORD: { limit: 5, windowMs: 15 * MINUTES },
  RESET_PASSWORD: { limit: 10, windowMs: 15 * MINUTES },
  CHANGE_PASSWORD: { limit: 10, windowMs: 15 * MINUTES },
  // REVOKE_SESSIONS 5/15dk: authenticated ve idempotent bir işlemdir, ama her çağrı TÜM
  // oturumları düşürür — çalınmış bir cookie ile tekrar tekrar çağrılırsa meşru kullanıcının
  // sürekli dışarı atılmasına (kendine DoS) yol açar. 5, gerçek "her yerden çıkış" ihtiyacını
  // fazlasıyla karşılar; kimse 15 dakikada beşten fazla kez tüm cihazlarından çıkmaz.
  REVOKE_SESSIONS: { limit: 5, windowMs: 15 * MINUTES },
  TENANT_CREATE: { limit: 10, windowMs: 10 * MINUTES },
  // DATA_EXPORT 2/saat (Issue #194): uretim PAHALIDIR (tenant'in tum tablolarini okur, ZIP
  // uretir, diske yazar) ve her calisma kalici bir dosya birakir. Sinirsiz birakmak, calinmis
  // bir OWNER oturumuyla diski doldurmanin ve ayni veriyi tekrar tekrar disariya tasimanin
  // yolu olurdu. 2, gercek bir tasima ihtiyacini fazlasiyla karsilar.
  DATA_EXPORT: { limit: 2, windowMs: 60 * MINUTES },
  COLLECTIONS_MANAGE: { limit: 60, windowMs: 1 * MINUTES },
  // VERIFY_EMAIL 10/15dk (Issue #190): token 256 bit olduğu için brute-force birincil tehdit
  // DEĞİLDİR; amaç, kimlik istemeyen ve her çağrıda DB'ye yazan bu endpoint'in sınırsız
  // çağrılmasını engellemektir (RESET_PASSWORD ile aynı gerekçe ve aynı değerler).
  VERIFY_EMAIL: { limit: 10, windowMs: 15 * MINUTES },
  // RESEND_VERIFICATION 3/15dk: her çağrı bir e-posta GÖNDERİR (gerçek sağlayıcıda
  // maliyetli) ve aynı adrese tekrar tekrar mesaj göndermek hedef kullanıcı açısından
  // tacize dönüşebilir. FORGOT_PASSWORD'dan (5) daha dar: doğrulama linki 24 saat yaşıyor,
  // tekrar isteme ihtiyacı çok daha nadir.
  RESEND_VERIFICATION: { limit: 3, windowMs: 15 * MINUTES },
  // MAINTENANCE 10/15dk (Issue #188): bakım endpoint'i PUBLIC'tir (oturum istemez, paylaşılan
  // bir anahtarla korunur) ve PAHALIDIR (toplu okuma + silme + dosya yazma). Limitin ikinci
  // işlevi, anahtarın brute-force edilmesini yavaşlatmaktır. 10, günlük çalışan bir cron'un
  // `hasMore` nedeniyle birkaç kez arka arkaya çağrılmasına yer bırakır; insan eliyle
  // tetiklenen bir denemeyi de engellemez.
  MAINTENANCE: { limit: 10, windowMs: 15 * MINUTES },
} as const satisfies Record<string, RateLimitPolicy>;

/**
 * Bucket key prefix'leri — raw credential/PII İÇERMEZ, sadece "hangi mantıksal endpoint"
 * bilgisini taşır. Gerçek key, `buildRateLimitKey()` ile buna istemci IP'si eklenerek kurulur
 * (bkz. `request-key.ts`), ör. `auth:sign-in:203.0.113.7`.
 */
export const RATE_LIMIT_BUCKETS = {
  SIGNIN: "auth:sign-in",
  SIGNUP: "auth:sign-up",
  FORGOT_PASSWORD: "auth:forgot-password",
  RESET_PASSWORD: "auth:reset-password",
  CHANGE_PASSWORD: "auth:change-password",
  REVOKE_SESSIONS: "auth:revoke-sessions",
  TENANT_CREATE: "tenant:create",
  DATA_EXPORT: "tenant:data-export",
  COLLECTIONS_MANAGE: "collections:manage",
  VERIFY_EMAIL: "auth:verify-email",
  RESEND_VERIFICATION: "auth:resend-verification",
  MAINTENANCE: "maintenance",
} as const;
