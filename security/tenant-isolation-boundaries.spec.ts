import { randomUUID } from "node:crypto";

import { MembershipRole } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { uniqueTestClientIp } from "../e2e/support/rate-limit";
import { prisma } from "../src/lib/prisma";

import {
  combineCookieHeaders,
  createActiveTenantCookieHeader,
  createSessionCookieHeader,
} from "./support/session";

/**
 * Issue #16 — kapsamlı tenant isolation / RBAC / IDOR sınır testleri.
 *
 * Bu dosya YENİ bir production güvenlik özelliği eklemez; #12 (authorization), #13 (tenant
 * isolation) ve #14 (invitation) kapsamında zaten var olan davranışı, TAM İKİ BAĞIMSIZ TENANT
 * (her biri OWNER/ADMIN/MEMBER ile) üzerinden doğrulayan konsolide bir güvenlik coverage'ıdır.
 * Buradaki her senaryo, mevcut `security/tenant-membership-authorization-security.spec.ts` ve
 * `security/tenant-invitation-security.spec.ts` dosyalarında zaten kapsanan senaryoları BİREBİR
 * TEKRARLAMAZ — sadece oralarda kapsanmayan saldırgan/hedef kombinasyonlarını (ör. ADMIN'in bir
 * OWNER'a ait YABANCI membership'i hedeflemesi, MEMBER'ın yabancı bir membership'i silmeye
 * çalışması, gerçek bir hedef kayda karşı unauthenticated mutation denemesi, iki tenant'ın
 * eşzamanlı/bağımsız mutation'ları) ve tenant A'nın member listesinde tenant B'nin HİÇBİR
 * kullanıcısının sızmadığını doğrulayan pozitif bir negatif-kontrol ekler.
 */

test.afterAll(async () => {
  await prisma.$disconnect();
});

type TenantFixtureUser = { userId: string; email: string; membershipId: string; cookie: string };

async function createUserWithMembership(
  role: MembershipRole,
  tenantId: string,
): Promise<TenantFixtureUser> {
  const email = `sec-boundary-${randomUUID()}@example.com`;
  const user = await prisma.user.create({ data: { email } });
  const membership = await prisma.membership.create({ data: { userId: user.id, tenantId, role } });

  const sessionCookie = await createSessionCookieHeader({ sub: user.id, email });
  const activeTenantCookie = await createActiveTenantCookieHeader(tenantId);
  const cookie = combineCookieHeaders(sessionCookie, activeTenantCookie);

  return { userId: user.id, email, membershipId: membership.id, cookie };
}

type TwoTenantFixture = {
  tenantA: { id: string };
  tenantB: { id: string };
  ownerA: TenantFixtureUser;
  adminA: TenantFixtureUser;
  memberA: TenantFixtureUser;
  ownerB: TenantFixtureUser;
  adminB: TenantFixtureUser;
  memberB: TenantFixtureUser;
};

/** İki tamamen bağımsız tenant, her biri OWNER/ADMIN/MEMBER ile — Issue #16'nın istediği fixture. */
async function setupTwoTenants(): Promise<TwoTenantFixture> {
  const tenantA = await prisma.tenant.create({
    data: { name: "Boundary Tenant A", slug: `boundary-a-${randomUUID()}` },
  });
  const tenantB = await prisma.tenant.create({
    data: { name: "Boundary Tenant B", slug: `boundary-b-${randomUUID()}` },
  });

  const [ownerA, adminA, memberA, ownerB, adminB, memberB] = await Promise.all([
    createUserWithMembership(MembershipRole.OWNER, tenantA.id),
    createUserWithMembership(MembershipRole.ADMIN, tenantA.id),
    createUserWithMembership(MembershipRole.MEMBER, tenantA.id),
    createUserWithMembership(MembershipRole.OWNER, tenantB.id),
    createUserWithMembership(MembershipRole.ADMIN, tenantB.id),
    createUserWithMembership(MembershipRole.MEMBER, tenantB.id),
  ]);

  return { tenantA, tenantB, ownerA, adminA, memberA, ownerB, adminB, memberB };
}

async function cleanupTwoTenants(fixture: TwoTenantFixture): Promise<void> {
  await prisma.tenant.deleteMany({ where: { id: { in: [fixture.tenantA.id, fixture.tenantB.id] } } });
  await prisma.user.deleteMany({
    where: {
      id: {
        in: [
          fixture.ownerA.userId,
          fixture.adminA.userId,
          fixture.memberA.userId,
          fixture.ownerB.userId,
          fixture.adminB.userId,
          fixture.memberB.userId,
        ],
      },
    },
  });
}

test.describe("Tenant isolation boundaries — unauthenticated mutation (gerçek hedef kayıtlara karşı)", () => {
  test("unauthenticated tenant creation: 401 alınır, DB'de tenant oluşmaz", async ({ request }) => {
    const uniqueSlug = `unauth-attempt-${randomUUID()}`;

    const response = await request.post("/api/tenants", {
      data: { name: "Should Not Exist", slug: uniqueSlug },
      headers: { "x-forwarded-for": uniqueTestClientIp() },
    });
    expect(response.status()).toBe(401);

    const created = await prisma.tenant.findUnique({ where: { slug: uniqueSlug } });
    expect(created).toBeNull();
  });

  test("unauthenticated invitation creation (gerçek tenant'a karşı): 401 alınır, DB'de invitation oluşmaz", async ({
    request,
  }) => {
    const tenant = await prisma.tenant.create({
      data: { name: "Unauth Invite Co", slug: `unauth-invite-${randomUUID()}` },
    });

    try {
      const response = await request.post(`/api/tenants/${tenant.id}/invitations`, {
        data: { email: "nobody@example.com", role: "MEMBER" },
      });
      expect(response.status()).toBe(401);

      const invitations = await prisma.tenantInvitation.findMany({ where: { tenantId: tenant.id } });
      expect(invitations).toHaveLength(0);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
    }
  });

  test("unauthenticated membership role update (gerçek membership'e karşı): 401 alınır, rol değişmez", async ({
    request,
  }) => {
    const tenant = await prisma.tenant.create({
      data: { name: "Unauth Role Co", slug: `unauth-role-${randomUUID()}` },
    });
    const target = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);

    try {
      const response = await request.patch(`/api/tenants/${tenant.id}/members/${target.membershipId}`, {
        data: { role: "OWNER" },
      });
      expect(response.status()).toBe(401);

      const unchanged = await prisma.membership.findUniqueOrThrow({ where: { id: target.membershipId } });
      expect(unchanged.role).toBe("MEMBER");
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: target.userId } });
    }
  });
});

test.describe("Tenant isolation boundaries — cross-tenant okuma sızıntısı yok", () => {
  test("GET /api/tenants/A/members yanıtında Tenant B'nin hiçbir kullanıcısı (OWNER/ADMIN/MEMBER) bulunmuyor", async ({
    request,
  }) => {
    const fixture = await setupTwoTenants();

    try {
      const response = await request.get(`/api/tenants/${fixture.tenantA.id}/members`, {
        headers: { cookie: fixture.ownerA.cookie },
      });
      expect(response.status()).toBe(200);

      const body = await response.json();
      const returnedUserIds: string[] = body.members.map((m: { userId: string }) => m.userId);

      expect(returnedUserIds.sort()).toEqual(
        [fixture.ownerA.userId, fixture.adminA.userId, fixture.memberA.userId].sort(),
      );
      expect(returnedUserIds).not.toContain(fixture.ownerB.userId);
      expect(returnedUserIds).not.toContain(fixture.adminB.userId);
      expect(returnedUserIds).not.toContain(fixture.memberB.userId);
    } finally {
      await cleanupTwoTenants(fixture);
    }
  });
});

test.describe("Tenant isolation boundaries — cross-tenant IDOR (yeni saldırgan/hedef kombinasyonları)", () => {
  test("ADMIN A, Tenant B'nin OWNER'ına ait membership'i URL'de tenant A ile hedefleyip rol değiştiremez (404)", async ({
    request,
  }) => {
    const fixture = await setupTwoTenants();

    try {
      const response = await request.patch(
        `/api/tenants/${fixture.tenantA.id}/members/${fixture.ownerB.membershipId}`,
        { headers: { cookie: fixture.adminA.cookie }, data: { role: "ADMIN" } },
      );
      expect(response.status()).toBe(404);

      const unchanged = await prisma.membership.findUniqueOrThrow({
        where: { id: fixture.ownerB.membershipId },
      });
      expect(unchanged.role).toBe("OWNER");
      expect(unchanged.tenantId).toBe(fixture.tenantB.id);
    } finally {
      await cleanupTwoTenants(fixture);
    }
  });

  test("MEMBER A, Tenant B'nin bir üyesini silmeye çalışır — permission kontrolü tenant sınırından önce devreye girer (403)", async ({
    request,
  }) => {
    const fixture = await setupTwoTenants();

    try {
      const response = await request.delete(
        `/api/tenants/${fixture.tenantA.id}/members/${fixture.memberB.membershipId}`,
        { headers: { cookie: fixture.memberA.cookie } },
      );
      // MEMBER, kendi tenant'ında (A) REMOVE_MEMBER iznine zaten sahip değildir — bu ret,
      // hedef membership'in gerçekten var olup olmadığından BAĞIMSIZ olarak permission
      // matrisinden gelir (fail-closed: yetki kontrolü kaynak aramasından ÖNCE çalışır).
      expect(response.status()).toBe(403);

      const stillThere = await prisma.membership.findUnique({ where: { id: fixture.memberB.membershipId } });
      expect(stillThere).not.toBeNull();
      expect(stillThere?.tenantId).toBe(fixture.tenantB.id);
    } finally {
      await cleanupTwoTenants(fixture);
    }
  });
});

test.describe("Tenant isolation boundaries — mutation izolasyonu", () => {
  test("Tenant A'da yapılan bir rol değişikliği Tenant B'nin üyelerini etkilemiyor", async ({ request }) => {
    const fixture = await setupTwoTenants();

    try {
      const before = await prisma.membership.findMany({
        where: { tenantId: fixture.tenantB.id },
        orderBy: { id: "asc" },
        select: { id: true, role: true },
      });

      const response = await request.patch(
        `/api/tenants/${fixture.tenantA.id}/members/${fixture.memberA.membershipId}`,
        { headers: { cookie: fixture.ownerA.cookie }, data: { role: "ADMIN" } },
      );
      expect(response.status()).toBe(200);

      const promoted = await prisma.membership.findUniqueOrThrow({
        where: { id: fixture.memberA.membershipId },
      });
      expect(promoted.role).toBe("ADMIN");

      const after = await prisma.membership.findMany({
        where: { tenantId: fixture.tenantB.id },
        orderBy: { id: "asc" },
        select: { id: true, role: true },
      });
      expect(after).toEqual(before);
    } finally {
      await cleanupTwoTenants(fixture);
    }
  });
});
