import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import { signInWithCredentials } from "./support/auth";
import { uniqueTestClientIp } from "./support/rate-limit";

/**
 * Bildirim tercihi ekranı — gerçek tarayıcıda, gerçek API'ye karşı (Issue #88).
 *
 * Sonuç her zaman BAĞIMSIZ bir okumayla (DB) doğrulanır — bkz. `modules-settings-ui.spec.ts`
 * ile aynı duruş.
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

function apiHeaders(): Record<string, string> {
  return { "x-forwarded-for": uniqueTestClientIp() };
}

async function signUpAndSignIn(page: Page, prefix: string): Promise<string> {
  const email = `${prefix}-${randomUUID()}@example.com`;

  const created = await page.request.post("/api/auth/signup", {
    data: { email, password: PASSWORD },
    headers: apiHeaders(),
  });
  expect(created.status()).toBe(201);

  const signedIn = await signInWithCredentials(page.request, email, PASSWORD);
  expect(signedIn.status()).toBe(302);

  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  createdUserIds.push(user.id);
  return user.id;
}

test.describe("/settings/notifications", () => {
  test("menüden gidilip bildirim tercihi kapatılıp açılıyor", async ({ page }) => {
    const userId = await signUpAndSignIn(page, "notif-toggle");

    await page.goto("/dashboard");
    await page
      .getByRole("navigation", { name: "Ana menü" })
      .getByRole("link", { name: "Bildirimler" })
      .click();
    await expect(page).toHaveURL(/\/settings\/notifications$/);

    // Varsayılan AÇIK gelir.
    await expect(page.getByLabel("Bildirimleri etkinleştir")).toBeChecked();

    await page.getByLabel("Bildirimleri etkinleştir").uncheck();
    await page.getByRole("button", { name: "Kaydet" }).click();
    await expect(page.getByText("Kaydedildi.")).toBeVisible();

    // BAĞIMSIZ DOĞRULAMA.
    let user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.notificationsEnabled).toBe(false);

    // Sayfa yenilenince KAPALI durum kalıcı olarak görünmeli.
    await page.reload();
    await expect(page.getByLabel("Bildirimleri etkinleştir")).not.toBeChecked();

    await page.getByLabel("Bildirimleri etkinleştir").check();
    await page.getByRole("button", { name: "Kaydet" }).click();
    await expect(page.getByText("Kaydedildi.")).toBeVisible();

    user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.notificationsEnabled).toBe(true);
  });

  test("MEMBER dahil herkes erişebiliyor (izin gerekmiyor)", async ({ page }) => {
    // Bu kullanıcının hiç tenant'ı/üyeliği yok; sayfa yine de erişilebilir olmalı (Issue #88:
    // tercih kullanıcıya aittir, çalışma alanına değil — `settings/security` ile aynı desen).
    await signUpAndSignIn(page, "notif-no-tenant");

    await page.goto("/settings/notifications");
    await expect(page.getByRole("heading", { name: "Bildirimler", level: 1 })).toBeVisible();
  });
});
