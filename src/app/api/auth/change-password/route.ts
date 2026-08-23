import { NextResponse } from "next/server";

import { changePassword } from "@/lib/auth/change-password";
import { requireUser } from "@/lib/auth/guard";
import { checkRateLimit } from "@/lib/rate-limit/guard";
import { RATE_LIMIT_BUCKETS, RATE_LIMIT_POLICIES } from "@/lib/rate-limit/policies";

export async function POST(request: Request) {
  // Rate-limit kontrolü authentication ve body parse dahil her şeyden ÖNCE uygulanır
  // (Issue #27): 429 durumunda ne pahalı scrypt doğrulaması çalışır ne de bir şifre değişir.
  // Endpoint authenticated olmasına rağmen limit gerekir — çalınmış bir session cookie'siyle
  // mevcut şifreyi brute-force etme girişimi tam olarak burada durdurulur (bkz.
  // `src/lib/rate-limit/policies.ts`'teki CHANGE_PASSWORD gerekçesi).
  const rateLimitResponse = await checkRateLimit(
    request,
    RATE_LIMIT_BUCKETS.CHANGE_PASSWORD,
    RATE_LIMIT_POLICIES.CHANGE_PASSWORD,
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

  const { currentPassword, newPassword } = body as Record<string, unknown>;

  // Hangi kullanıcının şifresinin değiştirileceği YALNIZCA trusted session'dan gelir
  // (`user.id`); body'de gönderilen bir userId/email ASLA kaynak değildir.
  const result = await changePassword(user.id, currentPassword, newPassword);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(
    { message: "Password has been changed successfully. Please sign in again." },
    { status: 200 },
  );
}
