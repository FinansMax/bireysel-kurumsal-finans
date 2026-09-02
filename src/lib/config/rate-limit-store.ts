/**
 * Rate limit store seçimi için tek çözümleme noktası (Issue #181).
 *
 * NEDEN VAR: `InMemoryRateLimiter` process-local'dir. Çok instance'lı veya serverless bir
 * deployment'ta her instance kendi sayacını tutar (gerçek limit instance sayısıyla çarpılır)
 * ve cold start sayacı sıfırlar — saldırgan yeni instance'lara dağılarak limiti pratikte
 * etkisiz kılabilir. Yani brute-force koruması kodda VAR ama production'da YOK SAYILABİLİR.
 *
 * NEDEN `app-url.ts` GİBİ PRODUCTION'DA FIRLATMIYOR: `APP_BASE_URL` yanlışsa kullanıcıya bozuk
 * link gider — sessiz ve geri dönülemez bir hasar. Burada ise varsayılana düşmek ÇALIŞAN ama
 * ZAYIF bir koruma bırakır. Tek instance'lı bir deployment (ki bugünkü durum budur) için
 * in-memory tamamen doğrudur; onu production'da hata sayarsak, henüz ölçeklenmemiş bir kurulumu
 * gereksizce bloke ederiz. Bunun bedeli, seçimin GÖRÜNÜR olmasıyla ödenir: seçilen store
 * başlangıçta bir kez loglanır (bkz. `limiter.ts`).
 */

export const RATE_LIMIT_STORES = {
  /** Process-local, in-memory (bugünkü davranış). */
  MEMORY: "memory",
  /** Upstash Redis (HTTP REST). */
  REDIS: "redis",
} as const;

export type RateLimitStore = (typeof RATE_LIMIT_STORES)[keyof typeof RATE_LIMIT_STORES];

export type RateLimitStoreConfig =
  | { store: typeof RATE_LIMIT_STORES.MEMORY }
  | { store: typeof RATE_LIMIT_STORES.REDIS; restUrl: string; restToken: string };

export const MISSING_REDIS_CREDENTIALS_ERROR =
  "RATE_LIMIT_STORE is 'redis' but UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not " +
  "set. Both are required; refusing to fall back to the in-memory limiter silently.";

export function unknownRateLimitStoreError(value: string): string {
  const supported = Object.values(RATE_LIMIT_STORES).join(", ");
  return `RATE_LIMIT_STORE '${value}' is not supported. Supported values: ${supported}.`;
}

function isRateLimitStore(value: string): value is RateLimitStore {
  return (Object.values(RATE_LIMIT_STORES) as readonly string[]).includes(value);
}

/**
 * `RATE_LIMIT_STORE` / `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` değerlerini çözer.
 *
 * - Tanımsız → `memory` (lokal geliştirme ve testler bugünkü gibi çalışır).
 * - Tanınmayan bir değer HER ortamda hatadır: `RATE_LIMIT_STORE=rediss` gibi bir yazım hatasının
 *   sessizce in-memory'ye düşmesi, tam da bu issue'nun kapatmak istediği "koruma var sanılıyor
 *   ama yok" durumudur.
 * - `redis` seçiliyken credential eksikse FIRLATIR, sessizce in-memory'ye DÜŞMEZ. Operatör
 *   açıkça "paylaşılan store istiyorum" dedi; ona zayıf korumayı sessizce vermek yanlış olurdu.
 */
export function resolveRateLimitStore(): RateLimitStoreConfig {
  const configured = process.env.RATE_LIMIT_STORE?.trim();

  if (!configured) {
    return { store: RATE_LIMIT_STORES.MEMORY };
  }

  if (!isRateLimitStore(configured)) {
    throw new Error(unknownRateLimitStoreError(configured));
  }

  if (configured === RATE_LIMIT_STORES.MEMORY) {
    return { store: RATE_LIMIT_STORES.MEMORY };
  }

  const restUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  if (!restUrl || !restToken) {
    throw new Error(MISSING_REDIS_CREDENTIALS_ERROR);
  }

  return { store: RATE_LIMIT_STORES.REDIS, restUrl, restToken };
}
