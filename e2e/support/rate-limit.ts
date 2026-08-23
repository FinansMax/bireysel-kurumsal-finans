import { randomUUID } from "node:crypto";

/**
 * Testler arasında (ve aynı test içindeki bağımsız denemeler arasında) rate-limit bucket
 * çakışmasını önlemek için benzersiz bir sahte istemci IP'si üretir (bkz.
 * `src/lib/rate-limit/request-key.ts` — `x-forwarded-for`'dan okunur, format doğrulanmaz,
 * opak bir bucket-key bileşeni olarak kullanılır).
 *
 * Bu bir production bypass'ı DEĞİLDİR: gerçek rate limiter mantığını hiç atlamaz, sadece
 * gerçek trafikte doğal olarak var olacak "farklı istemciler farklı IP'lerden gelir" durumunu
 * testlerde simüle eder — Issue #27 ile IP+endpoint bazlı rate limiting eklendiğinden beri,
 * aynı endpoint'e çok sayıda istek atan mevcut testlerin (ör. signup/signin/forgot-password
 * HTTP testleri) birbirinin (ve kendi içindeki ardışık denemelerinin) bucket'ını yanlışlıkla
 * tüketmemesi için gereklidir.
 */
export function uniqueTestClientIp(): string {
  return `test-${randomUUID()}`;
}
