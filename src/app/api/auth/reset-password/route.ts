import { NextResponse } from "next/server";

import { resetPassword } from "@/lib/auth/password-reset";
import { checkRateLimit } from "@/lib/rate-limit/guard";
import { RATE_LIMIT_BUCKETS, RATE_LIMIT_POLICIES } from "@/lib/rate-limit/policies";

export async function POST(request: Request) {
  // Rate-limit kontrolü business logic'ten (body parse ve token tüketimi dahil) ÖNCE
  // uygulanır (Issue #27) — 429 durumunda hiçbir token tüketilmez, hiçbir şifre değişmez.
  // Bu, kimlik doğrulaması gerektirmeyen credential-değiştirme endpoint'lerinin sonuncusuydu;
  // signup/sign-in/forgot-password ile aynı korumaya sahip olması için eklendi.
  const rateLimitResponse = await checkRateLimit(
    request,
    RATE_LIMIT_BUCKETS.RESET_PASSWORD,
    RATE_LIMIT_POLICIES.RESET_PASSWORD,
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

  const { token, password } = body as Record<string, unknown>;

  const result = await resetPassword(token, password);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ message: "Password has been reset successfully." }, { status: 200 });
}
