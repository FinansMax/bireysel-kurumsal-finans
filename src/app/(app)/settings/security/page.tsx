import type { Metadata } from "next";

import { PageHeader, Panel } from "@/components/ui/surfaces";
import { requirePageUser } from "@/lib/auth/page-guard";

import { RevokeSessionsButton } from "./revoke-sessions-button";

export const metadata: Metadata = {
  title: "Güvenlik",
};

/**
 * Hesap güvenliği ekranı (Issue #186).
 *
 * NEDEN TENANT KONTROLÜ YOK: buradaki işlem KULLANICIYA aittir, çalışma alanına değil. Bir
 * kullanıcı hiçbir çalışma alanına üye olmasa bile oturumlarını kapatabilmelidir — aksi halde
 * "hesabım ele geçirildi" durumunda en çok ihtiyaç duyulan düğme, tam da erişilemeyen bir
 * ekranın arkasında kalırdı. Bu yüzden sayfa `requirePageUser()` ile korunur,
 * `resolveActiveTenantForUser()` ÇAĞRILMAZ (modül/tenant ekranlarından bilinçli bir ayrım).
 *
 * ROL KONTROLÜ DE YOK: MEMBER dahil her authenticated kullanıcı kendi oturumlarını kapatır.
 * Asıl koruma route'taki `requireUser()`'dadır (invariant #3); burası yalnızca ekranı gösterir.
 */
export default async function SecuritySettingsPage() {
  const user = await requirePageUser();

  return (
    <section className="space-y-8">
      <PageHeader
        title="Güvenlik"
        description={
          <>
            <span className="font-medium text-strong">{user.email}</span> hesabının oturum
            güvenliği.
          </>
        }
      />

      <Panel className="space-y-4 p-5">
        <div className="space-y-1.5">
          <h2 className="text-sm font-semibold text-strong">Açık oturumlar</h2>
          <p className="text-sm text-pretty text-muted">
            Şifrenizin veya cihazınızın başkasının eline geçtiğinden şüpheleniyorsanız tüm
            oturumları kapatın. Bu işlemden sonra oturum açmış olan her cihaz — bu cihaz dahil —
            tekrar giriş yapmak zorunda kalır.
          </p>
          {/*
            BEKLENTİ YÖNETİMİ: kullanıcı "hangi cihazlardan giriş yapılmış" listesini arayacak.
            O liste sunucu tarafında oturum kaydı tutmayı gerektirir ve mimariyi değiştirir
            (#186 "Scope Dışı"). Var olmayan bir özelliği ima etmek yerine sınırı açıkça yazıyoruz.
          */}
          <p className="text-xs text-muted">
            Açık oturumlar tek tek listelenemez; kapatma işlemi hepsini birden kapsar.
          </p>
        </div>

        <RevokeSessionsButton />
      </Panel>
    </section>
  );
}
