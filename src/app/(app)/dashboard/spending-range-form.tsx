import Link from "next/link";

import { FIELD_CLASS, LABEL_CLASS } from "@/components/auth-form";

/**
 * Harcama dağılımının dönem seçici formu (Issue #65).
 *
 * `TransactionFiltersForm` (#56) ile AYNI duruş ve aynı gerekçeler: düz bir
 * `<form method="get">`, client component DEĞİL. Dönem URL'de yaşar (`?from=&to=`), böylece
 * sonuç paylaşılabilir, yer imine eklenebilir ve geri tuşu doğru çalışır; hiç istemci
 * JavaScript'i gerekmez ve `GET`in yan etkisizliği (invariant #4) ihlal edilmez.
 *
 * `action="/dashboard"` AÇIKÇA yazılır: form panelin ortasındadır ve gönderim, sayfanın kendi
 * yoluna dönmelidir — mevcut sorgu dizesini taşıyan göreli bir gönderim, ileride panele başka
 * bir parametre eklendiğinde onu sessizce düşürürdü.
 *
 * Boş bırakılan alan `?from=` olarak gider ve ayrıştırıcı bunu "verilmedi" okur; o uç varsayılan
 * aralıktan tamamlanır (bkz. route'taki not).
 */
export function SpendingRangeForm({
  from,
  to,
  isDefaultRange,
}: {
  /** Forma geri yazılacak değerler, `YYYY-MM-DD`. */
  from: string;
  to: string;
  /** Varsayılan (bu ay) aralıktaysa "sıfırla" bağlantısı gösterilmez — gidecek yer yok. */
  isDefaultRange: boolean;
}) {
  return (
    <form
      method="get"
      action="/dashboard"
      // Panelde birden fazla form bulunabileceği için erişilebilir ad zorunlu.
      aria-label="Harcama dönemi"
      className="flex flex-wrap items-end gap-3"
    >
      <div className="space-y-1.5">
        <label htmlFor="spending-from" className={LABEL_CLASS}>
          Başlangıç
        </label>
        <input id="spending-from" name="from" type="date" defaultValue={from} className={FIELD_CLASS} />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="spending-to" className={LABEL_CLASS}>
          Bitiş
        </label>
        {/* Bitiş tarihi kullanıcı için DAHİLDİR: "15 Mart'a kadar" 15 Mart'ı da kapsar
            (ortak `nextDay()` kuralı, bkz. `src/lib/finance/transaction.ts`). */}
        <input id="spending-to" name="to" type="date" defaultValue={to} className={FIELD_CLASS} />
      </div>

      <button
        type="submit"
        className="rounded-control bg-brand-600 px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out-soft hover:bg-brand-700"
      >
        Uygula
      </button>

      {isDefaultRange ? null : (
        <Link
          href="/dashboard"
          className="px-1 py-2 text-sm font-medium text-brand-600 transition-colors duration-150 ease-out-soft hover:text-brand-700 dark:text-brand-300"
        >
          Bu aya dön
        </Link>
      )}
    </form>
  );
}
