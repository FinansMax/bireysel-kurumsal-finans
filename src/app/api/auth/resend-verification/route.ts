import { NextResponse } from "next/server";

import { sendEmailVerification } from "@/lib/auth/email-verification";
import { checkRateLimit } from "@/lib/rate-limit/guard";
import { RATE_LIMIT_BUCKETS, RATE_LIMIT_POLICIES } from "@/lib/rate-limit/policies";

/**
 * Doğrulama e-postasını yeniden gönderir (Issue #190).
 *
 * YANIT DAİMA AYNIDIR: e-posta kayıtlı olsun olmasın, hesap doğrulanmış olsun olmasın 200 ve
 * aynı genel mesaj döner (invariant #7). Aksi halde bu endpoint "şu e-posta kayıtlı mı" ve
 * "doğrulanmış mı" sorularının ücretsiz bir oracle'ı olurdu — `forgot-password` ile birebir
 * aynı duruş.
 *
 * RATE LIMIT 3/15dk: her çağrı bir e-posta gönderir (gerçek sağlayıcıda maliyetli) ve aynı
 * adrese tekrar tekrar mesaj göndermek, hedef kullanıcı açısından tacize dönüşebilir.
 */
export async function POST(request: Request) {
  const rateLimitResponse = await checkRateLimit(
    request,
    RATE_LIMIT_BUCKETS.RESEND_VERIFICATION,
    RATE_LIMIT_POLICIES.RESEND_VERIFICATION,
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

  const { email } = body as Record<string, unknown>;
  await sendEmailVerification(email);

  return NextResponse.json(
    { message: "If the address is registered and unverified, a verification e-mail has been sent." },
    { status: 200 },
  );
}
