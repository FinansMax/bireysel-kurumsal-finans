import type { Metadata } from "next";
import Link from "next/link";

import { requirePageUser } from "@/lib/auth/page-guard";
import { hasPermission, PERMISSIONS } from "@/lib/authz/permissions";
import { listCategories } from "@/lib/finance/category";
import { resolveActiveTenantForUser } from "@/lib/tenants/tenant-context";

import { CreateCategoryForm } from "./create-category-form";

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
 * KAPSAM: liste + oluşturma (issue #50'nin kapsamı). Güncelleme/silme API'si (#49) hazırdır
 * ama arayüzü bu issue'da BİLEREK yapılmadı — hesap ekranında da aynı sınır var; ikisi tek
 * bir "düzenle/sil" issue'sunda birlikte ele alınmalıdır.
 *
 * API'nin `?type` filtresi burada KULLANILMAZ: o filtre işlem formu içindir (gider işlemine
 * yalnızca gider kategorisi seçilebilmelidir, #53). Bu ekranda kullanıcı kategorilerinin
 * tamamını tek listede görür; liste türe göre sıralı geldiği için zaten gruplu okunur.
 */
export default async function CategoriesPage() {
  const user = await requirePageUser();
  const active = await resolveActiveTenantForUser(user.id);

  if (!active) {
    return (
      <section className="space-y-2">
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Kategoriler</h1>
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

  if (!hasPermission(role, PERMISSIONS.VIEW_CATEGORIES)) {
    return (
      <section className="space-y-2">
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Kategoriler</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Bu çalışma alanının kategorilerini görüntüleme yetkiniz yok.
        </p>
      </section>
    );
  }

  const categories = await listCategories(tenant.id);
  const canManage = hasPermission(role, PERMISSIONS.MANAGE_CATEGORIES);

  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Kategoriler</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">{tenant.name}</span>{" "}
          çalışma alanının gelir ve gider kategorileri.
        </p>
      </div>

      {categories.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Henüz kategori yok.
          {canManage ? " Aşağıdaki formla ilkini oluşturun." : ""}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[24rem] text-left text-sm">
            <thead className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
              <tr>
                <th scope="col" className="py-2 pr-4 font-medium">Kategori</th>
                <th scope="col" className="py-2 font-medium">Tür</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <tr key={category.id} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="py-3 pr-4 font-medium text-zinc-900 dark:text-zinc-100">
                    {category.name}
                  </td>
                  <td className="py-3 text-zinc-700 dark:text-zinc-300">
                    {TYPE_LABELS[category.type] ?? category.type}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Oluşturma formu yalnızca yetkili role render edilir. Bu bir güvenlik kontrolü
          DEĞİLDİR — asıl kontrol `requirePermission(MANAGE_CATEGORIES)`'tır (kanıt:
          `security/category-security.spec.ts`); buradaki amaç, MEMBER'a kesin 403 alacağı bir
          form göstermemektir. */}
      {canManage && <CreateCategoryForm tenantId={tenant.id} />}
    </section>
  );
}
