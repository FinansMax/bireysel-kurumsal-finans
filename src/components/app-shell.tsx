import Link from "next/link";
import type { ReactNode } from "react";

import { SignOutButton } from "./sign-out-button";
import { TenantSwitcher, type SwitchableTenant } from "./tenant-switcher";

/**
 * Giriş yapmış kullanıcının gördüğü uygulama kabuğu — header + navigasyon iskeleti (Issue #39).
 *
 * `auth-form.tsx` ile aynı duruş: bu bir design system DEĞİL, korumalı sayfaların paylaştığı
 * markup'ın toplandığı saf sunum katmanıdır. Veri okumaz, oturum kontrolü YAPMAZ (o iş
 * `requirePageUser()`'ındır) — yalnızca prop olarak aldığını gösterir.
 */

/**
 * Navigasyon iskeleti.
 *
 * `href: null` olan öğeler HENÜZ VAR OLMAYAN ekranlardır ve link değil, devre dışı metin olarak
 * render edilir. Alternatif (öğeleri şimdiden `<Link>` yapmak) kullanıcıyı 404'e götürürdü;
 * öğeleri hiç göstermemek ise issue'nun istediği "iskelet"i vermezdi. İlgili ekran eklendiğinde
 * yapılacak tek şey buraya `href` yazmaktır.
 */
const NAV_ITEMS: ReadonlyArray<{ label: string; href: string | null }> = [
  { label: "Genel Bakış", href: "/dashboard" },
  { label: "Üyeler", href: "/members" }, // Issue #43
  { label: "Yeni Çalışma Alanı", href: "/tenants/new" }, // Issue #42
  { label: "Hesaplar", href: "/accounts" }, // Issue #47
  { label: "Kategoriler", href: "/categories" }, // Issue #50
  { label: "İşlemler", href: null }, // Issue #54
  { label: "Raporlar", href: null }, // Issue #63
  { label: "Ayarlar", href: null }, // Issue #86
];

export function AppShell({
  userEmail,
  tenants,
  activeTenantId,
  children,
}: {
  userEmail: string;
  tenants: SwitchableTenant[];
  activeTenantId: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <Link
            href="/dashboard"
            className="text-sm font-semibold text-zinc-950 dark:text-zinc-50"
          >
            Bireysel ve Kurumsal Finans
          </Link>

          <div className="flex items-center gap-4">
            <TenantSwitcher tenants={tenants} activeTenantId={activeTenantId} />

            {/* Kimliğin göstergesi olarak e-posta kullanılır, `session.user.name` DEĞİL:
                JWT'deki `name`, profil güncellendikten sonra bayat kalıyor (açık hata:
                Issue #113). E-posta bu endpoint'lerle değiştirilemediği için aynı sorunu
                taşımaz. #113 kapandığında burada adı göstermek tek satırlık bir değişiklik. */}
            <span className="text-sm text-zinc-600 dark:text-zinc-400">{userEmail}</span>
            <SignOutButton />
          </div>
        </div>

        {/* `aria-label`: sayfada birden fazla navigasyon olduğunda ekran okuyucuların ayırt
            edebilmesi için; E2E testleri de nav'ı bu rol+isimle bulur. */}
        <nav aria-label="Ana menü" className="mx-auto w-full max-w-5xl px-6">
          <ul className="flex flex-wrap gap-4 pb-3 text-sm">
            {NAV_ITEMS.map((item) => (
              <li key={item.label}>
                {item.href ? (
                  <Link
                    href={item.href}
                    className="font-medium text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-100"
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span
                    aria-disabled="true"
                    title="Yakında"
                    className="cursor-not-allowed text-zinc-400 dark:text-zinc-600"
                  >
                    {item.label}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
