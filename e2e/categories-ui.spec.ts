import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import { signInWithCredentials } from "./support/auth";
import { uniqueTestClientIp } from "./support/rate-limit";

/**
 * Kategori ekranı — gerçek tarayıcıda, gerçek API'ye karşı (Issue #50).
 *
 * `accounts-ui.spec.ts` ile aynı duruş: sonuç her zaman bağımsız bir okuma yoluyla
 * (`GET /api/tenants/:id/categories`) doğrulanır — listede bir satırın görünmesi tek başına
 * "sunucuda gerçekten oluştu" demek değildir.
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
    data: { name: "Kategori Ekrani", slug: `categories-ui-${randomUUID()}` },
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

async function apiCategories(
  page: Page,
  tenantId: string,
): Promise<Array<{ name: string; type: string }>> {
  const response = await page.request.get(`/api/tenants/${tenantId}/categories`);
  expect(response.status()).toBe(200);

  return ((await response.json()) as { categories: Array<{ name: string; type: string }> })
    .categories;
}

async function fillCategoryForm(page: Page, values: { name: string; type?: string }) {
  await page.getByLabel("Kategori adı").fill(values.name);
  if (values.type) {
    await page.getByLabel("Tür").selectOption(values.type);
  }
}

function submit(page: Page) {
  return page.getByRole("button", { name: /kategori oluştur/i }).click();
}

function formAlert(page: Page) {
  return page.locator("form").getByRole("alert");
}

test.describe("/categories — oluşturma ve listeleme", () => {
  test("menüden gidilip kategori oluşturuluyor ve listede görünüyor", async ({ page }) => {
    await signUpAndSignIn(page, "categories-create");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/dashboard");
    await page
      .getByRole("navigation", { name: "Ana menü" })
      .getByRole("link", { name: "Kategoriler" })
      .click();
    await expect(page).toHaveURL(/\/categories$/);

    // Boş durum: henüz kategori yok.
    await expect(page.getByText("Henüz kategori yok")).toBeVisible();

    await fillCategoryForm(page, { name: "Kira Gideri", type: "EXPENSE" });
    await submit(page);

    // Liste sunucudan yeniden render edilir.
    await expect(page.getByRole("cell", { name: "Kira Gideri" })).toBeVisible();

    // Asıl kanıt: kayıt sunucuda var.
    const categories = await apiCategories(page, tenantId);
    expect(categories).toHaveLength(1);
    expect(categories[0]).toMatchObject({ name: "Kira Gideri", type: "EXPENSE" });
  });

  test("aynı isim gelir ve gider tarafında ayrı ayrı kullanılabiliyor", async ({ page }) => {
    await signUpAndSignIn(page, "categories-bothtypes");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/categories");

    // Bu, #49'un `@@unique([tenantId, type, name])` kararının uçtan uca kanıtıdır: "Faiz"
    // hem gelir hem gider tarafında doğal bir isimdir ve ikisi de kabul edilmelidir.
    await fillCategoryForm(page, { name: "Faiz", type: "EXPENSE" });
    await submit(page);
    await expect(page.getByRole("cell", { name: "Gider" })).toBeVisible();

    await fillCategoryForm(page, { name: "Faiz", type: "INCOME" });
    await submit(page);
    await expect(page.getByRole("cell", { name: "Gelir" })).toBeVisible();

    // Formda hata YOK: ikinci kayıt reddedilmedi.
    await expect(formAlert(page)).toHaveCount(0);

    const categories = await apiCategories(page, tenantId);
    expect(categories).toHaveLength(2);
    expect(categories.map((category) => category.type).sort()).toEqual(["EXPENSE", "INCOME"]);
  });

  test("aynı tür içinde aynı isim ikinci kez kullanılamıyor (formda hata, yeni kayıt yok)", async ({
    page,
  }) => {
    await signUpAndSignIn(page, "categories-dup");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/categories");
    await fillCategoryForm(page, { name: "Market", type: "EXPENSE" });
    await submit(page);
    await expect(page.getByRole("cell", { name: "Market" })).toBeVisible();

    await fillCategoryForm(page, { name: "Market", type: "EXPENSE" });
    await submit(page);

    // Mesaj TÜRÜ de söyler: benzersizlik tenant + tür + isim üzerindendir.
    await expect(formAlert(page)).toContainText("Bu türde bu isimde");
    expect(await apiCategories(page, tenantId)).toHaveLength(1);
  });

  test("geçersiz ad formda hata veriyor ve kayıt oluşmuyor", async ({ page }) => {
    await signUpAndSignIn(page, "categories-badname");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/categories");
    // Tek karakter: `isValidCategoryName()`'in alt sınırının (2) altında.
    await fillCategoryForm(page, { name: "A", type: "EXPENSE" });
    await submit(page);

    await expect(formAlert(page)).toContainText("Bilgileri kontrol edin");
    expect(await apiCategories(page, tenantId)).toHaveLength(0);
  });

  test("başarılı kayıttan sonra ad temizleniyor ama tür seçimi korunuyor", async ({ page }) => {
    await signUpAndSignIn(page, "categories-formstate");
    await createAndActivateTenant(page);

    await page.goto("/categories");
    await fillCategoryForm(page, { name: "Maas", type: "INCOME" });
    await submit(page);
    await expect(page.getByRole("cell", { name: "Maas" })).toBeVisible();

    // Kullanıcı genellikle arka arkaya aynı taraftan kategori girer; türün sıfırlanması
    // her kayıtta yeniden seçmeyi gerektirirdi.
    await expect(page.getByLabel("Kategori adı")).toHaveValue("");
    await expect(page.getByLabel("Tür")).toHaveValue("INCOME");
  });
});

test.describe("/categories — yetki ve tenant durumu", () => {
  test("MEMBER listeyi görüyor ama oluşturma formunu görmüyor", async ({ page }) => {
    const viewerId = await signUpAndSignIn(page, "categories-viewer");

    const tenant = await prisma.tenant.create({
      data: { name: "Baska Alan", slug: `categories-viewer-${randomUUID()}` },
      select: { id: true },
    });
    createdTenantIds.push(tenant.id);

    // Ad bilerek tür etiketini ("Gider") İÇERMEZ: `getByRole("cell", { name })` varsayılan
    // olarak alt dize eşlemesi yapar, bu yüzden "Ortak Gider" adı aşağıdaki tür hücresi
    // locator'ını iki hücreye birden eşleştirirdi (bkz. `accounts-ui.spec.ts`'teki aynı tuzak).
    await prisma.category.create({
      data: { tenantId: tenant.id, name: "Ortak Harcama", type: "EXPENSE" },
    });
    await prisma.membership.create({
      data: { userId: viewerId, tenantId: tenant.id, role: "MEMBER" },
    });

    const activated = await page.request.post("/api/tenants/active", {
      data: { tenantId: tenant.id },
    });
    expect(activated.status()).toBe(200);

    await page.goto("/categories");

    // İzin matrisi MEMBER'a VIEW_CATEGORIES verir: liste görünür (işlem kaydederken seçecek).
    await expect(page.getByRole("cell", { name: "Ortak Harcama" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Gider" })).toBeVisible();

    // Ama yönetim formu HİÇ render edilmez.
    await expect(page.getByLabel("Kategori adı")).toHaveCount(0);

    // Asıl kontrol arayüzde değil backend'de: form baypas edilirse 403 gelir.
    const forced = await page.request.post(`/api/tenants/${tenant.id}/categories`, {
      data: { name: "Zorla", type: "EXPENSE" },
    });
    expect(forced.status()).toBe(403);
  });

  test("aktif çalışma alanı yokken liste yerine yönlendirici metin gösteriliyor", async ({
    page,
  }) => {
    await signUpAndSignIn(page, "categories-notenant");

    await page.goto("/categories");

    await expect(page.getByText("Önce üstteki menüden bir çalışma alanı seçin")).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByLabel("Kategori adı")).toHaveCount(0);
  });
});
