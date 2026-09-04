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
/**
 * İstek gövdesinde bir ikinci faktör alanı var mı (Issue #193).
 *
 * GÖVDE KLONDAN OKUNUR: `request.formData()` gövdeyi tüketir ve `handlers.POST(request)`
 * boş bir gövde görürdü — yani her giriş sessizce başarısız olurdu. `clone()` bunu önler.
 *
 * HATA YUTULUR VE `false` DÖNÜLÜR: bu fonksiyonun işi yalnızca "daha dar limiti uygula mı"
 * kararıdır. Ayrıştırılamayan bir gövde zaten Auth.js tarafından reddedilecektir; burada
 * fırlatmak, giriş akışını bir yardımcı kontrol yüzünden 500 ile düşürürdü.
 */
async function hasSecondFactorField(request: NextRequest): Promise<boolean> {
  try {
    const form = await request.clone().formData();
    const totp = form.get("totp");
    const recoveryCode = form.get("recoveryCode");

    return (
      (typeof totp === "string" && totp.trim().length > 0) ||
      (typeof recoveryCode === "string" && recoveryCode.trim().length > 0)
    );
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const { pathname } = new URL(request.url);

  if (pathname === CREDENTIALS_CALLBACK_PATH) {
    const rateLimitResponse = await checkRateLimit(request, RATE_LIMIT_BUCKETS.SIGNIN, RATE_LIMIT_POLICIES.SIGNIN);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    // İKİNCİ FAKTÖR İÇİN AYRI VE DAHA DAR BİR LİMİT (Issue #193).
    //
    // NEDEN AYRI: TOTP kodu yalnızca 6 hanedir (10^6) ve ±1 pencere toleransı yüzünden her an
    // ÜÇ kod geçerlidir. Şifrenin aksine bu, brute-force'un gerçekten uygulanabilir olduğu bir
    // sırdır. SIGNIN'in 10/5dk'sı şifre için makul, ikinci faktör için fazla cömerttir.
    //
    // İKİSİ BİRDEN uygulanır (SIGNIN önce, TOTP sonra): kod taşıyan bir istek her iki sayacı da
    // tüketir. Yalnızca TOTP bucket'ını uygulamak, kodu boş bırakıp SIGNIN limitini ayrı bir
    // havuz gibi kullanmayı mümkün kılardı.
    if (await hasSecondFactorField(request)) {
      const totpLimitResponse = await checkRateLimit(request, RATE_LIMIT_BUCKETS.TOTP, RATE_LIMIT_POLICIES.TOTP);
      if (totpLimitResponse) {
        return totpLimitResponse;
      }
    }
  }

  return handlers.POST(request);
}
