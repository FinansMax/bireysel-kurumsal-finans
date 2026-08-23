/**
 * Merkezi rate limiting abstraction'ı (Issue #27).
 *
 * `RateLimiter` kasıtlı olarak SADECE bir `key` + `limit` + `windowMs` üçlüsü bilir — hangi
 * endpoint'in hangi policy'ye sahip olduğunu (bkz. `policies.ts`) veya isteğin nereden geldiğini
 * (bkz. `request-key.ts`) HİÇ bilmez. Bu ayrım, implementasyonun (bugün process-local in-memory,
 * ileride Redis/shared-store) route kodunu hiç değiştirmeden takılabilir olmasını sağlar.
 */
export type RateLimitInput = {
  /** Zaten endpoint + kimliği (IP) kodlayan tam bucket key'i (bkz. `buildRateLimitKey()`). */
  key: string;
  /** Pencere içinde izin verilen maksimum istek sayısı. */
  limit: number;
  /** Sliding window genişliği (milisaniye). */
  windowMs: number;
};

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; remaining: 0; retryAfterMs: number };

export interface RateLimiter {
  /**
   * Bu key için bir istek dener: limit dolmamışsa isteği kaydeder ve `allowed: true` döner;
   * dolmuşsa isteği KAYDETMEDEN `allowed: false` döner (reddedilen denemeler pencereyi
   * uzatmaz/kotayı tüketmez).
   */
  consume(input: RateLimitInput): Promise<RateLimitResult>;
}
