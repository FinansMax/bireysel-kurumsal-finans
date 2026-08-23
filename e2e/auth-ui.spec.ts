import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { uniqueTestClientIp } from "./support/rate-limit";

/**
 * Login ve signup ekranları — gerçek tarayıcıda, gerçek API'ye karşı (Issue #36).
 *
 * Mock YOKTUR: formlar gerçek `/api/auth/signup` ve Auth.js credentials akışını kullanır,
 * oturum gerçek cookie ile kurulur ve `/api/auth/me` ile doğrulanır.
 */

const PASSWORD = "S3curePassw0rd!";

/**
 * Her test kendi sahte istemci IP'siyle çalışır (bkz. `e2e/support/rate-limit.ts`).
 *
 * Bu, API testlerindeki bilinen tuzağın TARAYICI tarafındaki hâlidir: signup IP başına
 * 5/10dk ile sınırlıdır (Issue #27) ve tarayıcıdan gönderilen tüm formlar varsayılan olarak
 * AYNI bucket'ı paylaşır — birkaç testten sonra hepsi 429 alır ve hatalar "form hatalı mesaj
 * gösteriyor" gibi görünür. `setExtraHTTPHeaders`, sayfadan çıkan tüm isteklere (belge, fetch,
 * XHR) header'ı ekler. Rate limiter BAYPAS EDİLMEZ; yalnızca gerçek trafikte doğal olarak var
 * olan "farklı istemciler farklı IP'lerden gelir" durumu simüle edilir.
 */
test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestClientIp() });
});

/** `page.request` çağrıları sayfanın extra header'larını devralmaz; açıkça verilir. */
function apiHeaders(): Record<string, string> {
  return { "x-forwarded-for": uniqueTestClientIp() };
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID()}@example.com`;
}

async function fillCredentials(page: Page, email: string, password: string) {
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill(password);
}

/**
 * Form içindeki hata kutusu. `page.getByRole("alert")` KULLANILMAZ: Next.js sayfa
 * geçişlerinde body seviyesinde kendi `role="alert"` route announcer'ını render eder ve
 * locator iki elemana birden eşleşip strict mode ihlali verir. Form'a scope'lamak, testin
 * gerçekten formun gösterdiği mesajı okumasını garanti eder.
 */
function formAlert(page: Page) {
  return page.locator("form").getByRole("alert");
}

/** Formu gönderip yönlendirmenin tamamlanmasını bekler. */
async function submit(page: Page, name: RegExp) {
  await page.getByRole("button", { name }).click();
}

test.describe("/signup — kayıt ekranı", () => {
  test("geçerli bilgiyle kayıt olunca /login'e yönlendiriliyor", async ({ page }) => {
    const email = uniqueEmail("ui-signup");

    await page.goto("/signup");
    await fillCredentials(page, email, PASSWORD);
    await submit(page, /kayıt ol/i);

    await expect(page).toHaveURL(/\/login$/);

    // Kontrol grubu: kullanıcı GERÇEKTEN oluşmuş olmalı — yönlendirme tek başına kanıt değil.
    // Aynı e-postayla ikinci kayıt denemesi 409'a düşer.
    const second = await page.request.post("/api/auth/signup", {
      data: { email, password: PASSWORD },
      headers: apiHeaders(),
    });
    expect(second.status()).toBe(409);
  });

  test("zaten kayıtlı e-posta formda görünür hata veriyor", async ({ page }) => {
    const email = uniqueEmail("ui-signup-dup");
    const created = await page.request.post("/api/auth/signup", {
      data: { email, password: PASSWORD },
      headers: apiHeaders(),
    });
    expect(created.status()).toBe(201);

    await page.goto("/signup");
    await fillCredentials(page, email, PASSWORD);
    await submit(page, /kayıt ol/i);

    await expect(formAlert(page)).toContainText("zaten kayıtlı");
    // Hata durumunda yönlendirme OLMAMALI.
    await expect(page).toHaveURL(/\/signup$/);
  });

  test("zayıf şifre formda görünür hata veriyor", async ({ page }) => {
    await page.goto("/signup");
    await fillCredentials(page, uniqueEmail("ui-signup-weak"), "short");
    await submit(page, /kayıt ol/i);

    await expect(formAlert(page)).toContainText("en az 8 karakter");
    await expect(page).toHaveURL(/\/signup$/);
  });
});

test.describe("/login — giriş ekranı", () => {
  test("kayıt + giriş uçtan uca çalışıyor ve oturum kuruluyor", async ({ page }) => {
    const email = uniqueEmail("ui-login");

    await page.goto("/signup");
    await fillCredentials(page, email, PASSWORD);
    await submit(page, /kayıt ol/i);
    await expect(page).toHaveURL(/\/login$/);

    await fillCredentials(page, email, PASSWORD);
    await submit(page, /giriş yap/i);

    await expect(page).toHaveURL(/\/$/);

    // Asıl kanıt: sunucu tarafında gerçek bir oturum var mı?
    const me = await page.request.get("/api/auth/me");
    expect(me.status()).toBe(200);
    expect(((await me.json()) as { user: { email: string } }).user.email).toBe(email);
  });

  test("yanlış şifre bilgi sızdırmayan genel hata gösteriyor", async ({ page }) => {
    const email = uniqueEmail("ui-login-wrong");
    await page.request.post("/api/auth/signup", { data: { email, password: PASSWORD }, headers: apiHeaders() });

    await page.goto("/login");
    await fillCredentials(page, email, "WrongPassw0rd!");
    await submit(page, /giriş yap/i);

    const alert = formAlert(page);
    await expect(alert).toBeVisible();

    // Mesaj, e-postanın kayıtlı OLDUĞUNU ele vermemeli.
    const message = (await alert.textContent()) ?? "";
    expect(message).not.toMatch(/kayıtlı|bulunamadı|mevcut değil/i);

    // Oturum kurulmamış olmalı.
    expect((await page.request.get("/api/auth/me")).status()).toBe(401);
  });

  test("bilinmeyen e-posta, yanlış şifreyle AYNI mesajı gösteriyor (enumeration engeli)", async ({
    page,
  }) => {
    const registered = uniqueEmail("ui-login-known");
    await page.request.post("/api/auth/signup", { data: { email: registered, password: PASSWORD }, headers: apiHeaders() });

    await page.goto("/login");
    await fillCredentials(page, registered, "WrongPassw0rd!");
    await submit(page, /giriş yap/i);
    const knownMessage = await formAlert(page).textContent();

    await page.goto("/login");
    await fillCredentials(page, uniqueEmail("ui-login-unknown"), "WrongPassw0rd!");
    await submit(page, /giriş yap/i);
    const unknownMessage = await formAlert(page).textContent();

    expect(knownMessage).toBe(unknownMessage);
  });
});

test.describe("Auth ekranları — gezinme", () => {
  test("login ve signup birbirine bağlanıyor", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: /kayıt olun/i }).click();
    await expect(page).toHaveURL(/\/signup$/);

    await page.getByRole("link", { name: /giriş yapın/i }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
