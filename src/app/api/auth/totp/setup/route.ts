import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/guard";
import { beginTotpEnrollment } from "@/lib/auth/totp-enrollment";
import { checkRateLimit } from "@/lib/rate-limit/guard";
import { RATE_LIMIT_BUCKETS, RATE_LIMIT_POLICIES } from "@/lib/rate-limit/policies";

/**
 * 2FA kurulumunu başlatır (Issue #193).
 *
 * POST'TUR, GET DEĞİL — ve bu, bu endpoint için özellikle önemlidir: her çağrı YENİ bir sır
 * üretir ve kurtarma kodlarını DEĞİŞTİRİR, yani ağır bir yan etkisi vardır (invariant #4).
 * GET olsaydı herhangi bir sitedeki bir `<img>` etiketi kullanıcının kurtarma kodlarını
 * sessizce geçersiz kılabilirdi.
 *
 * YANIT SIRRI VE KURTARMA KODLARINI DÜZ METİN OLARAK İÇERİR — tek ve son kez. DB'de yalnızca
 * şifrelenmiş sır ve kodların SHA-256 hash'leri durur; bu yanıt kaybolursa kurulum baştan
 * başlatılmalıdır. Bu bilinçlidir: kodları sonradan tekrar gösterebilmek, onları geri
 * okunabilir saklamayı gerektirirdi.
 */
export async function POST(request: Request) {
  // Rate limit iş mantığından ÖNCE (invariant #9). Endpoint authenticated olsa da limit
  // gerekir: her çağrı yazma yapar ve kurtarma kodlarını döndürür — çalınmış bir cookie ile
  // tekrar tekrar çağrılırsa meşru kullanıcının kodlarını sürekli geçersiz kılardı.
  const rateLimitResponse = await checkRateLimit(
    request,
    RATE_LIMIT_BUCKETS.TOTP,
    RATE_LIMIT_POLICIES.TOTP,
  );
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const { user, response } = await requireUser();
  if (!user) {
    return response;
  }

  // Kimin kurulumu yapılacağı YALNIZCA trusted session'dan gelir; gövde okunmaz
  // (invariant #2).
  const result = await beginTotpEnrollment(user.id);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(
    {
      secret: result.secret,
      otpauthUri: result.otpauthUri,
      recoveryCodes: result.recoveryCodes,
    },
    { status: 200 },
  );
}
