import type { Metadata } from "next";
import Link from "next/link";

import { DeleteWithConfirm } from "@/components/delete-with-confirm";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { IconArrowDownRight, IconArrowUpRight, IconWorkspace } from "@/components/ui/icons";
import { DirectionChip, Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/surfaces";
import { Table, Tbody, Td, Th, Thead, TableScroll, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth/page-guard";
import { hasPermission, PERMISSIONS } from "@/lib/authz/permissions";
import { listDebtCredits, type DebtCreditView } from "@/lib/finance/debt-credit";
import { resolveActiveTenantForUser } from "@/lib/tenants/tenant-context";

import { DebtCreditForm } from "./debt-credit-form";

export const metadata: Metadata = {
  title: "Borç/Alacak",
};

/**
 * Aktif çalışma alanının borç/alacak ekranı (Issue #70).
 *
 * `/accounts` (#47) ve `/transactions` (#54) ile aynı desen: URL'de `tenantId` YOKTUR — hangi
 * tenant'ın kayıtları sorusunun tek kaynağı aktif tenant'tır; form servis fonksiyonunu değil
 * route'u çağırır; düzenleme durumu `?edit=<id>` ile URL'dedir.
 *
 * TOPLAM GÖSTERİLMEZ. "Toplam borcum ne kadar" sorusunun cevabı para birimi bazında ayrılmış
 * bir toplama gerektirir (kur dönüşümü yok — bkz. panelin kararları) ve bu, sunum katmanına
 * değil `src/lib/finance` içine ait bir iş kuralıdır. Bugün istenmedi; istenirse panel özeti
 * gibi ayrı bir serviste yapılır.
 */
export default async function DebtCreditsPage({
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
        <PageHeader title="Borç/Alacak" />
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

  if (!hasPermission(role, PERMISSIONS.VIEW_DEBT_CREDITS)) {
    return (
      <section className="space-y-8">
        <PageHeader title="Borç/Alacak" />
        <EmptyState
          icon={<IconArrowUpRight className="size-5" />}
          title="Görüntüleme yetkiniz yok"
          description="Bu çalışma alanının borç/alacak kayıtlarını görmek için yöneticinizden yetki isteyin."
        />
      </section>
    );
  }

  const records = await listDebtCredits(tenant.id);
  const canManage = hasPermission(role, PERMISSIONS.MANAGE_DEBT_CREDITS);

  // Düzenlenecek kayıt LİSTEDEN seçilir, ayrı bir sorguyla değil: liste zaten aktif tenant ile
  // scope'lanmış geldiği için URL'e yabancı bir id yazmak hiçbir şey açmaz.
  const params = await searchParams;
  const editId = typeof params.edit === "string" ? params.edit : null;
  const editingRecord =
    canManage && editId ? (records.find((record) => record.id === editId) ?? null) : null;

  // "Bugün" SUNUCUDA ve UTC gün başlangıcı olarak hesaplanır — vade de UTC gece yarısı olarak
  // saklanıyor (#134: saat dilimi yönetimi hâlâ yok). İstemcide hesaplamak, aynı kaydı iki
  // kullanıcıya farklı gösterirdi.
  const todayUtc = new Date();
  const todayStart = Date.UTC(
    todayUtc.getUTCFullYear(),
    todayUtc.getUTCMonth(),
    todayUtc.getUTCDate(),
  );

  return (
    <section className="space-y-8">
      <PageHeader
        title="Borç/Alacak"
        description={
          <>
            <span className="font-medium text-strong">{tenant.name}</span> çalışma alanının
            takip ettiği borç ve alacaklar. Bu kayıtlar hesap bakiyelerini{" "}
            <span className="font-medium text-strong">etkilemez</span> — para henüz hareket
            etmemiştir.
          </>
        }
      />

      {records.length === 0 ? (
        <EmptyState
          icon={<IconArrowUpRight className="size-5" />}
          title="Henüz borç/alacak kaydı yok"
          description={
            canManage
              ? "Kime borçlu olduğunuzu ya da kimden alacağınız olduğunu aşağıdaki formla kaydedin. Vade girerseniz gecikenler işaretlenir."
              : "Bu çalışma alanında henüz borç/alacak kaydı yok."
          }
        />
      ) : (
        <TableScroll>
          <Table minWidth="44rem">
            <Thead>
              <Th>Karşı taraf</Th>
              <Th>Tür</Th>
              <Th align="right">Tutar</Th>
              <Th>Vade</Th>
              <Th>Durum</Th>
              {canManage && <Th srOnly>İşlemler</Th>}
            </Thead>
            <Tbody>
              {records.map((record) => (
                <Tr key={record.id} highlighted={record.id === editingRecord?.id}>
                  <Td emphasis>
                    <span className="flex items-center gap-2.5">
                      <DirectionChip direction={record.type === "CREDIT" ? "in" : "out"}>
                        {record.type === "CREDIT" ? (
                          <IconArrowUpRight className="size-4" />
                        ) : (
                          <IconArrowDownRight className="size-4" />
                        )}
                      </DirectionChip>
                      {record.counterparty}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={record.type === "CREDIT" ? "mint" : "neutral"}>
                      {record.type === "CREDIT" ? "Alacak" : "Borç"}
                    </Badge>
                  </Td>
                  <Td align="right">
                    {/* Tutar HAM STRING; yönü `type` taşır (#53'ün kuralı) — alacak `+`,
                        borç `-` ile gösterilir ve değerin kendisi hiç dönüştürülmez. */}
                    <Money
                      value={record.amount}
                      currency={record.currency}
                      direction={record.type === "CREDIT" ? "in" : "out"}
                      size="lg"
                    />
                  </Td>
                  <Td>
                    <DueDateCell record={record} todayStart={todayStart} />
                  </Td>
                  <Td>
                    <Badge tone={record.status === "SETTLED" ? "outline" : "brand"}>
                      {record.status === "SETTLED" ? "Kapandı" : "Açık"}
                    </Badge>
                  </Td>
                  {canManage && (
                    <Td align="right">
                      <div className="flex items-center justify-end gap-3">
                        {/* Düzenleme bir LİNK: form durumunu URL'e yazar, yan etkisi yoktur. */}
                        <Link
                          href={`/debt-credits?edit=${record.id}`}
                          className="text-sm font-medium text-brand-600 transition-colors duration-150 ease-out-soft hover:text-brand-700 dark:text-brand-300"
                        >
                          <span aria-hidden="true">Düzenle</span>
                          <span className="sr-only">
                            {record.counterparty} kaydını düzenle
                          </span>
                        </Link>

                        <DeleteWithConfirm
                          endpoint={`/api/tenants/${tenant.id}/debt-credits/${record.id}`}
                          itemLabel={`${record.counterparty} kaydını sil`}
                          confirmQuestion={`"${record.counterparty}" kaydını silmek istiyor musunuz?`}
                          consequence="Bu işlem geri alınamaz."
                          messages={{
                            forbidden: "Bu çalışma alanında borç/alacak silme yetkiniz yok.",
                            notFound: "Bu kayıt artık mevcut değil. Sayfayı yenileyin.",
                            fallback: "Kayıt silinemedi. Lütfen daha sonra tekrar deneyin.",
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

      {canManage &&
        (editingRecord ? (
          <div className="space-y-3">
            <DebtCreditForm
              key={editingRecord.id}
              tenantId={tenant.id}
              record={{
                id: editingRecord.id,
                type: editingRecord.type,
                counterparty: editingRecord.counterparty,
                amount: editingRecord.amount,
                currency: editingRecord.currency,
                dueDate: toIsoDay(editingRecord.dueDate),
                status: editingRecord.status,
              }}
            />
            <Link
              href="/debt-credits"
              className="inline-block text-sm font-medium text-muted underline-offset-4 hover:text-strong hover:underline"
            >
              Vazgeç
            </Link>
          </div>
        ) : (
          <DebtCreditForm tenantId={tenant.id} />
        ))}
    </section>
  );
}

/**
 * `Date` → `YYYY-MM-DD`.
 *
 * `toLocaleDateString()` KULLANILMAZ — yerelleştirme çıktıyı sunucunun saat dilimine bağlardı
 * (#54'ün kararı). Vade zaten UTC gece yarısı olarak saklanıyor, dolayısıyla ISO'nun ilk on
 * karakteri kaydedilen günün TA KENDİSİDİR.
 */
function toIsoDay(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

/**
 * Vade hücresi.
 *
 * GECİKME BİR UYARIDIR, BİR BİLDİRİM DEĞİL: vadesi geçmiş AÇIK kayıtlar işaretlenir, ama
 * otomatik hatırlatma bu issue'nun kapsamı dışındadır (#70 "Scope Dışı" + Epic 9). Kapanmış
 * bir kayıt geciktiği hâlde işaretlenmez — iş bitmiştir, kırmızı bir rozet yalnızca gürültü
 * olurdu.
 */
function DueDateCell({ record, todayStart }: { record: DebtCreditView; todayStart: number }) {
  const iso = toIsoDay(record.dueDate);

  if (!iso) {
    return <span className="text-faint">—</span>;
  }

  const overdue = record.status === "OPEN" && record.dueDate!.getTime() < todayStart;

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="tabular-nums">{iso}</span>
      {overdue ? <Badge tone="danger">Gecikmiş</Badge> : null}
    </span>
  );
}
