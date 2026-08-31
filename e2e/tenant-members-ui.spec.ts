import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import { signInWithCredentials } from "./support/auth";
import { uniqueTestClientIp } from "./support/rate-limit";

/**
 * Üye yönetimi ekranı — gerçek tarayıcıda, gerçek API'ye karşı (Issue #43).
 *
 * Ekranın sonucu HER ZAMAN bağımsız bir okuma yoluyla (`GET /api/tenants/:id/members`)
 * doğrulanır: satırın kaybolması veya kutunun değişmesi tek başına "sunucuda gerçekten oldu"
 * demek değildir.
 *
 * KURULUM: OWNER gerçek signup + sign-in akışından geçer (tarayıcı oturumu gerekli); diğer
 * üyeler ise doğrudan DB'ye yazılır — hiç giriş yapmayacakları için şifreye ihtiyaçları yok ve
 * davet akışı (#14) bu issue'nun kapsamı dışında.
 */

const PASSWORD = "S3curePassw0rd!";

const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestClientIp() });
});

test.afterAll(async () => {
  // Tenant/User silinince Membership cascade ile gider (bkz. docs/testing.md).
  await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

function apiHeaders(): Record<string, string> {
  return { "x-forwarded-for": uniqueTestClientIp() };
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID()}@example.com`;
}

/** Gerçek signup + sign-in: tarayıcı bağlamında geçerli bir oturum bırakır. */
async function signUpAndSignIn(page: Page, prefix: string): Promise<{ email: string; id: string }> {
  const email = uniqueEmail(prefix);

  const created = await page.request.post("/api/auth/signup", {
    data: { email, password: PASSWORD },
    headers: apiHeaders(),
  });
  expect(created.status()).toBe(201);

  const signedIn = await signInWithCredentials(page.request, email, PASSWORD);
  expect(signedIn.status()).toBe(302);
  expect(signedIn.headers()["location"] ?? "").not.toContain("error=");

  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  createdUserIds.push(user.id);

  return { email, id: user.id };
}

/** Giriş yapmayacak bir üye — davet akışı kapsam dışı olduğu için doğrudan DB'ye yazılır. */
async function addMember(
  tenantId: string,
  role: "OWNER" | "ADMIN" | "MEMBER",
): Promise<{ email: string; userId: string }> {
  const email = uniqueEmail("member");
  const user = await prisma.user.create({ data: { email }, select: { id: true } });
  createdUserIds.push(user.id);

  await prisma.membership.create({ data: { userId: user.id, tenantId, role } });

  return { email, userId: user.id };
}

/** Oturum sahibi için tenant oluşturur (OWNER olur) ve onu aktif tenant yapar. */
async function createAndActivateTenant(page: Page): Promise<string> {
  const response = await page.request.post("/api/tenants", {
    data: { name: "Uyeler Testi", slug: `members-${randomUUID()}` },
    headers: apiHeaders(),
  });
  expect(response.status()).toBe(201);

  const { tenant } = (await response.json()) as { tenant: { id: string } };
  createdTenantIds.push(tenant.id);

  const activated = await page.request.post("/api/tenants/active", { data: { tenantId: tenant.id } });
  expect(activated.status()).toBe(200);

  return tenant.id;
}

/** Sunucudaki gerçek durum — ekranın iddiasından bağımsız kontrol yolu. */
async function apiMembers(
  page: Page,
  tenantId: string,
): Promise<Array<{ id: string; role: string; user: { email: string } }>> {
  const response = await page.request.get(`/api/tenants/${tenantId}/members`);
  expect(response.status()).toBe(200);

  return ((await response.json()) as { members: Array<{ id: string; role: string; user: { email: string } }> })
    .members;
}

function rowOf(page: Page, email: string) {
  return page.getByRole("row").filter({ hasText: email });
}

test.describe("/members — OWNER yönetimi", () => {
  test("OWNER üyeleri görüyor ve bir üyenin rolünü değiştirebiliyor", async ({ page }) => {
    const owner = await signUpAndSignIn(page, "members-owner");
    const tenantId = await createAndActivateTenant(page);
    const member = await addMember(tenantId, "MEMBER");

    await page.goto("/members");

    // Liste sunucudan gelir: her iki kişi de görünmeli.
    await expect(rowOf(page, owner.email)).toBeVisible();
    await expect(rowOf(page, member.email)).toBeVisible();

    await rowOf(page, member.email)
      .getByLabel(`${member.email} rolü`)
      .selectOption("ADMIN");

    // Asıl kanıt: rol SUNUCUDA değişti mi?
    await expect
      .poll(async () => (await apiMembers(page, tenantId)).find((m) => m.user.email === member.email)?.role)
      .toBe("ADMIN");
  });

  test("OWNER bir üyeyi çıkarabiliyor (onay adımıyla)", async ({ page }) => {
    await signUpAndSignIn(page, "members-remove");
    const tenantId = await createAndActivateTenant(page);
    const member = await addMember(tenantId, "MEMBER");

    await page.goto("/members");

    // Tek tıkla silme YOKTUR: önce satır içi onay gelir.
    await rowOf(page, member.email).getByRole("button", { name: "Çıkar" }).click();
    await expect(rowOf(page, member.email).getByRole("button", { name: /evet, çıkar/i })).toBeVisible();

    // Kontrol grubu: "Vazgeç" gerçekten hiçbir şey yapmamalı.
    await rowOf(page, member.email).getByRole("button", { name: /vazgeç/i }).click();
    expect((await apiMembers(page, tenantId)).some((m) => m.user.email === member.email)).toBe(true);

    await rowOf(page, member.email).getByRole("button", { name: "Çıkar" }).click();
    await rowOf(page, member.email).getByRole("button", { name: /evet, çıkar/i }).click();

    await expect(rowOf(page, member.email)).toHaveCount(0);
    expect((await apiMembers(page, tenantId)).some((m) => m.user.email === member.email)).toBe(false);
  });

  test("tek OWNER için aksiyonlar devre dışı ve backend de reddediyor", async ({ page }) => {
    const owner = await signUpAndSignIn(page, "members-lastowner");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/members");

    const ownerRow = rowOf(page, owner.email);
    await expect(ownerRow.getByLabel(`${owner.email} rolü`)).toBeDisabled();
    await expect(ownerRow.getByRole("button", { name: "Çıkar" })).toBeDisabled();

    // DUYARLILIK KANITI: arayüzdeki "devre dışı" hâli backend kuralıyla aynı şeyi söylüyor mu?
    // Kutu baypas edilip endpoint doğrudan çağrılırsa 409 gelmeli — yani devre dışı bırakma
    // keyfi bir UI kararı değil, gerçek invariant'ın yansıması.
    const members = await apiMembers(page, tenantId);
    const ownerMembership = members.find((m) => m.user.email === owner.email);
    const forced = await page.request.patch(
      `/api/tenants/${tenantId}/members/${ownerMembership?.id}`,
      { data: { role: "MEMBER" } },
    );
    expect(forced.status()).toBe(409);
  });
});

test.describe("/members — yetkisiz roller", () => {
  test("MEMBER listeyi görüyor ama yönetim aksiyonlarını görmüyor", async ({ page }) => {
    // Tenant'ı ayrı bir bağlamdaki OWNER oluşturur; test kullanıcısı ona MEMBER olarak eklenir.
    const viewer = await signUpAndSignIn(page, "members-viewer");

    const tenant = await prisma.tenant.create({
      data: { name: "Baska Alan", slug: `viewer-${randomUUID()}` },
      select: { id: true },
    });
    createdTenantIds.push(tenant.id);

    const other = await addMember(tenant.id, "OWNER");
    await prisma.membership.create({
      data: { userId: viewer.id, tenantId: tenant.id, role: "MEMBER" },
    });

    const activated = await page.request.post("/api/tenants/active", { data: { tenantId: tenant.id } });
    expect(activated.status()).toBe(200);

    await page.goto("/members");

    // İzin matrisi (Issue #11) MEMBER'a VIEW_MEMBERS verir: liste görünür.
    await expect(rowOf(page, other.email)).toBeVisible();
    await expect(rowOf(page, viewer.email)).toBeVisible();

    // Ama yönetim aksiyonları HİÇ render edilmez.
    await expect(page.getByRole("button", { name: "Çıkar" })).toHaveCount(0);
    await expect(page.getByLabel(`${other.email} rolü`)).toHaveCount(0);

    // Asıl kontrol arayüzde değil backend'de: UI baypas edilirse 403 gelir.
    const members = await apiMembers(page, tenant.id);
    const target = members.find((m) => m.user.email === other.email);
    const forced = await page.request.patch(`/api/tenants/${tenant.id}/members/${target?.id}`, {
      data: { role: "MEMBER" },
    });
    expect(forced.status()).toBe(403);
  });

  test("aktif çalışma alanı yokken liste yerine yönlendirici metin gösteriliyor", async ({ page }) => {
    await signUpAndSignIn(page, "members-notenant");

    await page.goto("/members");

    await expect(page.getByText("Önce menüden bir çalışma alanı seçin")).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  });
});
