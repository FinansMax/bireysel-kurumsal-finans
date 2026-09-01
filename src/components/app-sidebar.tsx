"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { BrandMark } from "@/components/ui/brand-mark";
import {
  IconHandshake,
  IconMenu,
  IconModule,
  IconOverview,
  IconPlus,
  IconReports,
  IconSettings,
  IconTag,
  IconTransactions,
  IconUsers,
  IconWallet,
} from "@/components/ui/icons";
import type { ModuleNavLink } from "@/lib/modules/nav";

import { SignOutButton } from "./sign-out-button";
import { TenantSwitcher, type SwitchableTenant } from "./tenant-switcher";

/**
 * Uygulama kabuğunun sidebar'ı.
 *
 * NEDEN İSTEMCİ BİLEŞENİ: iki şey istemci durumu gerektiriyor — mobildeki aç/kapa ve aktif
 * menü öğesinin işaretlenmesi (`usePathname()`). Kabuğun VERİSİ hâlâ sunucuda çözülüyor
 * (`app-shell.tsx`), burada yalnızca sunum ve etkileşim var.
 *
 * TEK BİR `<nav aria-label="Ana menü">` VAR ve bu bilinçli: masaüstü ve mobil için iki ayrı
 * nav render etmek, erişilebilirlik ağacında aynı isimde iki navigasyon bırakır ve ekran
 * okuyucu kullanıcısına aynı menüyü iki kez okur (E2E'de de locator iki öğeye eşleşir).
 * Aynı DOM düğümü CSS ile yer değiştiriyor: mobilde ekran dışından kayarak gelen bir panel,
 * `lg` üstünde sabit bir kolon.
 */

/**
 * Navigasyon iskeleti.
 *
 * `href: null` olan öğeler HENÜZ VAR OLMAYAN ekranlardır ve link değil, devre dışı metin olarak
 * render edilir. Alternatif (öğeleri şimdiden `<Link>` yapmak) kullanıcıyı 404'e götürürdü;
 * öğeleri hiç göstermemek ise yol haritasını gizlerdi. İlgili ekran eklendiğinde yapılacak tek
 * şey buraya `href` yazmaktır.
 *
 * GRUPLAMA: öğeler iki başlık altında toplandı. Sekiz öğelik düz bir liste, hangisinin para
 * hareketiyle hangisinin yönetimle ilgili olduğunu söylemiyordu.
 */
type NavItem = { label: string; href: string | null; icon: ReactNode };

const NAV_GROUPS: ReadonlyArray<{ title: string; items: readonly NavItem[] }> = [
  {
    title: "Finans",
    items: [
      { label: "Genel Bakış", href: "/dashboard", icon: <IconOverview className="size-4.5" /> },
      { label: "Hesaplar", href: "/accounts", icon: <IconWallet className="size-4.5" /> }, // #47
      { label: "Kategoriler", href: "/categories", icon: <IconTag className="size-4.5" /> }, // #50
      { label: "İşlemler", href: "/transactions", icon: <IconTransactions className="size-4.5" /> }, // #54
      { label: "Borç/Alacak", href: "/debt-credits", icon: <IconHandshake className="size-4.5" /> }, // #70
      { label: "Raporlar", href: "/reports", icon: <IconReports className="size-4.5" /> }, // #67
    ],
  },
  {
    title: "Yönetim",
    items: [
      { label: "Üyeler", href: "/members", icon: <IconUsers className="size-4.5" /> }, // #43
      { label: "Yeni Çalışma Alanı", href: "/tenants/new", icon: <IconPlus className="size-4.5" /> }, // #42
      { label: "Ayarlar", href: null, icon: <IconSettings className="size-4.5" /> }, // #86
    ],
  },
];

export function AppSidebar({
  userEmail,
  tenants,
  activeTenantId,
  moduleLinks,
  canManageModules,
}: {
  userEmail: string;
  tenants: SwitchableTenant[];
  activeTenantId: string | null;
  /**
   * Açık modüllerin menü linkleri (Issue #152). SUNUCUDA hesaplanır — istemciye modül listesi
   * ya da katalog gönderilmez; buraya yalnızca gösterilecek linkler ulaşır.
   *
   * Kapalı bir modülün linki BURAYA HİÇ GELMEZ. Bu bir UX kararıdır, yetkilendirme DEĞİL
   * (invariant #3): gerçek koruma `requireModule()`/`requirePageModule()` guard'larındadır.
   */
  moduleLinks: readonly ModuleNavLink[];
  /**
   * `MANAGE_MODULES` izni (Issue #153). Modül yönetimi OWNER-only olduğu için, linki herkese
   * göstermek ADMIN/MEMBER'ı kesin bir yönlendirmeye davet ederdi — `EmptyState`in "yetkisi
   * olmayana eylem gösterme" kuralıyla aynı duruş.
   *
   * Gizlemek YETKİLENDİRME DEĞİLDİR (invariant #3): sayfa kendi guard'ıyla, API ise
   * `requirePermission()` ile korunur.
   */
  canManageModules: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Modül linkleri "Finans" grubunun SONUNA eklenir: çekirdek ekranlar sabit sırada kalır,
  // sonradan açılan yüzeyler onların altına düşer. Ayrı bir "Modüller" başlığı açmak,
  // kullanıcıya bir uygulama detayını (bu ekran bir modülden geliyor) menüde göstermek olurdu.
  const navGroups = NAV_GROUPS.map((group) => {
    if (group.title === "Finans" && moduleLinks.length > 0) {
      return {
        ...group,
        items: [
          ...group.items,
          ...moduleLinks.map((link) => ({
            label: link.label,
            href: link.href,
            icon: <IconModule className="size-4.5" />,
          })),
        ],
      };
    }

    // "Modüller" öğesi "Ayarlar" placeholder'ının ÖNÜNE eklenir: ikisi de yönetim işidir ve
    // gerçek bir ekranı olan öğe, henüz yazılmamış olanın üstünde durmalı.
    if (group.title === "Yönetim" && canManageModules) {
      return {
        ...group,
        items: [
          ...group.items.slice(0, -1),
          {
            label: "Modüller",
            href: "/settings/modules",
            icon: <IconModule className="size-4.5" />,
          }, // #153
          ...group.items.slice(-1),
        ],
      };
    }

    return group;
  });

  return (
    <>
      {/*
       * MOBİL ÜST ÇUBUK — yalnızca `lg` altında. Sidebar'ı ekranda tutmak mobilde içeriğe yer
       * bırakmazdı; gizlemek ise navigasyonu erişilemez yapardı.
       */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center gap-3 border-b border-shell-line bg-shell px-4 py-3 lg:hidden">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <BrandMark className="size-7" />
          <span className="text-sm font-semibold text-shell-text">FinansMax</span>
        </Link>

        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls="app-sidebar"
          className="ml-auto flex items-center gap-2 rounded-control border border-shell-line px-2.5 py-1.5 text-sm font-medium text-shell-text transition-colors duration-150 ease-out-soft hover:bg-shell-raised"
        >
          <IconMenu className="size-4.5" />
          Menü
        </button>
      </div>

      {/* Mobilde panel açıkken arkadaki içeriği karartan katman; tıklanınca kapatır. */}
      {open ? (
        <button
          type="button"
          aria-label="Menüyü kapat"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-ink-950/50 lg:hidden"
        />
      ) : null}

      <header
        id="app-sidebar"
        className={`fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 flex-col border-r border-shell-line bg-shell transition-transform duration-200 ease-out-soft lg:sticky lg:top-0 lg:h-dvh lg:w-64 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* MARKA ALANI — sidebar'ın en üstünde ve en güçlü öğesi. */}
        <div className="flex items-center gap-2.5 px-5 py-5">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <BrandMark className="size-8" />
            <span className="text-base font-semibold tracking-tight text-shell-text">
              FinansMax
            </span>
          </Link>
        </div>

        {/* Aktif çalışma alanı — navigasyondan ÖNCE: menüdeki her şey bu seçime bağlı. */}
        <div className="px-5 pb-5">
          <span className="mb-1.5 block text-[0.7rem] font-medium tracking-wide text-shell-muted uppercase">
            Çalışma alanı
          </span>
          <TenantSwitcher tenants={tenants} activeTenantId={activeTenantId} />
        </div>

        {/* `aria-label`: sayfada birden fazla navigasyon olduğunda ekran okuyucuların ayırt
            edebilmesi için; E2E testleri de nav'ı bu rol+isimle bulur. */}
        <nav aria-label="Ana menü" className="flex-1 overflow-y-auto px-3 pb-4">
          {navGroups.map((group) => (
            <div key={group.title} className="mb-5">
              <span className="mb-1.5 block px-2 text-[0.7rem] font-medium tracking-wide text-shell-muted uppercase">
                {group.title}
              </span>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.label}>
                    <NavEntry item={item} pathname={pathname} onNavigate={() => setOpen(false)} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Kullanıcı bölgesi — en altta, ayırıcıyla. */}
        <div className="border-t border-shell-line p-3">
          <div className="flex items-center gap-2.5 rounded-control px-2 py-2">
            {/* Baş harf, avatar yerine: gerçek bir avatar alanı üründe yok ve boş bir daire
                eksik bir özellik gibi görünürdü. */}
            <span className="flex size-8 shrink-0 items-center justify-center rounded-control bg-shell-raised text-sm font-semibold text-shell-text">
              {userEmail.slice(0, 1).toUpperCase()}
            </span>
            {/* Kimliğin göstergesi olarak e-posta kullanılır; `min-w-0` + `truncate` olmadan
                uzun bir adres sidebar'ı genişletirdi. */}
            <span className="min-w-0 flex-1 truncate text-xs text-shell-muted">{userEmail}</span>
          </div>
          <div className="mt-1">
            <SignOutButton />
          </div>
        </div>
      </header>

    </>
  );
}

/**
 * Tek bir menü satırı.
 *
 * AKTİF DURUM üç kanaldan birden belli olur: dolgulu zemin, marka renginde metin/ikon ve sol
 * kenarda ince bir şerit. Tek kanal (ör. yalnızca renk) yeterli değil — renk körlüğünde aktif
 * öğe kaybolurdu. `aria-current="page"` ise durumu ekran okuyucuya taşır.
 */
function NavEntry({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate: () => void;
}) {
  if (!item.href) {
    return (
      <span
        aria-disabled="true"
        title="Yakında"
        className="flex cursor-not-allowed items-center gap-2.5 rounded-control px-2.5 py-2 text-sm text-shell-muted/60"
      >
        {item.icon}
        {item.label}
      </span>
    );
  }

  // Alt yollar da aktif sayılır (ör. `/tenants/new` altında bir detay ekranı gelirse).
  // `startsWith` tek başına yanıltıcı olurdu (`/accounts` ile `/accounts-archive`), bu yüzden
  // sınır bir `/` ile aranıyor.
  const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={isActive ? "page" : undefined}
      className={`relative flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm transition-colors duration-150 ease-out-soft ${
        isActive
          ? "bg-shell-raised font-medium text-white"
          : "text-shell-muted hover:bg-shell-raised/60 hover:text-shell-text"
      }`}
    >
      {isActive ? (
        <span
          aria-hidden="true"
          className="absolute top-1.5 bottom-1.5 -left-0.5 w-0.5 rounded-full bg-brand-400"
        />
      ) : null}
      <span className={isActive ? "text-brand-300" : undefined}>{item.icon}</span>
      {item.label}
    </Link>
  );
}
