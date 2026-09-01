import { CategoryType, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { tenantScoped } from "@/lib/tenancy/scope";

/**
 * Panelin (dashboard) özet verisi — Issue #62.
 *
 * TENANT İZOLASYONU: `account.ts`/`transaction.ts` ile aynı desen — buradaki HER sorgu
 * `tenantScoped()` üzerinden geçer. Bu modül yalnızca OKUR (aggregate); tek bir yazma çağrısı
 * içermez, dolayısıyla `updateMany`/`deleteMany` sözleşmesi burada gündeme gelmez. `tenantId`
 * daima çağıranın `requirePermission()` context'inden gelir — URL parametresi veya body DEĞİL.
 *
 * Bu fonksiyonlar authorization kararı VERMEZ. Özet ÜÇ modelin verisini birleştirir (hesap,
 * işlem, kategori); bu yüzden çağıran route, üç görüntüleme izninin TAMAMINI arar
 * (bkz. `src/app/api/tenants/[tenantId]/dashboard/summary/route.ts`).
 *
 * ---
 *
 * EN ÖNEMLİ KARAR — FARKLI PARA BİRİMLERİ ASLA TOPLANMAZ.
 *
 * Üründe kur dönüşümü altyapısı YOKTUR (bkz. `prisma/schema.prisma` → `Account.currency`).
 * Bu yüzden "toplam bakiye" diye tek bir sayı ÜRETİLMEZ: 10.000 TRY ile 500 USD'yi toplayan
 * bir sayı, doğru görünen ama anlamsız bir sayıdır ve finansal bir üründe bu, hiç sayı
 * göstermemekten daha kötüdür. Her toplam, `currency` bazında AYRI döner.
 *
 * İŞLEMİN PARA BİRİMİ KENDİ SATIRINDA YOKTUR: `Transaction`ın para birimi, bağlı olduğu
 * `Account.currency`dir (şemadaki bilinçli tekrar-etmeme kararı). Prisma `groupBy` bir İLİŞKİ
 * alanına göre gruplayamaz ve ham SQL bu kod tabanında yasaktır (CLAUDE.md §5) — bu yüzden
 * gruplama `accountId` üzerinden yapılır ve para birimine katlama uygulama katmanında,
 * `Prisma.Decimal` aritmetiğiyle tamamlanır. Toplama yine kayıpsızdır: `number`a HİÇBİR
 * noktada dönüşülmez (invariant #10).
 */

/** Trend penceresi: içinde bulunulan ay DAHİL son altı ay. */
export const TREND_MONTH_COUNT = 6;

/** Para birimi başına hesap bakiyesi toplamı. */
export type CurrencyBalance = {
  currency: string;
  /** Decimal'in string gösterimi — asla `number` (invariant #10). Negatif olabilir. */
  balance: string;
  accountCount: number;
};

/** Bir dönemin, tek bir para birimindeki gelir/gider/fark özeti. */
export type CurrencyFlow = {
  currency: string;
  income: string;
  expense: string;
  /**
   * Gelir − gider farkının MUTLAK değeri; işareti `netDirection` taşır.
   *
   * Bu, kod tabanının kendi kuralının (bkz. `Transaction.amount`, #53: "tutar daima pozitif,
   * yönü `type` taşır") özet katmanındaki karşılığıdır. Alternatif — işaretli tek bir string —
   * sunum katmanını "başında `-` var mı" diye string kesmeye ya da `Money`ye ikinci bir eksi
   * bastırmaya zorlardı.
   */
  net: string;
  netDirection: "in" | "out";
};

/** Trend grafiğinin tek bir ayı. */
export type TrendPoint = {
  /** `YYYY-MM`, UTC. */
  month: string;
  income: string;
  expense: string;
  /**
   * Serinin en büyük değerine göre oran, `0.00`–`100.00` arası string.
   *
   * NEDEN SERVİSTE: grafik çubuğunun yüksekliği bir orandır ve o oranı sunum katmanında
   * hesaplamak, `Number(income) / Number(max)` demekti — yani paranın `number`a dönüşmesi
   * (invariant #10). Burada bölme `Prisma.Decimal` ile yapılır ve dışarı yalnızca ORAN
   * (para değil) çıkar; bileşen bunu doğrudan CSS yüzdesi olarak kullanır, hiçbir sayısal
   * dönüşüm yapmaz.
   */
  incomePercent: string;
  expensePercent: string;
};

/** Tek bir para biriminin altı aylık gelir/gider serisi. */
export type CurrencyTrend = {
  currency: string;
  /** Seride görülen en büyük tek değer (gelir ya da gider). `"0"` = seri tamamen boş. */
  max: string;
  points: TrendPoint[];
};

export type DashboardSummary = {
  counts: {
    accounts: number;
    transactions: number;
    categories: number;
  };
  balancesByCurrency: CurrencyBalance[];
  currentMonth: {
    /** `YYYY-MM`, UTC. */
    month: string;
    /** YALNIZCA bu ay hareketi olan para birimleri. Boş dizi = bu ay hiç hareket yok. */
    flows: CurrencyFlow[];
  };
  trend: {
    /** Eskiden yeniye, `YYYY-MM`. Uzunluğu daima `TREND_MONTH_COUNT`. */
    months: string[];
    /** YALNIZCA pencerede hareketi olan para birimleri; her biri kendi grafiğidir. */
    series: CurrencyTrend[];
  };
};

const ZERO = new Prisma.Decimal(0);

/**
 * Ay sınırları UTC'dedir.
 *
 * `occurredAt` bir `DateTime`tir ve üründe saat dilimi yönetimi henüz YOKTUR (Issue #134).
 * Yerel saate göre ay sınırı hesaplamak, aynı işlemi sunucunun diliminde başka bir aya
 * düşürürdü; UTC en azından TEK ve öngörülebilir bir kuraldır. `parseFilterDate()` de aynı
 * tercihi yapıyor (`Date.UTC`) — iki yerin ayrışmaması için burada da UTC.
 *
 * `Date.UTC` negatif ay indeksini kendisi devreder (Ocak'tan bir geri = önceki yılın Aralık'ı),
 * bu yüzden yıl/ay taşması elle yazılmaz.
 */
function monthStart(reference: Date, monthsBack: number): Date {
  return new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() - monthsBack, 1));
}

type MonthWindow = {
  key: string;
  /** Dahil. */
  start: Date;
  /** HARİÇ — ayın son anını `lte` ile yakalamaya çalışmak, ayın son milisaniyesini kaçırırdı. */
  end: Date;
};

function buildMonthWindows(now: Date): MonthWindow[] {
  const windows: MonthWindow[] = [];

  for (let back = TREND_MONTH_COUNT - 1; back >= 0; back -= 1) {
    const start = monthStart(now, back);
    windows.push({ key: start.toISOString().slice(0, 7), start, end: monthStart(now, back - 1) });
  }

  return windows;
}

/** Para birimi kodları ASCII'dir; `localeCompare` KULLANILMAZ — sıra ICU sürümüne bağlı olmasın. */
function byCurrencyCode(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function percentOf(value: Prisma.Decimal, max: Prisma.Decimal): string {
  // Boş seri: bölme yapılmaz (0/0). Her çubuk sıfır yüksekliktedir — grafik "veri yok" der.
  if (max.isZero()) {
    return "0.00";
  }
  return value.div(max).times(100).toFixed(2);
}

type Flow = { income: Prisma.Decimal; expense: Prisma.Decimal };

/**
 * Aktif çalışma alanının panel özeti.
 *
 * `now` parametresi YALNIZCA testler içindir (ay sınırı davranışı ancak sabitlenmiş bir "şimdi"
 * ile doğrulanabilir). Route ve sayfa katmanı bunu HİÇ geçirmez; istemciden gelen bir tarih
 * buraya ASLA bağlanmamalıdır — pencereyi kaydırmak bir izolasyon açığı olmasa da, kullanıcıya
 * "bu ay" diye başka bir ayı göstermek olurdu.
 */
export async function getDashboardSummary(
  tenantId: string,
  now: Date = new Date(),
): Promise<DashboardSummary> {
  const windows = buildMonthWindows(now);

  const [accountCount, transactionCount, categoryCount, balanceGroups, monthGroups] =
    await Promise.all([
      prisma.account.count({ where: tenantScoped(tenantId, {}) }),
      prisma.transaction.count({ where: tenantScoped(tenantId, {}) }),
      prisma.category.count({ where: tenantScoped(tenantId, {}) }),

      // Bakiye toplamı DB'de yapılır: `SUM(numeric)` Postgres tarafında kayıpsızdır ve tüm
      // satırları uygulamaya çekmez.
      prisma.account.groupBy({
        by: ["currency"],
        where: tenantScoped(tenantId, {}),
        _sum: { balance: true },
        _count: true,
        orderBy: { currency: "asc" },
      }),

      // Ay başına AYRI bir sorgu: Prisma `groupBy` bir tarihi aya YUVARLAYAMAZ (bunun için
      // `date_trunc` gerekir, o da ham SQL demektir — yasak). Altı sorgu paralel koşar ve her
      // biri `@@index([tenantId, occurredAt])`i kullanır; toplama yine DB'dedir.
      Promise.all(
        windows.map((window) =>
          prisma.transaction.groupBy({
            by: ["accountId", "type"],
            where: tenantScoped(tenantId, { occurredAt: { gte: window.start, lt: window.end } }),
            _sum: { amount: true },
          }),
        ),
      ),
    ]);

  // Hesap → para birimi haritası, groupBy'lardan SONRA okunur (paralel DEĞİL) ve bu bilinçlidir:
  // araya yeni bir hesap + işlem girerse, işlem groupBy'da görünüp hesap listede olmayabilirdi
  // ve o ayın toplamı sessizce eksik kalırdı. Sonradan okumak bu boşluğu kapatır — şemadaki
  // `onDelete: NoAction` sayesinde işlemi olan bir hesap bu arada SİLİNEMEZ, yani harita
  // yalnızca büyüyebilir.
  const accounts = await prisma.account.findMany({
    where: tenantScoped(tenantId, {}),
    select: { id: true, currency: true },
  });
  const currencyByAccountId = new Map(accounts.map(({ id, currency }) => [id, currency]));

  const flowsByMonth = monthGroups.map((groups) => {
    const byCurrency = new Map<string, Flow>();

    for (const group of groups) {
      const currency = currencyByAccountId.get(group.accountId);
      if (!currency) {
        // Ulaşılamaz olmalı (yukarıdaki sıralama + `NoAction` FK). Yine de sessizce ATLAMAK
        // yerine burada durmak da yanlış olurdu: panel, tek bir tutarsız satır yüzünden hiç
        // açılmamalı. Atlanan tutar toplamı eksiltir; alternatifi "bilinmeyen para birimi"
        // diye sahte bir kova üretmekti.
        continue;
      }

      const amount = group._sum.amount ?? ZERO;
      const flow = byCurrency.get(currency) ?? { income: ZERO, expense: ZERO };

      // `Prisma.Decimal` DEĞİŞMEZDİR: `plus()` yeni bir örnek döner, paylaşılan `ZERO` bozulmaz.
      if (group.type === CategoryType.INCOME) {
        flow.income = flow.income.plus(amount);
      } else {
        flow.expense = flow.expense.plus(amount);
      }

      byCurrency.set(currency, flow);
    }

    return byCurrency;
  });

  const trendCurrencies = [
    ...new Set(flowsByMonth.flatMap((byCurrency) => [...byCurrency.keys()])),
  ].sort(byCurrencyCode);

  const series: CurrencyTrend[] = trendCurrencies.map((currency) => {
    const monthlyFlows = flowsByMonth.map(
      (byCurrency) => byCurrency.get(currency) ?? { income: ZERO, expense: ZERO },
    );

    // Ölçek gelir ve gideri ORTAK kapsar: ikisi ayrı ayrı normalize edilseydi, 100 TRY gelir
    // ile 10.000 TRY gider aynı yükseklikte çubuk olurdu ve grafik yalan söylerdi.
    let max = ZERO;
    for (const flow of monthlyFlows) {
      if (flow.income.greaterThan(max)) {
        max = flow.income;
      }
      if (flow.expense.greaterThan(max)) {
        max = flow.expense;
      }
    }

    return {
      currency,
      max: max.toString(),
      points: windows.map((window, index) => {
        const flow = monthlyFlows[index];
        return {
          month: window.key,
          income: flow.income.toString(),
          expense: flow.expense.toString(),
          incomePercent: percentOf(flow.income, max),
          expensePercent: percentOf(flow.expense, max),
        };
      }),
    };
  });

  // "Bu ay" trendin SON kovasıdır — ayrı bir sorguyla hesaplanmaz. Gerekçe: iki ayrı hesap,
  // zamanla "bu ayın geliri"nin iki farklı tanımına dönüşür (biri UTC, diğeri yerel; biri
  // ay sonunu dahil eder, diğeri etmez). Tek kaynak, tek tanım.
  const currentWindow = windows[windows.length - 1];
  const currentFlows = flowsByMonth[flowsByMonth.length - 1];

  const flows: CurrencyFlow[] = [...currentFlows.entries()]
    .sort(([a], [b]) => byCurrencyCode(a, b))
    .map(([currency, flow]) => {
      const net = flow.income.minus(flow.expense);
      return {
        currency,
        income: flow.income.toString(),
        expense: flow.expense.toString(),
        net: net.abs().toString(),
        netDirection: net.isNegative() ? "out" : "in",
      };
    });

  return {
    counts: {
      accounts: accountCount,
      transactions: transactionCount,
      categories: categoryCount,
    },
    balancesByCurrency: balanceGroups.map((group) => ({
      currency: group.currency,
      balance: (group._sum.balance ?? ZERO).toString(),
      accountCount: group._count,
    })),
    currentMonth: { month: currentWindow.key, flows },
    trend: { months: windows.map((window) => window.key), series },
  };
}
