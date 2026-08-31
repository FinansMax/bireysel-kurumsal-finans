import type { ReactNode } from "react";

/**
 * Tablo iskeleti — finans ekranlarının paylaştığı hâli.
 *
 * Finans uygulamasında tablo, arayüzün kendisidir; bu yüzden üç ekranın (hesaplar, kategoriler,
 * işlemler) aynı satır yüksekliğini, aynı başlık tipografisini ve aynı hover davranışını
 * paylaşması gerekiyordu. Öncesinde her sayfa kendi sınıf dizisini taşıyordu ve küçük farklar
 * birikmişti (bir ekranda `pr-4`, diğerinde yok).
 *
 * YATAY KAYDIRMA KABIN İŞİ: `TableScroll` sarmalayıcısı olmadan geniş bir tablo mobilde
 * SAYFANIN kendisini yatay kaydırılır hâle getirir ve tüm düzen bozulur. Kaydırma tablonun
 * kendi kutusunda kalmalı.
 */

export function TableScroll({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-panel border border-line bg-surface shadow-subtle">
      {children}
    </div>
  );
}

export function Table({
  minWidth = "40rem",
  children,
}: {
  /** Tablonun okunabilir kaldığı en küçük genişlik; altına inince kaydırma devreye girer. */
  minWidth?: string;
  children: ReactNode;
}) {
  return (
    <table className="w-full text-left text-sm" style={{ minWidth }}>
      {children}
    </table>
  );
}

export function Thead({ children }: { children: ReactNode }) {
  return (
    // Başlık satırı hafif tintli bir zemin alır: uzun bir tabloda kaydırırken gözün
    // "burası veri değil" diye ayırabileceği tek ipucu.
    <thead className="bg-surface-muted text-xs text-muted">
      <tr>{children}</tr>
    </thead>
  );
}

export function Th({
  children,
  align = "left",
  srOnly = false,
}: {
  children: ReactNode;
  align?: "left" | "right";
  /** Aksiyon kolonu gibi görsel başlığı olmayan kolonlar için — ad ekran okuyucuda kalır. */
  srOnly?: boolean;
}) {
  return (
    <th
      scope="col"
      className={`px-4 py-2.5 font-medium tracking-wide uppercase ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {srOnly ? <span className="sr-only">{children}</span> : children}
    </th>
  );
}

export function Tbody({ children }: { children: ReactNode }) {
  // Satır ayırıcıları `divide-y` ile: her `tr`'ye `border-t` yazmak ilk satırda çift çizgi
  // ya da hiç çizgi olmaması gibi kenar durumlar üretiyordu.
  return <tbody className="divide-y divide-line">{children}</tbody>;
}

export function Tr({
  children,
  highlighted = false,
}: {
  children: ReactNode;
  /** Ör. düzenlenmekte olan satır — kullanıcı formda hangi kaydı açtığını görebilmeli. */
  highlighted?: boolean;
}) {
  return (
    <tr
      className={`transition-colors duration-150 ease-out-soft ${
        highlighted
          ? "bg-brand-50/70 dark:bg-brand-950/40"
          : "hover:bg-surface-muted/70"
      }`}
    >
      {children}
    </tr>
  );
}

export function Td({
  children,
  align = "left",
  emphasis = false,
  className = "",
}: {
  children: ReactNode;
  align?: "left" | "right";
  /** Satırın kimliğini taşıyan kolon (ör. hesap adı) — tarama bu kolondan yapılır. */
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`px-4 py-3 ${align === "right" ? "text-right" : ""} ${
        emphasis ? "font-medium text-strong" : "text-body"
      } ${className}`}
    >
      {children}
    </td>
  );
}
