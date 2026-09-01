import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import { signInWithCredentials } from "./support/auth";
import { uniqueTestClientIp } from "./support/rate-limit";

/**
 * Panel — kategori bazlı harcama dağılımı (Issue #65).
 *
 * `dashboard-ui.spec.ts` ile aynı duruş: ekrandaki her oran ve tutar, bağımsız bir okumayla
 * (`GET .../dashboard/spending-by-category`) doğrulanır.
 *
 * BU BÖLÜME ÖZGÜ İDDİALAR:
 * 1. Halkada YALNIZCA gider vardır — gelir dağılıma girmez.
 * 2. Dönem URL'de yaşar; geçersiz dönem sessizce tam listeye düşmez, hata gösterilir.
 * 3. Çok para birimli alanda tutarlar birleştirilmez.
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
    data: { name: "Harcama Ekrani", slug: `spending-ui-${randomUUID()}` },
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

async function createAccount(page: Page, tenantId: string, currency: string): Promise<string> {
  const response = await page.request.post(`/api/tenants/${tenantId}/accounts`, {
    data: { name: `Hesap ${randomUUID()}`, type: "CASH", currency, balance: "0" },
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

/** Ekrandakini DOĞRULAMAK için bağımsız okuma. */
async function apiSpending(page: Page, tenantId: string, query = "") {
  const response = await page.request.get(
    `/api/tenants/${tenantId}/dashboard/spending-by-category${query}`,
  );
  expect(response.status()).toBe(200);

  return ((await response.json()) as {
    spending: {
      range: { from: string; to: string };
      currencies: Array<{
        currency: string;
        total: string;
        slices: Array<{ name: string | null; amount: string; sharePercent: string }>;
      }>;
    };
  }).spending;
}

test.describe("Harcama dağılımı — gerçek veriyle", () => {
  test("kategori payları halkada ve lejantta gösterilir; GELİR dağılıma girmez", async ({
    page,
  }) => {
    await signUpAndSignIn(page, "spend-basic");
    const tenantId = await createAndActivateTenant(page);

    const accountId = await createAccount(page, tenantId, "TRY");
    const kira = await createCategory(page, tenantId, "Kira", "EXPENSE");
    const market = await createCategory(page, tenantId, "Market", "EXPENSE");
    const maas = await createCategory(page, tenantId, "Maas", "INCOME");

    await createTransaction(page, tenantId, {
      accountId,
      type: "EXPENSE",
      amount: "750",
      categoryId: kira,
      description: "Kira odemesi",
    });
    await createTransaction(page, tenantId, {
      accountId,
      type: "EXPENSE",
      amount: "500",
      categoryId: market,
      description: "Market",
    });
    // Gelir: halkada GÖRÜNMEMELİ. Görünseydi "harcamanın %x'i" cümlesi anlamsızlaşırdı.
    await createTransaction(page, tenantId, {
      accountId,
      type: "INCOME",
      amount: "9000",
      categoryId: maas,
      description: "Maas",
    });

    await page.goto("/dashboard");

    // BAĞIMSIZ DOĞRULAMA.
    const spending = await apiSpending(page, tenantId);
    expect(spending.currencies).toHaveLength(1);
    expect(spending.currencies[0].total).toBe("1250");
    expect(spending.currencies[0].slices.map((slice) => slice.name)).toEqual(["Kira", "Market"]);

    // Bölüm ADLANDIRILMIŞ bir landmark: aynı tutar panelin başka yerlerinde de (bakiye kartı,
    // aylık akış, son hareketler) geçtiği için iddialar bu bölgeye KAPSANIR — yoksa test,
    // dağılımı değil ekranın herhangi bir yerini doğrulamış olurdu.
    const panel = page.getByRole("region", { name: "Harcama dağılımı" });

    await expect(page.getByRole("heading", { name: "Harcama dağılımı" })).toBeVisible();
    await expect(panel.getByText("Yalnızca gider işlemleri.")).toBeVisible();

    // Halkanın ortası toplam gideri söyler — gelir toplamı (9000) burada olmamalı.
    await expect(panel.getByText("Toplam gider")).toBeVisible();
    await expect(panel.getByText("1250 TRY")).toBeVisible();

    // Lejant: ad + pay + tutar.
    await expect(panel.getByText("Kira", { exact: true })).toBeVisible();
    await expect(panel.getByText("Market", { exact: true })).toBeVisible();
    await expect(panel.getByText("%60.00")).toBeVisible();
    await expect(panel.getByText("%40.00")).toBeVisible();

    // Gelir kategorisi dağılımda HİÇ geçmemeli.
    await expect(panel.getByText("Maas", { exact: true })).toHaveCount(0);
    await expect(panel.getByText("9000 TRY")).toHaveCount(0);
  });

  test("kategorisiz harcama 'Kategorisiz' olarak gösterilir", async ({ page }) => {
    await signUpAndSignIn(page, "spend-uncat");
    const tenantId = await createAndActivateTenant(page);

    const accountId = await createAccount(page, tenantId, "TRY");
    await createTransaction(page, tenantId, {
      accountId,
      type: "EXPENSE",
      amount: "300",
      description: "Kategorisiz gider",
    });

    await page.goto("/dashboard");

    const panel = page.getByRole("region", { name: "Harcama dağılımı" });

    // `CategoryBadge` ile AYNI sözcük: kullanıcı iki ekranda iki farklı ad görmemeli.
    await expect(panel.getByText("Kategorisiz", { exact: true })).toBeVisible();
    await expect(panel.getByText("%100.00")).toBeVisible();
  });
});

test.describe("Harcama dağılımı — dönem seçimi", () => {
  test("dönem formu URL'e yazılır ve dağılımı daraltır", async ({ page }) => {
    await signUpAndSignIn(page, "spend-range");
    const tenantId = await createAndActivateTenant(page);

    const accountId = await createAccount(page, tenantId, "TRY");
    const kira = await createCategory(page, tenantId, "Kira", "EXPENSE");
    await createTransaction(page, tenantId, {
      accountId,
      type: "EXPENSE",
      amount: "750",
      categoryId: kira,
    });

    await page.goto("/dashboard");
    const panel = page.getByRole("region", { name: "Harcama dağılımı" });

    // Halkanın ortasında ve lejantta aynı tutar: tek kategorili bir dağılımda ikisi eşittir.
    await expect(panel.getByText("750 TRY")).toHaveCount(2);
    // Varsayılan dönemdeyken "sıfırla" bağlantısının gidecek yeri yok, bu yüzden gösterilmez.
    await expect(panel.getByRole("link", { name: "Bu aya dön" })).toHaveCount(0);

    // Geçmiş bir aya git: o dönemde kayıt yok.
    await panel.getByLabel("Başlangıç").fill("2026-01-01");
    await panel.getByLabel("Bitiş").fill("2026-01-31");
    await panel.getByRole("button", { name: "Uygula" }).click();

    await expect(page).toHaveURL(/from=2026-01-01/);
    await expect(page).toHaveURL(/to=2026-01-31/);

    // Boş dönem SAHTE bir sıfır dağılımı çizmez, ne olduğunu söyler.
    await expect(panel.getByText("Seçilen dönemde gider işlemi yok.")).toBeVisible();
    await expect(panel.getByText("Toplam gider")).toHaveCount(0);

    // Bağımsız doğrulama: API de aynı dönemde boş dönüyor.
    const spending = await apiSpending(page, tenantId, "?from=2026-01-01&to=2026-01-31");
    expect(spending.currencies).toEqual([]);
    expect(spending.range).toEqual({ from: "2026-01-01", to: "2026-01-31" });

    // Geri dönüş yolu var ve çalışıyor.
    await panel.getByRole("link", { name: "Bu aya dön" }).click();
    await expect(panel.getByText("750 TRY")).toHaveCount(2);
  });

  test("geçersiz dönem: hata gösterilir, dağılım SESSİZCE tam döneme düşmez", async ({ page }) => {
    await signUpAndSignIn(page, "spend-invalid");
    const tenantId = await createAndActivateTenant(page);

    const accountId = await createAccount(page, tenantId, "TRY");
    await createTransaction(page, tenantId, { accountId, type: "EXPENSE", amount: "750" });

    // Ters aralık: kullanıcının hatası veridekiyle karıştırılmamalı (#56'nın kararı).
    await page.goto("/dashboard?from=2026-04-01&to=2026-03-01");

    const panel = page.getByRole("region", { name: "Harcama dağılımı" });

    await expect(panel.getByText(/Dönem geçersiz olduğu için dağılım gösterilmiyor/)).toBeVisible();
    await expect(panel.getByText("Toplam gider")).toHaveCount(0);
    await expect(panel.getByText("750 TRY")).toHaveCount(0);

    // Form kullanıcının yazdığını korur; düzeltmek için yeniden yazmak zorunda kalmamalı.
    await expect(panel.getByLabel("Başlangıç")).toHaveValue("2026-04-01");
    await expect(panel.getByLabel("Bitiş")).toHaveValue("2026-03-01");

    // Panelin GERİ KALANI çalışmaya devam eder: hata yalnızca bu bölümü kapatır.
    await expect(page.getByRole("heading", { name: "Son hareketler" })).toBeVisible();
  });
});

test.describe("Harcama dağılımı — çok para birimli", () => {
  test("her para birimi kendi halkasını alır; tutarlar birleştirilmez", async ({ page }) => {
    await signUpAndSignIn(page, "spend-multi");
    const tenantId = await createAndActivateTenant(page);

    const tryAccount = await createAccount(page, tenantId, "TRY");
    const usdAccount = await createAccount(page, tenantId, "USD");
    const kira = await createCategory(page, tenantId, "Kira", "EXPENSE");

    await createTransaction(page, tenantId, {
      accountId: tryAccount,
      type: "EXPENSE",
      amount: "1000",
      categoryId: kira,
    });
    await createTransaction(page, tenantId, {
      accountId: usdAccount,
      type: "EXPENSE",
      amount: "50",
      categoryId: kira,
    });

    await page.goto("/dashboard");

    const spending = await apiSpending(page, tenantId);
    expect(spending.currencies.map((entry) => entry.currency)).toEqual(["TRY", "USD"]);

    const panel = page.getByRole("region", { name: "Harcama dağılımı" });

    // İki halka, iki toplam.
    await expect(panel.getByText("Toplam gider")).toHaveCount(2);
    // Her para biriminde halka ortası + lejant satırı: ikişer kez.
    await expect(panel.getByText("1000 TRY")).toHaveCount(2);
    await expect(panel.getByText("50 USD")).toHaveCount(2);

    // KRİTİK NEGATİF İDDİA: birleştirilmiş bir toplam (1050) hiçbir yerde olmamalı.
    await expect(page.getByText("1050")).toHaveCount(0);
  });
});
