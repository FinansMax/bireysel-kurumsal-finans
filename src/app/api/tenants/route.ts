import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/guard";
import { createTenant } from "@/lib/tenants/create-tenant";
import { listTenantsForUser } from "@/lib/tenants/user-tenants";

export async function GET() {
  const { user, response } = await requireUser();
  if (!user) {
    return response;
  }

  const tenants = await listTenantsForUser(user.id);
  return NextResponse.json({ tenants });
}

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

  const { name, slug } = body as Record<string, unknown>;

  const result = await createTenant(user.id, { name, slug });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ tenant: result.tenant }, { status: 201 });
}
