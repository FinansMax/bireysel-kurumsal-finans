import { isIP } from "node:net";

import { isTrustedProxy } from "@/lib/config/trusted-proxy";

/**
 * İstek → rate-limit bucket key türetimi (Issue #27, sertleştirme: Issue #182).
 *
 * PROXY TRUST ARTIK BİR VARSAYIM DEĞİL, BİR YAPILANDIRMA. Önceki hâlinde `x-forwarded-for`
 * koşulsuz okunuyordu ve "önümüzde güvenilir bir proxy var" varsayımı yalnızca yorumlarda
 * yazılıydı. Varsayım tutmazsa (uygulama doğrudan internete açılırsa) istemci header'ı
 * uydurup her istekte yeni bir bucket'a düşer ve rate limit TAMAMEN etkisiz kalırdı. Artık
 * karar `TRUSTED_PROXY` ile açıkça verilir ve production'da yazılmak zorundadır
 * (bkz. `src/lib/config/trusted-proxy.ts`, `docs/deployment.md`).
 */

/**
 * IP çıkarılamadığında kullanılan PAYLAŞILAN bucket.
 *
 * Paylaşılan olması kritiktir ve bilinçlidir: IP bulunamaması limiter'ı BYPASS ETMEZ. IP'siz
 * TÜM istekler AYNI bucket'ı tüketir; ayrı ayrı sınırsız deneme hakkı kazanmazlar. Bu, hatalı
 * yapılandırmada "çok kısıtlayıcı" tarafa düşmek demektir — güvenlik açısından doğru yön budur
 * (fail-closed).
 */
const UNKNOWN_IP_BUCKET = "unknown";

/**
 * Bir string'in geçerli bir IPv4/IPv6 adresi olup olmadığını söyler.
 *
 * NEDEN BİÇİM DOĞRULAMASI GEREKLİ: doğrulama olmadan `x-forwarded-for: aaaa1`, `aaaa2`, …
 * gibi rastgele stringler geçerli bucket key'leri üretiyordu. Yani proxy'nin arkasında bile,
 * header'a ek bir segment yazabilen herhangi biri SINIRSIZ sayıda bucket üretip limiti
 * eritebilirdi. Biçim kontrolü bu sonsuz bucket üretimini kırar: uymayan her değer tek bir
 * paylaşılan bucket'a çöker.
 *
 * NEDEN `node:net`: bu bir bağımlılık DEĞİL, Node'un yerleşik modülüdür — şifre hash'i için
 * `node:crypto` kullanmakla aynı duruş (`docs/conventions.md` → "Bağımlılıklar"). IPv6
 * ayrıştırmasını elle yazmak (`::` kısaltması, IPv4-mapped biçimler, zone id'ler) hem uzun hem
 * de hataya açıktır; yanlış bir doğrulayıcı meşru IP'leri `unknown`'a düşürüp gerçek
 * kullanıcıları birbirine bağlardı.
 */
function isValidIpAddress(value: string): boolean {
  return isIP(value) !== 0;
}

/**
 * İstemci IP'sini çıkarır.
 *
 * `TRUSTED_PROXY=false` iken `x-forwarded-for` HİÇ OKUNMAZ. Issue #182 bu durumda
 * "bağlantının kendi uzak adresi" kullanılmasını öngörüyordu; **Next.js 16'da bu adres bir
 * Route Handler'a açılmıyor** (`NextRequest.ip` bu sürümde yok ve uygulama edge/middleware
 * kullanmıyor — doğrulandı: `node_modules/next/dist/server/web/spec-extension/request.d.ts`).
 * Dolayısıyla issue'nun "bulunamıyorsa ortak `unknown` bucket'ına düşülür" dalı bugün TEK
 * geçerli daldır. Sonuç: proxy'siz bir kurulumda tüm istekler tek bir bucket'ı paylaşır —
 * kısıtlayıcıdır ama sahtelenebilir bir header'a güvenmekten iyidir. Uzak adres ileride
 * erişilebilir olursa değişecek tek yer burasıdır.
 */
export function getClientIp(request: Request): string {
  if (!isTrustedProxy()) {
    return UNKNOWN_IP_BUCKET;
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (!forwardedFor) {
    return UNKNOWN_IP_BUCKET;
  }

  // Format: `client, proxy1, proxy2, ...` — standart davranış olarak İLK değer (asıl istemciye
  // en yakın olan) kullanılır.
  const firstIp = forwardedFor.split(",")[0]?.trim();
  if (!firstIp || !isValidIpAddress(firstIp)) {
    return UNKNOWN_IP_BUCKET;
  }

  return firstIp;
}

/**
 * Mantıksal endpoint prefix'i (bkz. `policies.ts`'teki `RATE_LIMIT_BUCKETS`) ile istemci
 * kimliğini (IP) birleştirip tam bucket key'ini kurar. Raw email/password/token/cookie ASLA
 * bu key'e girmez — sadece endpoint adı + IP.
 */
export function buildRateLimitKey(bucketPrefix: string, clientIp: string): string {
  return `${bucketPrefix}:${clientIp}`;
}
