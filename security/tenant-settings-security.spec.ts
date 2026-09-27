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
 * Tenant ayarları API'sinin saldırgan bakışıyla testleri (Issue #86).
 *
 * BU ENDPOINT'E ÖZGÜ RİSK: ad ve varsayılan para birimi tüm tenant'ı etkiler; yetkisiz bir
 * değişiklik, tek bir kaydı değil TÜM tenant'ın yapılandırmasını bozar. Yönetim izni
 * (`UPDATE_TENANT_SETTINGS`) matriste OWNER-only'dir — `MANAGE_MODULES`/`EXPORT_TENANT_DATA`
 * ile aynı sınıf. Issue #86'nın gövdesi "OWNER/ADMIN" (#43 deseni) diyor ama matris bunu
 * SONRADAN OWNER-only'e çekti; burada matris esas alınır ve ADMIN'in de reddedildiği ayrıca
 * doğrulanır (bkz. `src/lib/tenants/settings.ts`'teki not).
 *
 * Doğrulama ve audit `integration/tenant-settings.spec.ts`tedir.
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
  const email = `sec-settings-${randomUUID()}@example.com`;
  const user = await prisma.user.create({ data: { email }, select: { id: true } });
  await prisma.membership.create({ data: { userId: user.id, tenantId, role } });

  const cookie = combineCookieHeaders(
    await createSessionCookieHeader({ sub: user.id, email }),
    await createActiveTenantCookieHeader(tenantId),
  );

  return { userId: user.id, cookie };
}

function settingsPath(tenantId: string): string {
  return `/api/tenants/${tenantId}/settings`;
}

test.describe("Tenant Settings API — authentication zorunluluğu", () => {
  test("unauthenticated istek 401 alır ve satır DEĞİŞMEZ", async ({ request }) => {
    const tenant = await createTenant("NoAuthSettings");

    try {
      const response = await request.patch(settingsPath(tenant.id), {
        data: { name: "Saldırgan" },
      });
      expect(response.status()).toBe(401);

      const row = await prisma.tenant.findFirstOrThrow({ where: { id: tenant.id } });
      expect(row.name).toBe("NoAuthSettings");
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
    }
  });
});

test.describe("Tenant Settings API — rol bazlı yetki", () => {
  test("MEMBER ve ADMIN 403 alır (matris: yönetim OWNER-only)", async ({ request }) => {
    const tenant = await createTenant("RoleSettings");
    const member = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);
    const admin = await createUserWithMembership(MembershipRole.ADMIN, tenant.id);

    try {
      for (const actor of [member, admin]) {
        const response = await request.patch(settingsPath(tenant.id), {
          headers: { cookie: actor.cookie },
          data: { name: "Yetkisiz Değişiklik" },
        });
        expect(response.status()).toBe(403);
      }

      const row = await prisma.tenant.findFirstOrThrow({ where: { id: tenant.id } });
      expect(row.name).toBe("RoleSettings");
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.deleteMany({ where: { id: { in: [member.userId, admin.userId] } } });
    }
  });

  test("KONTROL GRUBU: OWNER aynı isteği yapabiliyor", async ({ request }) => {
    // Duyarlılık kanıtı: yukarıdaki 403'ler endpoint hep 403 dönseydi de geçerdi.
    const tenant = await createTenant("OwnerSettings");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    try {
      const response = await request.patch(settingsPath(tenant.id), {
        headers: { cookie: owner.cookie },
        data: { name: "Sahibi Değiştirdi", defaultCurrency: "USD" },
      });
      expect(response.status()).toBe(200);

      const { tenant: updated } = (await response.json()) as {
        tenant: { name: string; defaultCurrency: string };
      };
      expect(updated).toMatchObject({ name: "Sahibi Değiştirdi", defaultCurrency: "USD" });
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });
});

test.describe("Tenant Settings API — tenant izolasyonu / IDOR", () => {
  test("URL'deki tenantId aktif tenant'tan farklıysa 403 ve komşu ETKİLENMEZ", async ({
    request,
  }) => {
    const mine = await createTenant("MineSettings");
    const theirs = await createTenant("TheirsSettings");
    const owner = await createUserWithMembership(MembershipRole.OWNER, mine.id);

    try {
      const response = await request.patch(settingsPath(theirs.id), {
        headers: { cookie: owner.cookie },
        data: { name: "Komşuyu Ele Geçir" },
      });
      expect(response.status()).toBe(403);

      const row = await prisma.tenant.findFirstOrThrow({ where: { id: theirs.id } });
      expect(row.name).toBe("TheirsSettings");
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [mine.id, theirs.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("body'deki tenantId alanı YOK SAYILIYOR", async ({ request }) => {
    const mine = await createTenant("SpoofSettings");
    const theirs = await createTenant("SpoofTargetSettings");
    const owner = await createUserWithMembership(MembershipRole.OWNER, mine.id);

    try {
      const response = await request.patch(settingsPath(mine.id), {
        headers: { cookie: owner.cookie },
        // Gövdedeki `tenantId` scope'u belirlemez: kaynak daima `requirePermission()`
        // context'idir (Issue #13).
        data: { name: "Kendi Adım", tenantId: theirs.id },
      });
      expect(response.status()).toBe(200);

      const mineRow = await prisma.tenant.findFirstOrThrow({ where: { id: mine.id } });
      expect(mineRow.name).toBe("Kendi Adım");

      const theirsRow = await prisma.tenant.findFirstOrThrow({ where: { id: theirs.id } });
      expect(theirsRow.name).toBe("SpoofTargetSettings");
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [mine.id, theirs.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });
});

test.describe("Tenant Settings API — girdi doğrulama ve sözleşme", () => {
  test("geçersiz para birimi kodu 400 alır ve satır DEĞİŞMEZ", async ({ request }) => {
    const tenant = await createTenant("BadCurrencySettings");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    try {
      const response = await request.patch(settingsPath(tenant.id), {
        headers: { cookie: owner.cookie },
        data: { defaultCurrency: "XYZZY" },
      });
      expect(response.status()).toBe(400);

      const row = await prisma.tenant.findFirstOrThrow({ where: { id: tenant.id } });
      expect(row.defaultCurrency).toBe("TRY");
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("boş body 400 alır (no updatable fields)", async ({ request }) => {
    const tenant = await createTenant("EmptyBodySettings");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    try {
      const response = await request.patch(settingsPath(tenant.id), {
        headers: { cookie: owner.cookie },
        data: {},
      });
      expect(response.status()).toBe(400);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });
});
