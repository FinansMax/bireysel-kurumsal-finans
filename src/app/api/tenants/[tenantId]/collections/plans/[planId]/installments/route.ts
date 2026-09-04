import { NextRequest, NextResponse } from "next/server";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { requireModule } from "@/lib/modules/guard";
import { MODULES } from "@/lib/modules/catalog";
import { listInstallments } from "@/lib/collections/payment-plan";

export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ tenantId: string; planId: string }> }
) {
  const params = await props.params;

  const authResult = await requireModule(MODULES.COLLECTIONS, PERMISSIONS.VIEW_COLLECTIONS, params.tenantId);
  if (authResult.response) return authResult.response;

  const serviceResult = await listInstallments(authResult.context.tenant.id, {
    planId: params.planId,
  });

  if (!serviceResult.ok) {
    return NextResponse.json({ error: serviceResult.error }, { status: serviceResult.status });
  }

  return NextResponse.json(serviceResult.data, { status: 200 });
}
