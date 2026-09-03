import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/guard";
import { confirmTotpEnrollment } from "@/lib/auth/totp-enrollment";
import { checkRateLimit } from "@/lib/rate-limit/guard";
import { RATE_LIMIT_BUCKETS, RATE_LIMIT_POLICIES } from "@/lib/rate-limit/policies";

/**
 * Kurulumu doğrular ve 2FA'yı AKTİFLEŞTİRİR (Issue #193).
 *
 * Bu adım olmadan 2FA aktif sayılmaz. Ayrım, QR'ı okuyamamış veya yanlış cihaza eklemiş bir
 * kullanıcının kendi hesabından kalıcı olarak kilitlenmesini önler.
 */
export async function POST(request: Request) {
  // Rate limit en üstte (invariant #9): burada doğrulanan şey 6 haneli bir koddur ve
  // brute-force gerçekten uygulanabilirdir.
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { code } = body as Record<string, unknown>;

  const result = await confirmTotpEnrollment(user.id, code);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(
    { message: "Two-factor authentication is now enabled." },
    { status: 200 },
  );
}
