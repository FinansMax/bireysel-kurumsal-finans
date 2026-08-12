import { NextResponse } from "next/server";

import { resetPassword } from "@/lib/auth/password-reset";

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

  const { token, password } = body as Record<string, unknown>;

  const result = await resetPassword(token, password);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ message: "Password has been reset successfully." }, { status: 200 });
}
