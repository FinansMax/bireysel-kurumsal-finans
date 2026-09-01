import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { prisma } from "../src/lib/prisma";
import { createAccount } from "../src/lib/finance/account";
import { createCategory } from "../src/lib/finance/category";
import { getDashboardSummary, TREND_MONTH_COUNT } from "../src/lib/finance/dashboard";
import { createTransaction } from "../src/lib/finance/transaction";

/**
 * Panel özeti iş kuralları — gerçek DB'ye karşı, HTTP olmadan (Issue #62).
 *
 * Yetkilendirme burada test EDİLMEZ: servis authorization kararı vermez, o iş route'un
 * `requirePermission()`ındır (bkz. `security/dashboard-security.spec.ts`). Buradaki konu:
 * para aritmetiğinin doğruluğu, ÇOK PARA BİRİMLİ davranış, ay sınırları ve tenant scope'u.
 *
 * VERİ GERÇEK SERVİSLERLE ÜRETİLİR (`createAccount`/`createTransaction`), doğrudan
 * `prisma.*.create` ile değil: özet, bakiyeyi de okur ve bakiye ancak işlem servisinin
 * aynı transaction'daki `increment`iyle doğru oluşur. Elle satır yazmak, testi gerçek
 * yazma yolundan koparırdı.
 *
 * ZAMAN SABİTLENİR: `getDashboardSummary(tenantId, NOW)` — ay sınırı davranışı ancak
 * belirlenmiş bir "şimdi" ile doğrulanabilir. `NOW` ayın ortasındadır ki testin kendisi
 * gerçek takvimin ay başına/sonuna denk gelip gelmemesinden etkilenmesin.
 */

/** Haziran 2026'nın ortası. Pencere: 2026-01 … 2026-06. */
const NOW = new Date("2026-06-15T12:00:00.000Z");
const CURRENT_MONTH = "2026-06";

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

test.afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

async function seedTenant(): Promise<string> {
  const tenant = await prisma.tenant.create({
    data: { name: "Panel Testi", slug: `dash-${randomUUID()}` },
    select: { id: true },
  });
  createdTenantIds.push(tenant.id);
  return tenant.id;
}

async function seedActor(): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `dash-actor-${randomUUID()}@example.com` },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  return user.id;
}

async function seedAccount(
  tenantId: string,
  actorId: string,
  currency: string,
  balance = "0",
): Promise<string> {
  const result = await createAccount(tenantId, actorId, {
    name: `Hesap ${randomUUID()}`,
    type: "BANK",
    currency,
    balance,
  });
  expect(result.ok, "hesap oluşturulamadı").toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.account.id;
}

async function seedCategory(
  tenantId: string,
  actorId: string,
  type: "INCOME" | "EXPENSE",
): Promise<string> {
  const result = await createCategory(tenantId, actorId, { name: `Kategori ${randomUUID()}`, type });
  expect(result.ok, "kategori oluşturulamadı").toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.category.id;
}

async function seedTransaction(
  tenantId: string,
  actorId: string,
  accountId: string,
  type: "INCOME" | "EXPENSE",
  amount: string,
  occurredAt: string,
): Promise<void> {
  const result = await createTransaction(tenantId, actorId, {
    accountId,
    type,
    amount,
    occurredAt,
  });
  expect(result.ok, `işlem oluşturulamadı: ${result.ok ? "" : result.error}`).toBe(true);
}

/** Bir para biriminin bu ayki akışını bulur; yoksa `undefined` (test bunu ayırt edebilmeli). */
function flowOf(
  summary: Awaited<ReturnType<typeof getDashboardSummary>>,
  currency: string,
) {
  return summary.currentMonth.flows.find((flow) => flow.currency === currency);
}

function seriesOf(
  summary: Awaited<ReturnType<typeof getDashboardSummary>>,
  currency: string,
) {
  return summary.trend.series.find((series) => series.currency === currency);
}

test.describe("getDashboardSummary() — boş tenant", () => {
  test("hiç veri yokken sıfırlar döner, uydurma bir kova üretilmez", async () => {
    const tenantId = await seedTenant();

    const summary = await getDashboardSummary(tenantId, NOW);

    expect(summary.counts).toEqual({ accounts: 0, transactions: 0, categories: 0 });
    // BOŞ DİZİ, "0 TRY" DEĞİL: hangi para biriminde sıfır olduğunu söyleyemeyiz, çünkü henüz
    // hiçbir para birimi seçilmemiştir. Sahte bir varsayılan üretmek yanlış olurdu.
    expect(summary.balancesByCurrency).toEqual([]);
    expect(summary.currentMonth.flows).toEqual([]);
    expect(summary.trend.series).toEqual([]);

    // Pencere yine de doludur: grafik ekseni veri olmadan da bilinir.
    expect(summary.trend.months).toHaveLength(TREND_MONTH_COUNT);
    expect(summary.trend.months).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
    expect(summary.currentMonth.month).toBe(CURRENT_MONTH);
  });

  test("hesabı olan ama işlemi olmayan tenant: bakiye görünür, akış boş kalır", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    await seedAccount(tenantId, actorId, "TRY", "1500.50");

    const summary = await getDashboardSummary(tenantId, NOW);

    expect(summary.counts.accounts).toBe(1);
    expect(summary.counts.transactions).toBe(0);
    expect(summary.balancesByCurrency).toEqual([
      { currency: "TRY", balance: "1500.5", accountCount: 1 },
    ]);
    // İşlemi olmayan para birimi TREND'e girmez: altı ay boyunca sıfır olan bir grafik,
    // bilgi değil gürültüdür.
    expect(summary.trend.series).toEqual([]);
    expect(summary.currentMonth.flows).toEqual([]);
  });
});

test.describe("getDashboardSummary() — tek para birimi", () => {
  test("yalnızca gelir varken gider sıfır, fark GELİR yönündedir", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");

    await seedTransaction(tenantId, actorId, accountId, "INCOME", "1000.25", "2026-06-05");
    await seedTransaction(tenantId, actorId, accountId, "INCOME", "499.75", "2026-06-10");

    const summary = await getDashboardSummary(tenantId, NOW);
    const flow = flowOf(summary, "TRY");

    expect(flow).toEqual({
      currency: "TRY",
      income: "1500",
      expense: "0",
      net: "1500",
      netDirection: "in",
    });
  });

  test("yalnızca gider varken gelir sıfır, fark GİDER yönündedir", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");

    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "250.10", "2026-06-02");

    const summary = await getDashboardSummary(tenantId, NOW);

    expect(flowOf(summary, "TRY")).toEqual({
      currency: "TRY",
      income: "0",
      expense: "250.1",
      // `net` MUTLAK değerdir, işareti `netDirection` taşır — negatif bir string DÖNMEZ.
      net: "250.1",
      netDirection: "out",
    });
  });

  test("gelir ve gider aynı para biriminde toplanır; fark Decimal hassasiyetini korur", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");

    // KRİTİK: `number` ile 0.1 + 0.2 = 0.30000000000000004 olurdu. Fark tam olarak 0.1 olmalı.
    await seedTransaction(tenantId, actorId, accountId, "INCOME", "0.3", "2026-06-03");
    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "0.2", "2026-06-04");

    const summary = await getDashboardSummary(tenantId, NOW);

    expect(flowOf(summary, "TRY")).toEqual({
      currency: "TRY",
      income: "0.3",
      expense: "0.2",
      net: "0.1",
      netDirection: "in",
    });
  });

  test("gelir gidere eşitken fark sıfırdır ve yön GELİR sayılır (negatif değil)", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");

    await seedTransaction(tenantId, actorId, accountId, "INCOME", "100", "2026-06-03");
    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "100", "2026-06-04");

    expect(flowOf(await getDashboardSummary(tenantId, NOW), "TRY")).toEqual({
      currency: "TRY",
      income: "100",
      expense: "100",
      net: "0",
      netDirection: "in",
    });
  });

  test("toplamlar DAİMA pozitiftir: negatif bir gelir/gider toplamı üretilemez", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");

    await seedTransaction(tenantId, actorId, accountId, "INCOME", "10", "2026-06-01");
    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "9999", "2026-06-02");

    const summary = await getDashboardSummary(tenantId, NOW);
    const flow = flowOf(summary, "TRY");

    // `Transaction.amount` şema seviyesinde pozitiftir (#53), bu yüzden toplamları da öyle
    // olmalıdır. Gider gelirden büyükken bile `expense` negatife DÖNMEZ; işaret yalnızca
    // farkın yönünde yaşar.
    expect(flow?.income.startsWith("-")).toBe(false);
    expect(flow?.expense.startsWith("-")).toBe(false);
    expect(flow?.net.startsWith("-")).toBe(false);
    expect(flow?.netDirection).toBe("out");
  });

  test("hesap bakiyesi negatif olabilir ve toplamı öyle döner", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    await seedAccount(tenantId, actorId, "TRY", "-2500.75");
    await seedAccount(tenantId, actorId, "TRY", "500.25");

    const summary = await getDashboardSummary(tenantId, NOW);

    // Bakiye, işlem tutarının aksine negatif OLABİLİR (kredi kartı / eksiye düşmüş hesap).
    expect(summary.balancesByCurrency).toEqual([
      { currency: "TRY", balance: "-2000.5", accountCount: 2 },
    ]);
  });
});

test.describe("getDashboardSummary() — çok para birimli", () => {
  test("farklı para birimleri ASLA toplanmaz; her biri kendi kovasında döner", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const tryAccount = await seedAccount(tenantId, actorId, "TRY", "1000");
    const usdAccount = await seedAccount(tenantId, actorId, "USD", "200");

    await seedTransaction(tenantId, actorId, tryAccount, "INCOME", "300", "2026-06-05");
    await seedTransaction(tenantId, actorId, usdAccount, "INCOME", "50", "2026-06-05");
    await seedTransaction(tenantId, actorId, usdAccount, "EXPENSE", "20", "2026-06-06");

    const summary = await getDashboardSummary(tenantId, NOW);

    // Bakiye: iki ayrı satır. TEK bir "1200" satırı ÜRETİLMEMELİ — kur dönüşümü yok.
    expect(summary.balancesByCurrency).toEqual([
      { currency: "TRY", balance: "1300", accountCount: 1 },
      { currency: "USD", balance: "230", accountCount: 1 },
    ]);

    expect(summary.currentMonth.flows).toEqual([
      { currency: "TRY", income: "300", expense: "0", net: "300", netDirection: "in" },
      { currency: "USD", income: "50", expense: "20", net: "30", netDirection: "in" },
    ]);

    // Trend de para birimi bazında AYRI seridir.
    expect(summary.trend.series.map((series) => series.currency)).toEqual(["TRY", "USD"]);
  });

  test("işlemin para birimi BAĞLI OLDUĞU HESAPTAN gelir", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const eurAccount = await seedAccount(tenantId, actorId, "EUR");
    await seedAccount(tenantId, actorId, "TRY");

    await seedTransaction(tenantId, actorId, eurAccount, "EXPENSE", "75", "2026-06-07");

    const summary = await getDashboardSummary(tenantId, NOW);

    // `Transaction`da currency alanı YOKTUR; tutar EUR hesabına yazıldığı için EUR kovasına
    // düşmeli, TRY'ye DEĞİL.
    expect(summary.currentMonth.flows).toEqual([
      { currency: "EUR", income: "0", expense: "75", net: "75", netDirection: "out" },
    ]);
    // Hareketi olmayan TRY, akışta görünmez ama bakiyede görünür.
    expect(summary.balancesByCurrency.map((balance) => balance.currency)).toEqual(["EUR", "TRY"]);
  });

  test("aynı para biriminde birden fazla hesap tek kovada toplanır", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const first = await seedAccount(tenantId, actorId, "TRY");
    const second = await seedAccount(tenantId, actorId, "TRY");

    await seedTransaction(tenantId, actorId, first, "INCOME", "100", "2026-06-05");
    await seedTransaction(tenantId, actorId, second, "INCOME", "150", "2026-06-05");

    expect(flowOf(await getDashboardSummary(tenantId, NOW), "TRY")?.income).toBe("250");
  });
});

test.describe("getDashboardSummary() — ay sınırları", () => {
  test("ayın ilk anı DAHİL, önceki ayın son anı HARİÇ", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");

    await seedTransaction(tenantId, actorId, accountId, "INCOME", "1", "2026-06-01T00:00:00.000Z");
    await seedTransaction(tenantId, actorId, accountId, "INCOME", "500", "2026-05-31T23:59:59.999Z");

    const summary = await getDashboardSummary(tenantId, NOW);

    // Bu ayda YALNIZCA 1 olmalı; mayısın son milisaniyesi sızmamalı.
    expect(flowOf(summary, "TRY")?.income).toBe("1");

    const points = seriesOf(summary, "TRY")?.points ?? [];
    expect(points.find((point) => point.month === "2026-05")?.income).toBe("500");
    expect(points.find((point) => point.month === "2026-06")?.income).toBe("1");
  });

  test("ayın son anı DAHİL, sonraki ayın ilk anı HARİÇ", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");

    await seedTransaction(tenantId, actorId, accountId, "INCOME", "7", "2026-06-30T23:59:59.999Z");
    // Gelecek tarihli kayıt serbesttir (#53) ama PENCEREYE GİRMEZ: temmuz, haziranın toplamı
    // değildir.
    await seedTransaction(tenantId, actorId, accountId, "INCOME", "999", "2026-07-01T00:00:00.000Z");

    const summary = await getDashboardSummary(tenantId, NOW);

    expect(flowOf(summary, "TRY")?.income).toBe("7");
    // Toplam işlem SAYISI penceresizdir: temmuzdaki kayıt da bir kayıttır.
    expect(summary.counts.transactions).toBe(2);
  });

  test("pencere altı aydır: altı ay öncesi HARİÇ, beş ay öncesi DAHİL", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");

    // 2025-12 = pencerenin bir adım DIŞI; 2026-01 = pencerenin ilk ayı.
    await seedTransaction(tenantId, actorId, accountId, "INCOME", "888", "2025-12-31");
    await seedTransaction(tenantId, actorId, accountId, "INCOME", "11", "2026-01-01");

    const summary = await getDashboardSummary(tenantId, NOW);
    const points = seriesOf(summary, "TRY")?.points ?? [];

    expect(points).toHaveLength(TREND_MONTH_COUNT);
    expect(points[0].month).toBe("2026-01");
    expect(points[0].income).toBe("11");
    // Aralık verisi hiçbir kovaya sızmamalı: toplam, pencere içindeki tek kayda eşit.
    const windowIncome = points.reduce((total, point) => total + Number(point.income), 0);
    expect(windowIncome).toBe(11);
  });

  test("yıl sınırı doğru devreder (ocakta bakınca önceki yılın ayları gelir)", async () => {
    const tenantId = await seedTenant();

    const summary = await getDashboardSummary(tenantId, new Date("2026-01-20T00:00:00.000Z"));

    expect(summary.trend.months).toEqual([
      "2025-08",
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
    ]);
  });
});

test.describe("getDashboardSummary() — grafik oranları", () => {
  test("oran serinin en büyük değerine göredir ve gelir/gider ORTAK ölçekte durur", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");

    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "1000", "2026-06-04");
    await seedTransaction(tenantId, actorId, accountId, "INCOME", "250", "2026-06-05");
    await seedTransaction(tenantId, actorId, accountId, "INCOME", "500", "2026-05-05");

    const series = seriesOf(await getDashboardSummary(tenantId, NOW), "TRY");
    const june = series?.points.find((point) => point.month === "2026-06");
    const may = series?.points.find((point) => point.month === "2026-05");

    expect(series?.max).toBe("1000");
    // Gider en büyüğü: %100. Gelir onun dörtte biri: %25. İki seri AYRI normalize edilseydi
    // 250 gelir de %100 çıkardı ve grafik yalan söylerdi.
    expect(june?.expensePercent).toBe("100.00");
    expect(june?.incomePercent).toBe("25.00");
    expect(may?.incomePercent).toBe("50.00");
    expect(may?.expensePercent).toBe("0.00");
  });

  test("oran alanları hiçbir zaman NaN/Infinity üretmez (sıfır bölme)", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");

    // Pencere DIŞINDA tek bir kayıt: seri var mı? Hayır — hiçbir ayda hareket yok, bu yüzden
    // para birimi trende hiç girmez ve sıfıra bölme durumu oluşmaz.
    await seedTransaction(tenantId, actorId, accountId, "INCOME", "5", "2024-01-01");

    const summary = await getDashboardSummary(tenantId, NOW);
    expect(summary.trend.series).toEqual([]);

    for (const series of summary.trend.series) {
      for (const point of series.points) {
        expect(Number.isFinite(Number(point.incomePercent))).toBe(true);
        expect(Number.isFinite(Number(point.expensePercent))).toBe(true);
      }
    }
  });
});

test.describe("getDashboardSummary() — tenant izolasyonu", () => {
  test("başka tenant'ın hesabı, işlemi ve kategorisi özete SIZMAZ", async () => {
    const actorId = await seedActor();

    const mine = await seedTenant();
    const theirs = await seedTenant();

    const myAccount = await seedAccount(mine, actorId, "TRY", "100");
    await seedCategory(mine, actorId, "INCOME");
    await seedTransaction(mine, actorId, myAccount, "INCOME", "10", "2026-06-05");

    // Komşu tenant'ta BOL veri: sızıntı olsaydı sayılar gözle görülür şekilde şişerdi.
    const theirAccount = await seedAccount(theirs, actorId, "USD", "999999");
    await seedCategory(theirs, actorId, "INCOME");
    await seedCategory(theirs, actorId, "EXPENSE");
    await seedTransaction(theirs, actorId, theirAccount, "INCOME", "888888", "2026-06-05");
    await seedTransaction(theirs, actorId, theirAccount, "EXPENSE", "777777", "2026-06-06");

    const summary = await getDashboardSummary(mine, NOW);

    expect(summary.counts).toEqual({ accounts: 1, transactions: 1, categories: 1 });
    expect(summary.balancesByCurrency).toEqual([
      { currency: "TRY", balance: "110", accountCount: 1 },
    ]);
    // Komşunun para birimi hiçbir listede görünmemeli.
    expect(summary.currentMonth.flows.map((flow) => flow.currency)).toEqual(["TRY"]);
    expect(summary.trend.series.map((series) => series.currency)).toEqual(["TRY"]);
    expect(flowOf(summary, "TRY")?.income).toBe("10");
    expect(flowOf(summary, "USD")).toBeUndefined();
  });

  test("KONTROL GRUBU: aynı veri kendi tenant'ında sorulunca GÖRÜNÜYOR", async () => {
    // Duyarlılık kanıtı: yukarıdaki testin "sızmıyor" iddiası, sorgunun her koşulda boş
    // dönmesinden kaynaklanıyor olabilirdi. Aynı kayıtları kendi tenant'ında sorup
    // gördüğümüzde, izolasyonun gerçekten filtrelediğini biliriz.
    const actorId = await seedActor();
    const theirs = await seedTenant();

    const theirAccount = await seedAccount(theirs, actorId, "USD", "999999");
    await seedTransaction(theirs, actorId, theirAccount, "INCOME", "888888", "2026-06-05");

    const summary = await getDashboardSummary(theirs, NOW);

    expect(summary.counts.accounts).toBe(1);
    expect(flowOf(summary, "USD")?.income).toBe("888888");
  });
});
