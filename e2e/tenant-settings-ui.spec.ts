import { randomUUID } from "node:crypto";

import { MembershipRole } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import { markEmailVerified } from "./support/email-verification";
import { signInWithCredentials } from "./support/auth";
import { uniqueTestClientIp } from "./support/rate-limit";

/**
 * Tenant ayarları ekranı — gerçek tarayıcıda, gerçek API'ye karşı (Issue #86).
 *
 * Sonuç her zaman BAĞIMSIZ bir okumayla (DB) doğrulanır: formdaki "Kaydedildi" mesajının
 * görünmesi tek başına "sunucuda gerçekten kaydedildi" demek değildir.
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

// Sunucu round-trip'ine bağlı beklemeler (bkz. #129 ve `modules-settings-ui.spec.ts`).
const REFRESH_TIMEOUT_MS = 15_000;

function apiHeaders(): Record<string, string> {
  return { "x-forwarded-for": uniqueTestClientIp() };
}

async function signUpAndSignIn(page: Page, prefix: string): Promise<string> {
  const email = `${prefix}-${randomUUID()}@example.com`;

  const created = await page.request.post("/api/auth/signup", {
    data: { email, password: PASSWORD },
    headers: apiHeaders(),
  });
  await markEmailVerified(email);
  expect(created.status()).toBe(201);

  const signedIn = await signInWithCredentials(page.request, email, PASSWORD);
  expect(signedIn.status()).toBe(302);

  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  createdUserIds.push(user.id);
  return user.id;
}

async function createAndActivateTenant(page: Page): Promise<string> {
  const response = await page.request.post("/api/tenants", {
    data: { name: "Ayar Ekrani", slug: `settings-ui-${randomUUID()}` },
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

test.describe("/settings/tenant — ad ve para birimi güncelleme", () => {
  test("menüden gidilip ad ve para birimi kaydediliyor", async ({ page }) => {
    await signUpAndSignIn(page, "settings-save");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/dashboard");
    await page
      .getByRole("navigation", { name: "Ana menü" })
      .getByRole("link", { name: "Ayarlar" })
      .click();
    await expect(page).toHaveURL(/\/settings\/tenant$/, { timeout: REFRESH_TIMEOUT_MS });

    // Form mevcut değerlerle DOLU gelir.
    await expect(page.getByLabel("Ad")).toHaveValue("Ayar Ekrani");
    await expect(page.getByLabel("Varsayılan para birimi")).toHaveValue("TRY");

    await page.getByLabel("Ad").fill("Güncellenmiş Ad");
    await page.getByLabel("Varsayılan para birimi").fill("USD");
    await page.getByRole("button", { name: "Kaydet" }).click();

    await expect(page.getByText("Kaydedildi.")).toBeVisible({ timeout: REFRESH_TIMEOUT_MS });

    // BAĞIMSIZ DOĞRULAMA.
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(tenant.name).toBe("Güncellenmiş Ad");
    expect(tenant.defaultCurrency).toBe("USD");

    // Sidebar'daki tenant seçici de yeni adı gösterir (`router.refresh()` kabuğu tazeler).
    await expect(page.getByText("Güncellenmiş Ad").first()).toBeVisible();
  });

  test("geçersiz para birimi kodu hata gösterir ve satır DEĞİŞMEZ", async ({ page }) => {
    await signUpAndSignIn(page, "settings-invalid");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/settings/tenant");
    await page.getByLabel("Varsayılan para birimi").fill("XYZZY");
    await page.getByRole("button", { name: "Kaydet" }).click();

    await expect(
      page.getByText("Bilgileri kontrol edin: ad 2-100 karakter, para birimi 3 harf (TRY)."),
    ).toBeVisible({ timeout: REFRESH_TIMEOUT_MS });

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(tenant.defaultCurrency).toBe("TRY");
  });
});

test.describe("/settings/tenant — yetki", () => {
  test("ADMIN sayfaya erişemiyor ve menüde linki GÖRMÜYOR", async ({ page }) => {
    const ownerId = await signUpAndSignIn(page, "settings-owner");
    const tenantId = await createAndActivateTenant(page);

    const adminId = await signUpAndSignIn(page, "settings-admin");
    expect(adminId).not.toBe(ownerId);
    await prisma.membership.create({
      data: { userId: adminId, tenantId, role: MembershipRole.ADMIN },
    });
    await page.request.post("/api/tenants/active", { data: { tenantId } });

    await page.goto("/settings/tenant");

    // Tenant ayarlarını değiştirmek bir sahiplik kararıdır: OWNER-only (#86).
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: REFRESH_TIMEOUT_MS });

    // Linki gizlemek YETKİLENDİRME DEĞİLDİR — yukarıdaki yönlendirme asıl korumadır — ama
    // kullanıcıyı kesin bir yönlendirmeye davet etmemek de gerekir.
    await expect(
      page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Ayarlar" }),
    ).toHaveCount(0);

    // API de reddeder (UI'da gizlemek tek başına yeterli değildir).
    const patched = await page.request.patch(`/api/tenants/${tenantId}/settings`, {
      data: { name: "Yetkisiz" },
    });
    expect(patched.status()).toBe(403);
  });

  test("KONTROL GRUBU: OWNER linki görüyor ve sayfaya girebiliyor", async ({ page }) => {
    await signUpAndSignIn(page, "settings-owner-control");
    await createAndActivateTenant(page);

    await page.goto("/dashboard");
    await expect(
      page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Ayarlar" }),
    ).toBeVisible();

    await page.goto("/settings/tenant");
    await expect(
      page.getByRole("heading", { name: "Çalışma Alanı Ayarları", level: 1 }),
    ).toBeVisible();
  });
});
