import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import { markEmailVerified } from "./support/email-verification";
import { signInWithCredentials } from "./support/auth";
import { uniqueTestClientIp } from "./support/rate-limit";

/**
 * "Dışa Aktar (CSV)" düğmesi — gerçek tarayıcıda, gerçek dosya indirmesiyle (Issue #81).
 *
 * `transactions-ui.spec.ts` ile aynı kurulum yardımcıları. Buradaki asıl iddia: düğme
 * GERÇEKTEN bir dosya indirir ve o dosya ekranda görünen kaydı içerir — yalnızca linkin
 * `href`ine bakmak, sunucunun gerçekte doğru içeriği ürettiğini KANITLAMAZ.
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
    data: { name: "Export Ekrani", slug: `tx-export-ui-${randomUUID()}` },
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

async function createAccount(page: Page, tenantId: string, name: string) {
  const response = await page.request.post(`/api/tenants/${tenantId}/accounts`, {
    data: { name, type: "CASH", currency: "TRY", balance: "0" },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { account: { id: string } }).account.id;
}

async function createTransaction(
  page: Page,
  tenantId: string,
  accountId: string,
  description: string,
) {
  const response = await page.request.post(`/api/tenants/${tenantId}/transactions`, {
    data: { accountId, type: "INCOME", amount: "42.50", description },
  });
  expect(response.status()).toBe(201);
}

test.describe("/transactions — Dışa Aktar (CSV)", () => {
  test("düğme gerçek bir CSV indirir ve ekrandaki kaydı içerir", async ({ page }) => {
    await signUpAndSignIn(page, "tx-export-ui");
    const tenantId = await createAndActivateTenant(page);
    const accountId = await createAccount(page, tenantId, "İhracat Kasası");
    await createTransaction(page, tenantId, accountId, "Dışa aktarılacak kayıt");

    await page.goto("/transactions");
    await expect(page.getByText("Dışa aktarılacak kayıt")).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Dışa Aktar (CSV)" }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe("islemler.csv");

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    const content = Buffer.concat(chunks).toString("utf-8");

    expect(content).toContain("Dışa aktarılacak kayıt");
    expect(content).toContain("İhracat Kasası");
    expect(content).toContain("42.5");
  });

  test("filtre uygulanınca export linki aynı filtreyi taşır", async ({ page }) => {
    await signUpAndSignIn(page, "tx-export-filter");
    const tenantId = await createAndActivateTenant(page);
    const accountId = await createAccount(page, tenantId, "Filtreli Kasa");
    await createTransaction(page, tenantId, accountId, "Filtrelenecek kayıt");

    await page.goto(`/transactions?accountId=${accountId}`);

    const href = await page.getByRole("link", { name: "Dışa Aktar (CSV)" }).getAttribute("href");
    expect(href).toContain(`accountId=${accountId}`);
    expect(href).toContain("format=csv");
  });
});
