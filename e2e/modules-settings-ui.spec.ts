import { randomUUID } from "node:crypto";

import { MembershipRole } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import { markEmailVerified } from "./support/email-verification";
import { signInWithCredentials } from "./support/auth";
import { uniqueTestClientIp } from "./support/rate-limit";

/**
 * Modül yönetim ekranı — gerçek tarayıcıda, gerçek API'ye karşı (Issue #153).
 *
 * Sonuç her zaman BAĞIMSIZ bir okumayla (`GET .../modules`) doğrulanır: karttaki rozetin
 * değişmesi tek başına "sunucuda gerçekten açıldı" demek değildir.
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

/**
 * Sunucu round-trip'ine bağlı beklemeler (bkz. #129 ve `accounts-ui.spec.ts`).
 *
 * Modül anahtarı `fetch` ile PATCH atar, ardından `router.refresh()` çağırır: rozetin
 * değişmesi bir gidiş-dönüşe ve RSC yeniden render'ına bağlıdır.
 */
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
  // #190: doğrulanmamış hesap çalışma alanı kuramaz; bu testin konusu doğrulama DEĞİL,
  // onun ÖN KOŞULU (bkz. e2e/support/email-verification.ts).
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
    data: { name: "Modul Ekrani", slug: `modules-ui-${randomUUID()}` },
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

async function apiModules(page: Page, tenantId: string) {
  const response = await page.request.get(`/api/tenants/${tenantId}/modules`);
  expect(response.status()).toBe(200);

  return ((await response.json()) as {
    modules: Array<{ key: string; enabled: boolean }>;
  }).modules;
}

function moduleCard(page: Page, label: string) {
  return page.locator("section").filter({ hasText: label }).last();
}

test.describe("/settings/modules — açma ve kapatma", () => {
  test("menüden gidilip modül açılıyor ve kapatılıyor", async ({ page }) => {
    await signUpAndSignIn(page, "modules-toggle");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/dashboard");
    await page
      .getByRole("navigation", { name: "Ana menü" })
      .getByRole("link", { name: "Modüller" })
      .click();
    await expect(page).toHaveURL(/\/settings\/modules$/, { timeout: REFRESH_TIMEOUT_MS });

    // Başlangıçta hepsi kapalı: satırın yokluğu = kapalı (#151).
    expect((await apiModules(page, tenantId)).every((module) => !module.enabled)).toBe(true);

    await page.getByRole("button", { name: "CRM & Süreç Takibi modülünü aç" }).click();

    // Açma ONAY İSTEMEZ: geri alınabilir ve bir şey kaybettirmez.
    await expect(
      page.getByRole("button", { name: "CRM & Süreç Takibi modülünü kapat" }),
    ).toBeVisible({ timeout: REFRESH_TIMEOUT_MS });

    // BAĞIMSIZ DOĞRULAMA.
    const afterEnable = await apiModules(page, tenantId);
    expect(afterEnable.find((module) => module.key === "crm")?.enabled).toBe(true);

    // Kapatma ONAY İSTER ve kullanıcının en çok korktuğu soruyu önceden yanıtlar.
    await page.getByRole("button", { name: "CRM & Süreç Takibi modülünü kapat" }).click();
    await expect(
      page.getByText("Modül kapatıldığında verileriniz silinmez; yalnızca erişim kapanır."),
    ).toBeVisible();

    await page.getByRole("button", { name: "Evet, kapat" }).click();
    await expect(
      page.getByRole("button", { name: "CRM & Süreç Takibi modülünü aç" }),
    ).toBeVisible({ timeout: REFRESH_TIMEOUT_MS });

    expect((await apiModules(page, tenantId)).find((m) => m.key === "crm")?.enabled).toBe(false);
  });

  test("kapatma onayından VAZGEÇİLİNCE durum değişmiyor", async ({ page }) => {
    await signUpAndSignIn(page, "modules-cancel");
    const tenantId = await createAndActivateTenant(page);

    await page.request.patch(`/api/tenants/${tenantId}/modules/crm`, { data: { enabled: true } });
    await page.goto("/settings/modules");

    await page.getByRole("button", { name: "CRM & Süreç Takibi modülünü kapat" }).click();
    await page.getByRole("button", { name: "Vazgeç" }).click();

    // Onay ekranı kapanır, modül AÇIK kalır.
    await expect(
      page.getByRole("button", { name: "CRM & Süreç Takibi modülünü kapat" }),
    ).toBeVisible();
    expect((await apiModules(page, tenantId)).find((m) => m.key === "crm")?.enabled).toBe(true);
  });
});

test.describe("/settings/modules — bağımlılıklar", () => {
  test("bağımlılığı kapalı modül açılamıyor; hata ADIYLA gösteriliyor", async ({ page }) => {
    await signUpAndSignIn(page, "modules-dep");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/settings/modules");

    // Kullanıcı denemeden ÖNCE neyin gerektiğini görebilmeli.
    await expect(moduleCard(page, "Tahsilat & Ödeme Planı").getByText("Gerektirir:")).toBeVisible();

    await page.getByRole("button", { name: "Tahsilat & Ödeme Planı modülünü aç" }).click();

    // Backend'in İngilizce metni GÖSTERİLMEZ; engelin adı Türkçe yazılır.
    await expect(
      page.getByText("Bu modülü açmak için önce şunları açın: CRM & Süreç Takibi."),
    ).toBeVisible({ timeout: REFRESH_TIMEOUT_MS });

    // Durum DEĞİŞMEDİ ve bağımlılık sessizce açılmadı.
    const modules = await apiModules(page, tenantId);
    expect(modules.every((module) => !module.enabled)).toBe(true);
  });

  test("bağımlısı açık modül kapatılamıyor; hata ADIYLA gösteriliyor", async ({ page }) => {
    await signUpAndSignIn(page, "modules-dep-close");
    const tenantId = await createAndActivateTenant(page);

    await page.request.patch(`/api/tenants/${tenantId}/modules/crm`, { data: { enabled: true } });
    await page.request.patch(`/api/tenants/${tenantId}/modules/collections`, {
      data: { enabled: true },
    });

    await page.goto("/settings/modules");
    await page.getByRole("button", { name: "CRM & Süreç Takibi modülünü kapat" }).click();
    await page.getByRole("button", { name: "Evet, kapat" }).click();

    await expect(
      page.getByText("Bu modülü kapatmak için önce şunları kapatın: Tahsilat & Ödeme Planı."),
    ).toBeVisible({ timeout: REFRESH_TIMEOUT_MS });

    expect((await apiModules(page, tenantId)).find((m) => m.key === "crm")?.enabled).toBe(true);
  });
});

test.describe("/settings/modules — yetki", () => {
  test("ADMIN sayfaya erişemiyor ve menüde linki GÖRMÜYOR", async ({ page }) => {
    const ownerId = await signUpAndSignIn(page, "modules-owner");
    const tenantId = await createAndActivateTenant(page);

    const adminId = await signUpAndSignIn(page, "modules-admin");
    expect(adminId).not.toBe(ownerId);
    await prisma.membership.create({
      data: { userId: adminId, tenantId, role: MembershipRole.ADMIN },
    });
    await page.request.post("/api/tenants/active", { data: { tenantId } });

    await page.goto("/settings/modules");

    // Modül açmak tenant'ın ürün yüzeyini değiştirir: OWNER-only (#151).
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: REFRESH_TIMEOUT_MS });

    // Linki gizlemek YETKİLENDİRME DEĞİLDİR — yukarıdaki yönlendirme asıl korumadır — ama
    // kullanıcıyı kesin bir yönlendirmeye davet etmemek de gerekir.
    await expect(
      page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Modüller" }),
    ).toHaveCount(0);

    // API de reddeder (UI'da gizlemek tek başına yeterli değildir).
    const patched = await page.request.patch(`/api/tenants/${tenantId}/modules/crm`, {
      data: { enabled: true },
    });
    expect(patched.status()).toBe(403);
  });

  test("KONTROL GRUBU: OWNER linki görüyor ve sayfaya girebiliyor", async ({ page }) => {
    await signUpAndSignIn(page, "modules-owner-control");
    await createAndActivateTenant(page);

    await page.goto("/dashboard");
    await expect(
      page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Modüller" }),
    ).toBeVisible();

    await page.goto("/settings/modules");
    await expect(page.getByRole("heading", { name: "Modüller", level: 1 })).toBeVisible();
  });
});
