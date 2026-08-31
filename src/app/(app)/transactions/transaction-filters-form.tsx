import Link from "next/link";
import { FIELD_CLASS, LABEL_CLASS } from "@/components/auth-form";

/**
 * İşlem listesi filtre formu (Issue #56).
 *
 * BU BİR CLIENT COMPONENT DEĞİLDİR — bilerek. Düz bir `<form method="get">`, alanları URL'e
 * yazar ve sunucu bileşenini yeni `searchParams` ile yeniden çalıştırır. Kazandırdıkları:
 *
 * - **Filtre durumu URL'dedir**, React state'inde değil: sonuç paylaşılabilir, yer imine
 *   eklenebilir, tarayıcı geri tuşu doğru çalışır.
 * - **Hiç istemci JavaScript'i gerekmez** — bu kod tabanının "`use client` yalnızca gerektiğinde
 *   ve en küçük yaprakta" kuralının doğal sonucu.
 * - Filtreleme okuma işlemidir; `GET` yan etkisizdir (invariant #4) ve bu form onu ihlal etmez.
 *
 * Alternatif (`useState` + `router.push`) aynı sonucu daha fazla kodla ve hydration'a bağımlı
 * olarak verirdi.
 *
 * Boş bırakılan alanlar `?from=&q=` gibi BOŞ STRING olarak gider; ayrıştırıcı bunu "filtre yok"
 * olarak okur (bkz. `transaction-filters.ts`), bu yüzden ayrıca temizlemeye gerek yoktur.
 */

type AccountOption = { id: string; name: string };
type CategoryOption = { id: string; name: string; type: string };

const TYPE_LABELS: Record<string, string> = {
  INCOME: "Gelir",
  EXPENSE: "Gider",
};

export type ActiveFilterValues = {
  from: string;
  to: string;
  accountId: string;
  categoryId: string;
  q: string;
};

export function TransactionFiltersForm({
  accounts,
  categories,
  values,
  hasActiveFilters,
}: {
  accounts: AccountOption[];
  categories: CategoryOption[];
  values: ActiveFilterValues;
  hasActiveFilters: boolean;
}) {
  // Alan ve etiket sınıfları PAYLAŞILAN sabitlerden gelir: filtre formunun alanları, kayıt
  // formunun alanlarıyla birebir aynı görünmeli — ikisi aynı ekranda, alt alta duruyor.
  const fieldClassName = FIELD_CLASS;
  const labelClassName = LABEL_CLASS;

  return (
    <form
      method="get"
      action="/transactions"
      // Kayıt formuyla aynı etiketleri paylaştığı için erişilebilir ad zorunlu (bkz.
      // create-transaction-form.tsx'teki aynı not).
      aria-label="İşlem filtreleri"
      className="space-y-4 rounded-panel border border-line bg-surface p-5 shadow-subtle"
    >
      <h2 className="text-sm font-semibold text-strong">Filtrele</h2>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <label htmlFor="filter-from" className={labelClassName}>
            Başlangıç tarihi
          </label>
          <input
            id="filter-from"
            name="from"
            type="date"
            defaultValue={values.from}
            className={fieldClassName}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="filter-to" className={labelClassName}>
            Bitiş tarihi
          </label>
          {/* Bitiş tarihi kullanıcı için DAHİLDİR: "15 Mart'a kadar" 15 Mart'ı da kapsar
              (servis katmanı bunu ertesi günün başlangıcına `lt` olarak çevirir). */}
          <input
            id="filter-to"
            name="to"
            type="date"
            defaultValue={values.to}
            className={fieldClassName}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="filter-account" className={labelClassName}>
            Hesap
          </label>
          <select
            id="filter-account"
            name="accountId"
            defaultValue={values.accountId}
            className={fieldClassName}
          >
            <option value="">Tümü</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="filter-category" className={labelClassName}>
            Kategori
          </label>
          {/* Kategori seçeneği türüyle birlikte yazılır ("Market (Gider)"): kayıt formunun
              aksine burada tür filtresi yoktur, dolayısıyla gelir ve gider kategorileri aynı
              listede yan yana görünür ve aynı isim iki tarafta da bulunabilir (#49). */}
          <select
            id="filter-category"
            name="categoryId"
            defaultValue={values.categoryId}
            className={fieldClassName}
          >
            <option value="">Tümü</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name} ({TYPE_LABELS[category.type] ?? category.type})
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
          <label htmlFor="filter-q" className={labelClassName}>
            Açıklamada ara
          </label>
          <input
            id="filter-q"
            name="q"
            type="search"
            autoComplete="off"
            placeholder="ör. kira"
            defaultValue={values.q}
            className={fieldClassName}
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          className="rounded-control bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-raised transition-colors duration-150 ease-out-soft hover:bg-brand-700"
        >
          Filtrele
        </button>

        {/* Temizleme bir düğme değil LİNK: filtresiz liste kendi URL'idir (`/transactions`),
            dolayısıyla form göndermeye gerek yok. */}
        {hasActiveFilters && (
          <Link
            href="/transactions"
            className="text-sm font-medium text-muted underline-offset-4 hover:text-strong hover:underline"
          >
            Filtreleri temizle
          </Link>
        )}
      </div>
    </form>
  );
}
