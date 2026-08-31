import type { Metadata } from "next";
import Link from "next/link";

import { Badge, CategoryBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  IconArrowDownRight,
  IconArrowUpRight,
  IconChevronRight,
  IconTransactions,
  IconWallet,
  IconWorkspace,
} from "@/components/ui/icons";
import { DirectionChip, Money } from "@/components/ui/money";
import { IconTile, PageHeader, Panel, PanelHeader } from "@/components/ui/surfaces";
import { requirePageUser } from "@/lib/auth/page-guard";
import { hasPermission, PERMISSIONS } from "@/lib/authz/permissions";
import { listAccounts } from "@/lib/finance/account";
import { listCategories } from "@/lib/finance/category";
import { listTransactions } from "@/lib/finance/transaction";
import { resolveActiveTenantForUser } from "@/lib/tenants/tenant-context";

export const metadata: Metadata = {
  title: "Genel Bakış",
};

/**
 * Korumalı alanın giriş sayfası (Issue #39).
 *
 * İÇERİK: aktif çalışma alanının hesapları ve son hareketleri. Hepsi MEVCUT servis
 * fonksiyonlarından okunur (`listAccounts`, `listTransactions`, `listCategories`) — yeni bir
 * API, servis ya da sorgu EKLENMEDİ.
 *
 * BİLEREK YOK — "toplam bakiye", "bu ayın geliri/gideri" gibi ÖZET değerler:
 *
 * 1. Hesaplar farklı para birimlerinde olabilir; bunları toplamak anlamsız bir sayı üretirdi.
 * 2. Dönemsel toplamlar para aritmetiği demektir ve bu, sunum katmanına değil `src/lib/finance`
 *    içine ait bir iş kuralıdır (Epic 7 / #62'nin konusu).
 *
 * Yani buradaki her sayı, başka bir ekranda da aynen görünen GERÇEK bir değerdir; hiçbiri bu
 * sayfada hesaplanmaz.
 *
 * `requirePageUser()` layout'ta zaten çağrıldığı hâlde BURADA DA çağrılır: layout'lar istemci
 * tarafı gezinmelerde yeniden render edilmediği ve alt segmentlerin render'ını engelleyemediği
 * için layout kontrolü tek başına yeterli değildir (bkz. `src/lib/auth/page-guard.ts`).
 * Aynı istekte ikinci bir DB sorgusuna yol açmaz — sonuç `cache()` ile paylaşılır.
 */
export default async function DashboardPage() {
  const user = await requirePageUser();
  const active = await resolveActiveTenantForUser(user.id);

  if (!active) {
    return (
      <section className="space-y-8">
        <PageHeader title="Genel Bakış" />
        <EmptyState
          icon={<IconWorkspace className="size-5" />}
          title="Henüz bir çalışma alanınız yok"
          description="Çalışma alanı, hesaplarınızın ve hareketlerinizin durduğu yerdir. Bireysel bütçeniz ve şirketiniz için ayrı alanlar açabilirsiniz."
          action={{ label: "Çalışma alanı oluştur", href: "/tenants/new" }}
        />
      </section>
    );
  }

  const { tenant, role } = active;

  const canViewAccounts = hasPermission(role, PERMISSIONS.VIEW_ACCOUNTS);
  const canViewTransactions = hasPermission(role, PERMISSIONS.VIEW_TRANSACTIONS);
  const canManageAccounts = hasPermission(role, PERMISSIONS.MANAGE_ACCOUNTS);

  // Yetkisi olmayan role o listeyi HİÇ çekmeyiz: gizlemek değil, sormamak doğru olan.
  const [accounts, transactionPage, categories] = await Promise.all([
    canViewAccounts ? listAccounts(tenant.id) : Promise.resolve([]),
    canViewTransactions
      ? listTransactions(tenant.id)
      : Promise.resolve({ transactions: [], nextCursor: null }),
    canViewTransactions ? listCategories(tenant.id) : Promise.resolve([]),
  ]);

  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  // Hesap adı ve PARA BİRİMİ birlikte taşınır: çok para birimli bir çalışma alanında
  // birimsiz bir tutar ("−8.500") hangi paradan olduğunu söylemez.
  const accountsById = new Map(
    accounts.map((account) => [account.id, { name: account.name, currency: account.currency }]),
  );

  // Son beş hareket. Liste zaten tarihe göre azalan sıralı geliyor (#53), bu yüzden burada
  // sıralama yapılmaz — yalnızca kesilir.
  const recent = transactionPage.transactions.slice(0, 5);

  return (
    <section className="space-y-8">
      <PageHeader
        title="Genel Bakış"
        description={
          <>
            <span className="font-medium text-strong">{tenant.name}</span> çalışma alanındaki
            durum. Bu alandaki rolünüz: <Badge tone="brand">{role}</Badge>
          </>
        }
      />

      {canViewAccounts ? <AccountsSection accounts={accounts} canManage={canManageAccounts} /> : null}

      {canViewTransactions ? (
        <RecentSection
          rows={recent}
          accountsById={accountsById}
          categoryNames={categoryNames}
          hasAccounts={accounts.length > 0}
        />
      ) : null}

      {!canViewAccounts && !canViewTransactions ? (
        <EmptyState
          icon={<IconWorkspace className="size-5" />}
          title="Görüntüleme yetkiniz yok"
          description="Bu çalışma alanındaki finansal verileri görmek için yöneticinizden yetki isteyin."
        />
      ) : null}
    </section>
  );
}

/**
 * Hesap kartları.
 *
 * KARTLARIN HEPSİ AYNI DEĞİL: ilk hesap vurgulu (sol kenarda marka şeridi). Gerekçe — bir
 * ekrandaki bütün kartlar aynı beyaz kutu olduğunda göz nereden başlayacağını bilemez.
 * Vurgu "bu hesap daha önemli" demez, "listeye buradan başla" der.
 */
function AccountsSection({
  accounts,
  canManage,
}: {
  accounts: ReadonlyArray<{ id: string; name: string; type: string; balance: string; currency: string }>;
  canManage: boolean;
}) {
  const TYPE_LABELS: Record<string, string> = { BANK: "Banka", CASH: "Kasa" };

  if (accounts.length === 0) {
    return (
      <EmptyState
        icon={<IconWallet className="size-5" />}
        title="Henüz hesap yok"
        description="Bakiyeleri görebilmek için önce bir banka ya da kasa hesabı tanımlayın."
        action={canManage ? { label: "Hesap oluştur", href: "/accounts" } : undefined}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-strong">Hesaplar</h2>
        <Link
          href="/accounts"
          className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 transition-colors duration-150 ease-out-soft hover:text-brand-700 dark:text-brand-300"
        >
          Tümü
          <IconChevronRight className="size-4" />
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {accounts.slice(0, 6).map((account, index) => (
          <Panel key={account.id} tone={index === 0 ? "accent" : "plain"} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <IconTile tone={index === 0 ? "brand" : "neutral"}>
                <IconWallet className="size-4.5" />
              </IconTile>
              <Badge tone="outline">{TYPE_LABELS[account.type] ?? account.type}</Badge>
            </div>

            <p className="mt-4 truncate text-sm font-medium text-strong">{account.name}</p>
            <div className="mt-1">
              {/* Bakiye SAYIYA ÇEVRİLMEZ; `Money` ham string'i tipografik olarak biçimler. */}
              <Money value={account.balance} currency={account.currency} size="xl" />
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

function RecentSection({
  rows,
  accountsById,
  categoryNames,
  hasAccounts,
}: {
  rows: ReadonlyArray<{
    id: string;
    type: string;
    amount: string;
    description: string | null;
    occurredAt: Date;
    accountId: string;
    categoryId: string | null;
  }>;
  accountsById: Map<string, { name: string; currency: string }>;
  categoryNames: Map<string, string>;
  hasAccounts: boolean;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<IconTransactions className="size-5" />}
        title="Henüz işlem yok"
        description={
          hasAccounts
            ? "İlk gelir ya da gider hareketinizi kaydedin; bakiye ve liste anında güncellenir."
            : "Önce bir hesap tanımlayın; hareketler bir hesaba bağlanmak zorundadır."
        }
        action={
          hasAccounts
            ? { label: "İşlem kaydet", href: "/transactions" }
            : { label: "Hesap oluştur", href: "/accounts" }
        }
      />
    );
  }

  return (
    <Panel>
      <PanelHeader
        title="Son hareketler"
        description="En yeni beş kayıt"
        actions={
          <Link
            href="/transactions"
            className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 transition-colors duration-150 ease-out-soft hover:text-brand-700 dark:text-brand-300"
          >
            Tümü
            <IconChevronRight className="size-4" />
          </Link>
        }
      />

      <ul className="divide-y divide-line">
        {rows.map((row) => {
          const isIncome = row.type === "INCOME";
          const account = accountsById.get(row.accountId);
          return (
            <li key={row.id} className="flex items-center gap-3 px-5 py-3.5">
              <DirectionChip direction={isIncome ? "in" : "out"}>
                {isIncome ? (
                  <IconArrowUpRight className="size-4" />
                ) : (
                  <IconArrowDownRight className="size-4" />
                )}
              </DirectionChip>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-strong">
                  {row.description ?? "Açıklama yok"}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {/* Tarih `YYYY-MM-DD` olarak, `toLocaleDateString()` KULLANILMADAN yazılır:
                      yerelleştirme çıktıyı sunucunun saat dilimine bağlardı (#54'ün kararı). */}
                  <span className="text-xs text-faint">
                    {row.occurredAt.toISOString().slice(0, 10)}
                  </span>
                  <span className="text-xs text-faint">{account?.name ?? "—"}</span>
                  <CategoryBadge
                    name={row.categoryId ? (categoryNames.get(row.categoryId) ?? null) : null}
                  />
                </div>
              </div>

              <Money
                value={row.amount}
                currency={account?.currency ?? null}
                direction={isIncome ? "in" : "out"}
              />
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
