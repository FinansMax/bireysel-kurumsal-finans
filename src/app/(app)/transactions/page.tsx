import type { Metadata } from "next";
import Link from "next/link";

import { requirePageUser } from "@/lib/auth/page-guard";
import { hasPermission, PERMISSIONS } from "@/lib/authz/permissions";
import { listAccounts } from "@/lib/finance/account";
import { listCategories } from "@/lib/finance/category";
import { listTransactions } from "@/lib/finance/transaction";
import { FILTER_ERRORS, parseTransactionFilters } from "@/lib/finance/transaction-filters";
import { resolveActiveTenantForUser } from "@/lib/tenants/tenant-context";

import { DeleteWithConfirm } from "@/components/delete-with-confirm";
import { Badge, CategoryBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  IconArrowDownRight,
  IconArrowUpRight,
  IconChevronRight,
  IconSearch,
  IconTransactions,
  IconWallet,
  IconWorkspace,
} from "@/components/ui/icons";
import { DirectionChip, Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/surfaces";
import { Table, Tbody, Td, Th, Thead, TableScroll, Tr } from "@/components/ui/table";

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
 * SAYFALAMA (#135): liste keyset imleciyle sayfalanır (`?after=`). Filtre formu düz bir
 * `<form method="get">` olduğu için kendi alanlarından başkasını göndermez — yani FİLTRE
 * DEĞİŞTİĞİNDE `after` KENDİLİĞİNDEN DÜŞER. Bu doğru davranıştır: yeni bir filtre, eski
 * listenin ortasından değil başından okunmalıdır.
 *
 * KAPSAM: liste + oluşturma + filtreleme + düzenleme/silme + sayfalama (#54, #56, #130, #135).
 * Düzenleme durumu `?edit=<id>` ile URL'dedir ve MEVCUT FİLTRELERİ (ve sayfayı) korur —
 * kullanıcı "Vazgeç" dediğinde baktığı listeye dönmelidir.
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
      <section className="space-y-8">
        <PageHeader title="İşlemler" />
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

  if (!hasPermission(role, PERMISSIONS.VIEW_TRANSACTIONS)) {
    return (
      <section className="space-y-8">
        <PageHeader title="İşlemler" />
        <EmptyState
          icon={<IconTransactions className="size-5" />}
          title="Görüntüleme yetkiniz yok"
          description="Bu çalışma alanının hareketlerini görmek için yöneticinizden yetki isteyin."
        />
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
  // doğruymuş gibi sunmak olurdu (#49'un `?type` kararındaki aynı gerekçe). Aynısı geçersiz
  // sayfalama imleci için de geçerlidir (#135): ayrıştırıcı onu da reddeder.
  const { transactions, nextCursor } = parsedFilters.ok
    ? await listTransactions(tenant.id, parsedFilters.filters, parsedFilters.after)
    : { transactions: [], nextCursor: null };

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

  /** Kullanıcının şu an baktığı sayfanın imleci (yoksa boş string = ilk sayfa). */
  const currentAfter = singleParam(rawParams.after);

  /**
   * Ekranın URL'ini kurar. FİLTRELER DAİMA KORUNUR (#56); `after` ve `edit` çağrıya göre
   * ayarlanır ya da düşürülür.
   *
   * `after`ın varsayılanı MEVCUT SAYFADIR: kullanıcı ikinci sayfadaki bir kaydı düzenlemeye
   * bastığında imleç düşseydi liste ilk sayfaya dönerdi ve düzenlenecek kayıt o listede
   * bulunmadığı için form hiç açılmazdı (kayıt listeden seçilir, bkz. aşağıdaki not).
   *
   * `edit`in varsayılanı ise DÜŞÜRMEKTİR: "sonraki sayfa" bağlantısı açık bir düzenleme
   * formunu yanında taşımamalı — o kayıt yeni sayfada zaten görünmüyor olacak.
   */
  function transactionsHref({
    after = currentAfter,
    edit = null,
  }: { after?: string; edit?: string | null } = {}): string {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(filterValues)) {
      if (value !== "") next.set(key, value);
    }
    if (after !== "") next.set("after", after);
    if (edit) next.set("edit", edit);
    const query = next.toString();
    return query === "" ? "/transactions" : `/transactions?${query}`;
  }

  return (
    <section className="space-y-8">
      <PageHeader
        title="İşlemler"
        description={
          <>
            <span className="font-medium text-strong">{tenant.name}</span> çalışma alanının gelir
            ve gider kayıtları.
          </>
        }
      />

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
          className="rounded-panel border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-900 dark:bg-danger-900/30 dark:text-danger-200"
        >
          {/* Sayfalama imleci bozuksa (Issue #135) kullanıcıya TARİH biçimini anlatmak
              yanıltıcı olurdu: onun düzeltebileceği bir filtre yok, elindeki bağlantı bozuk.
              Bu yüzden iki durum ayrı cümle alır ve imleç hâlinde çıkış yolu gösterilir. */}
          {parsedFilters.error === FILTER_ERRORS.CURSOR ? (
            <>
              Sayfa bağlantısı geçersiz olduğu için liste gösterilmiyor.{" "}
              <Link href={transactionsHref({ after: "" })} className="underline underline-offset-4">
                İlk sayfaya dönün.
              </Link>
            </>
          ) : (
            <>
              Filtre geçersiz olduğu için liste gösterilmiyor. Tarihleri{" "}
              <span className="font-medium">GG.AA.YYYY</span> biçiminde seçin ve başlangıcın
              bitişten sonra olmadığından emin olun.
            </>
          )}
        </p>
      ) : transactions.length === 0 && currentAfter !== "" ? (
        /* ÜÇÜNCÜ boş liste hâli (Issue #135): imleç geçerli ama arkasında kayıt kalmamış.
           Bu, kullanıcı "sonraki sayfa"ya bastıktan sonra o sayfadaki kayıtların silinmesiyle
           (ya da eski bir bağlantıyla) oluşur. Diğer iki mesajı vermek yanlış olurdu: ne
           "henüz işlem yok" doğrudur (kayıtlar var, sadece bu pencerede değil) ne de "filtreyle
           eşleşen yok" (sorun filtrede değil, sayfada). */
        <EmptyState
          icon={<IconTransactions className="size-5" />}
          title="Bu sayfada gösterilecek işlem kalmamış"
          description="Bu sayfadaki kayıtlar silinmiş ya da bağlantı eski olabilir."
          action={{ label: "İlk sayfaya dön", href: transactionsHref({ after: "" }) }}
        />
      ) : transactions.length === 0 ? (
        /* Boş liste iki FARKLI şey anlatabilir ve ikisini aynı cümleyle geçmek yanıltıcı
           olurdu: hiç kayıt olmaması ile filtrenin hiçbir şeyle eşleşmemesi. İkincisinde
           kullanıcıya "ilkini kaydedin" demek, elindeki kayıtları yok saymak olurdu. */
        <EmptyState
          icon={hasActiveFilters ? <IconSearch className="size-5" /> : <IconTransactions className="size-5" />}
          title={hasActiveFilters ? "Bu filtreyle eşleşen işlem yok" : "Henüz işlem yok"}
          description={
            hasActiveFilters
              ? "Filtreleri gevşetmeyi deneyin: tarih aralığını genişletin ya da arama metnini kısaltın."
              : canManage && accounts.length > 0
                ? "İlk gelir ya da gider hareketinizi aşağıdaki formla kaydedin; hesabın bakiyesi anında güncellenir."
                : "Bu çalışma alanında henüz hareket kaydedilmemiş."
          }
          action={
            hasActiveFilters ? { label: "Filtreleri temizle", href: "/transactions" } : undefined
          }
        />
      ) : (
        <>
          <TableScroll>
            <Table minWidth="46rem">
            <Thead>
              <Th>Tarih</Th>
              <Th>Açıklama</Th>
              <Th>Hesap</Th>
              <Th>Kategori</Th>
              <Th>Tür</Th>
              <Th align="right">Tutar</Th>
              {canManage && <Th srOnly>İşlemler</Th>}
            </Thead>
            <Tbody>
              {transactions.map((transaction) => {
                const account = accountsById.get(transaction.accountId);
                const category = transaction.categoryId
                  ? categoriesById.get(transaction.categoryId)
                  : null;

                const isIncome = transaction.type === "INCOME";

                return (
                  <Tr
                    key={transaction.id}
                    highlighted={transaction.id === editingTransaction?.id}
                  >
                    {/* Tarih `YYYY-MM-DD` olarak, sunucunun yerel ayarına BAĞLI OLMADAN
                        yazılır: `toLocaleDateString()` çıktıyı sunucunun saat dilimine ve
                        locale'ine bağlardı — aynı kayıt geliştirme ve CI ortamında farklı
                        görünebilirdi. Saat dilimi yönetimi bu üründe henüz hiç yok; ayrı bir
                        issue'nun konusudur (bkz. README). */}
                    <Td className="tabular-nums whitespace-nowrap">
                      {transaction.occurredAt.toISOString().slice(0, 10)}
                    </Td>
                    <Td emphasis>
                      <span className="flex items-center gap-2.5">
                        {/* Yön göstergesi AÇIKLAMANIN yanında: satırı soldan tarayan göz,
                            tutara ulaşmadan gelir mi gider mi olduğunu görür. */}
                        <DirectionChip direction={isIncome ? "in" : "out"}>
                          {isIncome ? (
                            <IconArrowUpRight className="size-4" />
                          ) : (
                            <IconArrowDownRight className="size-4" />
                          )}
                        </DirectionChip>
                        {transaction.description ?? "—"}
                      </span>
                    </Td>
                    <Td>{account?.name ?? "—"}</Td>
                    {/* Kategori silinmiş olabilir: #53'te `onDelete: SetNull` seçildi, işlem
                        kategorisiz kalır (bkz. README). "Kategorisiz", boş bir hücreden daha
                        anlaşılırdır. */}
                    <Td>
                      <CategoryBadge name={category?.name ?? null} />
                    </Td>
                    <Td>
                      <Badge tone={isIncome ? "mint" : "neutral"}>
                        {TYPE_LABELS[transaction.type] ?? transaction.type}
                      </Badge>
                    </Td>
                    {/* TUTAR HAM STRING OLARAK GÖSTERİLİR, `Intl.NumberFormat` ile DEĞİL:
                        biçimlendirme değeri önce `Number`'a çevirmeyi gerektirir ve bu, para
                        için yasak olan kayan nokta dönüşümünü (invariant #10) arayüz
                        katmanından geri getirirdi — hesap ekranındaki (#47) aynı karar. */}
                    <Td align="right">
                      <Money
                        value={transaction.amount}
                        currency={account?.currency ?? null}
                        direction={isIncome ? "in" : "out"}
                        size="lg"
                      />
                    </Td>
                    {canManage && (
                      <Td align="right">
                        <div className="flex items-center justify-end gap-3">
                          <Link
                            href={transactionsHref({ edit: transaction.id })}
                            className="text-sm font-medium text-brand-600 transition-colors duration-150 ease-out-soft hover:text-brand-700 dark:text-brand-300"
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
                      </Td>
                    )}
                  </Tr>
                );
              })}
              </Tbody>
            </Table>
          </TableScroll>

          {/* Sayfalama (Issue #135). "Sonraki sayfa" bir LİNKtir ve durum URL'dedir: her sayfa
              kendi adresine sahiptir, geri tuşu önceki sayfaya döner ve adres paylaşılabilir —
              filtrelerdeki (#56) aynı karar. Bu yüzden ayrı bir "Önceki" bağlantısı YOKTUR;
              onu eklemek, geri tuşunun zaten yaptığı işi imleç yığınını URL'de taşıyarak
              tekrarlamak olurdu.

              SAYFA NUMARASI DA YOK: keyset sayfalama toplam sayıyı bilmez ve öğrenmek her
              istekte ikinci bir tarama gerektirirdi (bkz. `TransactionPage`). */}
          {nextCursor && (
            <nav aria-label="Sayfalama" className="flex justify-end pt-4">
              <Link
                href={transactionsHref({ after: nextCursor })}
                className="inline-flex items-center gap-1 rounded-control border border-line bg-surface px-3.5 py-2 text-sm font-medium text-strong shadow-subtle transition-colors duration-150 ease-out-soft hover:bg-surface-muted"
              >
                Sonraki sayfa
                <IconChevronRight className="size-4 text-muted" />
              </Link>
            </nav>
          )}
        </>
      )}

      {/* Form yalnızca yetkili role render edilir. Bu bir güvenlik kontrolü DEĞİLDİR — asıl
          kontrol `requirePermission(MANAGE_TRANSACTIONS)`'tır (kanıt:
          `security/transaction-security.spec.ts`); buradaki amaç, MEMBER'a kesin 403 alacağı
          bir form göstermemektir. */}
      {canManage &&
        (accounts.length === 0 ? (
          // İşlem, hesapsız kaydedilemez (`accountId` zorunlu). Boş bir hesap seçicisi
          // göstermek yerine kullanıcı doğrudan çözüme yönlendirilir.
          <div className="rounded-panel border border-dashed border-line bg-surface px-5 py-6">
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <IconWallet className="size-4.5 shrink-0 text-brand-600" />
              İşlem kaydedebilmek için önce bir hesap gerekiyor.{" "}
              <Link
                href="/accounts"
                className="font-medium text-brand-600 underline-offset-4 hover:underline dark:text-brand-300"
              >
                Hesaplar ekranından oluşturun.
              </Link>
            </p>
          </div>
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
                href={transactionsHref()}
                className="inline-block text-sm font-medium text-muted underline-offset-4 hover:text-strong hover:underline"
              >
                Vazgeç
              </Link>
            )}
          </div>
        ))}
    </section>
  );
}
