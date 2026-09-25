import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/guard";
import { disableTotp } from "@/lib/auth/totp-enrollment";
import { checkRateLimit } from "@/lib/rate-limit/guard";
import { RATE_LIMIT_BUCKETS, RATE_LIMIT_POLICIES } from "@/lib/rate-limit/policies";

/**
 * 2FA'yı kapatır (Issue #193). MEVCUT ŞİFREYİ İSTER.
 *
 * NEDEN ŞİFRE: bu, hesabın koruma seviyesini DÜŞÜREN bir işlemdir. Çalınmış bir session
 * cookie'si ile tek çağrıda kapatılabilseydi, 2FA'nın koruduğu şeyi 2FA'nın kendi kapatma
 * ucundan aşmak mümkün olurdu — ikinci faktör anlamsızlaşırdı. Aynı gerekçe
 * `change-password` akışında da geçerlidir.
 *
 * CHANGE_PASSWORD DEĞİL TOTP bucket'ı kullanılır: burada denenen sır şifredir ama korunan
 * varlık 2FA'dır ve `policies.ts`'teki TOTP limiti daha dardır (5/5dk). Daha dar olanı
 * seçmek, bu ucu şifre tahmini için bir yan kapı olmaktan çıkarır.
 */
export async function POST(request: Request) {
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

  const { password } = body as Record<string, unknown>;

  const result = await disableTotp(user.id, password);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(
    { message: "Two-factor authentication has been disabled." },
    { status: 200 },
  );
}
