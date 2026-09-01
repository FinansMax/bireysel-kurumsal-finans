import type { ReactNode } from "react";

import type { ModuleNavLink } from "@/lib/modules/nav";

import { AppSidebar } from "./app-sidebar";
import { type SwitchableTenant } from "./tenant-switcher";

/**
 * Giriş yapmış kullanıcının gördüğü uygulama kabuğu (Issue #39).
 *
 * Bu dosya SUNUCU bileşeni ve yalnızca DÜZENİ kurar: solda sidebar, sağda içerik. Sidebar'ın
 * kendisi mobilde açılıp kapandığı için istemci bileşenidir (`app-sidebar.tsx`); ayrımı korumak
 * önemli — kabuk verisi (kullanıcı, tenant listesi) sunucuda çözülür, yalnızca aç/kapa durumu
 * istemcide yaşar.
 *
 * Veri okumaz, oturum kontrolü YAPMAZ (o iş `requirePageUser()`'ındır) — prop olarak aldığını
 * gösterir.
 */
export function AppShell({
  userEmail,
  tenants,
  activeTenantId,
  moduleLinks,
  children,
}: {
  userEmail: string;
  tenants: SwitchableTenant[];
  activeTenantId: string | null;
  /** Açık modüllerin menü linkleri (#152); sunucuda hesaplanır, kabuk yalnızca taşır. */
  moduleLinks: readonly ModuleNavLink[];
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 bg-canvas">
      <AppSidebar
        userEmail={userEmail}
        tenants={tenants}
        activeTenantId={activeTenantId}
        moduleLinks={moduleLinks}
      />

      {/*
       * `min-w-0` KRİTİK: flex çocuğu varsayılan olarak içeriğinden daha küçük olamaz, bu yüzden
       * geniş bir tablo bu kabı şişirir ve SAYFA yatay kaydırılır. `min-w-0` ile taşma
       * tablonun kendi kutusunda kalır (bkz. `components/ui/table.tsx` → `TableScroll`).
       */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/*
         * `pt-[4.25rem]` MOBİLDE ZORUNLU: sidebar'ın mobil üst çubuğu `fixed`tir ve akışta yer
         * kaplamaz — bu boşluk olmadan sayfa başlığı çubuğun ALTINDA kalıyordu.
         *
         * Telafi burada, içerik kabında yapılır; sidebar'ın yanına boş bir `div` koymak
         * denendi ve ÇALIŞMADI: kabuk bir flex SATIRI olduğu için o div dikey değil YATAY yer
         * kaplıyordu.
         */
        }
        <main className="mx-auto w-full max-w-6xl flex-1 px-5 pt-[4.25rem] pb-10 sm:px-8 lg:pt-10">
          {children}
        </main>
      </div>
    </div>
  );
}
