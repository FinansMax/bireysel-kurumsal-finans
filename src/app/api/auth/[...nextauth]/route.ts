import type { NextRequest } from "next/server";

import { handlers } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit/guard";
import { RATE_LIMIT_BUCKETS, RATE_LIMIT_POLICIES } from "@/lib/rate-limit/policies";

export const { GET } = handlers;

const CREDENTIALS_CALLBACK_PATH = "/api/auth/callback/credentials";

/**
 * Sign-in rate limiting (Issue #27).
 *
 * Auth.js'in Credentials provider `authorize()` callback'i (bkz. `src/lib/auth/config.ts`)
 * sadece `User | null` döndürebilir/throw edebilir — özel bir 429 status code veya
 * `Retry-After` header'ı ile yanıt VEREMEZ (bkz. `@auth/core` `CredentialsConfig` tipleri).
 * Bu yüzden sign-in rate limiting'i, NextAuth'un kendi yapılandırmasına/`authorize()`'a HİÇ
 * dokunmadan (mevcut auth mimarisi korunur), sadece credentials callback POST'u
 * `handlers.POST`'a devredilmeden ÖNCE — burada, route seviyesinde — uygulanır. Bu, pahalı
 * scrypt doğrulamasına (bkz. `authenticateUser()`) ulaşan brute-force trafiğini, Auth.js'in
 * kendi işleme hattına hiç girmeden, credential doğrulamasından ÖNCE engeller.
 *
 * Diğer tüm POST action'ları (signout, csrf, vb.) etkilenmeden `handlers.POST`'a geçer.
 */
export async function POST(request: NextRequest) {
  const { pathname } = new URL(request.url);

  if (pathname === CREDENTIALS_CALLBACK_PATH) {
    const rateLimitResponse = await checkRateLimit(request, RATE_LIMIT_BUCKETS.SIGNIN, RATE_LIMIT_POLICIES.SIGNIN);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }
  }

  return handlers.POST(request);
}
