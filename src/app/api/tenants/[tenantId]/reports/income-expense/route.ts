import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/authz/authorize";
import { hasAllPermissions, PERMISSIONS } from "@/lib/authz/permissions";
import { currentMonthRange, resolveDateRange } from "@/lib/finance/aggregation";
import { getIncomeExpenseReport } from "@/lib/finance/income-expense-report";
import { isValidId } from "@/lib/tenants/validation";

type RouteParams = { params: Promise<{ tenantId: string }> };

/**
 * Dönemsel gelir-gider raporu (Issue #67).
 *
 * `dashboard/spending-by-category` ile AYNI iskelet: ucuz şekil kontrolü → ortak aralık çözümü
 * → authz → servis. Aralık kuralları (`YYYY-MM-DD`, tekrarlanan parametre hatadır, kısmi
 * aralığın varsayılanla tamamlanması, ters aralık 400'dür) `aggregation.ts`'te TEK yerde
 * tanımlıdır — aynı URL her endpoint'te aynı dönemi anlatmalı.
 *
 * YETKİ: rapor üç modelin verisini birlikte açar (tutarlar, kategori adları, hesap adları), bu
 * yüzden üç görüntüleme izninin TAMAMI aranır — `dashboard/summary` ile aynı kural.
 *
 * `GET` YAN ETKİSİZDİR (invariant #4).
 */
export async function GET(request: Request, { params }: RouteParams) {
  const { tenantId } = await params;
  if (!isValidId(tenantId)) {
    return NextResponse.json({ error: "Invalid tenant id" }, { status: 400 });
  }

  // `getAll()` kullanılır, `get()` DEĞİL: `get()` tekrarlanan parametrede sessizce ilk değeri
  // döndürür ve ayrıştırıcının "tekrar hatadır" kontrolü hiç tetiklenmezdi.
  const search = new URL(request.url).searchParams;
  const parsed = resolveDateRange((key) => {
    const all = search.getAll(key);
    if (all.length === 0) return null;
    return all.length === 1 ? all[0] : all;
  }, currentMonthRange());
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { context, response } = await requirePermission(PERMISSIONS.VIEW_TRANSACTIONS, tenantId);
  if (!context) {
    return response;
  }

  if (
    !hasAllPermissions(context.role, [
      PERMISSIONS.VIEW_ACCOUNTS,
      PERMISSIONS.VIEW_TRANSACTIONS,
      PERMISSIONS.VIEW_CATEGORIES,
    ])
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Scope'un kaynağı `context.tenant.id` — URL parametresi DEĞİL (Issue #13).
  const report = await getIncomeExpenseReport(context.tenant.id, parsed.range);

  return NextResponse.json({ report });
}
