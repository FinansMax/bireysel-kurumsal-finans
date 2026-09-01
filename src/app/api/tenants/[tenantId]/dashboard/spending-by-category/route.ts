import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/authz/authorize";
import { hasAllPermissions, PERMISSIONS } from "@/lib/authz/permissions";
import {
  defaultSpendingRange,
  getSpendingByCategory,
  type SpendingRange,
} from "@/lib/finance/spending-by-category";
import { FILTER_ERRORS, parseTransactionFilters } from "@/lib/finance/transaction-filters";
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
  const search = new URL(request.url).searchParams;
  const parsed = parseTransactionFilters((key) => {
    if (key !== "from" && key !== "to") {
      return null;
    }
    const all = search.getAll(key);
    if (all.length === 0) return null;
    return all.length === 1 ? all[0] : all;
  });
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

  // Aralık KISMEN verilebilir (`?from=` var, `?to=` yok): eksik uç, varsayılan aralığın aynı
  // ucundan tamamlanır. Alternatif — "ikisi de zorunlu" — kullanıcıyı, aslında tek bir sınır
  // sorduğu durumda ikinci bir tarih uydurmaya zorlardı.
  const fallback = defaultSpendingRange();
  const range: SpendingRange = {
    from: parsed.filters.from ?? fallback.from,
    to: parsed.filters.to ?? fallback.to,
  };

  // Ters aralık kontrolü BİRLEŞTİRMEDEN SONRA da yapılır: ayrıştırıcı yalnızca İKİSİ DE
  // verildiğinde bakabilir, oysa tek uçlu bir istek varsayılanla birleşince de ters aralık
  // üretebilir (`?from=2026-12-01` + varsayılan `to` = bu ayın sonu). Sessizce boş dağılım
  // döndürmek, kullanıcıya "bu tarihlerde harcama yok" dedirtirdi; oysa sorun filtrededir
  // (#56'nın kararının aynısı).
  if (range.from.getTime() > range.to.getTime()) {
    return NextResponse.json({ error: FILTER_ERRORS.RANGE }, { status: 400 });
  }

  // Scope'un kaynağı `context.tenant.id` — URL parametresi DEĞİL (Issue #13).
  const spending = await getSpendingByCategory(context.tenant.id, range);

  return NextResponse.json({ spending });
}
