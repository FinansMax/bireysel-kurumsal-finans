import type { Metadata } from "next";
import Link from "next/link";

import { requirePageUser } from "@/lib/auth/page-guard";
import { hasPermission, PERMISSIONS } from "@/lib/authz/permissions";
import { listCategories } from "@/lib/finance/category";
import { resolveActiveTenantForUser } from "@/lib/tenants/tenant-context";

import { DeleteWithConfirm } from "@/components/delete-with-confirm";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { IconTag, IconWorkspace } from "@/components/ui/icons";
import { IconTile, PageHeader } from "@/components/ui/surfaces";
import { Table, Tbody, Td, Th, Thead, TableScroll, Tr } from "@/components/ui/table";

import { CategoryForm } from "./category-form";

export const metadata: Metadata = {
  title: "Kategoriler",
};

const TYPE_LABELS: Record<string, string> = {
  INCOME: "Gelir",
  EXPENSE: "Gider",
};

/**
 * Aktif çalışma alanının gelir/gider kategorileri ekranı (Issue #50).
 *
 * `/accounts` ile aynı desen: URL'de `tenantId` YOKTUR — hangi tenant'ın kategorileri
 * sorusunun tek kaynağı aktif tenant'tır (bkz. `src/app/(app)/accounts/page.tsx`).
 *
 * KAPSAM: liste + oluşturma + düzenleme/silme (#50, #130). Düzenleme durumu `?edit=<id>`
 * ile URL'dedir (hesap ekranındaki aynı desen).
 *
 * API'nin `?type` filtresi burada KULLANILMAZ: o filtre işlem formu içindir (gider işlemine
 * yalnızca gider kategorisi seçilebilmelidir, #53). Bu ekranda kullanıcı kategorilerinin
 * tamamını tek listede görür; liste türe göre sıralı geldiği için zaten gruplu okunur.
 */
export default async function CategoriesPage({
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
        <PageHeader title="Kategoriler" />
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

  if (!hasPermission(role, PERMISSIONS.VIEW_CATEGORIES)) {
    return (
      <section className="space-y-8">
        <PageHeader title="Kategoriler" />
        <EmptyState
          icon={<IconTag className="size-5" />}
          title="Görüntüleme yetkiniz yok"
          description="Bu çalışma alanının kategorilerini görmek için yöneticinizden yetki isteyin."
        />
      </section>
    );
  }

  const categories = await listCategories(tenant.id);
  const canManage = hasPermission(role, PERMISSIONS.MANAGE_CATEGORIES);

  // Düzenlenecek kayıt LİSTEDEN seçilir: liste zaten aktif tenant ile scope'lanmış geldiği
  // için URL'e yabancı bir id yazmak hiçbir şey açmaz.
  const params = await searchParams;
  const editId = typeof params.edit === "string" ? params.edit : null;
  const editingCategory =
    canManage && editId ? (categories.find((category) => category.id === editId) ?? null) : null;

  return (
    <section className="space-y-8">
      <PageHeader
        title="Kategoriler"
        description={
          <>
            <span className="font-medium text-strong">{tenant.name}</span> çalışma alanının gelir
            ve gider kategorileri.
          </>
        }
      />

      {categories.length === 0 ? (
        <EmptyState
          icon={<IconTag className="size-5" />}
          title="Henüz kategori yok"
          description={
            canManage
              ? "Gelir ve gider için ayrı kategoriler tanımlayın; hareketlerinizi bunlara göre gruplayacaksınız. İlkini aşağıdaki formla oluşturun."
              : "Bu çalışma alanında henüz kategori tanımlanmamış."
          }
        />
      ) : (
        <TableScroll>
          <Table minWidth="26rem">
            <Thead>
              <Th>Kategori</Th>
              <Th>Tür</Th>
              {canManage && <Th srOnly>İşlemler</Th>}
            </Thead>
            <Tbody>
              {categories.map((category) => (
                <Tr key={category.id} highlighted={category.id === editingCategory?.id}>
                  <Td emphasis>
                    <span className="flex items-center gap-2.5">
                      <IconTile tone="neutral">
                        <IconTag className="size-4" />
                      </IconTile>
                      {category.name}
                    </span>
                  </Td>
                  <Td>
                    {/* TÜR RENKLE AYRILIR: gelir mint, gider nötr. Aynı listede iki tür yan yana
                        durduğu için, metni okumadan ayırt edilebilmesi taramayı hızlandırır. */}
                    <Badge tone={category.type === "INCOME" ? "mint" : "neutral"}>
                      {TYPE_LABELS[category.type] ?? category.type}
                    </Badge>
                  </Td>
                  {canManage && (
                    <Td align="right">
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          href={`/categories?edit=${category.id}`}
                          className="text-sm font-medium text-brand-600 transition-colors duration-150 ease-out-soft hover:text-brand-700 dark:text-brand-300"
                        >
                          <span aria-hidden="true">Düzenle</span>
                          <span className="sr-only">{category.name} kategorisini düzenle</span>
                        </Link>

                        <DeleteWithConfirm
                          endpoint={`/api/tenants/${tenant.id}/categories/${category.id}`}
                          itemLabel={`${category.name} kategorisini sil`}
                          confirmQuestion={`"${category.name}" kategorisini silmek istiyor musunuz?`}
                          /* #53'ün kararı: kategori bir ETİKETTİR, silinince bağlı işlemler
                             SİLİNMEZ, "Kategorisiz" kalır (`onDelete: SetNull`). Kullanıcı bunu
                             onaylamadan ÖNCE bilmelidir — hesap silmenin aksine burada engel
                             yoktur, dolayısıyla uyarı tek koruma. */
                          consequence="Bu kategoriyi kullanan işlemler silinmez, 'Kategorisiz' olarak kalır. Bu işlem geri alınamaz."
                          messages={{
                            forbidden: "Bu çalışma alanında kategori silme yetkiniz yok.",
                            notFound: "Bu kategori artık mevcut değil. Sayfayı yenileyin.",
                            fallback: "Kategori silinemedi. Lütfen daha sonra tekrar deneyin.",
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

      {/* Oluşturma formu yalnızca yetkili role render edilir. Bu bir güvenlik kontrolü
          DEĞİLDİR — asıl kontrol `requirePermission(MANAGE_CATEGORIES)`'tır (kanıt:
          `security/category-security.spec.ts`); buradaki amaç, MEMBER'a kesin 403 alacağı bir
          form göstermemektir. */}
      {canManage &&
        (editingCategory ? (
          <div className="space-y-3">
            <CategoryForm
              key={editingCategory.id}
              tenantId={tenant.id}
              category={editingCategory}
            />
            <Link
              href="/categories"
              className="inline-block text-sm font-medium text-muted underline-offset-4 hover:text-strong hover:underline"
            >
              Vazgeç
            </Link>
          </div>
        ) : (
          <CategoryForm tenantId={tenant.id} />
        ))}
    </section>
  );
}
