import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import { signInWithCredentials } from "./support/auth";
import { uniqueTestClientIp } from "./support/rate-limit";

/**
 * Güvenlik ayarları ekranı — gerçek tarayıcıda, gerçek API'ye karşı (Issue #186).
 *
 * Sonuç HER ZAMAN bağımsız bir okumayla doğrulanır: düğmeye basıldıktan sonra `/login`'e
 * düşmek tek başına "sunucuda oturumlar gerçekten kapandı" demek değildir. Asıl kanıt,
 * DB'deki `sessionsRevokedAt`'in dolması ve eski cookie'nin artık kabul edilmemesidir.
 */

const PASSWORD = "S3curePassw0rd!";

const createdUserIds: string[] = [];

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestClientIp() });
});

test.afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

/** Sunucu round-trip'ine bağlı beklemeler (bkz. #129 ve `docs/testing.md`). */
const NAV_TIMEOUT_MS = 15_000;

async function signUpAndSignIn(page: Page): Promise<string> {
  const email = `security-ui-${randomUUID()}@example.com`;

  const created = await page.request.post("/api/auth/signup", {
    data: { email, password: PASSWORD },
    headers: { "x-forwarded-for": uniqueTestClientIp() },
  });
  expect(created.status()).toBe(201);

  const signedIn = await signInWithCredentials(page.request, email, PASSWORD);
  expect(signedIn.status()).toBe(302);

  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  createdUserIds.push(user.id);
  return user.id;
}

test.describe("/settings/security — tüm oturumları kapat", () => {
  test("çalışma alanı OLMADAN da erişilebiliyor", async ({ page }) => {
    /**
     * Bilinçli bir tasarım kararının testi: bu ekran KULLANICIYA aittir, çalışma alanına
     * değil. "Hesabım ele geçirildi" durumunda en çok ihtiyaç duyulan düğme, tenant seçimi
     * arkasında kalmamalı. Yeni kaydolan kullanıcının hiçbir tenant'ı yoktur.
     */
    await signUpAndSignIn(page);
    await page.goto("/settings/security");

    await expect(page.getByRole("heading", { name: "Güvenlik" })).toBeVisible({
      timeout: NAV_TIMEOUT_MS,
    });
    await expect(page.getByRole("button", { name: "Tüm cihazlardan çıkış yap" })).toBeVisible();
  });

  test("onay adımı olmadan hiçbir şey olmuyor", async ({ page }) => {
    // Tek tıkla tüm cihazlardan çıkmak, yanlışlıkla basılabilecek kadar ağır bir işlem.
    const userId = await signUpAndSignIn(page);
    await page.goto("/settings/security");

    await page.getByRole("button", { name: "Tüm cihazlardan çıkış yap" }).click();

    // Onay metni görünür, ama henüz YAZMA yapılmadı.
    await expect(page.getByRole("button", { name: "Evet, tüm oturumları kapat" })).toBeVisible();

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { sessionsRevokedAt: true },
    });
    expect(row.sessionsRevokedAt).toBeNull();
  });

  test("vazgeçince yazma yapılmıyor", async ({ page }) => {
    const userId = await signUpAndSignIn(page);
    await page.goto("/settings/security");

    await page.getByRole("button", { name: "Tüm cihazlardan çıkış yap" }).click();
    await page.getByRole("button", { name: "Vazgeç" }).click();

    await expect(page.getByRole("button", { name: "Tüm cihazlardan çıkış yap" })).toBeVisible();

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { sessionsRevokedAt: true },
    });
    expect(row.sessionsRevokedAt).toBeNull();
  });

  test("onaylayınca oturumlar kapanıyor, kullanıcı /login'e düşüyor ve DB'de kayıt oluşuyor", async ({
    page,
  }) => {
    const userId = await signUpAndSignIn(page);
    await page.goto("/settings/security");

    await page.getByRole("button", { name: "Tüm cihazlardan çıkış yap" }).click();
    await page.getByRole("button", { name: "Evet, tüm oturumları kapat" }).click();

    // 1) Kullanıcı giriş ekranına döndü.
    await page.waitForURL("**/login", { timeout: NAV_TIMEOUT_MS });

    // 2) BAĞIMSIZ KANIT: sunucuda gerçekten yazıldı.
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { sessionsRevokedAt: true },
    });
    expect(row.sessionsRevokedAt).toBeInstanceOf(Date);

    // 3) Ve oturum gerçekten kapandı: korumalı bir sayfa artık /login'e yönlendiriyor.
    await page.goto("/dashboard");
    await page.waitForURL("**/login", { timeout: NAV_TIMEOUT_MS });
  });
});
