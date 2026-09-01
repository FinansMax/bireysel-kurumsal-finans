import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { prisma } from "../src/lib/prisma";
import { createAccount } from "../src/lib/finance/account";
import { createCategory, deleteCategory } from "../src/lib/finance/category";
import {
  getIncomeExpenseReport,
  type ReportRange,
} from "../src/lib/finance/income-expense-report";
import { createTransaction } from "../src/lib/finance/transaction";

/**
 * Dönemsel gelir-gider raporu iş kuralları — gerçek DB'ye karşı, HTTP olmadan (Issue #67).
 *
 * Yetkilendirme burada test EDİLMEZ (bkz. `security/income-expense-report-security.spec.ts`).
 * Buradaki konu: toplamların doğruluğu, kırılımların (kategori/hesap) tutarlılığı, para birimi
 * ayrımı, tarih sınırları ve tenant scope'u.
 */

/** Haziran 2026'nın tamamı. */
const RANGE: ReportRange = {
  from: new Date("2026-06-01T00:00:00.000Z"),
  to: new Date("2026-06-30T00:00:00.000Z"),
};

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

test.afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

async function seedTenant(): Promise<string> {
  const tenant = await prisma.tenant.create({
    data: { name: "Rapor Testi", slug: `report-${randomUUID()}` },
    select: { id: true },
  });
  createdTenantIds.push(tenant.id);
  return tenant.id;
}

async function seedActor(): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `report-actor-${randomUUID()}@example.com` },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  return user.id;
}

async function seedAccount(
  tenantId: string,
  actorId: string,
  currency: string,
  name = `Hesap ${randomUUID()}`,
): Promise<string> {
  const result = await createAccount(tenantId, actorId, { name, type: "BANK", currency });
  expect(result.ok, "hesap oluşturulamadı").toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.account.id;
}

async function seedCategory(
  tenantId: string,
  actorId: string,
  name: string,
  type: "INCOME" | "EXPENSE",
): Promise<string> {
  const result = await createCategory(tenantId, actorId, { name, type });
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
  categoryId?: string,
): Promise<void> {
  const result = await createTransaction(tenantId, actorId, {
    accountId,
    type,
    amount,
    occurredAt,
    ...(categoryId ? { categoryId } : {}),
  });
  expect(result.ok, `işlem oluşturulamadı: ${result.ok ? "" : result.error}`).toBe(true);
}

function currencyOf(
  report: Awaited<ReturnType<typeof getIncomeExpenseReport>>,
  currency: string,
) {
  return report.currencies.find((entry) => entry.currency === currency);
}

test.describe("getIncomeExpenseReport() — toplamlar", () => {
  test("veri yokken boş dizi döner ve aralık geri bildirilir", async () => {
    const tenantId = await seedTenant();

    const report = await getIncomeExpenseReport(tenantId, RANGE);

    expect(report.currencies).toEqual([]);
    expect(report.range).toEqual({ from: "2026-06-01", to: "2026-06-30" });
  });

  test("gelir, gider, fark ve işlem sayısı doğru hesaplanıyor", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");

    await seedTransaction(tenantId, actorId, accountId, "INCOME", "5000", "2026-06-05");
    await seedTransaction(tenantId, actorId, accountId, "INCOME", "1000", "2026-06-06");
    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "1500.50", "2026-06-07");

    const entry = currencyOf(await getIncomeExpenseReport(tenantId, RANGE), "TRY");

    expect(entry?.income).toBe("6000");
    expect(entry?.expense).toBe("1500.5");
    // `net` MUTLAK değerdir, işareti `netDirection` taşır (#53'ün kuralı).
    expect(entry?.net).toBe("4499.5");
    expect(entry?.netDirection).toBe("in");
    expect(entry?.transactionCount).toBe(3);
  });

  test("gider gelirden fazlaysa fark GİDER yönündedir ve tutar yine POZİTİFTİR", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");

    await seedTransaction(tenantId, actorId, accountId, "INCOME", "100", "2026-06-05");
    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "400", "2026-06-06");

    const entry = currencyOf(await getIncomeExpenseReport(tenantId, RANGE), "TRY");

    expect(entry?.net).toBe("300");
    expect(entry?.netDirection).toBe("out");
    expect(entry?.income.startsWith("-")).toBe(false);
    expect(entry?.expense.startsWith("-")).toBe(false);
  });

  test("Decimal hassasiyeti korunuyor (0.3 − 0.2 = 0.1)", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");

    await seedTransaction(tenantId, actorId, accountId, "INCOME", "0.3", "2026-06-05");
    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "0.2", "2026-06-06");

    const entry = currencyOf(await getIncomeExpenseReport(tenantId, RANGE), "TRY");
    // `number` ile 0.30000000000000004 − 0.2 = 0.10000000000000003 olurdu.
    expect(entry?.net).toBe("0.1");
  });

  test("yalnızca gelir varken gider tablosu BOŞTUR (sıfırla dolu satır üretilmez)", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");

    await seedTransaction(tenantId, actorId, accountId, "INCOME", "100", "2026-06-05");

    const entry = currencyOf(await getIncomeExpenseReport(tenantId, RANGE), "TRY");

    expect(entry?.expense).toBe("0");
    expect(entry?.expenseByCategory).toEqual([]);
    expect(entry?.incomeByCategory).toHaveLength(1);
  });
});

test.describe("getIncomeExpenseReport() — kategori kırılımı", () => {
  test("paylar KENDİ YÖNÜNÜN toplamına göre hesaplanıyor", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");
    const maas = await seedCategory(tenantId, actorId, "Maas", "INCOME");
    const kira = await seedCategory(tenantId, actorId, "Kira", "EXPENSE");
    const market = await seedCategory(tenantId, actorId, "Market", "EXPENSE");

    await seedTransaction(tenantId, actorId, accountId, "INCOME", "1000", "2026-06-05", maas);
    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "300", "2026-06-06", kira);
    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "100", "2026-06-07", market);

    const entry = currencyOf(await getIncomeExpenseReport(tenantId, RANGE), "TRY");

    // Gelir tarafında tek kategori: %100 — GENEL toplama (1400) göre %71 DEĞİL.
    expect(entry?.incomeByCategory).toEqual([
      { categoryId: maas, name: "Maas", amount: "1000", sharePercent: "100.00" },
    ]);
    // Gider tarafı kendi içinde: 300/400 ve 100/400.
    expect(entry?.expenseByCategory).toEqual([
      { categoryId: kira, name: "Kira", amount: "300", sharePercent: "75.00" },
      { categoryId: market, name: "Market", amount: "100", sharePercent: "25.00" },
    ]);
  });

  test("aynı kategoriye birden fazla kayıt tek satırda toplanır", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");
    const kira = await seedCategory(tenantId, actorId, "Kira", "EXPENSE");

    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "300", "2026-06-06", kira);
    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "200", "2026-06-07", kira);

    const entry = currencyOf(await getIncomeExpenseReport(tenantId, RANGE), "TRY");
    expect(entry?.expenseByCategory).toHaveLength(1);
    expect(entry?.expenseByCategory[0].amount).toBe("500");
  });

  test("aynı ADI taşıyan gelir ve gider kategorileri KARIŞMAZ", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");
    // Şema `@@unique([tenantId, type, name])` — "Diğer" hem gelirde hem giderde olabilir (#49).
    const digerGelir = await seedCategory(tenantId, actorId, "Diger", "INCOME");
    const digerGider = await seedCategory(tenantId, actorId, "Diger", "EXPENSE");

    await seedTransaction(tenantId, actorId, accountId, "INCOME", "70", "2026-06-05", digerGelir);
    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "30", "2026-06-06", digerGider);

    const entry = currencyOf(await getIncomeExpenseReport(tenantId, RANGE), "TRY");

    expect(entry?.incomeByCategory).toEqual([
      { categoryId: digerGelir, name: "Diger", amount: "70", sharePercent: "100.00" },
    ]);
    expect(entry?.expenseByCategory).toEqual([
      { categoryId: digerGider, name: "Diger", amount: "30", sharePercent: "100.00" },
    ]);
  });

  test("kategorisiz kayıtlar tek kovada toplanır ve eşitlikte SONA düşer", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");
    const kira = await seedCategory(tenantId, actorId, "Kira", "EXPENSE");

    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "100", "2026-06-05");
    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "100", "2026-06-06", kira);

    const entry = currencyOf(await getIncomeExpenseReport(tenantId, RANGE), "TRY");
    expect(entry?.expenseByCategory.map((row) => row.name)).toEqual(["Kira", null]);
  });

  test("kategori SİLİNİNCE tutar kaybolmaz, kategorisiz satıra düşer", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");
    const gecici = await seedCategory(tenantId, actorId, "Gecici", "EXPENSE");

    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "500", "2026-06-05", gecici);
    expect((await deleteCategory(tenantId, gecici, actorId)).ok).toBe(true);

    const entry = currencyOf(await getIncomeExpenseReport(tenantId, RANGE), "TRY");

    // `onDelete: SetNull` (#53): kategori bir ETİKETTİR, paranın kendisi değil.
    expect(entry?.expense).toBe("500");
    expect(entry?.expenseByCategory).toEqual([
      { categoryId: null, name: null, amount: "500", sharePercent: "100.00" },
    ]);
  });
});

test.describe("getIncomeExpenseReport() — hesap kırılımı", () => {
  test("her hesap kendi gelir/gider/fark/adet satırını alır ve ADA göre sıralanır", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const bAccount = await seedAccount(tenantId, actorId, "TRY", "B Hesabi");
    const aAccount = await seedAccount(tenantId, actorId, "TRY", "A Hesabi");

    await seedTransaction(tenantId, actorId, aAccount, "INCOME", "100", "2026-06-05");
    await seedTransaction(tenantId, actorId, bAccount, "EXPENSE", "60", "2026-06-06");
    await seedTransaction(tenantId, actorId, bAccount, "INCOME", "10", "2026-06-07");

    const entry = currencyOf(await getIncomeExpenseReport(tenantId, RANGE), "TRY");

    // Sıra ADA göre: dönem değiştikçe satırların yeri oynamamalı.
    expect(entry?.byAccount).toEqual([
      {
        accountId: aAccount,
        name: "A Hesabi",
        income: "100",
        expense: "0",
        net: "100",
        netDirection: "in",
        transactionCount: 1,
      },
      {
        accountId: bAccount,
        name: "B Hesabi",
        income: "10",
        expense: "60",
        net: "50",
        netDirection: "out",
        transactionCount: 2,
      },
    ]);
  });

  test("hesap kırılımının toplamı, para biriminin toplamına EŞİTTİR", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    // Ad en az iki karakter (`MIN_ACCOUNT_NAME_LENGTH`) — tek harfli ad servisçe reddedilir.
    const first = await seedAccount(tenantId, actorId, "TRY", "Ilk Hesap");
    const second = await seedAccount(tenantId, actorId, "TRY", "Ikinci Hesap");

    await seedTransaction(tenantId, actorId, first, "INCOME", "123.45", "2026-06-05");
    await seedTransaction(tenantId, actorId, second, "INCOME", "876.55", "2026-06-06");
    await seedTransaction(tenantId, actorId, second, "EXPENSE", "0.05", "2026-06-07");

    const entry = currencyOf(await getIncomeExpenseReport(tenantId, RANGE), "TRY");

    // İç tutarlılık: kırılım ile toplam ayrışırsa rapor kendi içinde yalan söylüyor demektir.
    expect(entry?.income).toBe("1000");
    expect(entry?.expense).toBe("0.05");
    expect(
      entry?.byAccount.reduce((total, row) => total + row.transactionCount, 0),
    ).toBe(entry?.transactionCount);
  });
});

test.describe("getIncomeExpenseReport() — para birimleri ve tarih aralığı", () => {
  test("farklı para birimleri ASLA tek raporda toplanmaz", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const tryAccount = await seedAccount(tenantId, actorId, "TRY");
    const usdAccount = await seedAccount(tenantId, actorId, "USD");

    await seedTransaction(tenantId, actorId, tryAccount, "INCOME", "1000", "2026-06-05");
    await seedTransaction(tenantId, actorId, usdAccount, "EXPENSE", "40", "2026-06-05");

    const report = await getIncomeExpenseReport(tenantId, RANGE);

    expect(report.currencies.map((entry) => entry.currency)).toEqual(["TRY", "USD"]);
    expect(currencyOf(report, "TRY")?.income).toBe("1000");
    expect(currencyOf(report, "TRY")?.expense).toBe("0");
    expect(currencyOf(report, "USD")?.expense).toBe("40");
    // Her para biriminin hesap kırılımı YALNIZCA kendi hesaplarını içerir.
    expect(currencyOf(report, "TRY")?.byAccount).toHaveLength(1);
    expect(currencyOf(report, "USD")?.byAccount).toHaveLength(1);
  });

  test("her iki uç da DAHİLDİR; aralık dışı kayıtlar sayılmaz", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");

    await seedTransaction(tenantId, actorId, accountId, "INCOME", "1", "2026-06-01T00:00:00.000Z");
    await seedTransaction(tenantId, actorId, accountId, "INCOME", "2", "2026-06-30T23:59:59.999Z");
    await seedTransaction(tenantId, actorId, accountId, "INCOME", "999", "2026-05-31T23:59:59.999Z");
    await seedTransaction(tenantId, actorId, accountId, "INCOME", "888", "2026-07-01T00:00:00.000Z");

    const entry = currencyOf(await getIncomeExpenseReport(tenantId, RANGE), "TRY");
    expect(entry?.income).toBe("3");
    expect(entry?.transactionCount).toBe(2);
  });

  test("tek günlük aralık çalışır (from === to)", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");

    await seedTransaction(tenantId, actorId, accountId, "INCOME", "7", "2026-06-15T18:30:00.000Z");
    await seedTransaction(tenantId, actorId, accountId, "INCOME", "9", "2026-06-16T00:00:00.000Z");

    const single = {
      from: new Date("2026-06-15T00:00:00.000Z"),
      to: new Date("2026-06-15T00:00:00.000Z"),
    };
    expect(currencyOf(await getIncomeExpenseReport(tenantId, single), "TRY")?.income).toBe("7");
  });
});

test.describe("getIncomeExpenseReport() — tenant izolasyonu", () => {
  test("başka tenant'ın tutarları, kategori ve hesap adları rapora SIZMAZ", async () => {
    const actorId = await seedActor();
    const mine = await seedTenant();
    const theirs = await seedTenant();

    const myAccount = await seedAccount(mine, actorId, "TRY", "Benim Hesabim");
    const myCategory = await seedCategory(mine, actorId, "Benim Kategorim", "INCOME");
    await seedTransaction(mine, actorId, myAccount, "INCOME", "10", "2026-06-05", myCategory);

    const theirAccount = await seedAccount(theirs, actorId, "USD", "Komsu Hesabi");
    const theirCategory = await seedCategory(theirs, actorId, "Komsu Kategorisi", "EXPENSE");
    await seedTransaction(theirs, actorId, theirAccount, "EXPENSE", "777777", "2026-06-05", theirCategory);

    const report = await getIncomeExpenseReport(mine, RANGE);
    const raw = JSON.stringify(report);

    expect(report.currencies).toHaveLength(1);
    expect(report.currencies[0].currency).toBe("TRY");
    expect(report.currencies[0].income).toBe("10");
    expect(raw).not.toContain("Komsu");
    expect(raw).not.toContain("777777");
  });

  test("KONTROL GRUBU: aynı veri kendi tenant'ında GÖRÜNÜYOR", async () => {
    const actorId = await seedActor();
    const theirs = await seedTenant();

    const theirAccount = await seedAccount(theirs, actorId, "USD", "Komsu Hesabi");
    const theirCategory = await seedCategory(theirs, actorId, "Komsu Kategorisi", "EXPENSE");
    await seedTransaction(theirs, actorId, theirAccount, "EXPENSE", "777777", "2026-06-05", theirCategory);

    const raw = JSON.stringify(await getIncomeExpenseReport(theirs, RANGE));
    expect(raw).toContain("Komsu Hesabi");
    expect(raw).toContain("777777");
  });
});
