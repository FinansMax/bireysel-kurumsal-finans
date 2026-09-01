import { AppShell } from "@/components/app-shell";
import { requirePageUser } from "@/lib/auth/page-guard";
import { hasPermission, PERMISSIONS } from "@/lib/authz/permissions";
import { buildModuleNavLinks } from "@/lib/modules/nav";
import { listTenantModules } from "@/lib/modules/tenant-module";
import { resolveActiveTenantForUser } from "@/lib/tenants/tenant-context";
import { listTenantsForUser } from "@/lib/tenants/user-tenants";

/**
 * Korumalı route group'un layout'u (Issue #39).
 *
 * `(app)` bir ROUTE GROUP'tur: parantezli klasör adı URL'e yansımaz, yalnızca kendi altındaki
 * sayfaların bu layout'u paylaşmasını sağlar. Böylece `/login`, `/signup` gibi public ekranlar
 * (root layout'un altında kalır) kabuğu HİÇ almaz; yeni bir korumalı ekran eklemek için tek
 * gereken dosyayı bu klasörün altına koymaktır.
 *
 * Buradaki `requirePageUser()` kabuğun ihtiyaç duyduğu kullanıcıyı okur ve oturum yoksa
 * `/login`'e yönlendirir; ancak bu TEK kontrol değildir — aynı guard her korumalı sayfada da
 * çağrılır (gerekçesi: `src/lib/auth/page-guard.ts`).
 *
 * TENANT LİSTESİ SUNUCUDA ÜRETİLİR (Issue #40): seçici bir client component'tir ama listeyi
 * kendisi çekmez. `listTenantsForUser()` sorgusu daima `userId` ile scope'ludur ve `userId`
 * trusted session'dan gelir — client'ın gönderdiği hiçbir değer bu listeyi etkilemez.
 * Aktif tenant da aynı istekte, kullanıcı yeniden çözülmeden okunur.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requirePageUser();

  const [tenants, activeTenant] = await Promise.all([
    listTenantsForUser(user.id),
    resolveActiveTenantForUser(user.id),
  ]);

  // MODÜL MENÜSÜ SUNUCUDA KURULUR (Issue #152): istemciye modül listesi ya da katalog
  // gönderilmez, yalnızca gösterilecek linkler gider. Aktif tenant yoksa sorulacak bir modül
  // durumu da yoktur — gereksiz bir sorgu yapılmaz.
  //
  // Kapalı modülün linki hiç render edilmez; bu bir UX kararıdır, YETKİLENDİRME DEĞİL
  // (invariant #3). Gerçek koruma `requireModule()`/`requirePageModule()` guard'larındadır.
  const moduleLinks = activeTenant
    ? buildModuleNavLinks(
        (await listTenantModules(activeTenant.tenant.id))
          .filter((module) => module.enabled)
          .map((module) => module.key),
        activeTenant.role,
      )
    : [];

  return (
    <AppShell
      userEmail={user.email}
      tenants={tenants.map(({ id, name }) => ({ id, name }))}
      // Cookie geçerli olsa bile membership her istekte DB'den doğrulanır; üyelik silinmişse
      // `resolveActiveTenantForUser()` `null` döner ve seçici "seçim yok" durumuna düşer.
      activeTenantId={activeTenant?.tenant.id ?? null}
      moduleLinks={moduleLinks}
      // Modül yönetimi OWNER-only'dir (#151); linki herkese göstermek ADMIN/MEMBER'ı kesin bir
      // yönlendirmeye davet ederdi. Gizlemek yetkilendirme DEĞİL, UX kararıdır (invariant #3).
      canManageModules={
        activeTenant ? hasPermission(activeTenant.role, PERMISSIONS.MANAGE_MODULES) : false
      }
    >
      {children}
    </AppShell>
  );
}
