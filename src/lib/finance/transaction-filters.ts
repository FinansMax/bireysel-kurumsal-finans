import { isValidId } from "@/lib/tenants/validation";

import type { TransactionFilters } from "./transaction";
import { parseTransactionCursor, type TransactionCursor } from "./transaction-cursor";
import { parseFilterDate, MAX_SEARCH_QUERY_LENGTH, parseSearchQuery } from "./validation";

/**
 * İşlem listesi filtrelerinin TEK ayrıştırıcısı (Issue #56).
 *
 * Hem `GET /api/tenants/:id/transactions` route'u hem de `/transactions` sunucu bileşeni aynı
 * filtreleri okur. İki ayrı kopya yazmak, iki ayrı davranış demek olurdu: bir gün API'nin
 * reddettiği bir değeri ekran kabul eder (ya da tersi) ve kullanıcı, aynı URL'in iki farklı
 * sonuç verdiği bir duruma düşerdi.
 *
 * Fonksiyon HTTP bilmez; parametreyi nasıl okuyacağını çağıran söyler (`get`). Böylece
 * `URLSearchParams` ile Next.js'in `searchParams` nesnesi arasındaki fark buraya sızmaz.
 */

export type ParsedTransactionFilters =
  | { ok: true; filters: TransactionFilters; after: TransactionCursor | null }
  | { ok: false; error: string };

export const FILTER_ERRORS = {
  DATE: "from and to must be dates in YYYY-MM-DD format",
  RANGE: "from must not be after to",
  QUERY: `q must be at most ${MAX_SEARCH_QUERY_LENGTH} characters`,
  ACCOUNT_ID: "Invalid accountId",
  CATEGORY_ID: "Invalid categoryId",
  REPEATED: "Each filter may be provided at most once",
  CURSOR: "Invalid after cursor",
} as const;

/** Ham parametre değeri: yok, tek değer, ya da tekrarlanmış (`?q=a&q=b`). */
type RawValue = string | string[] | null | undefined;

/**
 * Tekrarlanan parametre HATADIR, ilk değer sessizce SEÇİLMEZ.
 *
 * `?accountId=A&accountId=B` gönderen bir istemci bir hata yapıyordur; birini seçip devam
 * etmek, kullanıcının istediğinden farklı bir listeyi doğruymuş gibi göstermek olurdu.
 */
function single(raw: RawValue): { value: string | null } | { error: string } {
  if (raw === null || raw === undefined) {
    return { value: null };
  }
  if (Array.isArray(raw)) {
    return { error: FILTER_ERRORS.REPEATED };
  }
  // Boş string ("filtre temizlendi") ile hiç gönderilmemiş parametre AYNI anlama gelir:
  // form boş bir alanı `?q=` olarak gönderir ve bu "filtre yok" demektir.
  return { value: raw === "" ? null : raw };
}

export function parseTransactionFilters(
  get: (key: string) => RawValue,
): ParsedTransactionFilters {
  const filters: TransactionFilters = {};

  for (const key of ["from", "to"] as const) {
    const raw = single(get(key));
    if ("error" in raw) {
      return { ok: false, error: raw.error };
    }
    if (raw.value === null) {
      continue;
    }
    const parsed = parseFilterDate(raw.value);
    if (!parsed) {
      return { ok: false, error: FILTER_ERRORS.DATE };
    }
    filters[key] = parsed;
  }

  // Ters aralık ("1 Nisan'dan 1 Mart'a") daima boş sonuç verir. Sessizce boş liste döndürmek
  // kullanıcıya "bu tarihlerde kayıt yok" dedirtirdi; oysa sorun veride değil filtrededir.
  if (filters.from && filters.to && filters.from.getTime() > filters.to.getTime()) {
    return { ok: false, error: FILTER_ERRORS.RANGE };
  }

  for (const key of ["accountId", "categoryId"] as const) {
    const raw = single(get(key));
    if ("error" in raw) {
      return { ok: false, error: raw.error };
    }
    if (raw.value === null) {
      continue;
    }
    if (!isValidId(raw.value)) {
      return {
        ok: false,
        error: key === "accountId" ? FILTER_ERRORS.ACCOUNT_ID : FILTER_ERRORS.CATEGORY_ID,
      };
    }
    filters[key] = raw.value;
  }

  const rawQuery = single(get("q"));
  if ("error" in rawQuery) {
    return { ok: false, error: rawQuery.error };
  }
  if (rawQuery.value !== null) {
    const parsed = parseSearchQuery(rawQuery.value);
    if (parsed === undefined) {
      return { ok: false, error: FILTER_ERRORS.QUERY };
    }
    if (parsed !== null) {
      filters.q = parsed;
    }
  }

  // Sayfalama imleci (Issue #135). Bir FİLTRE değildir — listeyi daraltmaz, nereden devam
  // edileceğini söyler — ama aynı sorgu dizesinde taşınır ve burada ayrıştırılır: tekrarlanan
  // parametre kontrolü ve "API ile ekran aynı URL'i aynı okur" garantisi ondan da geçmeli.
  //
  // GEÇERSİZ İMLEÇ SESSİZCE YOK SAYILMAZ: ilk sayfaya düşmek, kullanıcıya "sonraki sayfa"
  // dediği hâlde yeniden ilk sayfayı gösterirdi ve o bunu listenin sonu sanardı. Filtrelerdeki
  // aynı karar (#56: geçersiz filtre 400'dür, tam liste değil).
  const rawAfter = single(get("after"));
  if ("error" in rawAfter) {
    return { ok: false, error: rawAfter.error };
  }
  let after: TransactionCursor | null = null;
  if (rawAfter.value !== null) {
    after = parseTransactionCursor(rawAfter.value);
    if (!after) {
      return { ok: false, error: FILTER_ERRORS.CURSOR };
    }
  }

  return { ok: true, filters, after };
}
