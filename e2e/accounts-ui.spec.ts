import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import { signInWithCredentials } from "./support/auth";
import { uniqueTestClientIp } from "./support/rate-limit";

/**
 * Hesap ekranı — gerçek tarayıcıda, gerçek API'ye karşı (Issue #47).
 *
 * Sonuç her zaman bağımsız bir okuma yoluyla (`GET /api/tenants/:id/accounts`) doğrulanır:
 * listede bir satırın görünmesi tek başına "sunucuda gerçekten oluştu" demek değildir.
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

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID()}@example.com`;
}

async function signUpAndSignIn(page: Page, prefix: string): Promise<string> {
  const email = uniqueEmail(prefix);

  const created = await page.request.post("/api/auth/signup", {
    data: { email, password: PASSWORD },
    headers: apiHeaders(),
  });
  expect(created.status()).toBe(201);

  const signedIn = await signInWithCredentials(page.request, email, PASSWORD);
  expect(signedIn.status()).toBe(302);
  expect(signedIn.headers()["location"] ?? "").not.toContain("error=");

  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  createdUserIds.push(user.id);

  return user.id;
}

/** Oturum sahibi için tenant oluşturur (OWNER olur) ve aktif tenant yapar. */
async function createAndActivateTenant(page: Page): Promise<string> {
  const response = await page.request.post("/api/tenants", {
    data: { name: "Hesap Ekrani", slug: `accounts-ui-${randomUUID()}` },
    headers: apiHeaders(),
  });
  expect(response.status()).toBe(201);

  const { tenant } = (await response.json()) as { tenant: { id: string } };
  createdTenantIds.push(tenant.id);

  const activated = await page.request.post("/api/tenants/active", { data: { tenantId: tenant.id } });
  expect(activated.status()).toBe(200);

  return tenant.id;
}

async function apiAccounts(
  page: Page,
  tenantId: string,
): Promise<Array<{ name: string; type: string; balance: string; currency: string }>> {
  const response = await page.request.get(`/api/tenants/${tenantId}/accounts`);
  expect(response.status()).toBe(200);

  return (
    (await response.json()) as {
      accounts: Array<{ name: string; type: string; balance: string; currency: string }>;
    }
  ).accounts;
}

async function fillAccountForm(
  page: Page,
  values: { name: string; type?: string; currency?: string; balance?: string },
) {
  await page.getByLabel("Hesap adı").fill(values.name);
  if (values.type) {
    await page.getByLabel("Tür").selectOption(values.type);
  }
  if (values.currency !== undefined) {
    await page.getByLabel("Para birimi").fill(values.currency);
  }
  if (values.balance !== undefined) {
    await page.getByLabel("Açılış bakiyesi (isteğe bağlı)").fill(values.balance);
  }
}

function submit(page: Page) {
  return page.getByRole("button", { name: /hesap oluştur/i }).click();
}

function formAlert(page: Page) {
  return page.locator("form").getByRole("alert");
}

/**
 * Kayıttan SONRA listede beliren satırı bekler (Issue #129).
 *
 * Süre bilerek varsayılanın (5 sn) üstünde: form `router.refresh()` çağırır, yani satırın
 * görünmesi bir sunucu round-trip'ine ve RSC yeniden render'ına bağlıdır. Tam e2e suite'i
 * paralel koşarken bu adım 5 saniyeyi aşabiliyor ve test, uygulama doğru çalıştığı hâlde
 * kırmızıya düşüyordu — CI'daki `retries: 2` bunu örtüyor, yerelde ise sürekli sahte kırmızı
 * üretiyordu.
 *
 * Bu bir GEVŞETME DEĞİLDİR: iddia aynı (satır listede görünmeli), yalnızca bilinen bir yavaş
 * adıma daha fazla süre tanınıyor. Kaydın sunucuda gerçekten oluştuğu zaten bağımsız bir API
 * okumasıyla, bu beklemeden ayrı olarak doğrulanıyor. Desen ilk kez
 * `transactions-ui.spec.ts`'te (#54) uygulandı ve orada kararsızlığı tamamen bitirdi.
 *
 * Aynı süre form HATA KUTUSU beklemelerinde de kullanılır: o da bir sunucu round-trip'inden
 * sonra belirir (form `fetch` ile POST atar, mesajı yanıtın durum kodundan kurar).
 */
const ROW_TIMEOUT_MS = 15_000;

function expectRow(page: Page, name: string) {
  return expect(page.getByRole("cell", { name })).toBeVisible({ timeout: ROW_TIMEOUT_MS });
}

test.describe("/accounts — oluşturma ve listeleme", () => {
  test("menüden gidilip hesap oluşturuluyor ve listede görünüyor", async ({ page }) => {
    await signUpAndSignIn(page, "accounts-create");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/dashboard");
    await page
      .getByRole("navigation", { name: "Ana menü" })
      .getByRole("link", { name: "Hesaplar" })
      .click();
    await expect(page).toHaveURL(/\/accounts$/);

    // Boş durum: henüz hesap yok.
    await expect(page.getByText("Henüz hesap yok")).toBeVisible();

    await fillAccountForm(page, {
      name: "Vadesiz TL",
      type: "BANK",
      currency: "TRY",
      balance: "1500.75",
    });
    await submit(page);

    // Liste sunucudan yeniden render edilir.
    await expectRow(page, "Vadesiz TL");

    // Asıl kanıt: kayıt sunucuda var ve para STRING olarak, hassasiyeti bozulmadan duruyor.
    const accounts = await apiAccounts(page, tenantId);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      name: "Vadesiz TL",
      type: "BANK",
      currency: "TRY",
      balance: "1500.75",
    });
  });

  test("açılış bakiyesi boş bırakılınca 0 kabul ediliyor", async ({ page }) => {
    await signUpAndSignIn(page, "accounts-nobalance");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/accounts");
    // Bakiye alanı HİÇ doldurulmaz: form bu durumda alanı göndermemelidir (boş string
    // gönderilseydi backend "geçersiz tutar" diye 400 dönerdi).
    // Hesap adı bilerek tür etiketinden ("Kasa") FARKLI seçildi: aynı satırda hem ad hem tür
    // hücresi olduğu için "Kasa" adı, locator'ı iki hücreye birden eşleştirirdi.
    await fillAccountForm(page, { name: "Merkez Nakit", type: "CASH", currency: "TRY" });
    await submit(page);

    await expectRow(page, "Merkez Nakit");

    const accounts = await apiAccounts(page, tenantId);
    expect(accounts[0].balance).toBe("0");
    expect(accounts[0].type).toBe("CASH");
  });

  test("aynı isim ikinci kez kullanılamıyor (formda hata, yeni kayıt yok)", async ({ page }) => {
    await signUpAndSignIn(page, "accounts-dup");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/accounts");
    await fillAccountForm(page, { name: "Tek Hesap", currency: "TRY" });
    await submit(page);
    await expectRow(page, "Tek Hesap");

    await fillAccountForm(page, { name: "Tek Hesap", currency: "TRY" });
    await submit(page);

    await expect(formAlert(page)).toContainText("zaten var", { timeout: ROW_TIMEOUT_MS });
    expect(await apiAccounts(page, tenantId)).toHaveLength(1);
  });

  test("geçersiz bakiye biçimi formda hata veriyor ve kayıt oluşmuyor", async ({ page }) => {
    await signUpAndSignIn(page, "accounts-badmoney");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/accounts");
    // 4'ten fazla ondalık: `Decimal(19,4)` şemasının kabul etmediği bir değer.
    await fillAccountForm(page, { name: "Hatali", currency: "TRY", balance: "10.12345" });
    await submit(page);

    await expect(formAlert(page)).toContainText("Bilgileri kontrol edin", {
      timeout: ROW_TIMEOUT_MS,
    });
    expect(await apiAccounts(page, tenantId)).toHaveLength(0);
  });
});

test.describe("/accounts — yetki ve tenant durumu", () => {
  test("MEMBER listeyi görüyor ama oluşturma formunu görmüyor", async ({ page }) => {
    const viewerId = await signUpAndSignIn(page, "accounts-viewer");

    const tenant = await prisma.tenant.create({
      data: { name: "Baska Alan", slug: `accounts-viewer-${randomUUID()}` },
      select: { id: true },
    });
    createdTenantIds.push(tenant.id);

    await prisma.account.create({
      data: { tenantId: tenant.id, name: "Ortak Kasa", type: "CASH", currency: "TRY", balance: "42.5000" },
    });
    await prisma.membership.create({
      data: { userId: viewerId, tenantId: tenant.id, role: "MEMBER" },
    });

    const activated = await page.request.post("/api/tenants/active", { data: { tenantId: tenant.id } });
    expect(activated.status()).toBe(200);

    await page.goto("/accounts");

    // İzin matrisi MEMBER'a VIEW_ACCOUNTS verir: liste görünür.
    await expect(page.getByRole("cell", { name: "Ortak Kasa" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "42.5 TRY" })).toBeVisible();

    // Ama yönetim formu HİÇ render edilmez.
    await expect(page.getByLabel("Hesap adı")).toHaveCount(0);

    // Asıl kontrol arayüzde değil backend'de: form baypas edilirse 403 gelir.
    const forced = await page.request.post(`/api/tenants/${tenant.id}/accounts`, {
      data: { name: "Zorla", type: "BANK", currency: "TRY" },
    });
    expect(forced.status()).toBe(403);
  });

  test("aktif çalışma alanı yokken liste yerine yönlendirici metin gösteriliyor", async ({ page }) => {
    await signUpAndSignIn(page, "accounts-notenant");

    await page.goto("/accounts");

    await expect(page.getByText("Önce üstteki menüden bir çalışma alanı seçin")).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByLabel("Hesap adı")).toHaveCount(0);
  });
});
