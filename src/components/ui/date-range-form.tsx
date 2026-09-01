import Link from "next/link";

import { FIELD_CLASS, LABEL_CLASS } from "@/components/auth-form";

/**
 * Dönem (tarih aralığı) seçici — panelin harcama dağılımı (#65) ve rapor ekranı (#67) tarafından
 * PAYLAŞILIR.
 *
 * `TransactionFiltersForm` (#56) ile aynı duruş ve aynı gerekçeler: düz bir
 * `<form method="get">`, client component DEĞİL. Dönem URL'de yaşar (`?from=&to=`), böylece
 * sonuç paylaşılabilir, yer imine eklenebilir ve geri tuşu doğru çalışır; hiç istemci
 * JavaScript'i gerekmez ve `GET`in yan etkisizliği (invariant #4) ihlal edilmez.
 *
 * `action` AÇIKÇA verilir: göreli bir gönderim mevcut sorgu dizesini taşır ve ileride sayfaya
 * başka bir parametre eklendiğinde onu sessizce düşürürdü.
 *
 * `idPrefix` zorunludur: aynı sayfada ikinci bir dönem formu belirdiğinde `id`ler çakışır ve
 * `<label for>` bağlantısı sessizce yanlış alana gider.
 *
 * Boş bırakılan alan `?from=` olarak gider; ayrıştırıcı bunu "verilmedi" okur ve o uç varsayılan
 * aralıktan tamamlanır (bkz. `src/lib/finance/aggregation.ts` → `resolveDateRange`).
 */
export function DateRangeForm({
  action,
  ariaLabel,
  idPrefix,
  from,
  to,
  isDefaultRange,
  resetLabel,
}: {
  /** Formun gönderileceği yol (ör. `/reports`). */
  action: string;
  /** Sayfada birden fazla form olabildiği için erişilebilir ad zorunlu. */
  ariaLabel: string;
  idPrefix: string;
  /** Forma geri yazılacak değerler, `YYYY-MM-DD`. */
  from: string;
  to: string;
  /** Varsayılan dönemdeyken sıfırlama bağlantısı gösterilmez — gidecek yer yok. */
  isDefaultRange: boolean;
  resetLabel: string;
}) {
  return (
    <form method="get" action={action} aria-label={ariaLabel} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-from`} className={LABEL_CLASS}>
          Başlangıç
        </label>
        <input
          id={`${idPrefix}-from`}
          name="from"
          type="date"
          defaultValue={from}
          className={FIELD_CLASS}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-to`} className={LABEL_CLASS}>
          Bitiş
        </label>
        {/* Bitiş tarihi kullanıcı için DAHİLDİR: "15 Mart'a kadar" 15 Mart'ı da kapsar
            (ortak `nextDay()` kuralı, bkz. `src/lib/finance/transaction.ts`). */}
        <input
          id={`${idPrefix}-to`}
          name="to"
          type="date"
          defaultValue={to}
          className={FIELD_CLASS}
        />
      </div>

      <button
        type="submit"
        className="rounded-control bg-brand-600 px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out-soft hover:bg-brand-700"
      >
        Uygula
      </button>

      {isDefaultRange ? null : (
        <Link
          href={action}
          className="px-1 py-2 text-sm font-medium text-brand-600 transition-colors duration-150 ease-out-soft hover:text-brand-700 dark:text-brand-300"
        >
          {resetLabel}
        </Link>
      )}
    </form>
  );
}
