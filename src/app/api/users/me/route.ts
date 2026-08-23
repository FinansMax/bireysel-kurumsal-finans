import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/guard";
import { getUserProfile, updateUserProfile } from "@/lib/users/profile";

/**
 * `GET` yan etkisizdir (CSRF invariant'ı — bkz. CLAUDE.md ve
 * `integration/get-side-effect-free-pattern.spec.ts`): yalnızca okur.
 */
export async function GET() {
  const { user, response } = await requireUser();
  if (!user) {
    return response;
  }

  // Profil, session'dan (JWT) değil DB'den okunur: `PATCH` sonrası taze veriyi veren endpoint
  // budur. `/api/auth/me` ise oturumun kendi içeriğini yansıtır (bkz. README "Kullanıcı Profili").
  const profile = await getUserProfile(user.id);
  if (!profile) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ user: profile });
}

export async function PATCH(request: Request) {
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

  const { name } = body as Record<string, unknown>;

  // Hangi kullanıcının profili güncelleniyor sorusunun tek kaynağı trusted session'dır
  // (`user.id`); body'deki `userId`/`email` gibi alanlar okunmaz bile.
  const result = await updateUserProfile(user.id, { name });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ user: result.profile });
}
