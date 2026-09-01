import type { Metadata } from "next";
import Link from "next/link";

import { DeleteWithConfirm } from "@/components/delete-with-confirm";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { IconWallet, IconWorkspace } from "@/components/ui/icons";
import { Money } from "@/components/ui/money";
import { IconTile, PageHeader } from "@/components/ui/surfaces";
import { Table, Tbody, Td, Th, Thead, TableScroll, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth/page-guard";
import { hasPermission, PERMISSIONS } from "@/lib/authz/permissions";
import { listAccounts } from "@/lib/finance/account";
import { bankName } from "@/lib/finance/banks";
import { resolveActiveTenantForUser } from "@/lib/tenants/tenant-context";

import { AccountForm } from "./account-form";

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
 * KAPSAM: liste + oluşturma + düzenleme/silme (#47, #130).
 *
 * DÜZENLEME DURUMU URL'DE: `?edit=<id>` verildiğinde dolu bir düzenleme formu gösterilir ve
 * ilgili satır listede İŞARETLENİR. Durum React state'inde değil URL'de olduğu için tarayıcı
 * geri tuşu ve sayfa yenileme doğru çalışır (filtre formundaki #56 ile aynı gerekçe).
 */
export default async function AccountsPage({
  searchParams,
}: {
  // Next.js 16'da `searchParams` bir Promise'tir.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requirePageUser();
  const active = await resolveActiveTenantForUser(user.id);

  if (!active) {
    return (
      <section className="space-y-8">
        <PageHeader title="Hesaplar" />
        <EmptyState
          icon={<IconWorkspace className="size-5" />}
          title="Çalışma alanı seçilmedi"
          description="Önce menüden bir çalışma alanı seçin. Yeni bir tane de oluşturabilirsiniz."
          action={{ label: "Çalışma alanı oluştur", href: "/tenants/new" }}
        />
      </section>
    );
  }

  const { tenant, role } = active;

  if (!hasPermission(role, PERMISSIONS.VIEW_ACCOUNTS)) {
    return (
      <section className="space-y-8">
        <PageHeader title="Hesaplar" />
        <EmptyState
          icon={<IconWallet className="size-5" />}
          title="Görüntüleme yetkiniz yok"
          description="Bu çalışma alanının hesaplarını görmek için yöneticinizden yetki isteyin."
        />
      </section>
    );
  }

  const accounts = await listAccounts(tenant.id);
  const canManage = hasPermission(role, PERMISSIONS.MANAGE_ACCOUNTS);

  // Düzenlenecek kayıt LİSTEDEN seçilir, ayrı bir sorguyla değil: liste zaten aktif tenant
  // ile scope'lanmış olarak geldiği için, URL'e yabancı bir id yazmak hiçbir şey açmaz —
  // eşleşme bulunamaz ve normal liste gösterilir.
  const params = await searchParams;
  const editId = typeof params.edit === "string" ? params.edit : null;
  const editingAccount =
    canManage && editId ? (accounts.find((account) => account.id === editId) ?? null) : null;

  return (
    <section className="space-y-8">
      <PageHeader
        title="Hesaplar"
        description={
          <>
            <span className="font-medium text-strong">{tenant.name}</span> çalışma alanının banka
            ve kasa hesapları.
          </>
        }
      />

      {accounts.length === 0 ? (
        <EmptyState
          icon={<IconWallet className="size-5" />}
          title="Henüz hesap yok"
          description={
            canManage
              ? "İlk banka ya da kasa hesabınızı aşağıdaki formla oluşturun. Bakiye, kaydettiğiniz her işlemle birlikte kendiliğinden güncellenir."
              : "Bu çalışma alanında henüz hesap tanımlanmamış."
          }
        />
      ) : (
        <TableScroll>
          <Table minWidth="34rem">
            <Thead>
              <Th>Hesap</Th>
              <Th>Tür</Th>
              <Th align="right">Bakiye</Th>
              {canManage && <Th srOnly>İşlemler</Th>}
            </Thead>
            <Tbody>
              {accounts.map((account) => (
                <Tr key={account.id} highlighted={account.id === editingAccount?.id}>
                  <Td emphasis>
                    <span className="flex items-center gap-2.5">
                      <IconTile tone="neutral">
                        <IconWallet className="size-4" />
                      </IconTile>
                      {account.name}
                    </span>
                  </Td>
                  <Td>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="outline">{TYPE_LABELS[account.type] ?? account.type}</Badge>
                      {/* Banka adı TÜRÜN YANINDA, ayrı bir kolonda değil (Issue #148): kasa
                          hesaplarında hep boş kalacak bir kolon, tabloyu her satırda bir
                          boşlukla genişletirdi. Kod → ad çevirisi `banks.ts`tedir; bilinmeyen
                          bir kod (liste güncellenmişse) hiç gösterilmez, ham kod basılmaz. */}
                      {account.bankCode ? (
                        <Badge tone="brand">{bankName(account.bankCode) ?? "Banka"}</Badge>
                      ) : null}
                    </span>
                  </Td>
                  {/* BAKİYE HAM STRING OLARAK GÖSTERİLİR, `Intl.NumberFormat` ile DEĞİL:
                      biçimlendirme değeri önce `Number`'a çevirmeyi gerektirir ve bu, para
                      için yasak olan kayan nokta dönüşümünü (invariant #10) arayüz katmanından
                      geri getirirdi. Yerelleştirilmiş gösterim, string üzerinde çalışan ayrı
                      bir yardımcı ile ele alınmalıdır — bu issue'nun kapsamı değil.

                      Hesap bakiyesinde İŞARET (+/−) EKLENMEZ: bakiye bir yön değil bir
                      durumdur; eksiye düşmüşse değerin kendisi zaten "-" ile başlar. */}
                  <Td align="right">
                    <Money value={account.balance} currency={account.currency} size="lg" />
                  </Td>
                  {canManage && (
                    <Td align="right">
                      <div className="flex items-center justify-end gap-3">
                        {/* Düzenleme bir LİNK: form durumunu URL'e yazar, yan etkisi yoktur. */}
                        <Link
                          href={`/accounts?edit=${account.id}`}
                          className="text-sm font-medium text-brand-600 transition-colors duration-150 ease-out-soft hover:text-brand-700 dark:text-brand-300"
                        >
                          <span aria-hidden="true">Düzenle</span>
                          <span className="sr-only">{account.name} hesabını düzenle</span>
                        </Link>

                        <DeleteWithConfirm
                          endpoint={`/api/tenants/${tenant.id}/accounts/${account.id}`}
                          itemLabel={`${account.name} hesabını sil`}
                          confirmQuestion={`"${account.name}" hesabını silmek istiyor musunuz?`}
                          consequence="Bu işlem geri alınamaz."
                          messages={{
                            forbidden: "Bu çalışma alanında hesap silme yetkiniz yok.",
                            notFound: "Bu hesap artık mevcut değil. Sayfayı yenileyin.",
                            // #53'ün kararı: işlemi olan hesap silinemez, cascade REDDEDİLDİ.
                            // Kullanıcıya ham 409 yerine ne yapması gerektiği söylenir.
                            conflict:
                              "Bu hesabın işlemleri var. Önce işlemleri silin veya başka bir hesaba taşıyın.",
                            fallback: "Hesap silinemedi. Lütfen daha sonra tekrar deneyin.",
                          }}
                        />
                      </div>
                    </Td>
                  )}
                </Tr>
              ))}
            </Tbody>
          </Table>
        </TableScroll>
      )}

      {/* Formlar yalnızca yetkili role render edilir. Bu bir güvenlik kontrolü DEĞİLDİR —
          asıl kontrol `requirePermission(MANAGE_ACCOUNTS)`'tır (kanıt:
          `security/account-security.spec.ts`); buradaki amaç, MEMBER'a kesin 403 alacağı bir
          form göstermemektir.

          Düzenleme ve oluşturma AYNI ANDA gösterilmez: iki dolu form, kullanıcının hangisini
          kaydettiğini belirsizleştirirdi. `key` prop'u zorunlu — bir kaydı düzenlerken
          başkasına geçildiğinde React bileşeni yeniden kurmalı, aksi halde eski kaydın
          değerleri state'te kalırdı. */}
      {canManage &&
        (editingAccount ? (
          <div className="space-y-3">
            <AccountForm key={editingAccount.id} tenantId={tenant.id} account={editingAccount} />
            <Link
              href="/accounts"
              className="inline-block text-sm font-medium text-muted underline-offset-4 hover:text-strong hover:underline"
            >
              Vazgeç
            </Link>
          </div>
        ) : (
          <AccountForm tenantId={tenant.id} />
        ))}
    </section>
  );
}
