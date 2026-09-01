import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/authz/authorize";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { deleteAccount, updateAccount } from "@/lib/finance/account";
import { isValidId } from "@/lib/tenants/validation";

type RouteParams = { params: Promise<{ tenantId: string; accountId: string }> };

async function resolveParams(params: RouteParams["params"]) {
  const { tenantId, accountId } = await params;
  if (!isValidId(tenantId) || !isValidId(accountId)) {
    return null;
  }
  return { tenantId, accountId };
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const ids = await resolveParams(params);
  if (!ids) {
    return NextResponse.json({ error: "Invalid tenant or account id" }, { status: 400 });
  }

  const { context, response } = await requirePermission(
    PERMISSIONS.MANAGE_ACCOUNTS,
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

  const { name, type, currency, balance, bankCode } = body as Record<string, unknown>;

  // Trusted tenantId `context.tenant.id`dir; `actorUserId` de aynı context'ten gelir (audit).
  // Body'deki olası `tenantId`/`id` alanları servise HİÇ geçirilmez.
  const result = await updateAccount(context.tenant.id, ids.accountId, context.user.id, {
    name,
    type,
    currency,
    balance,
    bankCode,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ account: result.account });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const ids = await resolveParams(params);
  if (!ids) {
    return NextResponse.json({ error: "Invalid tenant or account id" }, { status: 400 });
  }

  const { context, response } = await requirePermission(
    PERMISSIONS.MANAGE_ACCOUNTS,
    ids.tenantId,
  );
  if (!context) {
    return response;
  }

  const result = await deleteAccount(context.tenant.id, ids.accountId, context.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return new NextResponse(null, { status: 204 });
}
