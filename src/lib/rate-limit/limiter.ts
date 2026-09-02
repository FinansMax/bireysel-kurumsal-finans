import { RATE_LIMIT_STORES, resolveRateLimitStore } from "@/lib/config/rate-limit-store";

import { InMemoryRateLimiter } from "./in-memory-rate-limiter";
import { RedisRateLimiter } from "./redis-rate-limiter";
import type { RateLimiter } from "./types";

/**
 * Uygulama genelinde paylaşılan tek `RateLimiter` instance'ı (Issue #27, store seçimi: #181).
 *
 * Route'lar bu singleton'ı kullanır ki tüm endpoint'ler AYNI store'u paylaşsın — her endpoint'in
 * kendi instance'ına ihtiyacı yoktur, izolasyon zaten bucket KEY'i (endpoint prefix + IP) ile
 * sağlanır (bkz. `request-key.ts`).
 *
 * Tip olarak somut sınıf yerine `RateLimiter` interface'i export edilir. #27'de yazılan
 * "ileride bu satır, route kodunun geri kalanına HİÇ dokunmadan bir shared-store
 * implementasyonuyla değiştirilebilir" cümlesinin karşılığı tam olarak budur: aşağıdaki seçim
 * dışında hiçbir çağıran dosya değişmedi.
 */
function createRateLimiter(): RateLimiter {
  const config = resolveRateLimitStore();

  /**
   * Seçim BİR KEZ, açıkça loglanır.
   *
   * NEDEN: in-memory limiter çok instance'lı bir deployment'ta sessizce ZAYIF bir korumadır
   * (her instance kendi sayacını tutar). Yapılandırma hatası yüzünden production'da in-memory'ye
   * düşmüş bir kurulumun bunu FARK ETMESİNİN tek yolu bu satırdır — `resolveRateLimitStore()`
   * bilinçli olarak fırlatmıyor (gerekçesi orada yazılı), o yüzden görünürlük buradan gelir.
   *
   * Log credential İÇERMEZ: yalnızca store adı.
   */
  console.log(`[rate-limit] store=${config.store}`);

  if (config.store === RATE_LIMIT_STORES.REDIS) {
    return new RedisRateLimiter({ restUrl: config.restUrl, restToken: config.restToken });
  }

  return new InMemoryRateLimiter();
}

export const rateLimiter: RateLimiter = createRateLimiter();
