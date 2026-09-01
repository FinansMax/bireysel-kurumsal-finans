import type { ReactNode } from "react";

/**
 * Dağılım halkası (donut) — Issue #65.
 *
 * BAĞIMLILIK YOK VE BU BİLİNÇLİ. Issue'nun teknik notu "hafif bir grafik kütüphanesi eklenir"
 * diyordu; eklenmedi. Gerekçe: #63'te trend grafiği zaten bağımlılıksız çözüldü ve bir
 * kütüphane getirmek (a) yeni bağımlılık için açık onay gerektirir (CLAUDE.md §4), (b) aynı
 * ekranda iki farklı grafik motoru bırakırdı, (c) bu halka için gereken tek şey SVG'nin kendi
 * `stroke-dasharray`ıdır. Karar README'de kayıtlıdır ve grafik etkileşimli olması gerektiğinde
 * (tooltip, tıklanabilir dilim, animasyonlu geçiş) yeniden gözden geçirilmelidir.
 *
 * `pathLength={100}` HİLESİ: SVG, çemberin gerçek uzunluğunu 100 birime NORMALİZE eder. Böylece
 * `strokeDasharray` ve `strokeDashoffset` doğrudan YÜZDE olarak yazılabilir — yarıçaptan
 * çevre hesaplamaya (`2πr`) hiç gerek kalmaz. Bileşen bu sayede TEK BİR aritmetik işlem bile
 * yapmaz: servisten gelen yüzde string'lerini olduğu gibi SVG'ye geçirir (bkz.
 * `src/lib/finance/spending-by-category.ts` — oran `Prisma.Decimal` ile orada üretilir).
 *
 * ERİŞİLEBİLİRLİK: halka `aria-hidden`dır, çünkü tek başına hiçbir şey söylemez. Veriyi taşıyan
 * şey yanındaki LİSTEDİR — gerçek metin, gerçek tutar, gerçek yüzde. Ekran okuyucu için SVG'yi
 * `role="img"` + uzun bir `aria-label` ile anlatmak, aynı bilgiyi ikinci kez ve daha kötü
 * biçimde vermek olurdu.
 */

export type DonutSlice = {
  /** Kategori adı (ya da "Kategorisiz"). */
  label: string;
  /** Tutarın gösterimi — `Money` bileşeni olarak verilir; bileşen tutara DOKUNMAZ. */
  value: ReactNode;
  /** `0.00`–`100.00` arası string; doğrudan SVG'ye yazılır. */
  sharePercent: string;
  /** Dilimin halkadaki başlangıç noktası, `0.00`–`100.00`. */
  offsetPercent: string;
};

/**
 * Dilim renkleri SIRAYA göre atanır (en büyük dilim en güçlü rengi alır) — `CategoryBadge`'in
 * ADA göre hash'lemesinden FARKLI olarak.
 *
 * Fark bilinçli: rozet listenin içinde tek başına durur ve rengi bir kimlik ipucudur, bu yüzden
 * her ekranda aynı kalmalıdır. Halkada ise renk kimlik değil SIRA taşır ve hemen yanındaki
 * lejant renkleri zaten adlarla eşler; ada göre hash, yan yana gelen iki dilimin aynı rengi
 * almasına izin verirdi ve halka okunamaz hâle gelirdi.
 *
 * `danger` rampası BİLEREK yok: kırmızı bu tasarım sisteminde hatanın rengidir (bkz.
 * globals.css), rastgele bir gider kategorisinin değil.
 */
const SLICE_TONES = [
  { stroke: "stroke-brand-500", swatch: "bg-brand-500" },
  { stroke: "stroke-mint-500", swatch: "bg-mint-500" },
  { stroke: "stroke-iris-500", swatch: "bg-iris-500" },
  { stroke: "stroke-brand-300", swatch: "bg-brand-300" },
  { stroke: "stroke-mint-400", swatch: "bg-mint-400" },
  { stroke: "stroke-iris-300", swatch: "bg-iris-300" },
  { stroke: "stroke-ink-400", swatch: "bg-ink-400" },
] as const;

export function DonutChart({
  slices,
  centerLabel,
  centerValue,
}: {
  slices: ReadonlyArray<DonutSlice>;
  /** Halkanın ortasındaki küçük etiket (ör. "Toplam gider"). */
  centerLabel: string;
  /** Halkanın ortasındaki değer — yine `Money`; bileşen hesaplamaz. */
  centerValue: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
      <div className="relative shrink-0">
        <svg viewBox="0 0 42 42" className="size-36" aria-hidden="true">
          {/* Zemin halkası: dilimler toplamı 100'e ulaşmasa bile (yuvarlama) halkada boşluk
              görünmez ve "ne kadarı gösterilmiş" hissi bozulmaz. */}
          <circle
            cx="21"
            cy="21"
            r="16"
            fill="none"
            strokeWidth="5"
            className="stroke-surface-inset"
          />
          {slices.map((slice, index) => (
            <circle
              key={slice.label}
              cx="21"
              cy="21"
              r="16"
              fill="none"
              strokeWidth="5"
              pathLength={100}
              className={SLICE_TONES[index % SLICE_TONES.length].stroke}
              strokeDasharray={`${slice.sharePercent} 100`}
              // Negatif ofset dilimi ileri kaydırır; `rotate(-90)` başlangıcı saat 12'ye alır.
              strokeDashoffset={`-${slice.offsetPercent}`}
              transform="rotate(-90 21 21)"
            />
          ))}
        </svg>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[0.65rem] text-muted">{centerLabel}</span>
          {centerValue}
        </div>
      </div>

      {/* Veriyi taşıyan asıl içerik. `dl` değil `ul`: her satır bir ad-değer çifti değil, bir
          KAYIT (ad + tutar + pay). */}
      <ul className="min-w-0 flex-1 space-y-2">
        {slices.map((slice, index) => (
          <li key={slice.label} className="flex items-center gap-2.5 text-sm">
            <span
              className={`size-2.5 shrink-0 rounded-[2px] ${SLICE_TONES[index % SLICE_TONES.length].swatch}`}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-body">{slice.label}</span>
            <span className="shrink-0 tabular-nums text-xs text-muted">
              %{slice.sharePercent}
            </span>
            <span className="shrink-0">{slice.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
