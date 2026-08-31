import type { ReactNode } from "react";

/**
 * Yüzeyler ve sayfa başlıkları — uygulama içi ekranların paylaştığı iskelet.
 *
 * Bu dosya bir design system değil, TEKRARIN TOPLANDIĞI yerdir (`auth-form.tsx` ile aynı
 * duruş). Üç finans ekranı, üyeler ekranı ve panel aynı başlık/kart yapısını kullanıyor;
 * her birinde ayrı sınıf dizileri yazmak, ilk küçük değişiklikte beşinin ayrışması demekti.
 */

/**
 * Sayfa başlığı. `title` DAİMA `h1`'dir — ekranın tek ana başlığı olmalı ve E2E testleri de
 * sayfaları bu başlıkla buluyor.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold tracking-tight text-strong sm:text-2xl">{title}</h1>
        {description ? <p className="text-sm text-pretty text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * İçerik kartı.
 *
 * `tone`, kartın sayfadaki AĞIRLIĞINI belirler — dekorasyon değil hiyerarşi aracıdır:
 * bir ekrandaki bütün kartlar aynı beyaz kutu olduğunda hiçbiri öne çıkmaz. `accent`
 * yalnızca ekranın EN önemli kartı için; ikiden fazla kullanıldığında vurgu değerini yitirir.
 */
export function Panel({
  tone = "plain",
  className = "",
  children,
}: {
  tone?: "plain" | "accent" | "muted";
  className?: string;
  children: ReactNode;
}) {
  const tones = {
    plain: "border-line bg-surface",
    // Sol kenarda ince bir marka şeridi + çok hafif tint: dolgulu bir renk kartı, içindeki
    // veriyi okunmaz hâle getirirdi.
    accent: "border-line bg-surface border-l-2 border-l-brand-500",
    muted: "border-line bg-surface-muted",
  } as const;

  return (
    <section className={`rounded-panel border shadow-subtle ${tones[tone]} ${className}`}>
      {children}
    </section>
  );
}

/** Kart başlığı — panelin içinde, ayırıcı çizgiyle. */
export function PanelHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
      <div className="space-y-0.5">
        <h2 className="text-sm font-semibold text-strong">{title}</h2>
        {description ? <p className="text-xs text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * İkon kabı. Marka karakterinin uygulama içinde en çok görüldüğü yer burası: renkli küçük
 * kareler, tamamen nötr bir arayüzü "bir ürüne" çevirir.
 */
export function IconTile({
  tone = "brand",
  children,
}: {
  tone?: "brand" | "mint" | "iris" | "neutral";
  children: ReactNode;
}) {
  const tones = {
    brand: "bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300",
    mint: "bg-mint-50 text-mint-700 dark:bg-mint-950 dark:text-mint-300",
    iris: "bg-iris-100 text-iris-600 dark:bg-iris-600/20 dark:text-iris-300",
    neutral: "bg-surface-inset text-muted",
  } as const;

  return (
    <span
      className={`flex size-9 shrink-0 items-center justify-center rounded-control ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
