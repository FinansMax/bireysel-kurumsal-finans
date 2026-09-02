import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { markEmailVerified } from "./support/email-verification";
import { signInWithCredentials } from "./support/auth";
import { uniqueTestClientIp } from "./support/rate-limit";

/**
 * Tenant oluşturma ekranı — gerçek tarayıcıda, gerçek API'ye karşı (Issue #42).
 *
 * Mock YOKTUR: form `POST /api/tenants`'a gerçek istek atar, sonuç `GET /api/tenants` ile
 * (yani bağımsız bir okuma yoluyla) doğrulanır — "yönlendirme oldu" tek başına kanıt sayılmaz.
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
  // #190: doğrulanmamış hesap çalışma alanı kuramaz; bu testin konusu doğrulama DEĞİL,
  // onun ÖN KOŞULU (bkz. e2e/support/email-verification.ts).
  await markEmailVerified(email);
  expect(created.status()).toBe(201);

  const signedIn = await signInWithCredentials(page.request, email, PASSWORD);
  expect(signedIn.status()).toBe(302);
  expect(signedIn.headers()["location"] ?? "").not.toContain("error=");

  return email;
}

/** Kullanıcının tenant'ları — formun sonucunu formdan bağımsız doğrulayan okuma yolu. */
async function listTenants(page: Page): Promise<Array<{ id: string; slug: string; role: string }>> {
  const response = await page.request.get("/api/tenants");
  expect(response.status()).toBe(200);

  return ((await response.json()) as { tenants: Array<{ id: string; slug: string; role: string }> })
    .tenants;
}

/** Form içindeki hata kutusu — bkz. `e2e/auth-ui.spec.ts`'teki route announcer notu. */
function formAlert(page: Page) {
  return page.locator("form").getByRole("alert");
}

async function fillForm(page: Page, name: string, slug?: string) {
  await page.getByLabel("Çalışma alanı adı").fill(name);
  if (slug !== undefined) {
    await page.getByLabel("Adres (isteğe bağlı)").fill(slug);
  }
}

async function submit(page: Page) {
  await page.getByRole("button", { name: /oluştur/i }).click();
}

test.describe("/tenants/new — çalışma alanı oluşturma", () => {
  test("geçerli bilgiyle oluşturuluyor ve oluşturan OWNER oluyor", async ({ page }) => {
    await signUpAndSignIn(page, "ui-tenant-create");

    // Ekrana kabuktaki menüden gidilir: sayfanın gerçekten erişilebilir olduğunu da kanıtlar.
    await page.goto("/dashboard");
    await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Yeni Çalışma Alanı" }).click();
    await expect(page).toHaveURL(/\/tenants\/new$/);

    const slug = `ui-tenant-${randomUUID()}`;
    await fillForm(page, "Deneme Sirketi", slug);
    await submit(page);

    await expect(page).toHaveURL(/\/dashboard$/);

    // Asıl kanıt: kayıt gerçekten oluştu ve kullanıcı OWNER.
    const tenants = await listTenants(page);
    expect(tenants).toHaveLength(1);
    expect(tenants[0].slug).toBe(slug);
    expect(tenants[0].role).toBe("OWNER");
  });

  test("adres boş bırakılırsa isimden türetiliyor", async ({ page }) => {
    await signUpAndSignIn(page, "ui-tenant-autoslug");

    // İSİM DE BENZERSİZ OLMALI: slug global olarak unique'tir ve buradaki senaryoda isimden
    // türetilir. Sabit bir isim (ör. "Acme Kurumsal") ilk koşuda geçer, ikinci koşuda aynı
    // slug'a 409 alıp kırılırdı (bkz. docs/testing.md → "Test verisi izole ve benzersizdir").
    const suffix = randomUUID();

    await page.goto("/tenants/new");
    // Slug alanı HİÇ doldurulmaz: boş string göndermek backend'de "geçersiz slug" dalına
    // düşerdi; formun bu alanı tamamen atlaması gerekiyor.
    await fillForm(page, `Acme ${suffix}`);
    await submit(page);

    await expect(page).toHaveURL(/\/dashboard$/);

    const tenants = await listTenants(page);
    expect(tenants).toHaveLength(1);
    // `slugify()`: küçük harfe çevirir, alfanumerik olmayan her diziyi tek tireye indirir.
    expect(tenants[0].slug).toBe(`acme-${suffix}`);
  });

  test("kullanılan adres formda anlamlı hata gösteriyor ve ikinci kayıt oluşmuyor", async ({
    page,
  }) => {
    await signUpAndSignIn(page, "ui-tenant-dup");

    const slug = `ui-dup-${randomUUID()}`;
    const first = await page.request.post("/api/tenants", {
      data: { name: "Ilk Sirket", slug },
      headers: apiHeaders(),
    });
    expect(first.status()).toBe(201);

    await page.goto("/tenants/new");
    await fillForm(page, "Ikinci Sirket", slug);
    await submit(page);

    await expect(formAlert(page)).toContainText("zaten kullanılıyor");
    // Hata durumunda yönlendirme OLMAMALI.
    await expect(page).toHaveURL(/\/tenants\/new$/);

    // Kontrol grubu: gerçekten ikinci bir tenant oluşmadı.
    const tenants = await listTenants(page);
    expect(tenants).toHaveLength(1);
  });

  test("geçersiz ad formda hata gösteriyor ve hiçbir şey oluşmuyor", async ({ page }) => {
    await signUpAndSignIn(page, "ui-tenant-invalid");

    await page.goto("/tenants/new");
    await fillForm(page, "A");
    await submit(page);

    await expect(formAlert(page)).toContainText("2-100 karakter");
    await expect(page).toHaveURL(/\/tenants\/new$/);

    expect(await listTenants(page)).toHaveLength(0);
  });

  test("oturumsuz kullanıcı /tenants/new'a giremiyor", async ({ page }) => {
    await page.goto("/tenants/new");

    await expect(page).toHaveURL(/\/login$/);
    // Kontrol grubu: form hiç render edilmemiş olmalı.
    await expect(page.getByLabel("Çalışma alanı adı")).toHaveCount(0);
  });
});
