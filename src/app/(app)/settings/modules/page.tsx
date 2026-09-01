import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { IconModule, IconWorkspace } from "@/components/ui/icons";
import { IconTile, PageHeader, Panel } from "@/components/ui/surfaces";
import { requirePageUser } from "@/lib/auth/page-guard";
import { hasPermission, PERMISSIONS } from "@/lib/authz/permissions";
import { MODULE_CATALOG, modulesDependingOn } from "@/lib/modules/catalog";
import { listTenantModules } from "@/lib/modules/tenant-module";
import { resolveActiveTenantForUser } from "@/lib/tenants/tenant-context";

import { ModuleToggle } from "./module-toggle";

export const metadata: Metadata = {
  title: "Modüller",
};

/**
 * Modül yönetim ekranı (Issue #153).
 *
 * YETKİ SAYFADA DA ZORLANIR: `MANAGE_MODULES` yoksa `/dashboard`'a yönlendirilir. Bu bir UX
 * kararıdır — asıl koruma `PATCH .../modules/:moduleKey` route'undaki `requirePermission()`
 * içindedir (invariant #3). Menüde linki gizlemek de aynı sınıfta bir karardır.
 *
 * NEDEN `/settings/modules` ve menüde AYRI bir öğe: "Ayarlar" öğesi tenant ayarları ekranının
 * (#86) placeholder'ı olarak duruyor; modülleri oraya bağlamak, henüz yazılmamış bir ekranın
 * yerini işgal etmek olurdu.
 */
export default async function ModulesSettingsPage() {
  const user = await requirePageUser();
  const active = await resolveActiveTenantForUser(user.id);

  if (!active) {
    return (
      <section className="space-y-8">
        <PageHeader title="Modüller" />
        <EmptyState
          icon={<IconWorkspace className="size-5" />}
          title="Çalışma alanı seçilmedi"
          description="Önce menüden bir çalışma alanı seçin. Modüller çalışma alanı başına açılır."
          action={{ label: "Çalışma alanı oluştur", href: "/tenants/new" }}
        />
      </section>
    );
  }

  const { tenant, role } = active;

  // Yetkisiz kullanıcıya BOŞ bir ekran göstermek yerine bildiği bir yere geri konur
  // (`requirePageModule()` ile aynı duruş).
  if (!hasPermission(role, PERMISSIONS.MANAGE_MODULES)) {
    redirect("/dashboard");
  }

  const modules = await listTenantModules(tenant.id);

  return (
    <section className="space-y-8">
      <PageHeader
        title="Modüller"
        description={
          <>
            <span className="font-medium text-strong">{tenant.name}</span> çalışma alanında hangi
            modüllerin açık olduğunu buradan yönetirsiniz. Modül kapatmak{" "}
            <span className="font-medium text-strong">veri silmez</span>; yalnızca erişimi
            kapatır.
          </>
        }
      />

      <div className="space-y-3">
        {modules.map((module) => {
          // Etiketler SUNUCUDA çözülür: istemci katalogdan bilgi türetmez, yalnızca
          // gösterilecek metni alır.
          const requires = module.dependsOn.map((key) => MODULE_CATALOG[key].label);
          const requiredBy = modulesDependingOn(module.key).map((entry) => entry.label);

          return (
            <Panel key={module.key} tone={module.enabled ? "accent" : "plain"} className="p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 gap-3">
                  <IconTile tone={module.enabled ? "brand" : "neutral"}>
                    <IconModule className="size-4.5" />
                  </IconTile>

                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold text-strong">{module.label}</h2>
                      <Badge tone={module.enabled ? "mint" : "outline"}>
                        {module.enabled ? "Açık" : "Kapalı"}
                      </Badge>
                    </div>

                    <p className="text-sm text-pretty text-muted">{module.description}</p>

                    {/* Bağımlılıklar KAPALIYKEN DE gösterilir: kullanıcı "Aç"a basmadan önce
                        neyin gerektiğini bilmeli, 409'u deneyerek öğrenmemeli. */}
                    {requires.length > 0 ? (
                      <p className="text-xs text-muted">
                        Gerektirir: <span className="font-medium text-body">{requires.join(", ")}</span>
                      </p>
                    ) : null}

                    {requiredBy.length > 0 ? (
                      <p className="text-xs text-muted">
                        Şunlar buna bağlı:{" "}
                        <span className="font-medium text-body">{requiredBy.join(", ")}</span>
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="shrink-0 sm:min-w-56">
                  <ModuleToggle
                    tenantId={tenant.id}
                    moduleKey={module.key}
                    label={module.label}
                    enabled={module.enabled}
                    requires={requires}
                    requiredBy={requiredBy}
                  />
                </div>
              </div>
            </Panel>
          );
        })}
      </div>
    </section>
  );
}
