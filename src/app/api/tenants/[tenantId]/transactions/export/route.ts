import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/authz/authorize";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { exportTransactionsCsv } from "@/lib/export/transactions-csv";
import { parseTransactionFilters } from "@/lib/finance/transaction-filters";
import { isValidId } from "@/lib/tenants/validation";

type RouteParams = { params: Promise<{ tenantId: string }> };

const SUPPORTED_FORMAT = "csv";

/**
 * Filtrelenmiş işlem listesini dosya olarak indirir (Issue #81).
 *
 * `?format=csv|xlsx` ISTENIR ama yalnızca `csv` DESTEKLENIR: `xlsx` yeni bir npm bağımlılığı
 * gerektirir (CLAUDE.md §4 — açık onay şartı). Onay gelene kadar `xlsx` sessizce `csv`ye
 * DÜŞMEZ (bu, kullanıcıya istemediği bir biçimi vermek olurdu); açıkça `400` döner.
 *
 * FİLTRELER `/transactions` ekranı ve `GET .../transactions` ile AYNI ayrıştırıcıdan geçer
 * (`transaction-filters.ts`) — ekranda görülen kayıt kümesiyle indirilen dosya sessizce
 * ayrışmasın diye (bkz. `transaction.ts`teki `listAllTransactionsForExport()` notu).
 * `after` (sayfalama imleci) burada da ayrıştırılır ama KULLANILMAZ: dışa aktarma sayfa değil,
 * filtreyle eşleşen HER kaydı verir.
 */
export async function GET(request: Request, { params }: RouteParams) {
  const { tenantId } = await params;
  if (!isValidId(tenantId)) {
    return NextResponse.json({ error: "Invalid tenant id" }, { status: 400 });
  }

  const search = new URL(request.url).searchParams;

  const format = search.get("format") ?? SUPPORTED_FORMAT;
  if (format !== SUPPORTED_FORMAT) {
    return NextResponse.json({ error: `Only format=${SUPPORTED_FORMAT} is supported` }, {
      status: 400,
    });
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

  const csv = await exportTransactionsCsv(context.tenant.id, parsed.filters);

  // Dosya adı SABİTTİR, kullanıcı girdisinden TÜRETİLMEZ: bir `Content-Disposition` başlığına
  // konan kaçırılmamış kullanıcı verisi başlık enjeksiyonu açardı (`tenant-export-service.ts`
  // dosya adının slug değil id taşımasıyla aynı gerekçe).
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="islemler.csv"',
    },
  });
}
