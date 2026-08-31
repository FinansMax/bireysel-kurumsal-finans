import type { ReactNode } from "react";

/**
 * Para değerlerinin gösterimi.
 *
 * KRİTİK — DEĞER HİÇ SAYIYA ÇEVRİLMEZ. Tutarlar servis katmanından `string` gelir (invariant
 * #10) ve burada da string kalır: `Intl.NumberFormat` veya `Number(...)` kullanmak, para için
 * yasak olan kayan nokta dönüşümünü sunum katmanından geri getirirdi. Bu bileşenin tek işi
 * TİPOGRAFİK hiyerarşi kurmak — değeri değiştirmek değil.
 *
 * (Yerelleştirilmiş binlik ayırıcı gösterimi, string üzerinde çalışan ayrı bir yardımcı
 * gerektirir ve hâlâ açık bir borçtur; #47'den beri kayıtlı.)
 */

/**
 * İşaret, TUTARIN KENDİSİNDEN değil işlemin yönünden gelir: `Transaction.amount` daima
 * pozitiftir, yönü `type` taşır (#53). Bu yüzden yön bir prop'tur, değerden çıkarılmaya
 * çalışılmaz.
 */
export type MoneyDirection = "in" | "out" | "neutral";

const DIRECTION_STYLES: Record<MoneyDirection, { text: string; prefix: string }> = {
  // Yeşil/kırmızı BİLEREK doygun değil: her gider satırını alarma çeviren bir kırmızı,
  // gerçek hataları görünmez kılar. Renk burada bir vurgu, tek bilgi kanalı değil —
  // işaret (+/-) renk körlüğünde de anlamı taşır. İşaret ASCII: hesap bakiyeleri negatifken
  // ham string zaten "-" ile geliyor; tipografik eksi kullanmak aynı ekranda iki farklı
  // eksi karakteri demekti.
  in: { text: "text-mint-700 dark:text-mint-300", prefix: "+" },
  out: { text: "text-strong", prefix: "-" },
  neutral: { text: "text-strong", prefix: "" },
};

export function Money({
  value,
  currency,
  direction = "neutral",
  size = "sm",
}: {
  /** Servisten gelen ham string. ASLA dönüştürülmez. */
  value: string;
  currency?: string | null;
  direction?: MoneyDirection;
  size?: "sm" | "lg" | "xl";
}) {
  const { text, prefix } = DIRECTION_STYLES[direction];
  const sizeClass =
    size === "xl"
      ? "text-2xl font-semibold tracking-tight"
      : size === "lg"
        ? "text-lg font-semibold"
        : "text-sm font-medium";

  return (
    // `tabular-nums`: rakamlar eşit genişlikte basılır, böylece bir kolondaki tutarlar
    // birbirini hizalar. Finans tablolarında bu okunabilirliğin yarısıdır.
    <span className={`tabular-nums whitespace-nowrap ${sizeClass} ${text}`}>
      {prefix}
      {value}
      {currency ? (
        <>
          {/* GERÇEK BİR BOŞLUK KARAKTERİ — yalnızca `ml-1` ile aralık vermek yetmez: erişilebilir
              ad (ve E2E'nin okuduğu metin) "42.5TRY" olurdu. Görsel aralık ile metnin kendisi
              iki ayrı şey; ikisi de gerekli. */}
          {" "}
          {/* Para birimi daha soluk ve küçük: kolonu tarayan göz tutarı arıyor, birimi değil. */}
          <span className="text-[0.85em] font-normal text-muted">{currency}</span>
        </>
      ) : null}
    </span>
  );
}

/**
 * Tutarın yanında yön göstergesi gereken yerler için (ör. işlem satırı ikonu).
 * Renk kabı taşır, ikon `currentColor` alır.
 */
export function DirectionChip({
  direction,
  children,
}: {
  direction: Exclude<MoneyDirection, "neutral">;
  children: ReactNode;
}) {
  return (
    <span
      className={`flex size-8 shrink-0 items-center justify-center rounded-control ${
        direction === "in"
          ? "bg-mint-100 text-mint-700 dark:bg-mint-950 dark:text-mint-300"
          : "bg-surface-inset text-muted"
      }`}
    >
      {children}
    </span>
  );
}
