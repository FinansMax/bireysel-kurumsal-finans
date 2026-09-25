import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { signInWithCredentials } from "./support/auth";
import { markEmailVerified } from "./support/email-verification";
import { uniqueTestClientIp } from "./support/rate-limit";

/**
 * Kalıcı "e-postanı doğrula" uyarı şeridi — gerçek tarayıcıda (Issue #190).
 *
 * NEDEN E2E: şeridin var olup olmaması, kabuk layout'unun her istekte veritabanından okuduğu bir
 * duruma bağlı. Bunu birim testiyle kanıtlamak mümkün değil; kanıtlanması gereken şey "bileşen
 * doğru render ediliyor mu" değil, "durum doğru yerden okunuyor mu".
 */

const PASSWORD = "S3curePassw0rd!";

/** Her test kendi sahte istemci IP'siyle çalışır — bkz. `e2e/auth-ui.spec.ts`'teki gerekçe. */
test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestClientIp() });
});

async function signUpAndSignIn(
  page: Page,
  prefix: string,
  options: { verifyEmail?: boolean } = {},
): Promise<string> {
  const email = `${prefix}-${randomUUID()}@example.com`;

  const created = await page.request.post("/api/auth/signup", {
    data: { email, password: PASSWORD },
    headers: { "x-forwarded-for": uniqueTestClientIp() },
  });
  expect(created.status()).toBe(201);

  if (options.verifyEmail) {
    await markEmailVerified(email);
  }

  const signedIn = await signInWithCredentials(page.request, email, PASSWORD);
  expect(signedIn.status()).toBe(302);
  expect(signedIn.headers()["location"] ?? "").not.toContain("error=");

  return email;
}

/** Kabuktaki şerit — form içindeki `role="status"` öğelerinden ayırmak için metinle daraltılır. */
function banner(page: Page) {
  return page.getByRole("status").filter({ hasText: "E-posta adresiniz doğrulanmadı" });
}

test.describe("Kabuk — e-posta doğrulama şeridi", () => {
  test("doğrulanmamış kullanıcı şeridi ve kendi adresini görüyor", async ({ page }) => {
    const email = await signUpAndSignIn(page, "banner-unverified");

    await page.goto("/dashboard");

    await expect(banner(page)).toBeVisible();
    // Adres ŞERİDİN İÇİNDE yazılı: kullanıcı hangi kutuya bakacağını bilmeli. (Kendi adresi,
    // kendi oturumu — sızıntı değil.)
    await expect(banner(page)).toContainText(email);
    await expect(banner(page)).toContainText("çalışma alanı oluşturamaz");
  });

  test("KONTROL GRUBU: doğrulanmış kullanıcıda şerit YOK", async ({ page }) => {
    // Bu test olmadan, şeridi HERKESE gösteren bir regresyon fark edilmezdi.
    await signUpAndSignIn(page, "banner-verified", { verifyEmail: true });

    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
  });

  test("doğrulama tamamlanınca şerit BİR SONRAKİ istekte kayboluyor", async ({ page }) => {
    // #190'ın kararı: durum her istekte DB'den okunur, session claim'ine yazılmaz. Kullanıcı
    // e-postasını başka bir sekmede doğruladığında şerit, token yenilenmesini BEKLEMEDEN
    // kaybolmalı. Bu test tam olarak o kararı sabitler: oturum cookie'si hiç değişmiyor.
    const email = await signUpAndSignIn(page, "banner-becomes-verified");

    await page.goto("/dashboard");
    await expect(banner(page)).toBeVisible();

    await markEmailVerified(email);
    await page.reload();

    await expect(banner(page)).toHaveCount(0);
  });

  test("şeritteki aksiyon MEVCUT endpoint'e gönderiyor ve cooldown'a giriyor", async ({ page }) => {
    await signUpAndSignIn(page, "banner-resend");
    await page.goto("/dashboard");

    const button = banner(page).getByRole("button", {
      name: "Doğrulama e-postasını tekrar gönder",
    });
    await expect(button).toBeVisible();

    // Yeni bir endpoint yazılmadığının kanıtı: istek GERÇEKTEN mevcut route'a gidiyor.
    const resent = page.waitForResponse(
      (response) =>
        response.url().includes("/api/auth/resend-verification") &&
        response.request().method() === "POST",
    );
    await button.click();
    expect((await resent).status()).toBe(200);

    await expect(banner(page).getByRole("button", { name: "Gönderildi" })).toBeDisabled();
    // Süre dolunca geri açılır — kalıcı kilitlenme bir regresyondur.
    await expect(button).toBeEnabled({ timeout: 15_000 });
  });

  test("şerit oturumsuz ekranlarda YOK (kabuk dışı)", async ({ page }) => {
    // Şerit `(app)` route group'unun layout'unda; `/login` o kabuğu hiç almaz.
    await page.goto("/login");

    await expect(page.getByLabel("E-posta")).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
  });
});
