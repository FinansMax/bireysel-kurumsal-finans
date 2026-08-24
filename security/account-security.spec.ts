import { randomUUID } from "node:crypto";

import { MembershipRole } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import {
  combineCookieHeaders,
  createActiveTenantCookieHeader,
  createSessionCookieHeader,
} from "./support/session";

/**
 * `Account` API'sinin saldırgan bakışıyla testleri (Issue #46).
 *
 * Konu: kimlik doğrulama zorunluluğu, rol bazlı yetki (MEMBER görür ama yönetemez),
 * tenant izolasyonu / IDOR, client input spoofing ve hata yanıtlarının bilgi sızdırmaması.
 * İş kuralları (doğrulama, Decimal hassasiyeti) `integration/account.spec.ts`'tedir.
 */

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function createTenant(label: string) {
  return prisma.tenant.create({
    data: { name: label, slug: `${label.toLowerCase()}-${randomUUID()}` },
    select: { id: true },
  });
}

async function createUserWithMembership(role: MembershipRole, tenantId: string) {
  const email = `sec-account-${randomUUID()}@example.com`;
  const user = await prisma.user.create({ data: { email }, select: { id: true } });
  await prisma.membership.create({ data: { userId: user.id, tenantId, role } });

  const cookie = combineCookieHeaders(
    await createSessionCookieHeader({ sub: user.id, email }),
    await createActiveTenantCookieHeader(tenantId),
  );

  return { userId: user.id, cookie };
}

async function createAccountRow(tenantId: string, name = `Hesap ${randomUUID()}`) {
  return prisma.account.create({
    data: { tenantId, name, type: "BANK", currency: "TRY", balance: "100.0000" },
    select: { id: true, name: true },
  });
}

test.describe("Account API — authentication zorunluluğu", () => {
  test("unauthenticated istekler 401 alır ve hiçbir şey oluşmaz", async ({ request }) => {
    const tenant = await createTenant("NoAuth");

    try {
      const list = await request.get(`/api/tenants/${tenant.id}/accounts`);
      expect(list.status()).toBe(401);

      const create = await request.post(`/api/tenants/${tenant.id}/accounts`, {
        data: { name: "Gizli", type: "BANK", currency: "TRY" },
      });
      expect(create.status()).toBe(401);

      expect(await prisma.account.count({ where: { tenantId: tenant.id } })).toBe(0);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
    }
  });

  test("uydurma session cookie'si kabul edilmiyor", async ({ request }) => {
    const tenant = await createTenant("FakeCookie");

    try {
      const response = await request.get(`/api/tenants/${tenant.id}/accounts`, {
        headers: { cookie: "authjs.session-token=uydurma-deger" },
      });
      expect(response.status()).toBe(401);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
    }
  });
});

test.describe("Account API — rol bazlı yetki", () => {
  test("MEMBER hesapları GÖRÜR ama oluşturamaz/güncelleyemez/silemez (403)", async ({ request }) => {
    const tenant = await createTenant("RoleCheck");
    const member = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);
    const account = await createAccountRow(tenant.id, "Kasa");

    try {
      // Görüntüleme: izin matrisi MEMBER'a VIEW_ACCOUNTS verir.
      const list = await request.get(`/api/tenants/${tenant.id}/accounts`, {
        headers: { cookie: member.cookie },
      });
      expect(list.status()).toBe(200);
      expect(((await list.json()) as { accounts: unknown[] }).accounts).toHaveLength(1);

      // Yönetim: MANAGE_ACCOUNTS yok → 403.
      const create = await request.post(`/api/tenants/${tenant.id}/accounts`, {
        headers: { cookie: member.cookie },
        data: { name: "Yeni", type: "CASH", currency: "TRY" },
      });
      expect(create.status()).toBe(403);

      const patch = await request.patch(`/api/tenants/${tenant.id}/accounts/${account.id}`, {
        headers: { cookie: member.cookie },
        data: { balance: "999999.0000" },
      });
      expect(patch.status()).toBe(403);

      const remove = await request.delete(`/api/tenants/${tenant.id}/accounts/${account.id}`, {
        headers: { cookie: member.cookie },
      });
      expect(remove.status()).toBe(403);

      // Kontrol grubu: hiçbir yazma gerçekleşmemiş olmalı.
      const rows = await prisma.account.findMany({ where: { tenantId: tenant.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].balance.toString()).toBe("100");
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: member.userId } });
    }
  });

  test("ADMIN hesap yönetebiliyor (duyarlılık kanıtı: 403'ler role bağlı, endpoint'e değil)", async ({
    request,
  }) => {
    const tenant = await createTenant("AdminOk");
    const admin = await createUserWithMembership(MembershipRole.ADMIN, tenant.id);

    try {
      const create = await request.post(`/api/tenants/${tenant.id}/accounts`, {
        headers: { cookie: admin.cookie },
        data: { name: "Admin Hesabi", type: "BANK", currency: "TRY" },
      });
      expect(create.status()).toBe(201);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: admin.userId } });
    }
  });
});

test.describe("Account API — tenant izolasyonu / IDOR", () => {
  test("başka tenant'ın hesabı, kendi tenant'ının URL'i altında bile güncellenemez (404)", async ({
    request,
  }) => {
    const tenant = await createTenant("Own");
    const foreignTenant = await createTenant("Foreign");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const foreignAccount = await createAccountRow(foreignTenant.id, "Yabanci Hesap");

    try {
      const response = await request.patch(
        `/api/tenants/${tenant.id}/accounts/${foreignAccount.id}`,
        { headers: { cookie: owner.cookie }, data: { name: "Ele Gecti" } },
      );
      expect(response.status()).toBe(404);

      const unchanged = await prisma.account.findUniqueOrThrow({ where: { id: foreignAccount.id } });
      expect(unchanged.name).toBe("Yabanci Hesap");
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [tenant.id, foreignTenant.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("cross-tenant geçerli id ile hiç var olmayan id AYNI yanıtı veriyor (enumeration engeli)", async ({
    request,
  }) => {
    const tenant = await createTenant("Enum");
    const foreignTenant = await createTenant("EnumForeign");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const foreignAccount = await createAccountRow(foreignTenant.id);

    try {
      const crossTenant = await request.delete(
        `/api/tenants/${tenant.id}/accounts/${foreignAccount.id}`,
        { headers: { cookie: owner.cookie } },
      );
      const nonExistent = await request.delete(
        `/api/tenants/${tenant.id}/accounts/acc-${randomUUID()}`,
        { headers: { cookie: owner.cookie } },
      );

      expect(crossTenant.status()).toBe(nonExistent.status());
      expect(await crossTenant.json()).toEqual(await nonExistent.json());

      expect(await prisma.account.count({ where: { id: foreignAccount.id } })).toBe(1);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [tenant.id, foreignTenant.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("aktif tenant URL'deki tenantId'den farklıysa 403 (üyesi olsa bile)", async ({ request }) => {
    const activeTenant = await createTenant("Active");
    const otherTenant = await createTenant("Other");
    const owner = await createUserWithMembership(MembershipRole.OWNER, activeTenant.id);
    // Kullanıcı diğer tenant'ta da OWNER: engel izin matrisinden değil, aktif tenant
    // tutarlılık kontrolünden gelmeli.
    await prisma.membership.create({
      data: { userId: owner.userId, tenantId: otherTenant.id, role: MembershipRole.OWNER },
    });
    await createAccountRow(otherTenant.id);

    try {
      const response = await request.get(`/api/tenants/${otherTenant.id}/accounts`, {
        headers: { cookie: owner.cookie },
      });
      expect(response.status()).toBe(403);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [activeTenant.id, otherTenant.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("listede yalnızca kendi tenant'ının hesapları var (sızıntı yok)", async ({ request }) => {
    const tenant = await createTenant("ListOwn");
    const foreignTenant = await createTenant("ListForeign");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    await createAccountRow(tenant.id, "Benim Hesabim");
    await createAccountRow(foreignTenant.id, "Yabanci Hesabim");

    try {
      const response = await request.get(`/api/tenants/${tenant.id}/accounts`, {
        headers: { cookie: owner.cookie },
      });
      expect(response.status()).toBe(200);

      const { accounts } = (await response.json()) as { accounts: Array<{ name: string }> };
      expect(accounts).toHaveLength(1);
      expect(accounts[0].name).toBe("Benim Hesabim");

      const body = JSON.stringify(accounts);
      expect(body).not.toContain("Yabanci Hesabim");
      expect(body).not.toContain(foreignTenant.id);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [tenant.id, foreignTenant.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });
});

test.describe("Account API — client input spoofing", () => {
  test("body'deki tenantId/id alanları YOK SAYILIYOR", async ({ request }) => {
    const tenant = await createTenant("Spoof");
    const foreignTenant = await createTenant("SpoofForeign");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    try {
      const response = await request.post(`/api/tenants/${tenant.id}/accounts`, {
        headers: { cookie: owner.cookie },
        data: {
          name: "Spoof Hesabi",
          type: "BANK",
          currency: "TRY",
          // Saldırganın hesabı başka bir tenant'a yazdırma denemesi.
          tenantId: foreignTenant.id,
          id: "attacker-controlled-id",
        },
      });
      expect(response.status()).toBe(201);

      const { account } = (await response.json()) as { account: { id: string } };
      expect(account.id).not.toBe("attacker-controlled-id");

      const row = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
      expect(row.tenantId).toBe(tenant.id);
      expect(await prisma.account.count({ where: { tenantId: foreignTenant.id } })).toBe(0);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [tenant.id, foreignTenant.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("bakiye `number` olarak gönderilemiyor (para invariant'ı HTTP sınırında da geçerli)", async ({
    request,
  }) => {
    const tenant = await createTenant("MoneyType");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    try {
      const response = await request.post(`/api/tenants/${tenant.id}/accounts`, {
        headers: { cookie: owner.cookie },
        data: { name: "Float Hesabi", type: "BANK", currency: "TRY", balance: 0.1 + 0.2 },
      });
      expect(response.status()).toBe(400);
      expect(await prisma.account.count({ where: { tenantId: tenant.id } })).toBe(0);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("hata yanıtları iç durum sızdırmıyor (stack trace / Prisma detayı yok)", async ({
    request,
  }) => {
    const tenant = await createTenant("ErrShape");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    try {
      const response = await request.post(`/api/tenants/${tenant.id}/accounts`, {
        headers: { cookie: owner.cookie },
        data: { name: "A", type: "BANK", currency: "TRY" },
      });
      expect(response.status()).toBe(400);

      const text = await response.text();
      expect(text).not.toMatch(/prisma|PrismaClient|at .*\(.*\.ts:|stack/i);
      expect(Object.keys((await response.json()) as Record<string, unknown>)).toEqual(["error"]);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("para JSON'da string olarak dönüyor (number değil)", async ({ request }) => {
    const tenant = await createTenant("MoneyShape");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    try {
      const response = await request.post(`/api/tenants/${tenant.id}/accounts`, {
        headers: { cookie: owner.cookie },
        data: { name: "String Bakiye", type: "BANK", currency: "TRY", balance: "1234.5600" },
      });
      expect(response.status()).toBe(201);

      const { account } = (await response.json()) as { account: { balance: unknown } };
      expect(typeof account.balance).toBe("string");
      expect(account.balance).toBe("1234.56");
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });
});
