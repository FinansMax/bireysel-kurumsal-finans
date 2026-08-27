import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/authz/authorize";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { deleteTransaction, updateTransaction } from "@/lib/finance/transaction";
import { isValidId } from "@/lib/tenants/validation";

type RouteParams = { params: Promise<{ tenantId: string; transactionId: string }> };

async function resolveParams(params: RouteParams["params"]) {
  const { tenantId, transactionId } = await params;
  if (!isValidId(tenantId) || !isValidId(transactionId)) {
    return null;
  }
  return { tenantId, transactionId };
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const ids = await resolveParams(params);
  if (!ids) {
    return NextResponse.json({ error: "Invalid tenant or transaction id" }, { status: 400 });
  }

  const { context, response } = await requirePermission(
    PERMISSIONS.MANAGE_TRANSACTIONS,
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

  const { accountId, categoryId, type, amount, description, occurredAt } = body as Record<
    string,
    unknown
  >;

  // Trusted tenantId `context.tenant.id`dir; `actorUserId` de aynı context'ten gelir (audit).
  // Body'deki olası `tenantId`/`id` alanları servise HİÇ geçirilmez.
  const result = await updateTransaction(context.tenant.id, ids.transactionId, context.user.id, {
    accountId,
    categoryId,
    type,
    amount,
    description,
    occurredAt,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ transaction: result.transaction });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const ids = await resolveParams(params);
  if (!ids) {
    return NextResponse.json({ error: "Invalid tenant or transaction id" }, { status: 400 });
  }

  const { context, response } = await requirePermission(
    PERMISSIONS.MANAGE_TRANSACTIONS,
    ids.tenantId,
  );
  if (!context) {
    return response;
  }

  const result = await deleteTransaction(context.tenant.id, ids.transactionId, context.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return new NextResponse(null, { status: 204 });
}
