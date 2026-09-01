import type { Metadata } from "next";

import { CategoryBadge } from "@/components/ui/badge";
import { DateRangeForm } from "@/components/ui/date-range-form";
import { EmptyState } from "@/components/ui/empty-state";
import { IconReports, IconWorkspace } from "@/components/ui/icons";
import { Money } from "@/components/ui/money";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/surfaces";
import { Table, TableScroll, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth/page-guard";
import { hasAllPermissions, PERMISSIONS } from "@/lib/authz/permissions";
import { currentMonthRange, resolveDateRange } from "@/lib/finance/aggregation";
import {
  getIncomeExpenseReport,
  type CurrencyReport,
  type ReportCategoryRow,
} from "@/lib/finance/income-expense-report";
import { resolveActiveTenantForUser } from "@/lib/tenants/tenant-context";

export const metadata: Metadata = {
  title: "Raporlar",
};

/**
 * Dönemsel gelir-gider raporu ekranı (Issue #67).
 *
 * PANELDEN FARKI: panel "şu an durum ne" der (bu ay, son altı ay, sabit pencereler); rapor
 * "SEÇTİĞİM dönemde ne oldu" der. Bu yüzden buradaki her sayı seçilen aralığa aittir ve
 * ekranın tamamı tek bir dönemi anlatır.
 *
 * TEK BİR HESAP YOK: bütün toplamlar `src/lib/finance/income-expense-report.ts`'ten gelir.
 * Sayfa yalnızca biçimlendirir — para aritmetiği sunum katmanına ait değildir.
 *
 * DÖNEM URL'DE (`?from=&to=`) ve çözümü panelle ORTAKTIR (`resolveDateRange`): aynı URL her
 * yerde aynı dönemi anlatmalı.
 *
 * `requirePageUser()` layout'ta zaten çağrıldığı hâlde BURADA DA çağrılır (gerekçe:
 * `src/lib/auth/page-guard.ts`).
 */
export default async function ReportsPage({
  searchParams,
}: {
  // Next.js 16'da `searchParams` bir Promise'tir ve değer tekrarlanan parametrede dizi olur.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requirePageUser();
  const active = await resolveActiveTenantForUser(user.id);

  if (!active) {
    return (
      <section className="space-y-8">
        <PageHeader title="Raporlar" />
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

  // Rapor üç modelin verisini birlikte açar (tutarlar, kategori adları, hesap adları) — API
  // route'undaki kuralın birebir aynısı.
  const canSeeReport = hasAllPermissions(role, [
    PERMISSIONS.VIEW_ACCOUNTS,
    PERMISSIONS.VIEW_TRANSACTIONS,
    PERMISSIONS.VIEW_CATEGORIES,
  ]);

  if (!canSeeReport) {
    return (
      <section className="space-y-8">
        <PageHeader title="Raporlar" />
        <EmptyState
          icon={<IconReports className="size-5" />}
          title="Görüntüleme yetkiniz yok"
          description="Rapor almak için yöneticinizden finansal verileri görüntüleme yetkisi isteyin."
        />
      </section>
    );
  }

  const params = await searchParams;
  const rawFrom = singleParam(params.from);
  const rawTo = singleParam(params.to);
  const isDefaultRange = params.from === undefined && params.to === undefined;

  // Ayrıştırma DB'ye gitmeden önce: aralık geçersizse hiçbir sorgu çalıştırmaya gerek yok.
  const parsed = resolveDateRange((key) => params[key], currentMonthRange());
  const report = parsed.ok ? await getIncomeExpenseReport(tenant.id, parsed.range) : null;

  // Aralık geçerliyken form değerleri SERVİSTEN gelir (kısmi aralık varsayılanla tamamlandığında
  // form da o tarihi göstermeli); geçersizken kullanıcının yazdığı ham metin korunur ki
  // düzeltmek için baştan yazmak zorunda kalmasın.
  const formValues = report
    ? { from: report.range.from, to: report.range.to }
    : { from: rawFrom, to: rawTo };

  return (
    <section className="space-y-8">
      <PageHeader
        title="Raporlar"
        description={
          <>
            <span className="font-medium text-strong">{tenant.name}</span> çalışma alanının
            seçilen dönemdeki gelir ve giderleri.
          </>
        }
      />

      <Panel>
        <div className="border-b border-line px-5 py-4">
          <DateRangeForm
            action="/reports"
            ariaLabel="Rapor dönemi"
            idPrefix="report"
            from={formValues.from}
            to={formValues.to}
            isDefaultRange={isDefaultRange}
            resetLabel="Bu aya dön"
          />
        </div>

        {!parsed.ok ? (
          <p role="status" className="px-5 py-10 text-center text-sm text-pretty text-muted">
            Dönem geçersiz olduğu için rapor gösterilmiyor. Tarihleri{" "}
            <span className="font-medium">GG.AA.YYYY</span> biçiminde seçin ve başlangıcın
            bitişten sonra olmadığından emin olun.
          </p>
        ) : report && report.currencies.length > 0 ? (
          <p className="px-5 py-3 text-xs text-muted">
            Dönem: <span className="font-medium text-body">{report.range.from}</span> —{" "}
            <span className="font-medium text-body">{report.range.to}</span> (iki uç da dahil)
          </p>
        ) : (
          <p className="px-5 py-10 text-center text-sm text-pretty text-muted">
            Seçilen dönemde hiç hareket yok. Dönemi genişletebilir ya da işlemler ekranından yeni
            kayıt ekleyebilirsiniz.
          </p>
        )}
      </Panel>

      {report?.currencies.map((currency) => (
        <CurrencyReportBlock key={currency.currency} report={currency} />
      ))}
    </section>
  );
}

/**
 * Bir arama parametresinin form alanına geri yazılacak hâli. Tekrarlanan parametre burada boşa
 * düşer — o durumda ayrıştırıcı zaten hata döndürüyor ve rapor gösterilmiyor; forma iki değerden
 * birini yazmak, reddedilen girdiyi "kabul edilmiş" gibi göstermek olurdu.
 */
function singleParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

/**
 * Tek bir para biriminin raporu.
 *
 * HER PARA BİRİMİ KENDİ BÖLÜMÜNDE — kur dönüşümü yok (#62'nin kararı), TRY ve USD toplamları
 * tek bir satırda birleştirilemez. Bölüm `aria-labelledby` ile adlandırılır: aynı tutar başka
 * bir para biriminin bölümünde de geçebilir, yapısal ayrım şart.
 */
function CurrencyReportBlock({ report }: { report: CurrencyReport }) {
  const headingId = `report-${report.currency}`;

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <h2 id={headingId} className="text-sm font-semibold text-strong">
        {report.currency} raporu
      </h2>

      <Panel>
        <dl className="grid gap-4 px-5 py-5 sm:grid-cols-4">
          <Stat label="Gelir" value={report.income} currency={report.currency} direction="in" />
          <Stat label="Gider" value={report.expense} currency={report.currency} direction="out" />
          {/* `net` MUTLAK değerdir, işareti `netDirection` taşır (#53'ün kuralı). */}
          <Stat
            label="Fark"
            value={report.net}
            currency={report.currency}
            direction={report.netDirection}
          />
          <div className="min-w-0">
            <dt className="text-xs text-muted">İşlem sayısı</dt>
            {/* Adet PARA DEĞİLDİR: `Money` ile değil düz sayı olarak basılır. */}
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-strong">
              {report.transactionCount}
            </dd>
          </div>
        </dl>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <CategoryTable
          title="Gelir kategorileri"
          rows={report.incomeByCategory}
          currency={report.currency}
          direction="in"
        />
        <CategoryTable
          title="Gider kategorileri"
          rows={report.expenseByCategory}
          currency={report.currency}
          direction="out"
        />
      </div>

      <Panel>
        <PanelHeader title="Hesap kırılımı" description="Bu para birimindeki hesaplar" />
        <TableScroll>
          <Table minWidth="34rem">
            <Thead>
              <Th>Hesap</Th>
              <Th align="right">Gelir</Th>
              <Th align="right">Gider</Th>
              <Th align="right">Fark</Th>
              <Th align="right">İşlem</Th>
            </Thead>
            <Tbody>
              {report.byAccount.map((row) => (
                <Tr key={row.accountId}>
                  <Td emphasis>{row.name}</Td>
                  <Td align="right">
                    <Money value={row.income} direction="in" />
                  </Td>
                  <Td align="right">
                    <Money value={row.expense} direction="out" />
                  </Td>
                  <Td align="right">
                    <Money value={row.net} direction={row.netDirection} />
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {row.transactionCount}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </TableScroll>
      </Panel>
    </section>
  );
}

function Stat({
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

/**
 * Kategori kırılımı tablosu.
 *
 * PARA BİRİMİ SÜTUNDA TEKRARLANMAZ: bölümün başlığı zaten "TRY raporu" diyor ve her satıra
 * "TRY" basmak, taranan kolonu gürültüye boğardı. Tutarların yönü ise satır başına anlamlıdır
 * (gelir tablosunda `+`, gider tablosunda `-`) ve korunur.
 */
function CategoryTable({
  title,
  rows,
  currency,
  direction,
}: {
  title: string;
  rows: ReportCategoryRow[];
  currency: string;
  direction: "in" | "out";
}) {
  return (
    <Panel>
      <PanelHeader
        title={title}
        description={rows.length === 0 ? undefined : `${currency} · paylar bu tablonun toplamına göre`}
      />

      {rows.length === 0 ? (
        // Boş bir tablo iskeleti yerine cümle: "bu dönemde bu yönde hiç hareket yok" bilgisi,
        // başlıkları olan ama satırı olmayan bir tablodan daha okunaklı.
        <p className="px-5 py-8 text-center text-sm text-muted">
          Bu dönemde {direction === "in" ? "gelir" : "gider"} hareketi yok.
        </p>
      ) : (
        <TableScroll>
          <Table minWidth="24rem">
            <Thead>
              <Th>Kategori</Th>
              <Th align="right">Tutar</Th>
              <Th align="right">Pay</Th>
            </Thead>
            <Tbody>
              {rows.map((row) => (
                <Tr key={row.categoryId ?? "uncategorized"}>
                  <Td>
                    {/* `CategoryBadge` "Kategorisiz"i kendisi biliyor — sözcük tek yerde. */}
                    <CategoryBadge name={row.name} />
                  </Td>
                  <Td align="right">
                    <Money value={row.amount} direction={direction} />
                  </Td>
                  <Td align="right" className="tabular-nums">
                    %{row.sharePercent}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </TableScroll>
      )}
    </Panel>
  );
}

