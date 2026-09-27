import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/guard";
import { getUserSettings, updateUserSettings } from "@/lib/users/settings";

/**
 * Kullanıcının kendi tercihleri (Issue #88). `/api/users/me` (ad, Issue #31) ile aynı kalıp:
 * `GET` yan etkisizdir (invariant #4), `PATCH` yalnızca trusted session'ın kendi satırını
 * değiştirir.
 */
export async function GET() {
  const { user, response } = await requireUser();
  if (!user) {
    return response;
  }

  const settings = await getUserSettings(user.id);
  if (!settings) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ settings });
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

  const { notificationsEnabled } = body as Record<string, unknown>;

  // Hangi kullanıcının tercihi güncelleniyor sorusunun tek kaynağı trusted session'dır
  // (`user.id`); body'deki olası `userId` alanı hiç okunmaz.
  const result = await updateUserSettings(user.id, { notificationsEnabled });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ settings: result.settings });
}
