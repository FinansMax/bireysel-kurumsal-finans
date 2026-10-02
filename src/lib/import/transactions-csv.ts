import {
  importTransactions,
  type ImportRowError,
  type ImportRowErrorCode,
  type ImportTransactionRow,
} from "@/lib/finance/transaction";
import {
  isValidCategoryType,
  parseDescription,
  parseOccurredAt,
  parsePositiveMoney,
} from "@/lib/finance/validation";
import { isValidId } from "@/lib/tenants/validation";

import { parseCsv, unescapeFormulaInjection } from "./csv-parse";

/**
 * İşlem CSV'si içe aktarma (Issue #83): dosya şablonu ve satır doğrulaması.
 *
 * ŞABLON = DIŞA AKTARIMIN SÜTUNLARI (`src/lib/export/transactions-csv.ts`, #81). Dışa aktarılan
 * bir dosya olduğu gibi geri yüklenebilir; `id`, `created_at`, `updated_at` tanınır ama YOK
 * SAYILIR — kimlik ve zaman damgalarını sunucu üretir, dosya dikte edemez. (Sonuç: aynı dosyayı
 * iki kez yüklemek işlemleri İKİ KEZ kaydeder; bu bir senkronizasyon değil, içe aktarmadır.)
 *
 * BİLİNMEYEN SÜTUN HATADIR, sessizce atlanmaz: `aciklama` gibi yanlış yazılmış bir başlık,
 * açıklamaların sessizce boş kaydedilmesi demek olurdu.
 *
 * DOĞRULAMA TEK KAYNAKTAN: satır alanları `createTransaction()`'ın kullandığı AYNI
 * doğrulayıcılardan geçer (`validation.ts`). İki ayrı kural, formdan kabul edilen bir tutarın
 * dosyadan reddedilmesi (ya da tersi) demekti.
 */

/** Dosya boyutu üst sınırı. Route bunu gövdeyi OKUMADAN önce de kontrol eder. */
export const MAX_IMPORT_BYTES = 512 * 1024;

/** Tek dosyadaki satır üst sınırı: tek DB transaction'ının makul kalması için. */
export const MAX_IMPORT_ROWS = 1000;

const REQUIRED_COLUMNS = ["type", "amount", "occurred_at", "account_id"] as const;
const OPTIONAL_COLUMNS = ["description", "category_id"] as const;
const IGNORED_COLUMNS = ["id", "created_at", "updated_at"] as const;
const KNOWN_COLUMNS: readonly string[] = [
  ...REQUIRED_COLUMNS,
  ...OPTIONAL_COLUMNS,
  ...IGNORED_COLUMNS,
];

export type ImportFileError =
  | "empty_file"
  | "malformed_csv"
  | "missing_columns"
  | "unknown_columns"
  | "duplicate_columns"
  | "too_many_rows"
  | "no_valid_rows";

export type ImportTransactionsCsvResult =
  | { ok: true; imported: number; errors: ImportRowError[] }
  | { ok: false; status: 400; error: ImportFileError; errors: ImportRowError[] }
  | { ok: false; status: 409; error: string; errors: ImportRowError[] };

type ColumnIndex = Record<(typeof REQUIRED_COLUMNS)[number] | (typeof OPTIONAL_COLUMNS)[number], number>;

function fileError(error: ImportFileError): ImportTransactionsCsvResult {
  return { ok: false, status: 400, error, errors: [] };
}

function parseRow(
  record: string[],
  columns: ColumnIndex,
  width: number,
): { ok: true; row: Omit<ImportTransactionRow, "line"> } | { ok: false; code: ImportRowErrorCode } {
  if (record.length !== width) {
    return { ok: false, code: "column_count" };
  }
  const cell = (index: number) => (index >= 0 ? record[index].trim() : "");

  // Büyük/küçük harf DÖNÜŞTÜRÜLMEZ: API (`createTransaction`) yalnızca `INCOME`/`EXPENSE` kabul
  // ediyor; dosyada daha gevşek bir kural, iki girişin aynı değere farklı cevap vermesi olurdu.
  const type = cell(columns.type);
  if (!isValidCategoryType(type)) {
    return { ok: false, code: "invalid_type" };
  }

  const amount = parsePositiveMoney(cell(columns.amount));
  if (!amount) {
    return { ok: false, code: "invalid_amount" };
  }

  const occurredAt = parseOccurredAt(cell(columns.occurred_at));
  if (!occurredAt) {
    return { ok: false, code: "invalid_occurred_at" };
  }

  const accountId = cell(columns.account_id);
  if (!isValidId(accountId)) {
    return { ok: false, code: "invalid_account_id" };
  }

  const rawCategory = cell(columns.category_id);
  if (rawCategory !== "" && !isValidId(rawCategory)) {
    return { ok: false, code: "invalid_category_id" };
  }

  // Önce kırpılır, SONRA formül kaçırması geri alınır (bkz. `unescapeFormulaInjection`): ters
  // sırada baştaki bir boşluk `'=` desenini gizler ve kaçırma çözülmeden kalırdı. Kırpma,
  // `parseDescription()`'ın form yolundaki davranışıyla aynıdır. Boş hücre "notu yok"tur (`null`).
  const rawDescription = columns.description >= 0 ? record[columns.description].trim() : "";
  let description: string | null = null;
  if (rawDescription !== "") {
    const parsed = parseDescription(unescapeFormulaInjection(rawDescription));
    if (parsed === undefined) {
      return { ok: false, code: "invalid_description" };
    }
    description = parsed;
  }

  return {
    ok: true,
    row: {
      type,
      amount,
      occurredAt,
      accountId,
      categoryId: rawCategory === "" ? null : rawCategory,
      description,
    },
  };
}

export async function importTransactionsCsv(
  tenantId: string,
  actorUserId: string,
  csvText: string,
): Promise<ImportTransactionsCsvResult> {
  const parsed = parseCsv(csvText);
  if (!parsed.ok) {
    return fileError("malformed_csv");
  }
  if (parsed.records.length === 0) {
    return fileError("empty_file");
  }

  const [header, ...body] = parsed.records;
  const names = header.map((name) => name.trim().toLowerCase());

  if (new Set(names).size !== names.length) {
    return fileError("duplicate_columns");
  }
  if (names.some((name) => !KNOWN_COLUMNS.includes(name))) {
    return fileError("unknown_columns");
  }
  if (REQUIRED_COLUMNS.some((name) => !names.includes(name))) {
    return fileError("missing_columns");
  }
  if (body.length === 0) {
    return fileError("empty_file");
  }
  if (body.length > MAX_IMPORT_ROWS) {
    return fileError("too_many_rows");
  }

  const columns: ColumnIndex = {
    type: names.indexOf("type"),
    amount: names.indexOf("amount"),
    occurred_at: names.indexOf("occurred_at"),
    account_id: names.indexOf("account_id"),
    description: names.indexOf("description"),
    category_id: names.indexOf("category_id"),
  };

  const rows: ImportTransactionRow[] = [];
  const errors: ImportRowError[] = [];

  // `line`: başlık 1. kayıttır, ilk veri 2. — kullanıcının tablo programında gördüğü satır
  // numarasıyla örtüşür (alıntı içinde satır sonu yoksa).
  body.forEach((record, index) => {
    const line = index + 2;
    const result = parseRow(record, columns, names.length);
    if (result.ok) {
      rows.push({ line, ...result.row });
    } else {
      errors.push({ line, code: result.code });
    }
  });

  const outcome = await importTransactions(tenantId, actorUserId, rows);
  const allErrors = [...errors, ...outcome.errors].sort((a, b) => a.line - b.line);

  if (!outcome.ok) {
    return { ok: false, status: 409, error: outcome.error, errors: allErrors };
  }
  if (outcome.imported === 0) {
    // Hiçbir satır geçerli değil: 200 + "0 kayıt" dönmek, başarısız bir yüklemeyi başarılı
    // gibi gösterirdi.
    return { ok: false, status: 400, error: "no_valid_rows", errors: allErrors };
  }

  return { ok: true, imported: outcome.imported, errors: allErrors };
}
