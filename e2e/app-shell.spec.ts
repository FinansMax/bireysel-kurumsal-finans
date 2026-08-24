import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { signInWithCredentials } from "./support/auth";
import { uniqueTestClientIp } from "./support/rate-limit";

/**
 * Korumalı uygulama kabuğu — gerçek tarayıcıda, gerçek oturumla (Issue #39).
 *
 * Mock YOKTUR: oturum gerçek Auth.js credentials akışıyla kurulur, kabuk gerçek sunucu
 * bileşeninden render edilir, çıkış gerçek `/api/auth/signout` isteğini atar.
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

/**
 * Kullanıcıyı oluşturup oturumu açar.
 *
 * `page.request`, sayfayla AYNI browser context'inin cookie kavanozunu kullanır — bu yüzden
 * API üzerinden kurulan oturum, ardından `page.goto()` ile açılan sayfada da geçerlidir.
 * (Kabuk testleri için form doldurmak gereksiz; login formunun kendisi
 * `e2e/auth-ui.spec.ts`'te test edilir.)
 */
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

function mainNav(page: Page) {
  return page.getByRole("navigation", { name: "Ana menü" });
}

test.describe("Korumalı kabuk — oturumsuz erişim", () => {
  test("oturumsuz kullanıcı /dashboard'a girince /login'e yönleniyor", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page).toHaveURL(/\/login$/);

    // Kontrol grubu: yönlendirme tek başına yetmez — kabuğun hiçbir parçası (nav, çıkış
    // düğmesi) render edilmemiş olmalı. Aksi halde "yönlendirdim ama içeriği de yolladım"
    // durumu testten kaçardı.
    await expect(mainNav(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /çıkış yap/i })).toHaveCount(0);
  });

  test("yönlendirme, sunucu tarafında da korumalı olduğunun kanıtıdır (oturum yok)", async ({
    page,
  }) => {
    // Duyarlılık kanıtı: aynı istemcide oturum GERÇEKTEN yok — API de 401 diyor. Böylece
    // yukarıdaki yönlendirme, "zaten oturum vardı ama yine de attı" gibi yorumlanamaz.
    expect((await page.request.get("/api/auth/me")).status()).toBe(401);
  });
});

test.describe("Korumalı kabuk — oturumlu erişim", () => {
  test("giriş yapmış kullanıcı kabuğu ve navigasyonu görüyor", async ({ page }) => {
    const email = await signUpAndSignIn(page, "shell-view");

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);

    // Kimlik göstergesi: e-posta (bkz. `src/components/app-shell.tsx` — JWT'deki `name`
    // Issue #113 nedeniyle bayat kalabiliyor). Locator, sayfa gövdesine değil KABUĞA
    // (`<header>` = banner rolü) scope'lanır: dashboard metni de e-postayı içerdiği için
    // scope'suz bir arama iki elemana birden eşleşir ve aslında kabuğu doğrulamış olmaz.
    await expect(page.getByRole("banner").getByText(email)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Genel Bakış" })).toBeVisible();
    await expect(page.getByRole("button", { name: /çıkış yap/i })).toBeVisible();

    const nav = mainNav(page);
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link", { name: "Genel Bakış" })).toBeVisible();

    // Henüz var olmayan ekranlar LİNK DEĞİLDİR: link olsalardı kullanıcıyı 404'e
    // götürürlerdi (bkz. `NAV_ITEMS`).
    //
    // Örnek olarak "Raporlar" (#63) seçildi — bu kontrol, ekranı yazılan bir menü öğesine
    // bağlanırsa o issue geldiğinde kırılır. Nitekim "Hesaplar" #47 ile gerçek bir bağlantıya
    // dönüştü; buradaki öğe de #63 geldiğinde hâlâ placeholder olan bir başkasıyla
    // değiştirilmeli (kontrolün amacı "şu öğe link olmasın" değil, "placeholder'lar link
    // olmasın"dır).
    await expect(nav.getByText("Raporlar")).toBeVisible();
    await expect(nav.getByRole("link", { name: "Raporlar" })).toHaveCount(0);
  });

  test("public ekranlar kabuğu almıyor", async ({ page }) => {
    await signUpAndSignIn(page, "shell-public");

    // Kabuk yalnızca `(app)` route group'unun altındadır; `/login` root layout'ta kalır.
    // Oturum açıkken bile orada nav/çıkış düğmesi görünmemeli.
    await page.goto("/login");
    await expect(mainNav(page)).toHaveCount(0);
  });
});

test.describe("Korumalı kabuk — çıkış", () => {
  test("çıkış yapınca /login'e dönülüyor ve korumalı sayfa erişilemez oluyor", async ({ page }) => {
    await signUpAndSignIn(page, "shell-signout");

    await page.goto("/dashboard");
    await page.getByRole("button", { name: /çıkış yap/i }).click();

    await expect(page).toHaveURL(/\/login$/);

    // Asıl kanıt: oturum GERÇEKTEN kapandı mı? Sadece yönlendirmeye bakmak, cookie duruyorken
    // de geçerdi.
    expect((await page.request.get("/api/auth/me")).status()).toBe(401);

    // Ve korumalı rota artık yine login'e atıyor.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });
});
