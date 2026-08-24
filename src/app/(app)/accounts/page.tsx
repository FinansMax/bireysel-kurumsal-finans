import type { Metadata } from "next";
import Link from "next/link";

import { requirePageUser } from "@/lib/auth/page-guard";
import { hasPermission, PERMISSIONS } from "@/lib/authz/permissions";
import { listAccounts } from "@/lib/finance/account";
import { resolveActiveTenantForUser } from "@/lib/tenants/tenant-context";

import { CreateAccountForm } from "./create-account-form";

export const metadata: Metadata = {
  title: "Hesaplar",
};

const TYPE_LABELS: Record<string, string> = {
  BANK: "Banka",
  CASH: "Kasa",
};

/**
 * Aktif çalışma alanının hesap (banka/kasa) ekranı (Issue #47).
 *
 * `/members` ile aynı desen: URL'de `tenantId` YOKTUR — hangi tenant'ın hesapları sorusunun
 * tek kaynağı aktif tenant'tır (bkz. `src/app/(app)/members/page.tsx`'teki gerekçe).
 *
 * KAPSAM: liste + oluşturma (issue #47'nin kapsamı). Güncelleme/silme API'si (#46) hazırdır
 * ama arayüzü bu issue'da BİLEREK yapılmadı; ayrı bir issue'da eklenmelidir.
 */
export default async function AccountsPage() {
  const user = await requirePageUser();
  const active = await resolveActiveTenantForUser(user.id);

  if (!active) {
    return (
      <section className="space-y-2">
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Hesaplar</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Önce üstteki menüden bir çalışma alanı seçin.{" "}
          <Link href="/tenants/new" className="underline underline-offset-4">
            Yeni bir tane oluşturabilirsiniz.
          </Link>
        </p>
      </section>
    );
  }

  const { tenant, role } = active;

  if (!hasPermission(role, PERMISSIONS.VIEW_ACCOUNTS)) {
    return (
      <section className="space-y-2">
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Hesaplar</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Bu çalışma alanının hesaplarını görüntüleme yetkiniz yok.
        </p>
      </section>
    );
  }

  const accounts = await listAccounts(tenant.id);
  const canManage = hasPermission(role, PERMISSIONS.MANAGE_ACCOUNTS);

  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Hesaplar</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">{tenant.name}</span>{" "}
          çalışma alanının banka ve kasa hesapları.
        </p>
      </div>

      {accounts.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Henüz hesap yok.
          {canManage ? " Aşağıdaki formla ilkini oluşturun." : ""}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
              <tr>
                <th scope="col" className="py-2 pr-4 font-medium">Hesap</th>
                <th scope="col" className="py-2 pr-4 font-medium">Tür</th>
                <th scope="col" className="py-2 font-medium">Bakiye</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="py-3 pr-4 font-medium text-zinc-900 dark:text-zinc-100">
                    {account.name}
                  </td>
                  <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">
                    {TYPE_LABELS[account.type] ?? account.type}
                  </td>
                  {/* BAKİYE HAM STRING OLARAK GÖSTERİLİR, `Intl.NumberFormat` ile DEĞİL:
                      biçimlendirme değeri önce `Number`'a çevirmeyi gerektirir ve bu, para
                      için yasak olan kayan nokta dönüşümünü (invariant #10) arayüz katmanından
                      geri getirirdi. Yerelleştirilmiş gösterim, string üzerinde çalışan ayrı
                      bir yardımcı ile ele alınmalıdır — bu issue'nun kapsamı değil. */}
                  <td className="py-3 tabular-nums text-zinc-900 dark:text-zinc-100">
                    {account.balance} {account.currency}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Oluşturma formu yalnızca yetkili role render edilir. Bu bir güvenlik kontrolü
          DEĞİLDİR — asıl kontrol `requirePermission(MANAGE_ACCOUNTS)`'tır (kanıt:
          `security/account-security.spec.ts`); buradaki amaç, MEMBER'a kesin 403 alacağı bir
          form göstermemektir. */}
      {canManage && <CreateAccountForm tenantId={tenant.id} />}
    </section>
  );
}
