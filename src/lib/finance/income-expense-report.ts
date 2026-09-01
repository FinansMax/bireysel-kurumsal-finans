import { CategoryType, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { tenantScoped } from "@/lib/tenancy/scope";

import {
  compareByAmountThenName,
  compareCurrencyCode,
  percentOf,
  toIsoDate,
  type DateRange,
} from "./aggregation";
import { nextDay } from "./transaction";

/**
 * Dönemsel gelir-gider raporu — Issue #67.
 *
 * TENANT İZOLASYONU: `dashboard.ts`/`spending-by-category.ts` ile aynı desen — her sorgu
 * `tenantScoped()` üzerinden geçer ve modül SALT OKUNURDUR. `tenantId` daima çağıranın
 * `requirePermission()` context'inden gelir.
 *
 * ---
 *
 * TEK BİR AGGREGATE SORGUSU. `groupBy(["accountId", "categoryId", "type"])` bu raporun
 * ihtiyaç duyduğu HER kırılımı aynı anda üretir: toplamlar (tümünü katla), kategori kırılımı
 * (kategoriye göre katla), hesap kırılımı (hesaba göre katla) ve yön ayrımı (`type`).
 *
 * AY BAZLI SATIRLAR BİLEREK YOK. Ay kırılımı `date_trunc` ister (ham SQL yasak) ya da ay
 * başına bir sorgu (panelin altı sabit ayında kabul edilebilir, ama BURADA aralık serbesttir —
 * beş yıllık bir dönem altmış sorgu demek olurdu). Panelde zaten son altı ayın trendi var
 * (#63); bu rapor "seçilen dönemde ne oldu" sorusunu yanıtlar, "aylar nasıl değişti"yi değil.
 *
 * PARA BİRİMLERİ AYRI — kur dönüşümü yok (#62'nin kararı). İşlemin para birimi bağlı olduğu
 * `Account.currency`dir; gruplama `accountId` üzerinden yapılır, katlama `Prisma.Decimal` ile
 * tamamlanır ve hiçbir noktada `number`a dönüşülmez (invariant #10).
 *
 * TARİH ARALIĞI SÖZLEŞMESİ ORTAKTIR: `from`/`to` DAHİLDİR, üst sınır `nextDay()` ile uygulanır
 * (bkz. `transaction.ts`).
 */

/** Kategori (ya da hesap) kırılımının tek satırı. */
export type ReportCategoryRow = {
  /** `null` = kategorisiz (hiç seçilmemiş ya da kategori silinmiş — `SetNull`, #53). */
  categoryId: string | null;
  name: string | null;
  amount: string;
  /** KENDİ YÖNÜNÜN toplamına göre pay (`0.00`–`100.00`): gider satırı gider toplamına oranlanır. */
  sharePercent: string;
};

export type ReportAccountRow = {
  accountId: string;
  name: string;
  income: string;
  expense: string;
  /** Mutlak değer; işareti `netDirection` taşır (#53'ün kuralı). */
  net: string;
  netDirection: "in" | "out";
  transactionCount: number;
};

export type CurrencyReport = {
  currency: string;
  income: string;
  expense: string;
  net: string;
  netDirection: "in" | "out";
  transactionCount: number;
  /** Tutara göre azalan; kategorisiz sona. Boş olabilir (o yönde hiç hareket yoksa). */
  incomeByCategory: ReportCategoryRow[];
  expenseByCategory: ReportCategoryRow[];
  /** Hesap adına göre artan — rapor okuyan göz burada sıralamayı değil KARŞILAŞTIRMAYI arar. */
  byAccount: ReportAccountRow[];
};

export type IncomeExpenseReport = {
  /** Uygulanan aralık, `YYYY-MM-DD` (ikisi de DAHİL). */
  range: { from: string; to: string };
  /** YALNIZCA aralıkta hareketi olan para birimleri. Boş dizi = dönemde hiç hareket yok. */
  currencies: CurrencyReport[];
};

export type ReportRange = DateRange;

const ZERO = new Prisma.Decimal(0);

type Flow = { income: Prisma.Decimal; expense: Prisma.Decimal; count: number };

function emptyFlow(): Flow {
  return { income: ZERO, expense: ZERO, count: 0 };
}

/** `Prisma.Decimal` değişmezdir: `plus()` yeni örnek döner, paylaşılan `ZERO` bozulmaz. */
function addTo(flow: Flow, type: CategoryType, amount: Prisma.Decimal, count: number): void {
  if (type === CategoryType.INCOME) {
    flow.income = flow.income.plus(amount);
  } else {
    flow.expense = flow.expense.plus(amount);
  }
  flow.count += count;
}

/**
 * Gelir − gider. Tutar MUTLAK döner, işareti `netDirection` taşır — kod tabanının kendi
 * kuralının (`Transaction.amount` daima pozitif, yönü `type` taşır, #53) rapor karşılığı.
 */
function netOf(flow: Flow): { net: string; netDirection: "in" | "out" } {
  const net = flow.income.minus(flow.expense);
  return { net: net.abs().toString(), netDirection: net.isNegative() ? "out" : "in" };
}

/** Kategorisiz kova; `Map` anahtarı `null` olamadığı için boş string kullanılır. */
const UNCATEGORIZED = "";

function toCategoryRows(
  buckets: Map<string, Prisma.Decimal>,
  nameByCategoryId: Map<string, string>,
  total: Prisma.Decimal,
): ReportCategoryRow[] {
  return [...buckets.entries()]
    .map(([key, amount]) => ({
      categoryId: key === UNCATEGORIZED ? null : key,
      name: key === UNCATEGORIZED ? null : (nameByCategoryId.get(key) ?? null),
      amount,
    }))
    .sort(compareByAmountThenName)
    .map((entry) => ({
      categoryId: entry.categoryId,
      name: entry.name,
      amount: entry.amount.toString(),
      sharePercent: percentOf(entry.amount, total),
    }));
}

export async function getIncomeExpenseReport(
  tenantId: string,
  range: ReportRange,
): Promise<IncomeExpenseReport> {
  const groups = await prisma.transaction.groupBy({
    by: ["accountId", "categoryId", "type"],
    where: tenantScoped(tenantId, {
      occurredAt: { gte: range.from, lt: nextDay(range.to) },
    }),
    _sum: { amount: true },
    _count: true,
  });

  // Hesap ve kategori adları groupBy'DAN SONRA okunur (`dashboard.ts`'teki aynı gerekçe):
  // paralel okunsalardı, araya giren yeni bir hesap groupBy'da görünüp haritada olmayabilir ve
  // o para biriminin toplamı sessizce eksik kalırdı.
  const [accounts, categories] = await Promise.all([
    prisma.account.findMany({
      where: tenantScoped(tenantId, {}),
      select: { id: true, name: true, currency: true },
    }),
    prisma.category.findMany({
      where: tenantScoped(tenantId, {}),
      select: { id: true, name: true },
    }),
  ]);

  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const nameByCategoryId = new Map(categories.map(({ id, name }) => [id, name]));

  type CurrencyBuckets = {
    totals: Flow;
    incomeByCategory: Map<string, Prisma.Decimal>;
    expenseByCategory: Map<string, Prisma.Decimal>;
    byAccount: Map<string, Flow>;
  };

  const byCurrency = new Map<string, CurrencyBuckets>();

  for (const group of groups) {
    const account = accountById.get(group.accountId);
    if (!account) {
      // Ulaşılamaz olmalı (okuma sırası + `onDelete: NoAction`). Yine de burada DURMAK yanlış
      // olurdu: rapor tek bir tutarsız satır yüzünden hiç açılmamalı.
      continue;
    }

    const amount = group._sum.amount ?? ZERO;
    const count = group._count;

    const buckets: CurrencyBuckets = byCurrency.get(account.currency) ?? {
      totals: emptyFlow(),
      incomeByCategory: new Map(),
      expenseByCategory: new Map(),
      byAccount: new Map(),
    };

    addTo(buckets.totals, group.type, amount, count);

    const accountFlow = buckets.byAccount.get(account.id) ?? emptyFlow();
    addTo(accountFlow, group.type, amount, count);
    buckets.byAccount.set(account.id, accountFlow);

    // Kategori kaydı bulunamıyorsa (okuma arasında silinmiş olabilir) satır KATEGORİSİZ kovasına
    // katlanır — "bilinmeyen kategori" diye sahte bir satır üretmek yerine, kaydın birazdan
    // DB'de de alacağı hâl (`SetNull`) gösterilir.
    const categoryKey =
      group.categoryId && nameByCategoryId.has(group.categoryId)
        ? group.categoryId
        : UNCATEGORIZED;

    const categoryBuckets =
      group.type === CategoryType.INCOME ? buckets.incomeByCategory : buckets.expenseByCategory;
    categoryBuckets.set(categoryKey, (categoryBuckets.get(categoryKey) ?? ZERO).plus(amount));

    byCurrency.set(account.currency, buckets);
  }

  const currencies: CurrencyReport[] = [...byCurrency.entries()]
    .sort(([a], [b]) => compareCurrencyCode(a, b))
    .map(([currency, buckets]) => ({
      currency,
      income: buckets.totals.income.toString(),
      expense: buckets.totals.expense.toString(),
      ...netOf(buckets.totals),
      transactionCount: buckets.totals.count,
      incomeByCategory: toCategoryRows(
        buckets.incomeByCategory,
        nameByCategoryId,
        buckets.totals.income,
      ),
      expenseByCategory: toCategoryRows(
        buckets.expenseByCategory,
        nameByCategoryId,
        buckets.totals.expense,
      ),
      byAccount: [...buckets.byAccount.entries()]
        .map(([accountId, flow]) => ({
          accountId,
          name: accountById.get(accountId)?.name ?? "",
          income: flow.income.toString(),
          expense: flow.expense.toString(),
          ...netOf(flow),
          transactionCount: flow.count,
        }))
        // Hesaplar ADA göre sıralanır, tutara göre DEĞİL: kategori kırılımında soru "en büyük
        // kalem hangisi", hesap kırılımında ise "şu hesapta ne oldu" — ad, aranan satırı
        // bulmanın en hızlı yoludur ve dönem değiştikçe sıra oynamaz.
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    }));

  return {
    range: { from: toIsoDate(range.from), to: toIsoDate(range.to) },
    currencies,
  };
}
