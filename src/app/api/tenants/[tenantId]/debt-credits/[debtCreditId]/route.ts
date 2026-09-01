import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/authz/authorize";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { deleteDebtCredit, updateDebtCredit } from "@/lib/finance/debt-credit";
import { isValidId } from "@/lib/tenants/validation";

type RouteParams = { params: Promise<{ tenantId: string; debtCreditId: string }> };

async function resolveParams(params: RouteParams["params"]) {
  const { tenantId, debtCreditId } = await params;
  if (!isValidId(tenantId) || !isValidId(debtCreditId)) {
    return null;
  }
  return { tenantId, debtCreditId };
}

/**
 * Tek bir borç/alacak kaydı (Issue #70). `accounts/[accountId]/route.ts` ile aynı iskelet.
 *
 * DURUM DEĞİŞİMİ İÇİN AYRI BİR ENDPOINT YOKTUR (`POST .../settle` gibi): "kapandı" işareti
 * kaydın bir ALANIDIR ve diğer alanlarla aynı yoldan güncellenir. Ayrı bir endpoint, aynı
 * yetki ve izolasyon kontrollerinin ikinci bir kopyasını doğururdu.
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  const ids = await resolveParams(params);
  if (!ids) {
    return NextResponse.json({ error: "Invalid tenant or record id" }, { status: 400 });
  }

  const { context, response } = await requirePermission(
    PERMISSIONS.MANAGE_DEBT_CREDITS,
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

  const { type, counterparty, amount, currency, dueDate, status } = body as Record<
    string,
    unknown
  >;

  const result = await updateDebtCredit(
    context.tenant.id,
    ids.debtCreditId,
    context.user.id,
    { type, counterparty, amount, currency, dueDate, status },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ debtCredit: result.debtCredit });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const ids = await resolveParams(params);
  if (!ids) {
    return NextResponse.json({ error: "Invalid tenant or record id" }, { status: 400 });
  }

  const { context, response } = await requirePermission(
    PERMISSIONS.MANAGE_DEBT_CREDITS,
    ids.tenantId,
  );
  if (!context) {
    return response;
  }

  const result = await deleteDebtCredit(context.tenant.id, ids.debtCreditId, context.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return new NextResponse(null, { status: 204 });
}
