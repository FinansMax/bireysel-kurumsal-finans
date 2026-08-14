import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/guard";
import { acceptInvitation } from "@/lib/tenants/invitation";

export async function POST(request: Request) {
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

  const { token } = body as Record<string, unknown>;

  const result = await acceptInvitation(user.id, user.email, token);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ membership: result.membership }, { status: 200 });
}
