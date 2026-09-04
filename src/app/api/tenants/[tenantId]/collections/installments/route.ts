import { NextRequest, NextResponse } from "next/server";
import { InstallmentStatus } from "@prisma/client";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { requireModule } from "@/lib/modules/guard";
import { MODULES } from "@/lib/modules/catalog";
import { listInstallments } from "@/lib/collections/payment-plan";

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ tenantId: string }> }
) {
  const params = await props.params;

  const authResult = await requireModule(MODULES.COLLECTIONS, PERMISSIONS.VIEW_COLLECTIONS, params.tenantId);
  if (authResult.response) return authResult.response;

  const searchParams = request.nextUrl.searchParams;
  const fromStr = searchParams.get("from");
  const toStr = searchParams.get("to");
  const statusStr = searchParams.get("status");
  const overdueStr = searchParams.get("overdue");

  let fromDate: Date | undefined;
  if (fromStr) {
    const d = new Date(fromStr);
    if (!isNaN(d.getTime())) fromDate = d;
  }

  let toDate: Date | undefined;
  if (toStr) {
    const d = new Date(toStr);
    if (!isNaN(d.getTime())) toDate = d;
  }

  let status: InstallmentStatus | undefined;
  if (statusStr && Object.values(InstallmentStatus).includes(statusStr as InstallmentStatus)) {
    status = statusStr as InstallmentStatus;
  }

  const overdue = overdueStr === "true";

  const serviceResult = await listInstallments(authResult.context.tenant.id, {
    from: fromDate,
    to: toDate,
    status,
    overdue,
  });

  if (!serviceResult.ok) {
    return NextResponse.json({ error: serviceResult.error }, { status: serviceResult.status });
  }

  return NextResponse.json(serviceResult.data, { status: 200 });
}
