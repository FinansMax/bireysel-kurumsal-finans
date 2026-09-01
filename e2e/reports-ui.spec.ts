import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import { signInWithCredentials } from "./support/auth";
import { uniqueTestClientIp } from "./support/rate-limit";

/**
 * Rapor ekranı — gerçek tarayıcıda, gerçek API'ye karşı (Issue #67).
 *
 * `dashboard-ui.spec.ts` ile aynı duruş: ekrandaki her sayı bağımsız bir okumayla
 * (`GET .../reports/income-expense`) doğrulanır.
 *
 * BU EKRANA ÖZGÜ İDDİALAR:
 * 1. Kategori payları KENDİ YÖNÜNÜN toplamına göredir (gelir tablosu genel toplama oranlanmaz).
 * 2. Dönem URL'de yaşar; geçersiz dönem sessizce tam döneme düşmez.
 * 3. Para birimleri ayrı bölümlerde; tek bir birleşik toplam yok.
 */

const PASSWORD = "S3curePassw0rd!";

const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestClientIp() });
});

test.afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

function apiHeaders(): Record<string, string> {
  return { "x-forwarded-for": uniqueTestClientIp() };
}

async function signUpAndSignIn(page: Page, prefix: string): Promise<void> {
  const email = `${prefix}-${randomUUID()}@example.com`;

  const created = await page.request.post("/api/auth/signup", {
    data: { email, password: PASSWORD },
    headers: apiHeaders(),
  });
  expect(created.status()).toBe(201);

  const signedIn = await signInWithCredentials(page.request, email, PASSWORD);
  expect(signedIn.status()).toBe(302);

  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  createdUserIds.push(user.id);
}

async function createAndActivateTenant(page: Page): Promise<string> {
  const response = await page.request.post("/api/tenants", {
    data: { name: "Rapor Ekrani", slug: `reports-ui-${randomUUID()}` },
    headers: apiHeaders(),
  });
  expect(response.status()).toBe(201);

  const { tenant } = (await response.json()) as { tenant: { id: string } };
  createdTenantIds.push(tenant.id);

  const activated = await page.request.post("/api/tenants/active", {
    data: { tenantId: tenant.id },
  });
  expect(activated.status()).toBe(200);

  return tenant.id;
}

async function createAccount(
  page: Page,
  tenantId: string,
  currency: string,
  name: string,
): Promise<string> {
  const response = await page.request.post(`/api/tenants/${tenantId}/accounts`, {
    data: { name, type: "CASH", currency, balance: "0" },
  });
  expect(response.status()).toBe(201);

  return ((await response.json()) as { account: { id: string } }).account.id;
}

async function createCategory(
  page: Page,
  tenantId: string,
  name: string,
  type: "INCOME" | "EXPENSE",
): Promise<string> {
  const response = await page.request.post(`/api/tenants/${tenantId}/categories`, {
    data: { name, type },
  });
  expect(response.status()).toBe(201);

  return ((await response.json()) as { category: { id: string } }).category.id;
}

async function createTransaction(
  page: Page,
  tenantId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const response = await page.request.post(`/api/tenants/${tenantId}/transactions`, { data });
  expect(response.status()).toBe(201);
}

async function apiReport(page: Page, tenantId: string, query = "") {
  const response = await page.request.get(
    `/api/tenants/${tenantId}/reports/income-expense${query}`,
  );
  expect(response.status()).toBe(200);

  return ((await response.json()) as {
    report: {
      range: { from: string; to: string };
      currencies: Array<{
        currency: string;
        income: string;
        expense: string;
        net: string;
        netDirection: "in" | "out";
        transactionCount: number;
        incomeByCategory: Array<{ name: string | null; sharePercent: string }>;
        expenseByCategory: Array<{ name: string | null; sharePercent: string }>;
        byAccount: Array<{ name: string }>;
      }>;
    };
  }).report;
}

test.describe("Rapor ekranı — gerçek veriyle", () => {
  test("menüden ulaşılıyor; toplamlar ve kırılımlar doğru gösteriliyor", async ({ page }) => {
    await signUpAndSignIn(page, "report-basic");
    const tenantId = await createAndActivateTenant(page);

    const accountId = await createAccount(page, tenantId, "TRY", "Kasa");
    const maas = await createCategory(page, tenantId, "Maas", "INCOME");
    const kira = await createCategory(page, tenantId, "Kira", "EXPENSE");
    const market = await createCategory(page, tenantId, "Market", "EXPENSE");

    await createTransaction(page, tenantId, {
      accountId,
      type: "INCOME",
      amount: "1000",
      categoryId: maas,
    });
    await createTransaction(page, tenantId, {
      accountId,
      type: "EXPENSE",
      amount: "300",
      categoryId: kira,
    });
    await createTransaction(page, tenantId, {
      accountId,
      type: "EXPENSE",
      amount: "100",
      categoryId: market,
    });

    // Menüde artık gerçek bir bağlantı (placeholder değil, #67).
    await page.goto("/dashboard");
    await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Raporlar" }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByRole("heading", { name: "Raporlar", level: 1 })).toBeVisible();

    // BAĞIMSIZ DOĞRULAMA.
    const report = await apiReport(page, tenantId);
    expect(report.currencies).toHaveLength(1);
    expect(report.currencies[0].income).toBe("1000");
    expect(report.currencies[0].expense).toBe("400");
    expect(report.currencies[0].net).toBe("600");
    expect(report.currencies[0].netDirection).toBe("in");
    expect(report.currencies[0].transactionCount).toBe(3);

    // Bölüm ADLANDIRILMIŞ landmark: aynı tutar başka bir para biriminin bölümünde de geçebilir.
    const block = page.getByRole("region", { name: "TRY raporu" });
    await expect(block.getByText("+1000 TRY")).toBeVisible();
    await expect(block.getByText("-400 TRY")).toBeVisible();
    await expect(block.getByText("+600 TRY")).toBeVisible();
    await expect(block.getByText("İşlem sayısı")).toBeVisible();

    // Kategori payları KENDİ YÖNÜNE göre: gelir tarafı tek kategori → %100 (genel toplam olan
    // 1400'e göre %71 DEĞİL).
    await expect(block.getByText("%100.00")).toBeVisible();
    // Gider tarafı kendi içinde: 300/400 ve 100/400.
    await expect(block.getByText("%75.00")).toBeVisible();
    await expect(block.getByText("%25.00")).toBeVisible();

    // Hesap kırılımı.
    await expect(block.getByRole("heading", { name: "Hesap kırılımı" })).toBeVisible();
    await expect(block.getByText("Kasa")).toBeVisible();
  });

  test("yalnızca tek yönde hareket varsa diğer tablo boş olduğunu SÖYLER", async ({ page }) => {
    await signUpAndSignIn(page, "report-oneside");
    const tenantId = await createAndActivateTenant(page);

    const accountId = await createAccount(page, tenantId, "TRY", "Kasa");
    await createTransaction(page, tenantId, { accountId, type: "INCOME", amount: "500" });

    await page.goto("/reports");
    const block = page.getByRole("region", { name: "TRY raporu" });

    // Boş bir tablo iskeleti değil, cümle.
    await expect(block.getByText("Bu dönemde gider hareketi yok.")).toBeVisible();
    // Kategorisiz gelir "Kategorisiz" rozetiyle görünür.
    await expect(block.getByText("Kategorisiz")).toBeVisible();
  });
});

test.describe("Rapor ekranı — dönem", () => {
  test("dönem formu URL'e yazılır ve raporu daraltır", async ({ page }) => {
    await signUpAndSignIn(page, "report-range");
    const tenantId = await createAndActivateTenant(page);

    const accountId = await createAccount(page, tenantId, "TRY", "Kasa");
    await createTransaction(page, tenantId, { accountId, type: "INCOME", amount: "500" });

    await page.goto("/reports");
    await expect(page.getByRole("region", { name: "TRY raporu" })).toBeVisible();
    // Varsayılan dönemdeyken sıfırlama bağlantısının gidecek yeri yok.
    await expect(page.getByRole("link", { name: "Bu aya dön" })).toHaveCount(0);

    await page.getByLabel("Başlangıç").fill("2026-01-01");
    await page.getByLabel("Bitiş").fill("2026-01-31");
    await page.getByRole("button", { name: "Uygula" }).click();

    await expect(page).toHaveURL(/from=2026-01-01/);
    await expect(page).toHaveURL(/to=2026-01-31/);

    // Boş dönem SAHTE bir sıfır raporu çizmez, ne olduğunu söyler.
    await expect(page.getByText("Seçilen dönemde hiç hareket yok.")).toBeVisible();
    await expect(page.getByRole("region", { name: "TRY raporu" })).toHaveCount(0);

    const report = await apiReport(page, tenantId, "?from=2026-01-01&to=2026-01-31");
    expect(report.currencies).toEqual([]);

    await page.getByRole("link", { name: "Bu aya dön" }).click();
    await expect(page.getByRole("region", { name: "TRY raporu" })).toBeVisible();
  });

  test("geçersiz dönem: hata gösterilir, rapor SESSİZCE tam döneme düşmez", async ({ page }) => {
    await signUpAndSignIn(page, "report-invalid");
    const tenantId = await createAndActivateTenant(page);

    const accountId = await createAccount(page, tenantId, "TRY", "Kasa");
    await createTransaction(page, tenantId, { accountId, type: "INCOME", amount: "500" });

    await page.goto("/reports?from=2026-04-01&to=2026-03-01");

    await expect(page.getByText(/Dönem geçersiz olduğu için rapor gösterilmiyor/)).toBeVisible();
    await expect(page.getByRole("region", { name: "TRY raporu" })).toHaveCount(0);

    // Form kullanıcının yazdığını korur.
    await expect(page.getByLabel("Başlangıç")).toHaveValue("2026-04-01");
    await expect(page.getByLabel("Bitiş")).toHaveValue("2026-03-01");
  });
});

test.describe("Rapor ekranı — çok para birimli", () => {
  test("her para birimi kendi bölümünü alır; tek bir birleşik toplam yok", async ({ page }) => {
    await signUpAndSignIn(page, "report-multi");
    const tenantId = await createAndActivateTenant(page);

    const tryAccount = await createAccount(page, tenantId, "TRY", "TL Kasa");
    const usdAccount = await createAccount(page, tenantId, "USD", "USD Kasa");

    await createTransaction(page, tenantId, { accountId: tryAccount, type: "INCOME", amount: "1000" });
    await createTransaction(page, tenantId, { accountId: usdAccount, type: "INCOME", amount: "40" });

    await page.goto("/reports");

    const report = await apiReport(page, tenantId);
    expect(report.currencies.map((entry) => entry.currency)).toEqual(["TRY", "USD"]);

    await expect(page.getByRole("heading", { name: "TRY raporu" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "USD raporu" })).toBeVisible();

    // Her bölüm YALNIZCA kendi hesabını listeler.
    const tryBlock = page.getByRole("region", { name: "TRY raporu" });
    await expect(tryBlock.getByText("TL Kasa")).toBeVisible();
    await expect(tryBlock.getByText("USD Kasa")).toHaveCount(0);

    // KRİTİK NEGATİF İDDİA: birleştirilmiş bir toplam (1040) hiçbir yerde olmamalı.
    await expect(page.getByText("1040")).toHaveCount(0);
  });
});
