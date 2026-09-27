import type { Metadata } from "next";

import { PageHeader, Panel } from "@/components/ui/surfaces";
import { requirePageUser } from "@/lib/auth/page-guard";
import { getUserSettings } from "@/lib/users/settings";

import { NotificationSettingsForm } from "./notification-settings-form";

export const metadata: Metadata = {
  title: "Bildirimler",
};

/**
 * Bildirim tercihi ekranı (Issue #88).
 *
 * NEDEN TENANT KONTROLÜ YOK: `settings/security/page.tsx` ile AYNI gerekçe — bu tercih
 * KULLANICIYA aittir, çalışma alanına değil. Rol kontrolü de yok; MEMBER dahil herkes kendi
 * bildirim tercihini değiştirir. Asıl koruma route'taki `requireUser()`'dadır (invariant #3).
 */
export default async function NotificationSettingsPage() {
  const user = await requirePageUser();

  // `getUserSettings` `null` dönerse (oturum geçerli ama satır silinmiş — aşırı nadir bir
  // yarış) varsayılan `true` ile gösterilir; formun kendisi zaten PATCH'te 404'ü ele alır.
  const settings = await getUserSettings(user.id);

  return (
    <section className="space-y-8">
      <PageHeader
        title="Bildirimler"
        description="Uygulama içi ve e-posta bildirimlerini buradan açıp kapatabilirsiniz."
      />

      <Panel className="max-w-md p-5">
        <NotificationSettingsForm
          notificationsEnabled={settings?.notificationsEnabled ?? true}
        />
      </Panel>
    </section>
  );
}
