import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/authz/authorize";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { toCsv } from "@/lib/export/csv";
import { listTransactionsForExport, type TransactionExportRow } from "@/lib/finance/transaction";
import { parseTransactionFilters } from "@/lib/finance/transaction-filters";
import { isValidId } from "@/lib/tenants/validation";

type RouteParams = { params: Promise<{ tenantId: string }> };

const TYPE_LABELS: Record<TransactionExportRow["type"], string> = {
  INCOME: "Gelir",
  EXPENSE: "Gider",
};

/**
 * İşlem listesini dosya olarak dışa aktarır (Issue #81).
 *
 * `GET .../transactions/export?format=csv&from=&to=&accountId=&categoryId=&q=`.
 *
 * `format=xlsx` HENÜZ DESTEKLENMİYOR (issue'nun kapsamı `csv|xlsx`): xlsx üretimi yeni bir
 * npm bağımlılığı gerektirir ve bu repo'da bağımlılık eklemek açık onay ister (CLAUDE.md §4
 * "Ek kural"). Onay alınmadan bir kütüphane seçip eklemek yerine bugün yalnızca CSV'yi
 * (bağımlılıksız, `src/lib/export/csv.ts`) sunuyoruz; `xlsx` istenirse 400 ile açıkça
 * reddedilir — sessizce CSV'ye düşülmez.
 *
 * FİLTRELER `parseTransactionFilters()` İLE PAYLAŞILIR (Issue #56): listeleme ekranı ve bu
 * uç aynı `?from=&to=&accountId=&categoryId=&q=`'i aynı şekilde okur/reddeder. `after` (imleç)
 * parse edilir (tekrarlanan parametre kontrolü ondan da geçmeli) ama KULLANILMAZ: dışa aktarma
 * "sonraki sayfa" bilmez, filtreye uyan HER ŞEYİ ister.
 */
export async function GET(request: Request, { params }: RouteParams) {
  const { tenantId } = await params;
  if (!isValidId(tenantId)) {
    return NextResponse.json({ error: "Invalid tenant id" }, { status: 400 });
  }

  const search = new URL(request.url).searchParams;

  const format = search.get("format") ?? "csv";
  if (format !== "csv") {
    return NextResponse.json(
      { error: "format must be csv (xlsx not yet supported)" },
      { status: 400 },
    );
  }

  const parsed = parseTransactionFilters((key) => {
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

  // Scope'un kaynağı `context.tenant.id` — URL parametresi DEĞİL (Issue #13).
  const { rows, truncated } = await listTransactionsForExport(context.tenant.id, parsed.filters);

  if (truncated) {
    // Kısmi bir dosyayı "tam" gibi indirmek sessiz bir hata olurdu (bkz. servis katmanı
    // NEDEN'i); kullanıcı filtreyi daraltmaya yönlendirilir.
    return NextResponse.json(
      { error: "Too many rows for a single export; narrow the from/to filter" },
      { status: 413 },
    );
  }

  const csv = toCsv(rows, [
    { header: "occurred_at", value: (row) => row.occurredAt },
    { header: "type", value: (row) => TYPE_LABELS[row.type] },
    { header: "amount", value: (row) => row.amount },
    { header: "description", value: (row) => row.description },
    { header: "account", value: (row) => row.accountName },
    { header: "category", value: (row) => row.categoryName },
  ]);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      // Tarayıcı geçmişine yazılmaz (bu bir link değil, indirme yanıtıdır) ama yine de
      // dosya adı sabit tutulur: her indirme "islemler.csv" olarak gelir, kullanıcı hangi
      // filtreyle indirdiğini dosya adından değil, indirdiği anda hatırlar.
      "Content-Disposition": 'attachment; filename="islemler.csv"',
    },
  });
}
