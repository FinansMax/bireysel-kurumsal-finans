import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { EmptyState } from "@/components/ui/empty-state";
import { IconWorkspace } from "@/components/ui/icons";
import { PageHeader, Panel } from "@/components/ui/surfaces";
import { requirePageUser } from "@/lib/auth/page-guard";
import { hasPermission, PERMISSIONS } from "@/lib/authz/permissions";
import { resolveActiveTenantForUser } from "@/lib/tenants/tenant-context";

import { TenantSettingsForm } from "./tenant-settings-form";

export const metadata: Metadata = {
  title: "Çalışma Alanı Ayarları",
};

/**
 * Tenant ayarları ekranı (Issue #86): ad + varsayılan para birimi.
 *
 * YETKİ SAYFADA DA ZORLANIR: `UPDATE_TENANT_SETTINGS` yoksa `/dashboard`'a yönlendirilir —
 * asıl koruma `PATCH .../settings` route'undaki `requirePermission()` içindedir (invariant #3).
 * `settings/modules/page.tsx` ile birebir aynı desen; yetki de aynı sınıftan (OWNER-only).
 */
export default async function TenantSettingsPage() {
  const user = await requirePageUser();
  const active = await resolveActiveTenantForUser(user.id);

  if (!active) {
    return (
      <section className="space-y-8">
        <PageHeader title="Çalışma Alanı Ayarları" />
        <EmptyState
          icon={<IconWorkspace className="size-5" />}
          title="Çalışma alanı seçilmedi"
          description="Önce menüden bir çalışma alanı seçin."
          action={{ label: "Çalışma alanı oluştur", href: "/tenants/new" }}
        />
      </section>
    );
  }

  const { tenant, role } = active;

  if (!hasPermission(role, PERMISSIONS.UPDATE_TENANT_SETTINGS)) {
    redirect("/dashboard");
  }

  return (
    <section className="space-y-8">
      <PageHeader
        title="Çalışma Alanı Ayarları"
        description="Çalışma alanının adını ve varsayılan para birimini buradan değiştirebilirsiniz."
      />

      <Panel className="max-w-md space-y-4 p-5">
        <TenantSettingsForm
          tenantId={tenant.id}
          name={tenant.name}
          defaultCurrency={tenant.defaultCurrency}
        />
      </Panel>
    </section>
  );
}
