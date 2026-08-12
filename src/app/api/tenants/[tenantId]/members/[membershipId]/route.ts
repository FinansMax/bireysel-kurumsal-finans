import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/guard";
import { removeMember, updateMemberRole } from "@/lib/tenants/membership";
import { isValidId } from "@/lib/tenants/validation";

type RouteParams = { params: Promise<{ tenantId: string; membershipId: string }> };

async function resolveParams(params: RouteParams["params"]) {
  const { tenantId, membershipId } = await params;
  if (!isValidId(tenantId) || !isValidId(membershipId)) {
    return null;
  }
  return { tenantId, membershipId };
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { user, response } = await requireUser();
  if (!user) {
    return response;
  }

  const ids = await resolveParams(params);
  if (!ids) {
    return NextResponse.json({ error: "Invalid tenant or membership id" }, { status: 400 });
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

  const { role } = body as Record<string, unknown>;

  const result = await updateMemberRole(ids.tenantId, ids.membershipId, user.id, role);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ member: result.member });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { user, response } = await requireUser();
  if (!user) {
    return response;
  }

  const ids = await resolveParams(params);
  if (!ids) {
    return NextResponse.json({ error: "Invalid tenant or membership id" }, { status: 400 });
  }

  const result = await removeMember(ids.tenantId, ids.membershipId, user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return new NextResponse(null, { status: 204 });
}
