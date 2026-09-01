/**
 * Gelir/gider trend grafiği — Issue #63.
 *
 * BAĞIMLILIK YOK VE BU BİLİNÇLİ. Recharts/Chart.js gibi bir kütüphane, bu tek grafik için
 * onlarca kilobayt JavaScript ve bir `"use client"` sınırı getirirdi; oysa buradaki grafik
 * sunucuda render edilen, JavaScript'siz çalışan, yazdırılabilir bir HTML/CSS çubuğudur.
 * (Yeni bağımsızlık eklemek zaten açık onay ister — CLAUDE.md §4.) Grafik etkileşimli hâle
 * gelmesi gerektiğinde (zoom, tooltip, seri gizleme) karar yeniden gözden geçirilmelidir;
 * bugün ihtiyaç yok.
 *
 * YÜKSEKLİKLER BURADA HESAPLANMAZ. Bileşen hazır yüzde STRING'leri alır ve doğrudan CSS'e
 * yazar. Gerekçe invariant #10: yüksekliği burada hesaplamak `Number(income) / Number(max)`
 * demekti, yani paranın kayan noktaya dönmesi. Oran, `Prisma.Decimal` ile servis katmanında
 * üretilir (bkz. `src/lib/finance/dashboard.ts` → `percentOf`).
 *
 * SAHTE VERİ YOKTUR: veri yoksa çağıran bu bileşeni HİÇ render etmez (bkz. dashboard sayfası).
 */

export type TrendBar = {
  /** Kısa ay etiketi (ör. "Mar"). */
  label: string;
  /** Ekran okuyucu ve `title` için tam açıklama (ör. "2026-03: gelir 1000 TRY, gider 400 TRY"). */
  description: string;
  /** `0.00`–`100.00` arası string; doğrudan CSS yüzdesi olarak kullanılır. */
  incomePercent: string;
  expensePercent: string;
};

export function TrendChart({ bars }: { bars: ReadonlyArray<TrendBar> }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-mint-500" aria-hidden="true" />
          Gelir
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-ink-400 dark:bg-ink-300" aria-hidden="true" />
          Gider
        </span>
      </div>

      {/* Taban çizgisi çubukların ALTINDA: çubuklar bir zeminden yükseliyormuş gibi okunur,
          havada asılı durmaz. */}
      <div className="flex h-40 items-end gap-2 border-b border-line sm:gap-3">
        {bars.map((bar) => (
          <div key={bar.label + bar.description} className="flex h-full flex-1 flex-col justify-end">
            <div className="flex h-full items-end justify-center gap-1" title={bar.description}>
              {/* `min-h-0.5`: sıfır değerli bir ay, GÖRÜNMEYEN bir çubuk değil, tabanda ince bir
                  iz bırakır — "veri yok" ile "değer sıfır" ayrımı ancak böyle görünür. */}
              <span
                className="min-h-0.5 w-2.5 rounded-t-[3px] bg-mint-500 sm:w-3"
                style={{ height: `${bar.incomePercent}%` }}
              />
              <span
                className="min-h-0.5 w-2.5 rounded-t-[3px] bg-ink-400 sm:w-3 dark:bg-ink-300"
                style={{ height: `${bar.expensePercent}%` }}
              />
            </div>
            <span className="sr-only">{bar.description}</span>
          </div>
        ))}
      </div>

      <div className="flex gap-2 sm:gap-3">
        {bars.map((bar) => (
          <span
            key={bar.label + bar.description}
            className="flex-1 text-center text-xs text-faint"
            aria-hidden="true"
          >
            {bar.label}
          </span>
        ))}
      </div>
    </div>
  );
}
