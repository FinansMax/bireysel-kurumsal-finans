import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/authz/authorize";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { createTransaction, listTransactions } from "@/lib/finance/transaction";
import { isValidId } from "@/lib/tenants/validation";

type RouteParams = { params: Promise<{ tenantId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { tenantId } = await params;
  if (!isValidId(tenantId)) {
    return NextResponse.json({ error: "Invalid tenant id" }, { status: 400 });
  }

  const { context, response } = await requirePermission(PERMISSIONS.VIEW_TRANSACTIONS, tenantId);
  if (!context) {
    return response;
  }

  // Sorgu scope'unun kaynağı `context.tenant.id`dir (requirePermission'ın DB'den canlı
  // doğruladığı aktif tenant) — URL parametresi DEĞİL (Issue #13).
  const transactions = await listTransactions(context.tenant.id);
  return NextResponse.json({ transactions });
}

export async function POST(request: Request, { params }: RouteParams) {
  const { tenantId } = await params;
  if (!isValidId(tenantId)) {
    return NextResponse.json({ error: "Invalid tenant id" }, { status: 400 });
  }

  const { context, response } = await requirePermission(
    PERMISSIONS.MANAGE_TRANSACTIONS,
    tenantId,
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

  // `accountId`/`categoryId` body'den gelir ve bu GÜVENLİDİR: ikisi de servis katmanında
  // `tenantScoped()` ile AKTİF TENANT içinde aranır (bkz. `requireAccount()`), yani başka bir
  // tenant'ın geçerli id'si burada asla eşleşmez. Güvenilmeyen tek şey `tenantId`dir ve o
  // body'den değil `context`ten alınır.
  const result = await createTransaction(context.tenant.id, context.user.id, {
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

  return NextResponse.json({ transaction: result.transaction }, { status: 201 });
}
