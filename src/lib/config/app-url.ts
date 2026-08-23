/**
 * Uygulamanın dışarıya görünen kök adresi (`APP_BASE_URL`) için tek çözümleme noktası.
 *
 * NEDEN VAR: Bu değer, kullanıcıya E-POSTA ile gönderilen mutlak linkleri üretir (şifre
 * sıfırlama, tenant daveti). Ayarlanmadığında eski davranış sessizce
 * `http://localhost:3000`'e düşüyordu — yani production'da gönderilen her reset/davet
 * linki çalışmaz hale geliyor, üstelik hiçbir hata üretmediği için bu durum fark
 * edilmiyordu. Konfigürasyon hatasının sessizce kullanıcıya ulaşan bozuk bir linke
 * dönüşmesi yerine, production'da GÜRÜLTÜLÜ şekilde başarısız olmak tercih edilmiştir.
 *
 * KULLANIM KURALI — user enumeration: Bu fonksiyon, e-posta linki üreten akışlarda
 * herhangi bir DB erişiminden ÖNCE çağrılmalıdır. Aksi halde (ör. yalnızca kullanıcı
 * bulunduğunda çağrılırsa) yanlış yapılandırılmış bir production ortamında "kayıtlı
 * e-posta → 500, kayıtsız e-posta → 200" farkı oluşur ve bu, Issue #7'de kapatılan
 * user-enumeration oracle'ını geri getirirdi. Mevcut çağrı yerleri (`requestPasswordReset`,
 * `createInvitation`) bu kurala uyar; regresyon testi:
 * `integration/app-url.spec.ts` → "yapılandırma hatası kayıtlı/kayıtsız e-posta ayrımı
 * yaratmaz".
 */

/** Yalnızca production DIŞINDA kullanılan varsayılan. */
export const DEFAULT_DEV_BASE_URL = "http://localhost:3000";

export const MISSING_APP_BASE_URL_ERROR =
  "APP_BASE_URL is not set. It is required in production because password reset and " +
  "invitation e-mails contain absolute links built from it.";

export const INVALID_APP_BASE_URL_ERROR =
  "APP_BASE_URL must be an absolute http(s) URL (e.g. https://app.example.com).";

/**
 * `APP_BASE_URL`'i çözer ve normalize eder (sondaki `/` karakterleri atılır, böylece
 * `${baseUrl}/reset-password` her zaman tek eğik çizgi üretir).
 *
 * - Değer varsa: mutlak bir `http(s)` URL olmalıdır; değilse HER ortamda hata fırlatır
 *   (geçersiz bir değer her ortamda bir yapılandırma hatasıdır ve sessizce tolere edilirse
 *   yine bozuk link üretir).
 * - Değer yoksa: production'da hata fırlatır, diğer ortamlarda `DEFAULT_DEV_BASE_URL` döner.
 */
export function getAppBaseUrl(): string {
  const configured = process.env.APP_BASE_URL?.trim();

  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(MISSING_APP_BASE_URL_ERROR);
    }
    return DEFAULT_DEV_BASE_URL;
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error(INVALID_APP_BASE_URL_ERROR);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(INVALID_APP_BASE_URL_ERROR);
  }

  return configured.replace(/\/+$/, "");
}
