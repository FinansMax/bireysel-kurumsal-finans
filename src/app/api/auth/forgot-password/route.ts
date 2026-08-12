import { NextResponse } from "next/server";

import { requestPasswordReset } from "@/lib/auth/password-reset";

// Kayıtlı/kayıtsız e-posta için AYNI genel mesaj — user enumeration engeli (Issue #7 AC).
const GENERIC_MESSAGE = "If an account exists, a password reset link has been sent.";

export async function POST(request: Request) {
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

  if (typeof email !== "string" || email.length === 0) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Kullanıcı var olsun ya da olmasın davranış ve dönen yanıt AYNIDIR.
  await requestPasswordReset(email);

  return NextResponse.json({ message: GENERIC_MESSAGE }, { status: 200 });
}
