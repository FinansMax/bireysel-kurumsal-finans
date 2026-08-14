import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/authz/authorize";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { createInvitation } from "@/lib/tenants/invitation";
import { isValidId } from "@/lib/tenants/validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const { tenantId } = await params;
  if (!isValidId(tenantId)) {
    return NextResponse.json({ error: "Invalid tenant id" }, { status: 400 });
  }

  const { context, response } = await requirePermission(PERMISSIONS.SEND_INVITE, tenantId);
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

  const { email, role } = body as Record<string, unknown>;

  // tenantId'nin trusted kaynağı `context.tenant.id`dir (Issue #13) — bkz.
  // src/app/api/tenants/[tenantId]/members/route.ts'teki aynı not. actorUserId de aynı
  // şekilde requirePermission'ın DB'den doğruladığı context'ten gelir, request body'den DEĞİL.
  const result = await createInvitation(context.tenant.id, context.role, context.user.id, {
    email,
    role,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ invitation: result.invitation }, { status: 201 });
}
