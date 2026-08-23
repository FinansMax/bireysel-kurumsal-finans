import { NextResponse } from "next/server";

import { rateLimiter } from "./limiter";
import { buildRateLimitKey, getClientIp } from "./request-key";
import type { RateLimitPolicy } from "./policies";

// Generic, bilgi sızdırmayan mesaj — hangi endpoint/IP/kullanıcı/attempt count olduğu response'a
// YAZILMAZ (bkz. Issue #27 "Internal veri response'a yazılmamalı").
const RATE_LIMIT_MESSAGE = "Too many requests. Please try again later.";

/**
 * Route handler'larda kullanılan tekrar kullanılabilir rate-limit guard'ı — mevcut
 * `requireUser()`/`requirePermission()` deseniyle AYNI ruhta (bkz. `src/lib/auth/guard.ts`,
 * `src/lib/authz/authorize.ts`): limit aşılmışsa hazır bir `NextResponse` döner, aşılmamışsa
 * `null` döner ve çağıran taraf business logic'e devam eder.
 *
 * Kullanım:
 *   const rateLimitResponse = await checkRateLimit(request, RATE_LIMIT_BUCKETS.SIGNUP, RATE_LIMIT_POLICIES.SIGNUP);
 *   if (rateLimitResponse) return rateLimitResponse;
 */
export async function checkRateLimit(
  request: Request,
  bucketPrefix: string,
  policy: RateLimitPolicy,
): Promise<NextResponse | null> {
  const key = buildRateLimitKey(bucketPrefix, getClientIp(request));
  const result = await rateLimiter.consume({ key, limit: policy.limit, windowMs: policy.windowMs });

  if (result.allowed) {
    return null;
  }

  return NextResponse.json(
    { error: RATE_LIMIT_MESSAGE },
    {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(result.retryAfterMs / 1000)) },
    },
  );
}
