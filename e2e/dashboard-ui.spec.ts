import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import { markEmailVerified } from "./support/email-verification";
import { signInWithCredentials } from "./support/auth";
import { uniqueTestClientIp } from "./support/rate-limit";

/**
 * Panel ekranı — gerçek tarayıcıda, gerçek API'ye karşı (Issue #63).
 *
 * `transactions-ui.spec.ts` ile aynı duruş: ekranda görünen sayı, BAĞIMSIZ bir okumayla
 * (burada `GET /api/tenants/:id/dashboard/summary`) doğrulanır — sayfanın bir rakam basması
 * tek başına "doğru hesaplandı" demek değildir.
 *
 * BU EKRANA ÖZGÜ İKİ İDDİA:
 * 1. Veri YOKKEN panel boş kalmaz ama SAHTE de doldurulmaz: onboarding görünür, grafik ve
 *    "son hareketler" HİÇ render edilmez.
 * 2. Çok para birimli çalışma alanında TEK bir "toplam" üretilmez; her para birimi kendi
 *    kartına ve kendi grafiğine sahiptir.
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
  // #190: doğrulanmamış hesap çalışma alanı kuramaz; bu testin konusu doğrulama DEĞİL,
  // onun ÖN KOŞULU (bkz. e2e/support/email-verification.ts).
  await markEmailVerified(email);
  expect(created.status()).toBe(201);

  const signedIn = await signInWithCredentials(page.request, email, PASSWORD);
  expect(signedIn.status()).toBe(302);
  expect(signedIn.headers()["location"] ?? "").not.toContain("error=");

  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  createdUserIds.push(user.id);
}

/** Oturum sahibi için tenant oluşturur (OWNER olur) ve aktif tenant yapar. */
async function createAndActivateTenant(page: Page): Promise<string> {
  const response = await page.request.post("/api/tenants", {
    data: { name: "Panel Ekrani", slug: `dashboard-ui-${randomUUID()}` },
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
  balance: string,
): Promise<string> {
  const response = await page.request.post(`/api/tenants/${tenantId}/accounts`, {
    data: { name: `Hesap ${randomUUID()}`, type: "CASH", currency, balance },
  });
  expect(response.status()).toBe(201);

  return ((await response.json()) as { account: { id: string } }).account.id;
}

async function createCategory(page: Page, tenantId: string, type: "INCOME" | "EXPENSE") {
  const response = await page.request.post(`/api/tenants/${tenantId}/categories`, {
    data: { name: `Kategori ${randomUUID()}`, type },
  });
  expect(response.status()).toBe(201);
}

async function createTransaction(
  page: Page,
  tenantId: string,
  accountId: string,
  type: "INCOME" | "EXPENSE",
  amount: string,
  description: string,
) {
  const response = await page.request.post(`/api/tenants/${tenantId}/transactions`, {
    data: { accountId, type, amount, description },
  });
  expect(response.status()).toBe(201);
}

/** Panelin gösterdiğini DOĞRULAMAK için bağımsız okuma — ekrandaki metinden değil. */
async function apiSummary(page: Page, tenantId: string) {
  const response = await page.request.get(`/api/tenants/${tenantId}/dashboard/summary`);
  expect(response.status()).toBe(200);

  return ((await response.json()) as {
    summary: {
      counts: { accounts: number; transactions: number; categories: number };
      balancesByCurrency: Array<{ currency: string; balance: string; accountCount: number }>;
      currentMonth: { flows: Array<{ currency: string; income: string; expense: string; net: string }> };
    };
  }).summary;
}

test.describe("Panel — veri yokken", () => {
  test("boş çalışma alanında onboarding gösterilir; grafik ve sahte rakam YOKTUR", async ({
    page,
  }) => {
    await signUpAndSignIn(page, "dash-empty");
    await createAndActivateTenant(page);

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Genel Bakış", level: 1 })).toBeVisible();

    // Üç adım, sırayla.
    await expect(page.getByRole("heading", { name: "İlk adımlar" })).toBeVisible();
    await expect(page.getByText("Hesap oluştur", { exact: true })).toBeVisible();
    await expect(page.getByText("Kategori oluştur", { exact: true })).toBeVisible();
    await expect(page.getByText("İlk işlemi ekle", { exact: true })).toBeVisible();

    // Sıradaki adımın (ilk tamamlanmamış olan) tek bir eylemi vardır.
    await expect(page.getByRole("link", { name: "Başla" })).toHaveCount(1);

    // Sayımlar GERÇEKTİR: hepsi sıfır.
    await expect(page.getByRole("link", { name: "Hesap 0", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "İşlem 0", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Kategori 0", exact: true })).toBeVisible();

    // Veri olmadan grafik, akış paneli ve "son hareketler" HİÇ render edilmez — boş bir
    // grafik, "veri yok" demenin en kötü yoludur.
    await expect(page.getByText("Son hareketler")).toHaveCount(0);
    await expect(page.getByText("Bu ay gelir")).toHaveCount(0);
    await expect(page.getByText("Toplam bakiye")).toHaveCount(0);
  });

  test("hesap ve kategori eklenince o adımlar tamamlanır, sıra işleme geçer", async ({ page }) => {
    await signUpAndSignIn(page, "dash-partial");
    const tenantId = await createAndActivateTenant(page);

    await createAccount(page, tenantId, "TRY", "1000");
    await createCategory(page, tenantId, "INCOME");

    await page.goto("/dashboard");

    // Onboarding hâlâ görünür (işlem yok), ama iki adım tamamlanmıştır.
    await expect(page.getByRole("heading", { name: "İlk adımlar" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Başla" })).toHaveCount(1);

    // Bakiye artık GERÇEK bir veridir ve gösterilir — işlem olmasa da.
    await expect(page.getByText("Toplam bakiye")).toBeVisible();
    await expect(page.getByRole("link", { name: "Hesap 1", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Kategori 1", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "İşlem 0", exact: true })).toBeVisible();

    // Grafik hâlâ yok: hiç hareket yok.
    await expect(page.getByText("Bu ay gelir")).toHaveCount(0);
  });
});

test.describe("Panel — gerçek veriyle", () => {
  test("bakiye, bu ayın gelir/gideri, grafik ve son hareketler gösterilir", async ({ page }) => {
    await signUpAndSignIn(page, "dash-data");
    const tenantId = await createAndActivateTenant(page);

    const accountId = await createAccount(page, tenantId, "TRY", "0");
    await createCategory(page, tenantId, "INCOME");
    await createTransaction(page, tenantId, accountId, "INCOME", "1000", "Maas odemesi");
    await createTransaction(page, tenantId, accountId, "EXPENSE", "250", "Market alisverisi");

    await page.goto("/dashboard");

    // Onboarding kaybolur: üç adım da tamamlandı.
    await expect(page.getByRole("heading", { name: "İlk adımlar" })).toHaveCount(0);

    // BAĞIMSIZ DOĞRULAMA: ekrandaki rakamlar API'nin hesabıyla aynı olmalı.
    const summary = await apiSummary(page, tenantId);
    expect(summary.counts).toEqual({ accounts: 1, transactions: 2, categories: 1 });
    expect(summary.balancesByCurrency).toEqual([
      { currency: "TRY", balance: "750", accountCount: 1 },
    ]);
    expect(summary.currentMonth.flows).toEqual([
      { currency: "TRY", income: "1000", expense: "250", net: "750", netDirection: "in" },
    ]);

    await expect(page.getByText("Toplam bakiye")).toBeVisible();
    // Bakiye = 1000 − 250. `Money` ham string'i basar; "750 TRY" ekranda aynen görünmeli.
    await expect(page.getByText("750 TRY").first()).toBeVisible();

    await expect(page.getByRole("heading", { name: "TRY akışı" })).toBeVisible();
    await expect(page.getByText("Bu ay gelir")).toBeVisible();
    await expect(page.getByText("Bu ay gider")).toBeVisible();
    await expect(page.getByText("Fark", { exact: true })).toBeVisible();

    // Grafik gerçek veriyi anlatır: ekran okuyucu metni ayın rakamlarını taşır (dekoratif
    // bir çizim değil).
    await expect(page.getByText(/gelir 1000 TRY, gider 250 TRY/)).toHaveCount(1);
    // Hareketi olmayan aylar da eksende durur ve SIFIR der.
    await expect(page.getByText(/gelir 0 TRY, gider 0 TRY/).first()).toBeVisible();

    // Son hareketler: açıklama, tutar, yön.
    await expect(page.getByRole("heading", { name: "Son hareketler" })).toBeVisible();
    await expect(page.getByText("Maas odemesi")).toBeVisible();
    await expect(page.getByText("Market alisverisi")).toBeVisible();
    await expect(page.getByText("+1000 TRY").first()).toBeVisible();
    await expect(page.getByText("-250 TRY").first()).toBeVisible();
    // Kategorisiz kayıtlar "Kategorisiz" rozetiyle işaretlenir — boş bırakılmaz.
    await expect(page.getByText("Kategorisiz").first()).toBeVisible();
  });

  test("gider gelirden fazlaysa fark GİDER yönünde gösterilir", async ({ page }) => {
    await signUpAndSignIn(page, "dash-negative");
    const tenantId = await createAndActivateTenant(page);

    // Açılış bakiyesi BİLEREK sıfır değil: sıfır olsaydı bakiye de (0+100−400) −300 çıkar ve
    // aşağıdaki "-300 TRY" iddiası hangi değeri gördüğünü ayırt edemezdi.
    const accountId = await createAccount(page, tenantId, "TRY", "1000");
    await createTransaction(page, tenantId, accountId, "INCOME", "100", "Kucuk gelir");
    await createTransaction(page, tenantId, accountId, "EXPENSE", "400", "Buyuk gider");

    await page.goto("/dashboard");

    const summary = await apiSummary(page, tenantId);
    expect(summary.currentMonth.flows[0]).toEqual({
      currency: "TRY",
      income: "100",
      expense: "400",
      // Tutar POZİTİF, işaret yönde (#53'ün kuralı).
      net: "300",
      netDirection: "out",
    });

    // Ekranda eksi işaretiyle: "-300 TRY". Bakiye 700 TRY olduğu için bu değer TEKTİR.
    await expect(page.getByText("-300 TRY")).toBeVisible();
    await expect(page.getByText("700 TRY").first()).toBeVisible();
  });
});

test.describe("Panel — çok para birimli", () => {
  test("para birimleri AYRI gösterilir; tek bir toplam üretilmez", async ({ page }) => {
    await signUpAndSignIn(page, "dash-multi");
    const tenantId = await createAndActivateTenant(page);

    const tryAccount = await createAccount(page, tenantId, "TRY", "0");
    const usdAccount = await createAccount(page, tenantId, "USD", "0");

    await createTransaction(page, tenantId, tryAccount, "INCOME", "1000", "TRY geliri");
    await createTransaction(page, tenantId, usdAccount, "INCOME", "40", "USD geliri");
    await createTransaction(page, tenantId, usdAccount, "EXPENSE", "15", "USD gideri");

    await page.goto("/dashboard");

    const summary = await apiSummary(page, tenantId);
    expect(summary.balancesByCurrency).toEqual([
      { currency: "TRY", balance: "1000", accountCount: 1 },
      { currency: "USD", balance: "25", accountCount: 1 },
    ]);

    // İki bakiye kartı, iki akış paneli — ve kullanıcıya nedeni AÇIKÇA söylenir.
    await expect(page.getByText("Toplam bakiye")).toHaveCount(2);
    await expect(
      page.getByText("Para birimleri ayrı toplanır — kur dönüşümü yapılmaz."),
    ).toBeVisible();

    await expect(page.getByRole("heading", { name: "TRY akışı" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "USD akışı" })).toBeVisible();

    // Grafikler de ayrıdır ve birbirinin rakamını taşımaz.
    await expect(page.getByText(/gelir 1000 TRY, gider 0 TRY/)).toHaveCount(1);
    await expect(page.getByText(/gelir 40 USD, gider 15 USD/)).toHaveCount(1);

    // KRİTİK NEGATİF İDDİA: 1000 + 25 = 1025 gibi birleşik bir sayı HİÇBİR yerde olmamalı.
    await expect(page.getByText("1025")).toHaveCount(0);
    await expect(page.getByText("1040")).toHaveCount(0);
  });
});
