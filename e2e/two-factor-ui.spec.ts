import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { totpCode, TOTP_STEP_SECONDS } from "../src/lib/auth/totp";
import { prisma } from "../src/lib/prisma";

import { signInWithCredentials } from "./support/auth";
import { uniqueTestClientIp } from "./support/rate-limit";

// Hata metinleri `getByText` ile aranır, `getByRole("alert")` ile DEĞİL: Next.js sayfaya
// kendi `role="alert"` route duyurucusunu ekler ve rol seçicisi iki öğe bulur.

/**
 * İki faktörlü doğrulama arayüzü — gerçek tarayıcıda, gerçek API'ye karşı (Issue #229).
 *
 * TOTP kodu testte GERÇEK algoritmayla üretilir (`totpCode`), mock yok. Kurulum onayı mevcut
 * zaman adımını tüketir (replay koruması, #193); bu yüzden girişte BİR SONRAKİ adımın kodu
 * kullanılır — doğrulama penceresi ±1 adımdır.
 *
 * Sonuç daima bağımsız bir okumayla (DB) da doğrulanır: ekranda "Açık." yazması tek başına
 * "sunucuda 2FA gerçekten aktif" demek değildir.
 */

const PASSWORD = "S3curePassw0rd!";
const NAV_TIMEOUT_MS = 15_000;

const createdUserIds: string[] = [];

test.beforeEach(async ({ page }) => {
  // TOTP ve sign-in rate limit bucket'ları IP başınadır; testler birbirini tüketmesin.
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestClientIp() });
});

test.afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

function nextStepCode(secret: string): string {
  const code = totpCode(secret, Date.now() + TOTP_STEP_SECONDS * 1000);
  if (!code) throw new Error("TOTP kodu üretilemedi");
  return code;
}

async function signUpAndSignIn(page: Page): Promise<{ userId: string; email: string }> {
  const email = `twofa-ui-${randomUUID()}@example.com`;
  const created = await page.request.post("/api/auth/signup", {
    data: { email, password: PASSWORD },
    headers: { "x-forwarded-for": uniqueTestClientIp() },
  });
  expect(created.status()).toBe(201);

  const signedIn = await signInWithCredentials(page.request, email, PASSWORD);
  expect(signedIn.status()).toBe(302);

  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  createdUserIds.push(user.id);
  return { userId: user.id, email };
}

/** 2FA'yı API üzerinden açar (giriş testlerinin ön koşulu) ve sırrı + kodları döndürür. */
async function enableViaApi(page: Page): Promise<{ secret: string; recoveryCodes: string[] }> {
  // `page.request`, sayfanın `setExtraHTTPHeaders`'ını taşımaz; TOTP bucket'ı IP başına dar
  // (5/5dk) olduğu için benzersiz IP burada AÇIKÇA verilir.
  const headers = { "x-forwarded-for": uniqueTestClientIp() };
  const setup = await page.request.post("/api/auth/totp/setup", { headers });
  expect(setup.status()).toBe(200);
  const body = (await setup.json()) as { secret: string; recoveryCodes: string[] };

  const code = totpCode(body.secret);
  const confirmed = await page.request.post("/api/auth/totp/confirm", {
    data: { code },
    headers,
  });
  expect(confirmed.status()).toBe(200);
  return body;
}

async function startLogin(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
}

test.describe("/settings/security — 2FA kurulumu", () => {
  test("kodlar gösteriliyor, kaydedildi onayı olmadan ilerlenemiyor, doğrulayınca açılıyor", async ({
    page,
  }) => {
    const { userId } = await signUpAndSignIn(page);
    await page.goto("/settings/security");

    await page.getByRole("button", { name: "İki faktörlü doğrulamayı aç" }).click({
      timeout: NAV_TIMEOUT_MS,
    });

    const secret = (await page.getByLabel("Kurulum anahtarı").innerText()).replace(/\s+/g, "");
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);

    // Kodlar görünüyor ve BİR DAHA gösterilmeyeceği açıkça söyleniyor (#229 kabul kriteri).
    await expect(page.getByRole("list", { name: "Kurtarma kodları" }).getByRole("listitem")).toHaveCount(10);
    await expect(page.getByText("Bu kodlar bir daha gösterilmeyecek")).toBeVisible();

    // Onay kutusu işaretlenmeden doğrulama adımına geçilemez.
    const proceed = page.getByRole("button", { name: "Devam et" });
    await expect(proceed).toBeDisabled();
    await page.getByLabel("Kurtarma kodlarımı güvenli bir yere kaydettim.").check();
    await proceed.click();

    // Kodlar doğrulama adımında artık ekranda değil.
    await expect(page.getByRole("list", { name: "Kurtarma kodları" })).toHaveCount(0);

    const code = totpCode(secret);
    expect(code).not.toBeNull();
    await page.getByLabel("Doğrulama kodu").fill(code!);
    await page.getByRole("button", { name: "Doğrula ve aç" }).click();

    await expect(page.getByText("Açık.")).toBeVisible({ timeout: NAV_TIMEOUT_MS });

    // Bağımsız kanıt: sunucuda gerçekten onaylı.
    const record = await prisma.userTotpSecret.findUniqueOrThrow({
      where: { userId },
      select: { confirmedAt: true },
    });
    expect(record.confirmedAt).not.toBeNull();

    // Sır ve kodlar tarayıcı deposuna yazılmadı.
    const stored = await page.evaluate(() =>
      JSON.stringify({ ...window.localStorage, ...window.sessionStorage }),
    );
    expect(stored).not.toContain(secret);
  });

  test("yanlış kodla 2FA AÇILMIYOR", async ({ page }) => {
    const { userId } = await signUpAndSignIn(page);
    await page.goto("/settings/security");
    await page.getByRole("button", { name: "İki faktörlü doğrulamayı aç" }).click({
      timeout: NAV_TIMEOUT_MS,
    });
    await page.getByLabel("Kurtarma kodlarımı güvenli bir yere kaydettim.").check();
    await page.getByRole("button", { name: "Devam et" }).click();

    await page.getByLabel("Doğrulama kodu").fill("000000");
    await page.getByRole("button", { name: "Doğrula ve aç" }).click();

    await expect(page.getByText("Kod doğrulanamadı")).toBeVisible({ timeout: NAV_TIMEOUT_MS });
    const record = await prisma.userTotpSecret.findUnique({
      where: { userId },
      select: { confirmedAt: true },
    });
    expect(record?.confirmedAt ?? null).toBeNull();
  });
});

test.describe("/login — ikinci adım", () => {
  test("2FA açık kullanıcı doğrulama koduyla uçtan uca giriş yapıyor", async ({ page }) => {
    const { email } = await signUpAndSignIn(page);
    const { secret } = await enableViaApi(page);

    await startLogin(page, email);

    // Şifre doğru ama kod yok: ikinci adım açılır, şifre alanı korunur.
    const codeField = page.getByLabel("Doğrulama kodu");
    await expect(codeField).toBeVisible({ timeout: NAV_TIMEOUT_MS });
    await expect(page.getByLabel("Şifre")).toHaveValue(PASSWORD);
    await expect(page).toHaveURL(/\/login$/);

    await codeField.fill(nextStepCode(secret));
    await page.getByRole("button", { name: "Giriş yap" }).click();

    await expect(page).toHaveURL(/\/dashboard$/, { timeout: NAV_TIMEOUT_MS });
  });

  test("yanlış kod: giriş YOK, 'kod geçersiz' deniyor", async ({ page }) => {
    const { email } = await signUpAndSignIn(page);
    await enableViaApi(page);

    await startLogin(page, email);
    await page.getByLabel("Doğrulama kodu").fill("000000", { timeout: NAV_TIMEOUT_MS });
    await page.getByRole("button", { name: "Giriş yap" }).click();

    await expect(page.getByText("Doğrulama kodu geçersiz")).toBeVisible({ timeout: NAV_TIMEOUT_MS });
    await expect(page).toHaveURL(/\/login$/);
  });

  test("kurtarma koduyla giriş yapılabiliyor ve kod TÜKETİLİYOR", async ({ page }) => {
    const { email, userId } = await signUpAndSignIn(page);
    const { recoveryCodes } = await enableViaApi(page);

    await startLogin(page, email);
    await page
      .getByRole("button", { name: "Kurtarma kodu kullan" })
      .click({ timeout: NAV_TIMEOUT_MS });
    await page.getByLabel("Kurtarma kodu").fill(recoveryCodes[0]);
    await page.getByRole("button", { name: "Giriş yap" }).click();

    await expect(page).toHaveURL(/\/dashboard$/, { timeout: NAV_TIMEOUT_MS });
    expect(await prisma.userRecoveryCode.count({ where: { userId, usedAt: null } })).toBe(
      recoveryCodes.length - 1,
    );
  });

  test("KONTROL GRUBU: 2FA'sız kullanıcıda ikinci adım HİÇ görünmüyor", async ({ page }) => {
    const { email } = await signUpAndSignIn(page);

    await startLogin(page, email);

    await expect(page).toHaveURL(/\/dashboard$/, { timeout: NAV_TIMEOUT_MS });
    await expect(page.getByLabel("Doğrulama kodu")).toHaveCount(0);
  });
});

test.describe("/settings/security — 2FA kapatma", () => {
  test("mevcut şifre İSTENİYOR; yanlış şifreyle kapanmıyor, doğrusuyla kapanıyor", async ({
    page,
  }) => {
    const { userId } = await signUpAndSignIn(page);
    await enableViaApi(page);

    await page.goto("/settings/security");
    await expect(page.getByText("Açık.")).toBeVisible({ timeout: NAV_TIMEOUT_MS });
    await page.getByRole("button", { name: "İki faktörlü doğrulamayı kapat" }).click();

    await page.getByLabel("Mevcut şifre").fill("yanlis-sifre-123");
    await page.getByRole("button", { name: "2FA'yı kapat" }).click();
    await expect(page.getByText("Şifre doğrulanamadı")).toBeVisible({ timeout: NAV_TIMEOUT_MS });
    expect(
      (await prisma.userTotpSecret.findUnique({ where: { userId }, select: { confirmedAt: true } }))
        ?.confirmedAt,
    ).not.toBeNull();

    await page.getByLabel("Mevcut şifre").fill(PASSWORD);
    await page.getByRole("button", { name: "2FA'yı kapat" }).click();

    await expect(page.getByRole("button", { name: "İki faktörlü doğrulamayı aç" })).toBeVisible({
      timeout: NAV_TIMEOUT_MS,
    });
    const after = await prisma.userTotpSecret.findUnique({
      where: { userId },
      select: { confirmedAt: true },
    });
    expect(after?.confirmedAt ?? null).toBeNull();
  });
});
