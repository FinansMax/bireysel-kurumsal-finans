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

  // tenantId'nin trusted kaynağı burada `context.tenant.id`dir (requirePermission'ın DB'den
  // canlı doğruladığı active tenant) — URL parametresinin kendisi DEĞİL (Issue #13). Bu iki
  // değer requirePermission içindeki expectedTenantId eşleşme kontrolü sayesinde eşittir,
  // ama sorgu scope'u için kaynak olarak açıkça context kullanılır.
  const members = await listMembers(context.tenant.id);
  return NextResponse.json({ members });
}
