import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/authz/authorize";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { createAccount, listAccounts } from "@/lib/finance/account";
import { isValidId } from "@/lib/tenants/validation";

type RouteParams = { params: Promise<{ tenantId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { tenantId } = await params;
  if (!isValidId(tenantId)) {
    return NextResponse.json({ error: "Invalid tenant id" }, { status: 400 });
  }

  const { context, response } = await requirePermission(PERMISSIONS.VIEW_ACCOUNTS, tenantId);
  if (!context) {
    return response;
  }

  // Sorgu scope'unun kaynağı `context.tenant.id`dir (requirePermission'ın DB'den canlı
  // doğruladığı aktif tenant) — URL parametresi DEĞİL (Issue #13). İkisi guard içindeki
  // `expectedTenantId` kontrolü sayesinde eşittir; yine de kaynak açıkça context'tir.
  const accounts = await listAccounts(context.tenant.id);
  return NextResponse.json({ accounts });
}

export async function POST(request: Request, { params }: RouteParams) {
  const { tenantId } = await params;
  if (!isValidId(tenantId)) {
    return NextResponse.json({ error: "Invalid tenant id" }, { status: 400 });
  }

  const { context, response } = await requirePermission(PERMISSIONS.MANAGE_ACCOUNTS, tenantId);
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

  const { name, type, currency, balance } = body as Record<string, unknown>;

  const result = await createAccount(context.tenant.id, context.user.id, {
    name,
    type,
    currency,
    balance,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ account: result.account }, { status: 201 });
}
