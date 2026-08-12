import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/authz/authorize";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { listMembers } from "@/lib/tenants/membership";
import { isValidId } from "@/lib/tenants/validation";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const { tenantId } = await params;
  if (!isValidId(tenantId)) {
    return NextResponse.json({ error: "Invalid tenant id" }, { status: 400 });
  }

  const { context, response } = await requirePermission(PERMISSIONS.VIEW_MEMBERS, tenantId);
  if (!context) {
    return response;
  }

  const members = await listMembers(tenantId);
  return NextResponse.json({ members });
}
