import { NextResponse } from "next/server";

import { verifyEmail } from "@/lib/auth/email-verification";
import { checkRateLimit } from "@/lib/rate-limit/guard";
import { RATE_LIMIT_BUCKETS, RATE_LIMIT_POLICIES } from "@/lib/rate-limit/policies";

/**
 * E-posta doğrulama token'ını tüketir (Issue #190).
 *
 * POST'tur, GET DEĞİL (invariant #4): `emailVerified` yazar. Bir GET olsaydı, e-posta
 * istemcisinin link ön-getirmesi (prefetch) token'ı kullanıcı tıklamadan tüketebilirdi —
 * `/reset-password` ile aynı gerekçe.
 *
 * KİMLİK DOĞRULAMASI İSTEMEZ ve bu bilinçlidir: token'ın KENDİSİ yetkidir. Hedef kullanıcı
 * token kaydından okunur, oturumdan değil — bu yüzden başka bir hesaba giriş yapmış biri
 * elindeki token ile yalnızca o token'ın SAHİBİNİN hesabını doğrulayabilir, kendi hesabını
 * değil. Oturum zorunlu kılınsaydı, e-postayı telefonunda açıp bilgisayarda oturumu olmayan
 * kullanıcı doğrulama yapamazdı.
 */
export async function POST(request: Request) {
  // Rate limit her şeyden önce (invariant #9): endpoint public'tir ve her çağrı DB'ye yazar.
  const rateLimitResponse = await checkRateLimit(
    request,
    RATE_LIMIT_BUCKETS.VERIFY_EMAIL,
    RATE_LIMIT_POLICIES.VERIFY_EMAIL,
  );
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { token } = body as Record<string, unknown>;
  const result = await verifyEmail(token);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ message: "E-mail address verified." }, { status: 200 });
}
