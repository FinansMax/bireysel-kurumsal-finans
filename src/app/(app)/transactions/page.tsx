import type { Metadata } from "next";
import Link from "next/link";

import { requirePageUser } from "@/lib/auth/page-guard";
import { hasPermission, PERMISSIONS } from "@/lib/authz/permissions";
import { listAccounts } from "@/lib/finance/account";
import { listCategories } from "@/lib/finance/category";
import { listTransactions } from "@/lib/finance/transaction";
import { parseTransactionFilters } from "@/lib/finance/transaction-filters";
import { resolveActiveTenantForUser } from "@/lib/tenants/tenant-context";

import { DeleteWithConfirm } from "@/components/delete-with-confirm";

import { TransactionForm } from "./transaction-form";
import { TransactionFiltersForm, type ActiveFilterValues } from "./transaction-filters-form";

export const metadata: Metadata = {
  title: "İşlemler",
};

const TYPE_LABELS: Record<string, string> = {
  INCOME: "Gelir",
  EXPENSE: "Gider",
};

/**
 * Form tarihinin varsayılanı — sunucunun yerel tarihi, `YYYY-MM-DD`.
 *
 * `toISOString().slice(0, 10)` KULLANILMAZ: o UTC'ye çevirir ve UTC+3 bir sunucuda gece
 * yarısından sonra "dün"ü varsayılan yapardı. Değerin istemcide değil burada üretilmesinin
 * gerekçesi `TransactionForm`'un `today` prop'unda yazılıdır.
 */
function serverTodayIsoDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Bir arama parametresinin form alanına geri yazılacak hâli.
 *
 * Tekrarlanan parametre (`?q=a&q=b`) burada boşa düşer — o durumda `parseTransactionFilters()`
 * zaten hata döndürüyor ve liste gösterilmiyor; forma iki değerden birini seçip yazmak,
 * kullanıcıya reddedilen girdisini "kabul edilmiş" gibi göstermek olurdu.
 */
function singleParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

/**
 * Aktif çalışma alanının gelir/gider işlemleri ekranı (Issue #54).
 *
 * `/accounts` (#47) ve `/categories` (#50) ile aynı desen: URL'de `tenantId` YOKTUR — hangi
 * tenant'ın işlemleri sorusunun tek kaynağı aktif tenant'tır; form servis fonksiyonunu değil
 * route'u çağırır (yetki ve aktif tenant tutarlılığı orada).
 *
 * BU EKRANIN ÖNCEKİLERDEN FARKI: tek bir listeye değil ÜÇ listeye ihtiyaç duyar — işlemler,
 * hesaplar ve kategoriler. Hesap/kategori yalnızca formun açılır menüleri için değil, listedeki
 * `accountId`/`categoryId` alanlarını okunabilir isme çevirmek için de gerekir; API bilerek
 * ilişki genişletmez (dar `select` allowlist'i, bkz. `src/lib/finance/transaction.ts`).
 *
 * FİLTRELEME (#56): filtre durumu URL'dedir (`?from=&to=&accountId=&categoryId=&q=`), React
 * state'inde değil — sonuç paylaşılabilir ve geri tuşu doğru çalışır. Ayrıştırıcı API route'u
 * ile ORTAKTIR (`transaction-filters.ts`), böylece aynı URL iki yerde aynı sonucu verir.
 *
 * KAPSAM: liste + oluşturma + filtreleme + düzenleme/silme (#54, #56, #130). Düzenleme
 * durumu `?edit=<id>` ile URL'dedir ve MEVCUT FİLTRELERİ korur — kullanıcı "Vazgeç"
 * dediğinde baktığı filtrelenmiş listeye dönmelidir.
 */
export default async function TransactionsPage({
  searchParams,
}: {
  // Next.js 16'da `searchParams` bir Promise'tir ve değer tekrarlanan parametrede dizi olur
  // (bkz. node_modules/next/dist/docs/.../file-conventions/page.md).
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requirePageUser();
  const active = await resolveActiveTenantForUser(user.id);

  if (!active) {
    return (
      <section className="space-y-2">
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">İşlemler</h1>
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

  if (!hasPermission(role, PERMISSIONS.VIEW_TRANSACTIONS)) {
    return (
      <section className="space-y-2">
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">İşlemler</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Bu çalışma alanının işlemlerini görüntüleme yetkiniz yok.
        </p>
      </section>
    );
  }

  const canManage = hasPermission(role, PERMISSIONS.MANAGE_TRANSACTIONS);

  const rawParams = await searchParams;
  const parsedFilters = parseTransactionFilters((key) => rawParams[key]);

  // Hesap ve kategori listeleri filtre geçersiz olsa DA gerekir: form yeniden çizilecek.
  const [accounts, categories] = await Promise.all([
    listAccounts(tenant.id),
    listCategories(tenant.id),
  ]);

  // Geçersiz filtrede liste HİÇ ÇEKİLMEZ ve gösterilmez. Filtreyi sessizce yok sayıp tüm
  // listeyi göstermek, filtrenin uygulandığını sanan kullanıcıya yanlış bir veri kümesini
  // doğruymuş gibi sunmak olurdu (#49'un `?type` kararındaki aynı gerekçe).
  const transactions = parsedFilters.ok
    ? await listTransactions(tenant.id, parsedFilters.filters)
    : [];

  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const categoriesById = new Map(categories.map((category) => [category.id, category]));

  // Düzenlenecek kayıt LİSTEDEN seçilir, ayrı bir sorguyla değil: liste zaten aktif tenant
  // ile scope'lanmış geldiği için URL'e yabancı bir id yazmak hiçbir şey açmaz. Filtre
  // aktifken filtrenin dışında kalan bir kayıt da düzenlenemez — bu kabul edilebilir: o kayıt
  // zaten ekranda görünmüyordur.
  const editId = typeof rawParams.edit === "string" ? rawParams.edit : null;
  const editingTransaction =
    canManage && editId
      ? (transactions.find((transaction) => transaction.id === editId) ?? null)
      : null;

  /** Formun geri yazacağı ham değerler — kullanıcının yazdığı gibi, çözümlenmiş hâli değil. */
  const filterValues: ActiveFilterValues = {
    from: singleParam(rawParams.from),
    to: singleParam(rawParams.to),
    accountId: singleParam(rawParams.accountId),
    categoryId: singleParam(rawParams.categoryId),
    q: singleParam(rawParams.q),
  };
  const hasActiveFilters = Object.values(filterValues).some((value) => value !== "");

  /** Mevcut filtreleri koruyarak `edit` parametresini ayarlar/kaldırır. */
  function hrefWithEdit(id: string | null): string {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(filterValues)) {
      if (value !== "") next.set(key, value);
    }
    if (id) next.set("edit", id);
    const query = next.toString();
    return query === "" ? "/transactions" : `/transactions?${query}`;
  }

  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">İşlemler</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">{tenant.name}</span>{" "}
          çalışma alanının gelir ve gider kayıtları.
        </p>
      </div>

      <TransactionFiltersForm
        accounts={accounts.map((account) => ({ id: account.id, name: account.name }))}
        categories={categories.map((category) => ({
          id: category.id,
          name: category.name,
          type: category.type,
        }))}
        values={filterValues}
        hasActiveFilters={hasActiveFilters}
      />

      {!parsedFilters.ok ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
        >
          Filtre geçersiz olduğu için liste gösterilmiyor. Tarihleri{" "}
          <span className="font-medium">GG.AA.YYYY</span> biçiminde seçin ve başlangıcın
          bitişten sonra olmadığından emin olun.
        </p>
      ) : transactions.length === 0 ? (
        /* Boş liste iki FARKLI şey anlatabilir ve ikisini aynı cümleyle geçmek yanıltıcı
           olurdu: hiç kayıt olmaması ile filtrenin hiçbir şeyle eşleşmemesi. İkincisinde
           kullanıcıya "ilkini kaydedin" demek, elindeki kayıtları yok saymak olurdu. */
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {hasActiveFilters
            ? "Bu filtreyle eşleşen işlem yok. Filtreleri gevşetmeyi deneyin."
            : `Henüz işlem yok.${
                canManage && accounts.length > 0 ? " Aşağıdaki formla ilkini kaydedin." : ""
              }`}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
              <tr>
                <th scope="col" className="py-2 pr-4 font-medium">Tarih</th>
                <th scope="col" className="py-2 pr-4 font-medium">Açıklama</th>
                <th scope="col" className="py-2 pr-4 font-medium">Hesap</th>
                <th scope="col" className="py-2 pr-4 font-medium">Kategori</th>
                <th scope="col" className="py-2 pr-4 font-medium">Tür</th>
                <th scope="col" className="py-2 pr-4 font-medium">Tutar</th>
                {canManage && (
                  <th scope="col" className="py-2 font-medium">
                    <span className="sr-only">İşlemler</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => {
                const account = accountsById.get(transaction.accountId);
                const category = transaction.categoryId
                  ? categoriesById.get(transaction.categoryId)
                  : null;

                return (
                  <tr
                    key={transaction.id}
                    className="border-t border-zinc-200 dark:border-zinc-800"
                  >
                    {/* Tarih `YYYY-MM-DD` olarak, sunucunun yerel ayarına BAĞLI OLMADAN
                        yazılır: `toLocaleDateString()` çıktıyı sunucunun saat dilimine ve
                        locale'ine bağlardı — aynı kayıt geliştirme ve CI ortamında farklı
                        görünebilirdi. Saat dilimi yönetimi bu üründe henüz hiç yok; ayrı bir
                        issue'nun konusudur (bkz. README). */}
                    <td className="py-3 pr-4 tabular-nums text-zinc-700 dark:text-zinc-300">
                      {transaction.occurredAt.toISOString().slice(0, 10)}
                    </td>
                    <td className="py-3 pr-4 text-zinc-900 dark:text-zinc-100">
                      {transaction.description ?? "—"}
                    </td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">
                      {account?.name ?? "—"}
                    </td>
                    {/* Kategori silinmiş olabilir: #53'te `onDelete: SetNull` seçildi, işlem
                        kategorisiz kalır (bkz. README). "Kategorisiz", boş bir hücreden daha
                        anlaşılırdır. */}
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">
                      {category?.name ?? "Kategorisiz"}
                    </td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">
                      {TYPE_LABELS[transaction.type] ?? transaction.type}
                    </td>
                    {/* TUTAR HAM STRING OLARAK GÖSTERİLİR, `Intl.NumberFormat` ile DEĞİL:
                        biçimlendirme değeri önce `Number`'a çevirmeyi gerektirir ve bu, para
                        için yasak olan kayan nokta dönüşümünü (invariant #10) arayüz
                        katmanından geri getirirdi — hesap ekranındaki (#47) aynı karar. */}
                    <td className="py-3 pr-4 tabular-nums text-zinc-900 dark:text-zinc-100">
                      {transaction.amount} {account?.currency ?? ""}
                    </td>
                    {canManage && (
                      <td className="py-3 align-top">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                          <Link
                            href={hrefWithEdit(transaction.id)}
                            className="text-sm text-zinc-700 underline underline-offset-4 dark:text-zinc-300"
                          >
                            <span aria-hidden="true">Düzenle</span>
                            <span className="sr-only">
                              {transaction.occurredAt.toISOString().slice(0, 10)} tarihli{" "}
                              {transaction.amount} tutarlı işlemi düzenle
                            </span>
                          </Link>

                          <DeleteWithConfirm
                            endpoint={`/api/tenants/${tenant.id}/transactions/${transaction.id}`}
                            itemLabel={`${transaction.occurredAt.toISOString().slice(0, 10)} tarihli ${transaction.amount} tutarlı işlemi sil`}
                            confirmQuestion={`${transaction.amount} tutarlı bu işlemi silmek istiyor musunuz?`}
                            /* Silme, hesabın BAKİYESİNİ değiştirir (#53: etki geri alınır).
                               Kullanıcı bunu onaylamadan ÖNCE görmelidir — diğer iki ekranda
                               silmenin parasal sonucu yoktur, burada vardır. */
                            consequence={`"${account?.name ?? "Hesap"}" hesabının bakiyesi bu işlemin etkisi geri alınarak güncellenecek. Bu işlem geri alınamaz.`}
                            messages={{
                              forbidden: "Bu çalışma alanında işlem silme yetkiniz yok.",
                              notFound: "Bu işlem artık mevcut değil. Sayfayı yenileyin.",
                              fallback: "İşlem silinemedi. Lütfen daha sonra tekrar deneyin.",
                            }}
                          />
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Form yalnızca yetkili role render edilir. Bu bir güvenlik kontrolü DEĞİLDİR — asıl
          kontrol `requirePermission(MANAGE_TRANSACTIONS)`'tır (kanıt:
          `security/transaction-security.spec.ts`); buradaki amaç, MEMBER'a kesin 403 alacağı
          bir form göstermemektir. */}
      {canManage &&
        (accounts.length === 0 ? (
          // İşlem, hesapsız kaydedilemez (`accountId` zorunlu). Boş bir hesap seçicisi
          // göstermek yerine kullanıcı doğrudan çözüme yönlendirilir.
          <p className="border-t border-zinc-200 pt-6 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
            İşlem kaydedebilmek için önce bir hesap gerekiyor.{" "}
            <Link href="/accounts" className="underline underline-offset-4">
              Hesaplar ekranından oluşturun.
            </Link>
          </p>
        ) : (
          <div className="space-y-3">
            <TransactionForm
              // `key`: bir kaydı düzenlerken başkasına geçildiğinde React bileşeni yeniden
              // kurmalı, aksi halde eski kaydın değerleri state'te kalırdı.
              key={editingTransaction?.id ?? "new"}
              tenantId={tenant.id}
              accounts={accounts.map((account) => ({
                id: account.id,
                name: account.name,
                currency: account.currency,
              }))}
              categories={categories.map((category) => ({
                id: category.id,
                name: category.name,
                type: category.type,
              }))}
              today={serverTodayIsoDate()}
              transaction={
                editingTransaction
                  ? {
                      id: editingTransaction.id,
                      accountId: editingTransaction.accountId,
                      categoryId: editingTransaction.categoryId,
                      type: editingTransaction.type,
                      amount: editingTransaction.amount,
                      description: editingTransaction.description,
                      // Tarih alanı `YYYY-MM-DD` bekler; listedeki gösterimle AYNI dönüşüm
                      // kullanılır ki kullanıcı formda başka bir gün görmesin.
                      occurredAt: editingTransaction.occurredAt.toISOString().slice(0, 10),
                    }
                  : undefined
              }
            />
            {editingTransaction && (
              // "Vazgeç" MEVCUT FİLTRELERE döner: kullanıcı düzenlemeye filtrelenmiş bir
              // listeden geldiyse, vazgeçince tam listeye düşmek onu bağlamından koparırdı.
              <Link
                href={hrefWithEdit(null)}
                className="text-sm text-zinc-600 underline underline-offset-4 dark:text-zinc-400"
              >
                Vazgeç
              </Link>
            )}
          </div>
        ))}
    </section>
  );
}
