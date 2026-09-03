import { NextResponse } from "next/server";

import { sendEmailVerification } from "@/lib/auth/email-verification";
import { registerUser } from "@/lib/auth/signup";
import { checkRateLimit } from "@/lib/rate-limit/guard";
import { RATE_LIMIT_BUCKETS, RATE_LIMIT_POLICIES } from "@/lib/rate-limit/policies";

export async function POST(request: Request) {
  // Rate-limit kontrolü business logic'ten (body parse dahil) ÖNCE uygulanır (Issue #27) —
  // 429 durumunda hiçbir kullanıcı oluşturulmaz, hiçbir side-effect tetiklenmez.
  const rateLimitResponse = await checkRateLimit(request, RATE_LIMIT_BUCKETS.SIGNUP, RATE_LIMIT_POLICIES.SIGNUP);
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

  const { email, password } = body as Record<string, unknown>;

  const result = await registerUser({ email, password });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Doğrulama e-postası BEST-EFFORT gönderilir (Issue #190): gönderim başarısız olsa da kayıt
  // BAŞARILI sayılır ve 201 döner. Aksi halde sağlayıcı kesintisi, kullanıcının hiç hesap
  // açamaması anlamına gelirdi; kullanıcı "tekrar gönder" ile ilerleyebilir.
  //
  // `sendEmailVerification()` zaten throw etmez ve kullanıcının var olup olmadığını
  // yansıtmaz; yine de olası bir beklenmeyen hatanın 201 yanıtını bozmaması için sarmalanır.
  try {
    await sendEmailVerification(result.user.email);
  } catch {
    // Yutulmuş değil, BİLİNÇLİ yok sayılıyor: kayıt tamamlandı ve kullanıcı akışı devam etmeli.
  }

  return NextResponse.json({ user: result.user }, { status: 201 });
}
