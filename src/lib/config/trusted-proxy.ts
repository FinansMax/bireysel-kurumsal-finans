/**
 * Güvenilir proxy yapılandırması için tek çözümleme noktası (Issue #182).
 *
 * NEDEN VAR: `getClientIp()` istemci IP'sini `x-forwarded-for`'un ilk segmentinden okur ve bu
 * değer rate-limit bucket key'ini belirler. Header'ı uygulamanın ÖNÜNDEKİ güvenilir bir proxy
 * set ediyorsa bu doğrudur. Ama uygulama doğrudan internete açılırsa (nginx'siz bir VPS),
 * istemci header'ı serbestçe uydurup HER İSTEKTE yeni bir bucket'a düşer ve **rate limit
 * tamamen etkisiz kalır** — brute-force, enumeration ve pahalı endpoint koruması hep birden
 * yok olur. #181 ile dağıtık bir store kurulsa bile bu açık kapanmaz.
 *
 * Bu sınır bugüne kadar yalnızca yorumlarda ve README'de yazılıydı; kodda ve deployment'ta
 * hiçbir zorlayıcı yoktu. Bu modül o zorlayıcıdır.
 *
 * NEDEN VARSAYILAN YOK (production'da): sessiz bir varsayılan tam da engellenmek istenen şey.
 * `TRUSTED_PROXY=true` varsayılan olsaydı, proxy'siz bir deployment sessizce "korumalı"
 * görünürdü. `false` varsayılan olsaydı, proxy'li normal bir deployment sessizce TÜM trafiği
 * tek bir paylaşılan bucket'a sıkıştırır ve gerçek kullanıcılar birbirinin limitini yerdi.
 * İkisi de sessizce yanlış; bu yüzden production'da açıkça yazılmak ZORUNDA
 * (`src/lib/config/app-url.ts` ile aynı duruş ve aynı gerekçe).
 */

export const MISSING_TRUSTED_PROXY_ERROR =
  "TRUSTED_PROXY is not set. It is required in production because it decides whether the " +
  "x-forwarded-for header may be trusted for rate limiting. Set it to 'true' when the app " +
  "runs behind a reverse proxy that sets the header itself, 'false' otherwise.";

export function invalidTrustedProxyError(value: string): string {
  return `TRUSTED_PROXY '${value}' is invalid. Use exactly 'true' or 'false'.`;
}

/**
 * `TRUSTED_PROXY`'yi çözer.
 *
 * - `"true"` → `x-forwarded-for` okunur (proxy arkasındayız).
 * - `"false"` → header hiç okunmaz; tüm istekler paylaşılan `unknown` bucket'ına düşer.
 * - Tanımsız: production'da hata, diğer ortamlarda `true`.
 * - Başka herhangi bir değer (`"1"`, `"yes"`, `"TRUE"`) HER ortamda hatadır. Gevşek ayrıştırma
 *   (`value !== "false"` gibi) yazım hatası olan bir production yapılandırmasını sessizce
 *   "güveniyoruz"a çevirirdi — bu modülün var olma sebebinin tam tersi.
 *
 * Production DIŞINDA varsayılanın `true` olması bilinçlidir: geliştirme ve test ortamında
 * istekler proxy'siz gelir ve testler `x-forwarded-for` ile farklı istemcileri simüle eder
 * (bkz. `e2e/support/rate-limit.ts`). Burada `false` varsaymak, tüm test suite'ini tek bucket'a
 * sıkıştırıp rate-limit testlerini anlamsız kılardı.
 */
export function isTrustedProxy(): boolean {
  const configured = process.env.TRUSTED_PROXY?.trim();

  if (configured === undefined || configured === "") {
    if (process.env.NODE_ENV === "production") {
      throw new Error(MISSING_TRUSTED_PROXY_ERROR);
    }
    return true;
  }

  if (configured === "true") return true;
  if (configured === "false") return false;

  throw new Error(invalidTrustedProxyError(configured));
}
