/**
 * E-posta sağlayıcısı yapılandırması için tek çözümleme noktası (Issue #180).
 *
 * NEDEN VAR — ve neden `app-url.ts` ile AYNI desende: bu değerler, kullanıcıya gerçekten
 * e-posta gidip gitmediğini belirler. Yanlış yapılandırılmış bir production, sessizce
 * "e-postanı kontrol et" diyen ama hiçbir şey göndermeyen bir sisteme dönüşür; kullanıcı
 * hesabına giremez, biz de hiçbir hata görmediğimiz için durumu fark etmeyiz. Bu yüzden
 * production'da eksik/`console` yapılandırma SESSİZCE TOLERE EDİLMEZ, GÜRÜLTÜLÜ şekilde
 * hata verir (bkz. `src/lib/config/app-url.ts`, aynı gerekçe).
 *
 * KULLANIM KURALI — user enumeration: `getAppBaseUrl()` ile birebir aynı kural geçerlidir.
 * Bu fonksiyon, e-posta gönderen akışlarda herhangi bir DB erişiminden ÖNCE çağrılmalıdır.
 * Yalnızca "kullanıcı bulunduğunda" çağrılırsa, yanlış yapılandırılmış bir production'da
 * "kayıtlı e-posta → 500, kayıtsız e-posta → 200" farkı oluşur ve bu, Issue #7'de kapatılan
 * user-enumeration oracle'ını geri getirir. Mevcut çağrı yerleri (`requestPasswordReset`,
 * `createInvitation`) sender'ı ilk satırlarda çözer; regresyon testi:
 * `integration/email-config.spec.ts` → "yapılandırma hatası kayıtlı/kayıtsız ayrımı yaratmaz".
 *
 * GİZLİLİK: `EMAIL_API_KEY` bu modülden DIŞARI yalnızca gönderim transport'una verilir;
 * loglanmaz, audit metadata'sına yazılmaz ve `NEXT_PUBLIC_` önekiyle tanımlanamaz
 * (invariant #5).
 */

/**
 * Desteklenen sağlayıcılar.
 *
 * `as const` + türetilmiş union: rastgele bir string'in sağlayıcı adı olarak kabul edilmesini
 * derleme zamanında engeller (`PERMISSIONS`/`MODULES` ile aynı desen).
 */
export const EMAIL_PROVIDERS = {
  /** Gerçek gönderim YOK: loglar + (production dışında) dosya tabanlı outbox. */
  CONSOLE: "console",
  /** Resend HTTP API üzerinden gerçek gönderim. */
  RESEND: "resend",
} as const;

export type EmailProvider = (typeof EMAIL_PROVIDERS)[keyof typeof EMAIL_PROVIDERS];

/**
 * Çözümlenmiş yapılandırma.
 *
 * Ayrıştırılmış (discriminated) union: `provider === "resend"` olduğunda `apiKey` ve `from`
 * alanlarının DOLU olduğu tipten bellidir. Böylece çağıran tarafta "api key var mı" kontrolü
 * tekrarlanmaz ve unutulamaz.
 */
export type EmailConfig =
  | { provider: typeof EMAIL_PROVIDERS.CONSOLE }
  | { provider: typeof EMAIL_PROVIDERS.RESEND; apiKey: string; from: string };

export const CONSOLE_PROVIDER_IN_PRODUCTION_ERROR =
  "EMAIL_PROVIDER is 'console' in production. A real provider (e.g. 'resend') is required " +
  "because password reset and invitation e-mails would otherwise never be delivered.";

export const MISSING_EMAIL_API_KEY_ERROR =
  "EMAIL_API_KEY is not set. It is required when EMAIL_PROVIDER is a real provider.";

export const MISSING_EMAIL_FROM_ERROR =
  "EMAIL_FROM is not set. It is required when EMAIL_PROVIDER is a real provider " +
  '(e.g. "FinansMax <no-reply@example.com>").';

export function unknownEmailProviderError(value: string): string {
  const supported = Object.values(EMAIL_PROVIDERS).join(", ");
  return `EMAIL_PROVIDER '${value}' is not supported. Supported values: ${supported}.`;
}

function isEmailProvider(value: string): value is EmailProvider {
  return (Object.values(EMAIL_PROVIDERS) as readonly string[]).includes(value);
}

/**
 * `EMAIL_PROVIDER` / `EMAIL_API_KEY` / `EMAIL_FROM` değişkenlerini çözer ve doğrular.
 *
 * - Değer yoksa varsayılan `console`'dur — ama YALNIZCA production dışında. Production'da
 *   eksik değişken de `console` yazmakla aynıdır ve aynı hatayı verir: "varsayılana düşmek"
 *   burada tam olarak engellenmek istenen davranıştır.
 * - Tanınmayan bir sağlayıcı adı HER ortamda hatadır. Sessizce `console`'a düşmek, yazım
 *   hatası olan bir production yapılandırmasını (ör. `EMAIL_PROVIDER=resned`) fark edilmez
 *   kılardı.
 * - `resend` seçiliyse `EMAIL_API_KEY` ve `EMAIL_FROM` zorunludur; eksikse HER ortamda hata
 *   verir (eksik değerle gönderim denemek, sağlayıcıdan 401 alıp sessizce başarısız olmaktır).
 */
export function resolveEmailConfig(): EmailConfig {
  const configured = process.env.EMAIL_PROVIDER?.trim();
  const isProduction = process.env.NODE_ENV === "production";

  if (!configured) {
    if (isProduction) {
      throw new Error(CONSOLE_PROVIDER_IN_PRODUCTION_ERROR);
    }
    return { provider: EMAIL_PROVIDERS.CONSOLE };
  }

  if (!isEmailProvider(configured)) {
    throw new Error(unknownEmailProviderError(configured));
  }

  if (configured === EMAIL_PROVIDERS.CONSOLE) {
    if (isProduction) {
      throw new Error(CONSOLE_PROVIDER_IN_PRODUCTION_ERROR);
    }
    return { provider: EMAIL_PROVIDERS.CONSOLE };
  }

  const apiKey = process.env.EMAIL_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(MISSING_EMAIL_API_KEY_ERROR);
  }

  const from = process.env.EMAIL_FROM?.trim();
  if (!from) {
    throw new Error(MISSING_EMAIL_FROM_ERROR);
  }

  return { provider: EMAIL_PROVIDERS.RESEND, apiKey, from };
}
