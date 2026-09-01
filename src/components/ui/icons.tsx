import type { SVGProps } from "react";

/**
 * Tek ikon ailesi.
 *
 * NEDEN KÜTÜPHANE DEĞİL: bir ikon paketi eklemek yeni bir bağımlılıktır (CLAUDE.md §4) ve bu
 * uygulamanın ihtiyacı yirmi küsur ikon. Buradakiler aynı kurallarla çizilir — 24 birimlik
 * kare, 1.75 çizgi kalınlığı, yuvarlak uç — dolayısıyla farklı ekranlarda yan yana geldiklerinde
 * aynı aileden oldukları görülür. EMOJİ KULLANILMAZ: platformdan platforma değişir, renk
 * sistemine uymaz ve ekran okuyucuda gürültü üretir.
 *
 * Hepsi `currentColor` ile boyanır; renk kararı ikonun değil, onu saran kabın işidir.
 * `aria-hidden` varsayılandır — ikon tek başına anlam taşıdığında çağıran taraf metin verir.
 */

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconOverview(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 13h6v7H4zM14 4h6v6h-6zM14 14h6v6h-6zM4 4h6v5H4z" />
    </Icon>
  );
}

export function IconWallet(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H18a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8.5Z" />
      <path d="M16.5 12h.5" />
    </Icon>
  );
}

export function IconTag(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M11.5 3.5H19A1.5 1.5 0 0 1 20.5 5v7.5a2 2 0 0 1-.6 1.4l-6 6a2 2 0 0 1-2.8 0l-6.5-6.5a2 2 0 0 1 0-2.8l6-6a2 2 0 0 1 1.4-.6Z" />
      <path d="M16.4 8h.01" />
    </Icon>
  );
}

export function IconTransactions(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 17V7m0 0L4 10m3-3 3 3" />
      <path d="M17 7v10m0 0 3-3m-3 3-3-3" />
    </Icon>
  );
}

export function IconUsers(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1" />
      <circle cx="9.5" cy="7.5" r="3.5" />
      <path d="M17 11a3 3 0 1 0 0-6M21 19v-1a4 4 0 0 0-3-3.87" />
    </Icon>
  );
}

export function IconWorkspace(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3 3 7.5 12 12l9-4.5L12 3Z" />
      <path d="M3 12.5 12 17l9-4.5M3 17l9 4.5L21 17" />
    </Icon>
  );
}

export function IconReports(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </Icon>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.2A1.6 1.6 0 0 0 4.3 6.3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V2a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.1 1Z" />
    </Icon>
  );
}

export function IconSignOut(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 21H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h3" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </Icon>
  );
}

export function IconArrowUpRight(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 17 17 7M8 7h9v9" />
    </Icon>
  );
}

export function IconArrowDownRight(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 7l10 10M17 8v9H8" />
    </Icon>
  );
}

export function IconShield(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3 5 6v6c0 4.2 2.9 7.7 7 9 4.1-1.3 7-4.8 7-9V6l-7-3Z" />
      <path d="m9.2 12 2 2 3.6-3.8" />
    </Icon>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </Icon>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m9 6 6 6-6 6" />
    </Icon>
  );
}

// Tamamlanmış adım göstergesi (panel onboarding'i, #63). Tek bir çentik: yuvarlak kabı çağıran
// taraf verir, ikon yalnızca işareti çizer.
export function IconCheck(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </Icon>
  );
}
