import { InMemoryRateLimiter } from "./in-memory-rate-limiter";
import type { RateLimiter } from "./types";

/**
 * Uygulama genelinde paylaşılan tek `RateLimiter` instance'ı (Issue #27). Route'lar bu
 * singleton'ı kullanır ki tüm endpoint'ler AYNI bucket store'unu (dolayısıyla tutarlı memory
 * sınırlarını) paylaşsın — her endpoint'in kendi ayrı `RateLimiter` instance'ına ihtiyacı
 * yoktur, izolasyon zaten bucket KEY'i (endpoint prefix + IP) ile sağlanır (bkz.
 * `request-key.ts`).
 *
 * Tip olarak somut `InMemoryRateLimiter` yerine `RateLimiter` interface'i export edilir: ileride
 * bu satır, route kodunun geri kalanına HİÇ dokunmadan bir Redis/shared-store implementasyonuyla
 * değiştirilebilir olsun diye.
 */
export const rateLimiter: RateLimiter = new InMemoryRateLimiter();
