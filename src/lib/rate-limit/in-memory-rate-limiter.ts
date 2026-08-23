import type { RateLimitInput, RateLimitResult, RateLimiter } from "./types";

type Bucket = {
  /** Bu key için, ilgili window içinde başarıyla "consume" edilmiş isteklerin zaman damgaları. */
  timestamps: number[];
  /** Bu bucket'ın TAMAMEN alakasız hale geleceği an (son timestamp + o çağrının windowMs'i) —
   * sadece stale-bucket sweep'i için tutulur, limit hesaplamasında kullanılmaz. */
  expiresAt: number;
};

// Map'in sınırsız büyümesini (her biri kendi limitiyle sınırlı bucket'ların SAYISI artarak)
// önleyen basit bir üst sınır — aşıldığında lazy bir tam-sweep tetiklenir (bkz. `maybeSweep()`).
// Background worker/timer YOKTUR; sweep sadece gerçek `consume()` çağrılarına "binerek" çalışır.
const DEFAULT_MAX_TRACKED_BUCKETS = 10_000;

export type InMemoryRateLimiterOptions = {
  /** Test edilebilirlik seam'i — gerçek süre beklemeden sliding-window davranışını test etmeyi
   * sağlar. Production'da varsayılan `Date.now`. Test-only bir bypass/backdoor DEĞİLDİR: sadece
   * "şu an" bilgisinin kaynağını enjekte edilebilir kılar, limit/pencere mantığını atlamaz. */
  now?: () => number;
  maxTrackedBuckets?: number;
};

/**
 * Process-local, in-memory, sliding-window `RateLimiter` implementasyonu (Issue #27).
 *
 * Algoritma (her `consume()` çağrısında, key başına):
 * 1. Bucket (varsa) okunur.
 * 2. Window dışında kalan (yani `timestamp <= now - windowMs`) timestamp'ler filtrelenir.
 * 3. Kalan (aktif) timestamp sayısı `limit` ile karşılaştırılır.
 * 4. `>= limit` ise istek REDDEDİLİR — bucket, filtrelenmiş (temizlenmiş) haliyle güncellenir
 *    ama YENİ bir timestamp EKLENMEZ (reddedilen denemeler kotayı tüketmez).
 * 5. Değilse yeni bir timestamp eklenir, bucket güncellenir, `allowed: true` döner.
 *
 * Fixed-window DEĞİLDİR: sınır her zaman "şu andan `windowMs` öncesine kadar" kayan bir
 * pencereye göre değerlendirilir; pencere sınırında ani "reset" davranışı yoktur.
 *
 * CONCURRENCY: `consume()` içinde tek bir `await` bile YOKTUR — tüm okuma+hesaplama+yazma tek
 * senkron blokta yapılır. JavaScript'in tek thread'li event loop modelinde, bir async
 * fonksiyonun gövdesi ilk `await`e kadar SENKRON çalışır; burada hiç `await` olmadığı için
 * `consume()` çağrısı baştan sona ATOMIK'tir — aynı key için eşzamanlı (ör. `Promise.all`
 * içindeki) 10 çağrı asla iç içe geçmez, birbirinin okuduğu/yazdığı state'i bozamaz. Bu,
 * distributed/multi-process concurrency SAĞLAMAZ (bu issue'nun kapsamı dışıdır) ama tek process
 * içinde limiti bypass etmeyi yapısal olarak imkansız kılar.
 *
 * CLEANUP: Bir bucket'ın timestamp dizisi kendi `limit`'iyle sınırlıdır (reddedilen denemeler
 * eklenmediği için asla `limit`'i aşamaz) — bucket başına bellek SINIRLIDIR. Bucket boşalırsa
 * (tüm timestamp'ler expire olduysa) Map'ten tamamen SİLİNİR. Map'in toplam key SAYISININ
 * (benzersiz IP/endpoint kombinasyonu) sınırsız büyümesine karşı, `maxTrackedBuckets` eşiği
 * aşıldığında `consume()` çağrısına "binen" lazy bir tam-sweep, tamamen expire olmuş
 * bucket'ları temizler — background worker/timer kurulmaz.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;
  private readonly maxTrackedBuckets: number;

  constructor(options: InMemoryRateLimiterOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxTrackedBuckets = options.maxTrackedBuckets ?? DEFAULT_MAX_TRACKED_BUCKETS;
  }

  async consume({ key, limit, windowMs }: RateLimitInput): Promise<RateLimitResult> {
    const nowMs = this.now();
    this.maybeSweep(nowMs);

    const existing = this.buckets.get(key);
    const windowStart = nowMs - windowMs;
    const active = existing ? existing.timestamps.filter((t) => t > windowStart) : [];

    if (active.length >= limit) {
      if (active.length === 0) {
        this.buckets.delete(key);
      } else {
        // `expiresAt` HER ZAMAN en YENİ timestamp'ten hesaplanır (bkz. `Bucket.expiresAt`
        // dokümantasyonu ve aşağıdaki allow yolu). Burada en ESKİ timestamp kullanılırsa
        // (`active[0]`) bucket'ın kayıtlı expiry'si gerçek expiry'sinden erken olur ve
        // `maybeSweep()` (sadece `expiresAt <= now` bakar) HÂLÂ pencere içinde timestamp
        // taşıyan bir bucket'ı silebilir. O durumda limiti aşmış bir istemci, en eski
        // denemesi pencereden çıkar çıkmaz 1 değil TAM `limit` kadar yeni hak kazanır —
        // yani sliding window, saldırının en yoğun olduğu anda (map dolu olduğu için sweep
        // aktifken) erken-reset'li fixed window'a dejenere olur.
        this.buckets.set(key, {
          timestamps: active,
          expiresAt: active[active.length - 1] + windowMs,
        });
      }
      // `active` boşken (yalnızca `limit <= 0` ile mümkün — bkz. yukarıdaki delete dalı)
      // `active[0]` `undefined`'dır; bunu doğrudan aritmetiğe sokmak `retryAfterMs`'i NaN
      // yapar ve guard'da geçersiz bir `Retry-After: NaN` header'ı üretirdi. Böyle bir
      // policy "endpoint tamamen kapalı" demektir, dolayısıyla beklenecek süre tam pencere
      // kadardır.
      const oldestActive = active[0];
      const retryAfterMs =
        oldestActive === undefined ? windowMs : Math.max(0, oldestActive + windowMs - nowMs);
      return { allowed: false, remaining: 0, retryAfterMs };
    }

    active.push(nowMs);
    this.buckets.set(key, { timestamps: active, expiresAt: nowMs + windowMs });
    return { allowed: true, remaining: limit - active.length };
  }

  /** Sadece testler/gözlemlenebilirlik için — limiti bypass etmez, sadece iç state'i okur. */
  get size(): number {
    return this.buckets.size;
  }

  private maybeSweep(nowMs: number): void {
    if (this.buckets.size < this.maxTrackedBuckets) {
      return;
    }
    for (const [key, bucket] of this.buckets) {
      if (bucket.expiresAt <= nowMs) {
        this.buckets.delete(key);
      }
    }
  }
}
