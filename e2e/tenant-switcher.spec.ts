import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { signInWithCredentials } from "./support/auth";
import { uniqueTestClientIp } from "./support/rate-limit";

/**
 * Kabuktaki tenant (çalışma alanı) seçici — gerçek tarayıcıda, gerçek API'ye karşı (Issue #40).
 *
 * Mock YOKTUR: tenant'lar `POST /api/tenants` ile gerçekten oluşturulur, seçim
 * `POST /api/tenants/active`'e gider, sonuç aktif tenant cookie'siyle korunan gerçek bir
 * endpoint (`GET /api/tenants/:id/members`) üzerinden doğrulanır.
 *
 * NEDEN KANIT OLARAK ÜYE LİSTESİ ENDPOINT'İ: seçicinin kutusunda doğru ismin görünmesi tek
 * başına kanıt değildir (o değer istemcide de değişmiş olabilir). `requirePermission()`
 * URL'deki tenantId aktif tenant ile eşleşmezse 403 döner (bkz. `src/lib/authz/authorize.ts`);
 * yani "A için 200, B için 403" cevabı, cookie'nin sunucu tarafında GERÇEKTEN değiştiğini
 * gösterir.
 */

const PASSWORD = "S3curePassw0rd!";

/** Her test kendi sahte istemci IP'siyle çalışır — bkz. `e2e/auth-ui.spec.ts`'teki gerekçe. */
test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestClientIp() });
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

  return email;
}

/** Oturum sahibi adına gerçek bir tenant oluşturur; oluşturan OWNER olur. */
async function createTenant(page: Page, name: string): Promise<{ id: string; name: string }> {
  const response = await page.request.post("/api/tenants", {
    data: { name, slug: `${name.toLowerCase()}-${randomUUID()}` },
    headers: apiHeaders(),
  });
  expect(response.status()).toBe(201);

  const body = (await response.json()) as { tenant: { id: string; name: string } };
  return body.tenant;
}

function switcher(page: Page) {
  return page.getByLabel("Çalışma alanı");
}

/**
 * Seçim yapıp sayfanın YENİDEN YÜKLENMESİNİ bekler.
 *
 * `load` beklemeden yapılan bir assertion yanıltıcıdır: `<select>`'in değeri POST tamamlanmadan
 * da istemcide değişmiş görünür. Beklenen şey, sunucunun yeni cookie ile yeniden render
 * etmesidir.
 */
async function switchTo(page: Page, label: string) {
  await Promise.all([page.waitForEvent("load"), switcher(page).selectOption({ label })]);
}

/** Aktif tenant'a bağlı gerçek bir korumalı endpoint'in bu tenant için verdiği status. */
async function membersStatus(page: Page, tenantId: string): Promise<number> {
  const response = await page.request.get(`/api/tenants/${tenantId}/members`);
  return response.status();
}

test.describe("Tenant switcher — geçiş", () => {
  test("kullanıcı üyesi olduğu tenant'lar arasında geçiş yapabiliyor", async ({ page }) => {
    await signUpAndSignIn(page, "switcher-move");
    const alfa = await createTenant(page, "Alfa");
    const beta = await createTenant(page, "Beta");

    await page.goto("/dashboard");

    // Başlangıçta aktif tenant YOKTUR: "GET yan etkisizdir" invariant'ı gereği sayfa render'ı
    // sırasında otomatik seçim yapılmaz (cookie yazılmaz). Duyarlılık kanıtı: aktif tenant
    // olmadan korumalı endpoint 400 döner.
    await expect(switcher(page)).toHaveValue("");
    expect(await membersStatus(page, alfa.id)).toBe(400);

    await switchTo(page, "Alfa");

    expect(await membersStatus(page, alfa.id)).toBe(200);
    // Kontrol grubu: aktif tenant Alfa iken Beta'ya erişim 403 — yani cookie gerçekten
    // Alfa'yı işaret ediyor, "her şeye 200" veren bir durum yok.
    expect(await membersStatus(page, beta.id)).toBe(403);

    await switchTo(page, "Beta");

    expect(await membersStatus(page, beta.id)).toBe(200);
    expect(await membersStatus(page, alfa.id)).toBe(403);

    // Sunucu, yeniden render'da seçili değeri de doğru gösteriyor.
    await expect(switcher(page)).toHaveValue(beta.id);
  });

  test("seçici yalnızca kullanıcının kendi tenant'larını listeliyor", async ({ page }) => {
    await signUpAndSignIn(page, "switcher-own");
    await createTenant(page, "Kendi Alani");

    // Başka bir kullanıcının tenant'ı — aynı tarayıcıda değil, ayrı bir istemci bağlamında
    // oluşturulur; bu kullanıcının listesinde ASLA görünmemeli.
    const foreign = await createForeignTenant(page);

    await page.goto("/dashboard");

    const options = switcher(page).locator("option");
    await expect(options).toHaveText(["Çalışma alanı seçin", "Kendi Alani"]);
    await expect(options.filter({ hasText: foreign.name })).toHaveCount(0);
  });
});

test.describe("Tenant switcher — yetki sınırı", () => {
  test("üyesi olmadığı bir tenant seçilemiyor (arayüz gizlese de backend reddediyor)", async ({
    page,
  }) => {
    await signUpAndSignIn(page, "switcher-foreign");
    const own = await createTenant(page, "Benim Alanim");
    const foreign = await createForeignTenant(page);

    await page.goto("/dashboard");
    await switchTo(page, "Benim Alanim");
    expect(await membersStatus(page, own.id)).toBe(200);

    // Arayüzün listeyi kısıtlaması bir GÜVENLİK kontrolü değildir; asıl kontrol backend'de.
    // Seçici baypas edilip endpoint'e doğrudan istek atılırsa 403 alınır.
    const forced = await page.request.post("/api/tenants/active", {
      data: { tenantId: foreign.id },
    });
    expect(forced.status()).toBe(403);

    // Ve aktif tenant DEĞİŞMEMİŞTİR: kendi tenant'ı hâlâ erişilebilir, yabancı tenant değil.
    expect(await membersStatus(page, own.id)).toBe(200);
    expect(await membersStatus(page, foreign.id)).toBe(403);
  });
});

test.describe("Tenant switcher — hiç tenant yokken", () => {
  test("tenant'ı olmayan kullanıcıya seçici yerine durum metni gösteriliyor", async ({ page }) => {
    await signUpAndSignIn(page, "switcher-empty");

    await page.goto("/dashboard");

    await expect(page.getByRole("banner").getByText("Çalışma alanı yok")).toBeVisible();
    await expect(switcher(page)).toHaveCount(0);
  });
});

/**
 * BAŞKA bir kullanıcıya ait tenant oluşturur.
 *
 * Ayrı bir istemci bağlamı (`page.context().request` değil, yeni bir request context) yerine
 * aynı sayfanın request'i kullanılamaz — cookie kavanozu paylaşıldığı için oturum çakışırdı.
 * Bu yüzden Playwright'ın bağlamsız `request` fixture'ı gibi davranan yeni bir tarayıcı
 * bağlamı açılır ve iş bitince kapatılır.
 */
async function createForeignTenant(page: Page): Promise<{ id: string; name: string }> {
  const browser = page.context().browser();
  if (!browser) {
    throw new Error("Tarayıcı bağlamı alınamadı (test kurulumu hatası)");
  }

  const context = await browser.newContext();
  try {
    const foreignPage = await context.newPage();
    await foreignPage.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestClientIp() });

    await signUpAndSignIn(foreignPage, "switcher-foreign-owner");
    return await createTenant(foreignPage, "Yabanci Alan");
  } finally {
    await context.close();
  }
}
