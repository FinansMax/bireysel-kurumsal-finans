import type { MembershipRole } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge, CategoryBadge } from "@/components/ui/badge";
import { DateRangeForm } from "@/components/ui/date-range-form";
import { DonutChart, type DonutSlice } from "@/components/ui/donut-chart";
import { EmptyState } from "@/components/ui/empty-state";
import {
  IconArrowDownRight,
  IconArrowUpRight,
  IconCheck,
  IconChevronRight,
  IconTag,
  IconTransactions,
  IconWallet,
  IconWorkspace,
} from "@/components/ui/icons";
import { DirectionChip, Money } from "@/components/ui/money";
import { formatDateInTimeZone } from "@/lib/time/tenant-time";
import { IconTile, PageHeader, Panel, PanelHeader } from "@/components/ui/surfaces";
import { TrendChart, type TrendBar } from "@/components/ui/trend-chart";
import { requirePageUser } from "@/lib/auth/page-guard";
import { hasAllPermissions, hasPermission, PERMISSIONS } from "@/lib/authz/permissions";
import { listAccounts } from "@/lib/finance/account";
import { listCategories } from "@/lib/finance/category";
import {
  getDashboardSummary,
  type CurrencyBalance,
  type CurrencyTrend,
  type DashboardSummary,
} from "@/lib/finance/dashboard";
import { resolveDateRange } from "@/lib/finance/aggregation";
import {
  defaultSpendingRange,
  getSpendingByCategory,
  type SpendingByCategory,
  type SpendingRange,
} from "@/lib/finance/spending-by-category";
import { listTransactions } from "@/lib/finance/transaction";
import { resolveActiveTenantForUser } from "@/lib/tenants/tenant-context";

export const metadata: Metadata = {
  title: "Genel Bakış",
};

/**
 * Korumalı alanın giriş sayfası (Issue #39, #63).
 *
 * TÜM ÖZET DEĞERLER `src/lib/finance/dashboard.ts`'TEN GELİR. Bu sayfada tek bir toplama,
 * çıkarma ya da oran hesabı yoktur — para aritmetiği bir iş kuralıdır ve sunum katmanına ait
 * değildir (#62'nin konusu). Burada yapılan tek "hesap", sayıların SIFIR olup olmadığına
 * bakmaktır (hangi bölümün render edileceği kararı).
 *
 * FARKLI PARA BİRİMLERİ TOPLANMAZ. Üründe kur dönüşümü yoktur; bu yüzden ekranda "toplam
 * bakiye" diye TEK bir sayı yoktur, her para birimi kendi kartına ve kendi grafiğine sahiptir.
 * Gerekçenin tamamı servis modülünün başındadır.
 *
 * SAHTE VERİ YOKTUR: bir bölümün göstereceği gerçek veri yoksa o bölüm render EDİLMEZ; yerine
 * ne yapılacağını söyleyen bir yönlendirme gelir.
 *
 * HARCAMA DÖNEMİ URL'DEDİR (`?from=&to=`, Issue #65) — React state'inde değil. `/transactions`
 * ekranındaki (#56) aynı karar ve aynı ayrıştırıcı: aynı URL, API'de ve ekranda aynı sonucu
 * vermelidir. Ayrıştırıcıya YALNIZCA `from`/`to` sorulur; işlem listesine özgü diğer filtreler
 * (`accountId`, `q`, `after`) bu ekranda anlamsızdır ve sessizce yok sayılır.
 *
 * `requirePageUser()` layout'ta zaten çağrıldığı hâlde BURADA DA çağrılır: layout'lar istemci
 * tarafı gezinmelerde yeniden render edilmediği ve alt segmentlerin render'ını engelleyemediği
 * için layout kontrolü tek başına yeterli değildir (bkz. `src/lib/auth/page-guard.ts`).
 */
export default async function DashboardPage({
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
  const canViewCategories = hasPermission(role, PERMISSIONS.VIEW_CATEGORIES);
  const canViewTransactions = hasPermission(role, PERMISSIONS.VIEW_TRANSACTIONS);

  // Özet ÜÇ modelin verisini birleştirir; bu yüzden üç görüntüleme izninin tamamı aranır —
  // API'deki (`/api/tenants/[tenantId]/dashboard/summary`) kuralın birebir aynısı. Bugün üç
  // rolün üçü de bu izinlere sahip; kontrol matris değiştiğinde anlam kazanır.
  const canSeeSummary = hasAllPermissions(role, [
    PERMISSIONS.VIEW_ACCOUNTS,
    PERMISSIONS.VIEW_TRANSACTIONS,
    PERMISSIONS.VIEW_CATEGORIES,
  ]);

  // Harcama dönemi. Ayrıştırma DB'ye gitmeden önce yapılır: aralık geçersizse hiçbir sorgu
  // çalıştırmaya gerek yok (route'taki "ucuz şekil kontrolü en üstte" sırasının sayfa
  // karşılığı).
  const params = await searchParams;
  const spendingRange = resolveSpendingRange(params);

  // Yetkisi olmayan role o veriyi HİÇ çekmeyiz: gizlemek değil, sormamak doğru olan.
  const [summary, spending, accounts, transactionPage, categories] = await Promise.all([
    canSeeSummary ? getDashboardSummary(tenant.id) : Promise.resolve(null),
    canSeeSummary && spendingRange.ok
      ? getSpendingByCategory(tenant.id, spendingRange.range)
      : Promise.resolve(null),
    canViewAccounts ? listAccounts(tenant.id) : Promise.resolve([]),
    canViewTransactions
      ? listTransactions(tenant.id)
      : Promise.resolve({ transactions: [], nextCursor: null }),
    canViewCategories ? listCategories(tenant.id) : Promise.resolve([]),
  ]);

  if (!canViewAccounts && !canViewTransactions) {
    return (
      <section className="space-y-8">
        <PageHeader title="Genel Bakış" />
        <EmptyState
          icon={<IconWorkspace className="size-5" />}
          title="Görüntüleme yetkiniz yok"
          description="Bu çalışma alanındaki finansal verileri görmek için yöneticinizden yetki isteyin."
        />
      </section>
    );
  }

  // Hiç işlem yoksa akış panelleri ve son hareketler yerine ONBOARDING gösterilir: sıfırlarla
  // dolu bir grafik, "veri yok" demenin en kötü yoludur — ekranı doldurur ama hiçbir şey
  // söylemez ve kullanıcıya ne yapacağını da anlatmaz.
  const onboarding = summary !== null && summary.counts.transactions === 0;

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

      {summary ? (
        <>
          {summary.balancesByCurrency.length > 0 ? (
            <BalanceSection balances={summary.balancesByCurrency} />
          ) : null}

          <CountsPanel counts={summary.counts} />

          {onboarding ? (
            <OnboardingPanel counts={summary.counts} role={role} />
          ) : (
            <>
              <FlowSection summary={summary} />
              <SpendingSection range={spendingRange} spending={spending} />
            </>
          )}
        </>
      ) : null}

      {canViewAccounts && (accounts.length > 0 || summary === null) ? (
        <AccountsSection
          accounts={accounts}
          canManage={hasPermission(role, PERMISSIONS.MANAGE_ACCOUNTS)}
        />
      ) : null}

      {canViewTransactions && !onboarding ? (
        <RecentSection
          rows={recent}
          accountsById={accountsById}
          categoryNames={categoryNames}
          hasAccounts={accounts.length > 0}
          timeZone={tenant.timeZone}
        />
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------------------------------
 * Ay etiketleri
 * --------------------------------------------------------------------------------------- */

/**
 * Ay adları SABİT bir dizidir, `toLocaleDateString()` DEĞİL.
 *
 * Aynı gerekçe işlem tarihlerinde de geçerli (#54): yerelleştirme çıktıyı çalıştığı ortamın
 * saat dilimine ve ICU sürümüne bağlar; iki farklı sunucu aynı veriyi farklı yazabilir.
 * Servis `YYYY-MM` (UTC) üretir, burada yalnızca okunur hâle getirilir.
 */
const MONTH_SHORT_NAMES = [
  "Oca",
  "Şub",
  "Mar",
  "Nis",
  "May",
  "Haz",
  "Tem",
  "Ağu",
  "Eyl",
  "Eki",
  "Kas",
  "Ara",
] as const;

const MONTH_LONG_NAMES = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
] as const;

/** `"2026-03"` → ay indeksi (0-11). Ay STRING'inden okunur; tarih nesnesi kurulmaz. */
function monthIndex(month: string): number {
  return Number(month.slice(5, 7)) - 1;
}

function shortMonthLabel(month: string): string {
  return MONTH_SHORT_NAMES[monthIndex(month)] ?? month;
}

function longMonthLabel(month: string): string {
  const name = MONTH_LONG_NAMES[monthIndex(month)];
  return name ? `${name} ${month.slice(0, 4)}` : month;
}

/* ------------------------------------------------------------------------------------------
 * Bölümler
 * --------------------------------------------------------------------------------------- */

/**
 * Para birimi başına toplam bakiye.
 *
 * BU EKRANIN EN ÖNEMLİ KARARI BURADA GÖRÜNÜR: birden fazla para birimi varsa birden fazla kart
 * vardır. Tek bir "toplam" kartı, kur dönüşümü olmadan uydurma bir sayı olurdu; alt başlık bunu
 * kullanıcıya da açıkça söyler.
 */
function BalanceSection({ balances }: { balances: ReadonlyArray<CurrencyBalance> }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-strong">Bakiye</h2>
        <p className="text-xs text-muted">
          {balances.length > 1
            ? "Para birimleri ayrı toplanır — kur dönüşümü yapılmaz."
            : "Hesaplarınızın toplamı."}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {balances.map((balance, index) => (
          <Panel key={balance.currency} tone={index === 0 ? "accent" : "plain"} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <IconTile tone={index === 0 ? "brand" : "neutral"}>
                <IconWallet className="size-4.5" />
              </IconTile>
              <Badge tone="outline">{balance.accountCount} hesap</Badge>
            </div>

            <p className="mt-4 text-xs text-muted">Toplam bakiye</p>
            <div className="mt-0.5">
              {/* Tutar SAYIYA ÇEVRİLMEZ; `Money` ham string'i tipografik olarak biçimler. */}
              <Money value={balance.balance} currency={balance.currency} size="xl" />
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

/** Kayıt sayıları. Para değil, adet — bu yüzden `Money` değil düz sayı. */
function CountsPanel({ counts }: { counts: DashboardSummary["counts"] }) {
  const items = [
    { label: "Hesap", value: counts.accounts, href: "/accounts", icon: <IconWallet className="size-4.5" />, tone: "brand" as const },
    { label: "İşlem", value: counts.transactions, href: "/transactions", icon: <IconTransactions className="size-4.5" />, tone: "mint" as const },
    { label: "Kategori", value: counts.categories, href: "/categories", icon: <IconTag className="size-4.5" />, tone: "iris" as const },
  ];

  return (
    <Panel>
      <ul className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {items.map((item) => (
          <li key={item.label}>
            <Link
              href={item.href}
              className="flex items-center gap-3 px-5 py-4 transition-colors duration-150 ease-out-soft hover:bg-surface-muted/70"
            >
              <IconTile tone={item.tone}>{item.icon}</IconTile>
              <span className="min-w-0">
                <span className="block text-xs text-muted">{item.label}</span>
                <span className="block text-lg font-semibold tabular-nums text-strong">
                  {item.value}
                </span>
              </span>
              <IconChevronRight className="ml-auto size-4 shrink-0 text-faint" />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/**
 * Para birimi başına akış: bu ayın gelir/gider/farkı + son altı ayın trendi.
 *
 * HER PARA BİRİMİ KENDİ PANELİNDE. Alternatif — tek grafikte para birimi seçici — bir client
 * component ve bir durum yönetimi demekti; ayrı paneller sunucuda render edilir, JavaScript'siz
 * çalışır ve iki para biriminin AYNI ANDA görünmesini sağlar. Tek para birimi olan (yani
 * kullanıcıların çoğunluğu için) ekranda tek panel vardır, hiçbir fark hissedilmez.
 */
function FlowSection({ summary }: { summary: DashboardSummary }) {
  if (summary.trend.series.length === 0) {
    return (
      <EmptyState
        icon={<IconTransactions className="size-5" />}
        title="Son altı ayda hareket yok"
        description="Kayıtlı işlemleriniz bu pencerenin dışında kalıyor. Tümünü işlemler ekranından görebilirsiniz."
        action={{ label: "İşlemlere git", href: "/transactions" }}
      />
    );
  }

  const flowByCurrency = new Map(
    summary.currentMonth.flows.map((flow) => [flow.currency, flow]),
  );

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-strong">Gelir ve gider</h2>

      <div className={`grid gap-4 ${summary.trend.series.length > 1 ? "xl:grid-cols-2" : ""}`}>
        {summary.trend.series.map((series) => (
          <CurrencyFlowPanel
            key={series.currency}
            series={series}
            month={summary.currentMonth.month}
            // Seride hareketi olan ama BU AY hareketi olmayan para birimi için sıfır gösterilir
            // — panelin kendisi de kaybolmaz, çünkü grafiği hâlâ anlamlıdır.
            flow={
              flowByCurrency.get(series.currency) ?? {
                currency: series.currency,
                income: "0",
                expense: "0",
                net: "0",
                netDirection: "in" as const,
              }
            }
          />
        ))}
      </div>
    </div>
  );
}

function CurrencyFlowPanel({
  series,
  month,
  flow,
}: {
  series: CurrencyTrend;
  month: string;
  flow: { income: string; expense: string; net: string; netDirection: "in" | "out" };
}) {
  const bars: TrendBar[] = series.points.map((point) => ({
    label: shortMonthLabel(point.month),
    description: `${longMonthLabel(point.month)}: gelir ${point.income} ${series.currency}, gider ${point.expense} ${series.currency}`,
    incomePercent: point.incomePercent,
    expensePercent: point.expensePercent,
  }));

  return (
    <Panel>
      <PanelHeader
        title={`${series.currency} akışı`}
        description={`${longMonthLabel(month)} ve önceki beş ay`}
      />

      <div className="space-y-6 px-5 py-5">
        <dl className="grid grid-cols-3 gap-3">
          <FlowStat label="Bu ay gelir" value={flow.income} currency={series.currency} direction="in" />
          <FlowStat label="Bu ay gider" value={flow.expense} currency={series.currency} direction="out" />
          {/* `net` MUTLAK değerdir, işareti `netDirection` taşır (#53'ün kuralı) — bu yüzden
              `Money`ye yön prop'u olarak verilir, string'in başındaki eksi aranmaz. */}
          <FlowStat
            label="Fark"
            value={flow.net}
            currency={series.currency}
            direction={flow.netDirection}
          />
        </dl>

        <TrendChart bars={bars} />
      </div>
    </Panel>
  );
}

function FlowStat({
  label,
  value,
  currency,
  direction,
}: {
  label: string;
  value: string;
  currency: string;
  direction: "in" | "out";
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">
        <Money value={value} currency={currency} direction={direction} size="lg" />
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------
 * Harcama dağılımı (Issue #65)
 * --------------------------------------------------------------------------------------- */

type ResolvedSpendingRange =
  | { ok: true; range: SpendingRange; isDefault: boolean }
  | { ok: false; from: string; to: string; isDefault: boolean };

/**
 * Bir arama parametresinin form alanına geri yazılacak hâli.
 *
 * Tekrarlanan parametre (`?from=a&from=b`) burada boşa düşer — o durumda ayrıştırıcı zaten hata
 * döndürüyor ve dağılım gösterilmiyor; forma iki değerden birini seçip yazmak, kullanıcıya
 * reddedilen girdisini "kabul edilmiş" gibi göstermek olurdu (`/transactions`'taki aynı not).
 */
function singleParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

/**
 * `?from=&to=` → dönem. Çözüm ORTAKTIR (`resolveDateRange`): API route'u, rapor ekranı (#67) ve
 * bu sayfa aynı kuralları paylaşır — aynı biçim, aynı "tekrarlanan parametre hatadır", kısmi
 * aralığın varsayılanla tamamlanması ve birleştirmeden SONRAKİ ters aralık kontrolü.
 *
 * Buradaki ek iş yalnızca SUNUMA aittir: forma geri yazılacak ham değerler ve "varsayılan
 * dönemde miyiz" bilgisi.
 */
function resolveSpendingRange(params: {
  [key: string]: string | string[] | undefined;
}): ResolvedSpendingRange {
  const rawFrom = singleParam(params.from);
  const rawTo = singleParam(params.to);
  const isDefault = params.from === undefined && params.to === undefined;

  const parsed = resolveDateRange((key) => params[key], defaultSpendingRange());
  if (!parsed.ok) {
    return { ok: false, from: rawFrom, to: rawTo, isDefault };
  }

  return { ok: true, range: parsed.range, isDefault };
}

/**
 * Kategori bazlı harcama dağılımı.
 *
 * YALNIZCA GİDER — panelin başlığı bunu söylüyor, alt başlığı da tekrar ediyor. Gelirleri de
 * halkaya koymak "harcamanın %40'ı kira" gibi her cümleyi anlamsızlaştırırdı (gerekçenin tamamı
 * `src/lib/finance/spending-by-category.ts`'te).
 *
 * PARA BİRİMİ BAŞINA AYRI HALKA — `FlowSection` ile aynı karar ve aynı gerekçe: kur dönüşümü
 * yok, TRY ve USD harcamaları tek dağılımda toplanamaz.
 */
function SpendingSection({
  range,
  spending,
}: {
  range: ResolvedSpendingRange;
  spending: SpendingByCategory | null;
}) {
  // Aralık geçerliyken form değerleri SERVİSTEN gelir (`spending.range`), kullanıcının yazdığı
  // ham metinden değil: eksik uç varsayılanla tamamlandığında form da o tamamlanmış tarihi
  // göstermeli, boş kalmamalı.
  const formValues = range.ok
    ? { from: spending?.range.from ?? "", to: spending?.range.to ?? "" }
    : { from: range.from, to: range.to };

  return (
    // ADLANDIRILMIŞ BİR BÖLGE (`aria-labelledby` ile `role="region"`): panelin en karmaşık
    // bölümü burasıdır — kendi formu, kendi dönemi ve iki grafiği vardır. Ekran okuyucu
    // kullanıcısının buraya doğrudan atlayabilmesi ve "hangi tutar hangi bölüme ait" sorusunun
    // yapısal bir cevabı olması için. (E2E de bölümü bu adla kapsıyor; aynı tutar panelin
    // başka yerlerinde de geçebiliyor.)
    <section aria-labelledby="spending-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="spending-heading" className="text-sm font-semibold text-strong">
          Harcama dağılımı
        </h2>
        <p className="text-xs text-muted">Yalnızca gider işlemleri.</p>
      </div>

      <Panel>
        <div className="border-b border-line px-5 py-4">
          <DateRangeForm
            action="/dashboard"
            ariaLabel="Harcama dönemi"
            idPrefix="spending"
            from={formValues.from}
            to={formValues.to}
            isDefaultRange={range.isDefault}
            resetLabel="Bu aya dön"
          />
        </div>

        {!range.ok ? (
          <p
            role="status"
            className="px-5 py-8 text-center text-sm text-pretty text-muted"
          >
            Dönem geçersiz olduğu için dağılım gösterilmiyor. Tarihleri{" "}
            <span className="font-medium">GG.AA.YYYY</span> biçiminde seçin ve başlangıcın
            bitişten sonra olmadığından emin olun.
          </p>
        ) : spending === null || spending.currencies.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-pretty text-muted">
            Seçilen dönemde gider işlemi yok. Dönemi genişletebilir ya da bu aya
            dönebilirsiniz.
          </p>
        ) : (
          <div className="divide-y divide-line">
            {spending.currencies.map((currency) => (
              <CurrencySpendingBlock key={currency.currency} spending={currency} />
            ))}
          </div>
        )}
      </Panel>
    </section>
  );
}

function CurrencySpendingBlock({
  spending,
}: {
  spending: SpendingByCategory["currencies"][number];
}) {
  const slices: DonutSlice[] = spending.slices.map((slice) => ({
    // "Kategorisiz" bir kategori DEĞİLDİR, kategorinin yokluğudur — `CategoryBadge` ile aynı
    // sözcük kullanılır ki kullanıcı iki ekranda iki farklı ad görmesin.
    label: slice.name ?? "Kategorisiz",
    // Tutar `Money`ye ham string olarak verilir; hiçbir yerde sayıya çevrilmez.
    // Yön prop'u YOK: bu panelin tamamı gider: her satıra bir eksi basmak, aynı şeyi
    // ikinci kez söylemek olurdu.
    value: <Money value={slice.amount} currency={spending.currency} />,
    sharePercent: slice.sharePercent,
    offsetPercent: slice.offsetPercent,
  }));

  return (
    <div className="space-y-4 px-5 py-5">
      <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">
        {spending.currency}
      </h3>
      <DonutChart
        slices={slices}
        centerLabel="Toplam gider"
        centerValue={<Money value={spending.total} currency={spending.currency} />}
      />
    </div>
  );
}

/**
 * Yeni çalışma alanı için sıralı yönlendirme (#63).
 *
 * ÖRNEK RAKAM GÖSTERİLMEZ. "Demo veri" ile dolu bir panel, kullanıcının kendi parasıyla
 * karıştırabileceği bir yalandır; burada ekranı dolduran şey veri değil, YAPILACAK İŞTİR.
 *
 * ADIM SIRASI ZORUNLU BİR BAĞIMLILIKTIR, süsleme değil: işlem bir hesaba bağlanmak
 * zorundadır (şemadaki `accountId` zorunlu alanı), kategori ise opsiyoneldir ama işlem
 * kaydederken seçilir. Bu yüzden hesap → kategori → işlem.
 *
 * EYLEM YETKİYE BAĞLIDIR (`EmptyState` ile aynı duruş): MEMBER'a kesin 403 alacağı bir yola
 * "başla" demek, yardım değil tuzaktır.
 */
function OnboardingPanel({
  counts,
  role,
}: {
  counts: DashboardSummary["counts"];
  role: MembershipRole;
}) {
  const steps = [
    {
      title: "Hesap oluştur",
      description: "Banka hesabı ya da kasa. Her hareket bir hesaba bağlanır.",
      href: "/accounts",
      done: counts.accounts > 0,
      allowed: hasPermission(role, PERMISSIONS.MANAGE_ACCOUNTS),
    },
    {
      title: "Kategori oluştur",
      description: "Gelir ve gider kategorileri, hareketleri sınıflandırmanızı sağlar.",
      href: "/categories",
      done: counts.categories > 0,
      allowed: hasPermission(role, PERMISSIONS.MANAGE_CATEGORIES),
    },
    {
      title: "İlk işlemi ekle",
      description: "Bir gelir ya da gider kaydedin; bakiye ve grafikler anında oluşur.",
      href: "/transactions",
      done: counts.transactions > 0,
      allowed: hasPermission(role, PERMISSIONS.MANAGE_TRANSACTIONS),
    },
  ];

  // Sıradaki adım = tamamlanmamış İLK adım. Kullanıcıya aynı anda tek bir eylem gösterilir;
  // üç düğme birden, "hangisinden başlayacağım" sorusunu geri getirirdi.
  const nextIndex = steps.findIndex((step) => !step.done);

  return (
    <Panel tone="accent">
      <PanelHeader
        title="İlk adımlar"
        description="Panelin sayıları, siz veri girdikçe kendiliğinden oluşur."
      />

      <ol className="divide-y divide-line">
        {steps.map((step, index) => {
          const isNext = index === nextIndex;

          return (
            <li key={step.title} className="flex items-start gap-3 px-5 py-4">
              <span
                className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  step.done
                    ? "bg-mint-100 text-mint-700 dark:bg-mint-950 dark:text-mint-300"
                    : isNext
                      ? "bg-brand-600 text-white"
                      : "bg-surface-inset text-faint"
                }`}
              >
                {step.done ? <IconCheck className="size-4" /> : index + 1}
              </span>

              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-medium ${step.done ? "text-muted line-through" : "text-strong"}`}
                >
                  {step.title}
                </p>
                <p className="mt-0.5 text-sm text-pretty text-muted">{step.description}</p>
              </div>

              {isNext && step.allowed ? (
                <Link
                  href={step.href}
                  className="shrink-0 rounded-control bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors duration-150 ease-out-soft hover:bg-brand-700"
                >
                  Başla
                </Link>
              ) : null}
            </li>
          );
        })}
      </ol>

      {nextIndex !== -1 && !steps[nextIndex].allowed ? (
        <p className="border-t border-line px-5 py-3 text-xs text-muted">
          Bu adımı tamamlamak için yönetim yetkisi gerekir; çalışma alanı yöneticinizden
          isteyebilirsiniz.
        </p>
      ) : null}
    </Panel>
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
        {accounts.slice(0, 6).map((account) => (
          <Panel key={account.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <IconTile tone="neutral">
                <IconWallet className="size-4.5" />
              </IconTile>
              <Badge tone="outline">{TYPE_LABELS[account.type] ?? account.type}</Badge>
            </div>

            <p className="mt-4 truncate text-sm font-medium text-strong">{account.name}</p>
            <div className="mt-1">
              {/* Bakiye SAYIYA ÇEVRİLMEZ; `Money` ham string'i tipografik olarak biçimler. */}
              <Money value={account.balance} currency={account.currency} size="lg" />
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
  timeZone,
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
  timeZone: string;
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
                  {/* `occurredAt` bir ANDIR: hangi güne düştüğü TENANT'IN saat diliminde
                      yorumlanır (#134). Önceki `toISOString().slice(0, 10)` daima UTC gününü
                      basıyordu — aynı kayıt işlemler listesinde bir gün, burada başka bir gün
                      görünebiliyordu. `toLocaleDateString()` hâlâ kullanılmıyor: çıktıyı
                      sunucunun locale'ine bağlardı (#54'ün kararı). */}
                  <span className="text-xs text-faint">
                    {formatDateInTimeZone(row.occurredAt, timeZone)}
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
