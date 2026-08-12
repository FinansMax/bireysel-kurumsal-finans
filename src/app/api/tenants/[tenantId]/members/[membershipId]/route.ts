import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/authz/authorize";
import { PERMISSIONS } from "@/lib/authz/permissions";
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
  const ids = await resolveParams(params);
  if (!ids) {
    return NextResponse.json({ error: "Invalid tenant or membership id" }, { status: 400 });
  }

  const { context, response } = await requirePermission(
    PERMISSIONS.UPDATE_MEMBER_ROLE,
    ids.tenantId,
  );
  if (!context) {
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

  const { role } = body as Record<string, unknown>;

  // tenantId'nin trusted kaynağı `context.tenant.id`dir (Issue #13) — bkz.
  // src/app/api/tenants/[tenantId]/members/route.ts'teki aynı not.
  const result = await updateMemberRole(context.tenant.id, ids.membershipId, context.role, role);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ member: result.member });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const ids = await resolveParams(params);
  if (!ids) {
    return NextResponse.json({ error: "Invalid tenant or membership id" }, { status: 400 });
  }

  const { context, response } = await requirePermission(PERMISSIONS.REMOVE_MEMBER, ids.tenantId);
  if (!context) {
    return response;
  }

  const result = await removeMember(context.tenant.id, ids.membershipId, context.role);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return new NextResponse(null, { status: 204 });
}
