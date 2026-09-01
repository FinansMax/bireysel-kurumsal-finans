import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/authz/authorize";
import { hasAllPermissions, PERMISSIONS } from "@/lib/authz/permissions";
import { resolveDateRange } from "@/lib/finance/aggregation";
import { defaultSpendingRange, getSpendingByCategory } from "@/lib/finance/spending-by-category";
import { isValidId } from "@/lib/tenants/validation";

type RouteParams = { params: Promise<{ tenantId: string }> };

/**
 * Kategori bazlı harcama dağılımı (Issue #65).
 *
 * FİLTRE AYRIŞTIRICISI `/transactions` İLE ORTAKTIR. `?from=&to=` burada da aynı biçimi
 * (`YYYY-MM-DD`), aynı "tekrarlanan parametre hatadır" kuralını ve aynı "ters aralık 400'dür"
 * kararını (#56) izler. İkinci bir ayrıştırıcı yazmak, aynı URL'in iki endpoint'te farklı
 * davranması demek olurdu; ayrıştırıcının işlem-dışı filtreleri (`accountId`, `q`, `after`)
 * bu endpoint'e HİÇ sorulmaz, dolayısıyla sessizce yok sayılırlar.
 *
 * YETKİ: `dashboard/summary` ile aynı kural — yanıt işlem tutarlarını, kategori adlarını ve
 * (para birimi üzerinden) hesap bilgisini birlikte açar, bu yüzden üç görüntüleme izninin
 * TAMAMI aranır.
 *
 * `GET` YAN ETKİSİZDİR (invariant #4).
 */
export async function GET(request: Request, { params }: RouteParams) {
  const { tenantId } = await params;
  if (!isValidId(tenantId)) {
    return NextResponse.json({ error: "Invalid tenant id" }, { status: 400 });
  }

  // Ucuz şekil kontrolü authz'den ÖNCE (route sırası, CLAUDE.md §5). `getAll()` kullanılır,
  // `get()` DEĞİL: `get()` tekrarlanan parametrede sessizce ilk değeri döndürür ve
  // ayrıştırıcının "tekrar hatadır" kontrolü hiç tetiklenmezdi.
  //
  // Aralık çözümü ORTAKTIR (`resolveDateRange`): kısmi aralığın varsayılanla tamamlanması ve
  // birleştirmeden SONRAKİ ters aralık kontrolü dahil (bkz. `aggregation.ts`).
  const search = new URL(request.url).searchParams;
  const parsed = resolveDateRange((key) => {
    const all = search.getAll(key);
    if (all.length === 0) return null;
    return all.length === 1 ? all[0] : all;
  }, defaultSpendingRange());
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
  const spending = await getSpendingByCategory(context.tenant.id, parsed.range);

  return NextResponse.json({ spending });
}
