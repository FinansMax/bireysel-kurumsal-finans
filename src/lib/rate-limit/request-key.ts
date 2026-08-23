/**
 * İstek → rate-limit bucket key türetimi (Issue #27).
 *
 * PROXY TRUST VARSAYIMI: `x-forwarded-for` header'ı, uygulamanın ÖNÜNDE güvenilir bir
 * reverse-proxy/load-balancer (ör. Vercel, nginx) olduğu ve bu header'ı KENDİSİNİN set ettiği
 * varsayımıyla okunur — bu repo bu header'ı doğrulayan/imzalayan bir mekanizma İÇERMEZ. Eğer
 * uygulama arkasında güvenilir bir proxy YOKSA, istemci bu header'ı serbestçe sahteleyip
 * kendi bucket'ını değiştirebilir (kendi rate limit'ini "resetleyebilir"). Bu, tıpkı
 * `authConfig.trustHost: true`'nun (bkz. `src/lib/auth/config.ts`) zaten varsaydığı gibi,
 * production'da güvenilir bir reverse-proxy arkasında çalıştığı varsayılan bir deployment
 * modelidir — bu implementasyon bunu OLDUĞUNDAN GÜVENLİ GÖSTERMEZ, sadece belgeler (bkz. README
 * "Rate Limiting" bölümü).
 */
const UNKNOWN_IP_BUCKET = "unknown";

/**
 * `x-forwarded-for` header'ından istemci IP'sini çıkarır.
 *
 * Format: `client, proxy1, proxy2, ...` — standart davranış olarak İLK değer (asıl istemciye
 * en yakın olan) kullanılır. Whitespace temizlenir; header eksik/boşsa veya ilk segment boşsa
 * (malformed) ortak `"unknown"` bucket'ına düşülür — bu, IP bulunamamasının limiter'ı BYPASS
 * ETMESİNİ engeller: IP'siz TÜM istekler AYNI paylaşılan bucket'ı tüketir, ayrı ayrı sınırsız
 * deneme hakkı kazanmazlar.
 */
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (!forwardedFor) {
    return UNKNOWN_IP_BUCKET;
  }

  const firstIp = forwardedFor.split(",")[0]?.trim();
  return firstIp && firstIp.length > 0 ? firstIp : UNKNOWN_IP_BUCKET;
}

/**
 * Mantıksal endpoint prefix'i (bkz. `policies.ts`'teki `RATE_LIMIT_BUCKETS`) ile istemci
 * kimliğini (IP) birleştirip tam bucket key'ini kurar. Raw email/password/token/cookie ASLA
 * bu key'e girmez — sadece endpoint adı + IP.
 */
export function buildRateLimitKey(bucketPrefix: string, clientIp: string): string {
  return `${bucketPrefix}:${clientIp}`;
}
