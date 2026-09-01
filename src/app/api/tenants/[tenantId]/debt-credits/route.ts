import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/authz/authorize";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { createDebtCredit, listDebtCredits } from "@/lib/finance/debt-credit";
import { isValidId } from "@/lib/tenants/validation";

type RouteParams = { params: Promise<{ tenantId: string }> };

/**
 * Borç/alacak kayıtları (Issue #70).
 *
 * `accounts/route.ts` ile BİREBİR aynı iskelet: ucuz şekil kontrolü → authz → parse →
 * servis → sonuç eşlemesi. Yeni bir desen ÜRETİLMEDİ.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { tenantId } = await params;
  if (!isValidId(tenantId)) {
    return NextResponse.json({ error: "Invalid tenant id" }, { status: 400 });
  }

  const { context, response } = await requirePermission(PERMISSIONS.VIEW_DEBT_CREDITS, tenantId);
  if (!context) {
    return response;
  }

  // Sorgu scope'unun kaynağı `context.tenant.id` — URL parametresi DEĞİL (Issue #13).
  const debtCredits = await listDebtCredits(context.tenant.id);
  return NextResponse.json({ debtCredits });
}

export async function POST(request: Request, { params }: RouteParams) {
  const { tenantId } = await params;
  if (!isValidId(tenantId)) {
    return NextResponse.json({ error: "Invalid tenant id" }, { status: 400 });
  }

  const { context, response } = await requirePermission(
    PERMISSIONS.MANAGE_DEBT_CREDITS,
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

  const { type, counterparty, amount, currency, dueDate, status } = body as Record<
    string,
    unknown
  >;

  const result = await createDebtCredit(context.tenant.id, context.user.id, {
    type,
    counterparty,
    amount,
    currency,
    dueDate,
    status,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ debtCredit: result.debtCredit }, { status: 201 });
}
