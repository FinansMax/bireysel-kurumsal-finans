import {
  listAllTransactionsForExport,
  type TransactionFilters,
  type TransactionView,
} from "@/lib/finance/transaction";

import { toCsv, type CsvColumn } from "./csv";

/**
 * İşlem listesi dışa aktarımı (Issue #81).
 *
 * SÜTUNLAR `tenant-data.ts`'teki `islemler.csv` ile BİREBİR AYNIDIR (id, type, amount,
 * description, occurred_at, account_id, category_id, created_at, updated_at): iki dışa
 * aktarma yolu (filtreli tekil / tüm tenant) aynı dosyayı farklı biçimlerde üretirse, ikisini
 * birlikte kullanan biri (ör. içe aktarma, Epic 10) iki ayrı ayrıştırıcı yazmak zorunda kalırdı.
 *
 * HESAP/KATEGORİ ADI YOKTUR, yalnızca id: aynı gerekçe — API bilerek ilişki genişletmez (dar
 * `select` allowlist'i, bkz. `transaction.ts`), dışa aktarma bunun istisnası değildir.
 */
const COLUMNS: readonly CsvColumn<TransactionView>[] = [
  { header: "id", value: (row) => row.id },
  { header: "type", value: (row) => row.type },
  { header: "amount", value: (row) => row.amount },
  { header: "description", value: (row) => row.description },
  { header: "occurred_at", value: (row) => row.occurredAt },
  { header: "account_id", value: (row) => row.accountId },
  { header: "category_id", value: (row) => row.categoryId },
  { header: "created_at", value: (row) => row.createdAt },
  { header: "updated_at", value: (row) => row.updatedAt },
];

export async function exportTransactionsCsv(
  tenantId: string,
  filters: TransactionFilters,
): Promise<string> {
  const transactions = await listAllTransactionsForExport(tenantId, filters);
  return toCsv(transactions, COLUMNS);
}
