import { randomUUID } from "node:crypto";

import { MembershipRole } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import {
  combineCookieHeaders,
  createActiveTenantCookieHeader,
  createSessionCookieHeader,
} from "./support/session";

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function createUserWithMembership(role: MembershipRole, tenantId: string) {
  const email = `sec-authz-${randomUUID()}@example.com`;
  const user = await prisma.user.create({ data: { email } });
  await prisma.membership.create({ data: { userId: user.id, tenantId, role } });

  const sessionCookie = await createSessionCookieHeader({ sub: user.id, email });
  const activeTenantCookie = await createActiveTenantCookieHeader(tenantId);
  const cookie = combineCookieHeaders(sessionCookie, activeTenantCookie);

  return { userId: user.id, cookie };
}

test.describe("Tenant membership authorization security — active tenant / URL tutarlılığı", () => {
  test("aktif tenant, URL'deki tenantId'den farklıysa erişim reddedilir (403)", async ({ request }) => {
    const activeTenant = await prisma.tenant.create({
      data: { name: "Active Co", slug: `active-${randomUUID()}` },
    });
    const otherTenant = await prisma.tenant.create({
      data: { name: "Other Co", slug: `other-${randomUUID()}` },
    });
    // Kullanıcı otherTenant'ta da OWNER — permission matrisi tek başına engellemez,
    // engel active-tenant-vs-URL kontrolünden gelmeli.
    const owner = await createUserWithMembership(MembershipRole.OWNER, activeTenant.id);
    await prisma.membership.create({
      data: { userId: owner.userId, tenantId: otherTenant.id, role: MembershipRole.OWNER },
    });

    try {
      const response = await request.get(`/api/tenants/${otherTenant.id}/members`, {
        headers: { cookie: owner.cookie },
      });
      expect(response.status()).toBe(403);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [activeTenant.id, otherTenant.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("başka tenant'a ait membershipId, aktif tenant'ın URL'i altında bile işlem yapılamaz", async ({
    request,
  }) => {
    const tenant = await prisma.tenant.create({
      data: { name: "Tenant A", slug: `tenant-a-${randomUUID()}` },
    });
    const foreignTenant = await prisma.tenant.create({
      data: { name: "Tenant B", slug: `tenant-b-${randomUUID()}` },
    });
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const foreignUser = await prisma.user.create({ data: { email: `sec-foreign-${randomUUID()}@example.com` } });
    const foreignMembership = await prisma.membership.create({
      data: { userId: foreignUser.id, tenantId: foreignTenant.id, role: MembershipRole.MEMBER },
    });

    try {
      const response = await request.patch(
        `/api/tenants/${tenant.id}/members/${foreignMembership.id}`,
        { headers: { cookie: owner.cookie }, data: { role: "ADMIN" } },
      );
      expect(response.status()).toBe(404);

      const unchanged = await prisma.membership.findUniqueOrThrow({ where: { id: foreignMembership.id } });
      expect(unchanged.role).toBe("MEMBER");
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [tenant.id, foreignTenant.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [owner.userId, foreignUser.id] } } });
    }
  });

  test("stale active-tenant cookie'si (membership silindikten sonra) erişim vermez", async ({ request }) => {
    const tenant = await prisma.tenant.create({
      data: { name: "Stale Co", slug: `stale-${randomUUID()}` },
    });
    const secondOwner = await prisma.user.create({ data: { email: `sec-second-owner-${randomUUID()}@example.com` } });
    await prisma.membership.create({
      data: { userId: secondOwner.id, tenantId: tenant.id, role: MembershipRole.OWNER },
    });
    const staleOwner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    // Membership, cookie üretildikten SONRA silinir — cookie hâlâ "geçerli" görünür ama
    // authorization her çağrıda DB'den canlı doğrulanmalı.
    await prisma.membership.delete({
      where: { userId_tenantId: { userId: staleOwner.userId, tenantId: tenant.id } },
    });

    try {
      const response = await request.get(`/api/tenants/${tenant.id}/members`, {
        headers: { cookie: staleOwner.cookie },
      });
      expect(response.status()).toBe(400);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.deleteMany({ where: { id: { in: [staleOwner.userId, secondOwner.id] } } });
    }
  });
});

test.describe("Tenant membership authorization security — client spoofing korumaları", () => {
  test("MEMBER, request body'sinde role/tenantId spoof ederek yetki yükseltemez", async ({ request }) => {
    const tenant = await prisma.tenant.create({
      data: { name: "Spoof Co", slug: `spoof-${randomUUID()}` },
    });
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const member = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);
    const ownerMembership = await prisma.membership.findFirstOrThrow({
      where: { tenantId: tenant.id, userId: owner.userId },
    });

    try {
      // Body içinde sahte bir "actorRole"/"tenantId" alanı gönderiliyor — bu isim, server
      // kodunda hiçbir yerde okunmaz; tek etkili kaynak DB'den canlı doğrulanan context'tir.
      const response = await request.patch(
        `/api/tenants/${tenant.id}/members/${ownerMembership.id}`,
        {
          headers: { cookie: member.cookie },
          data: { role: "OWNER", actorRole: "OWNER", tenantId: "some-other-tenant" },
        },
      );
      expect(response.status()).toBe(403);

      const unchanged = await prisma.membership.findUniqueOrThrow({ where: { id: ownerMembership.id } });
      expect(unchanged.role).toBe("OWNER");
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.deleteMany({ where: { id: { in: [owner.userId, member.userId] } } });
    }
  });

  test("sahte bir role/tenant header'ı authorization kararını etkilemez", async ({ request }) => {
    const tenant = await prisma.tenant.create({
      data: { name: "Header Spoof Co", slug: `header-spoof-${randomUUID()}` },
    });
    const member = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);

    try {
      const response = await request.delete(`/api/tenants/${tenant.id}/members/whatever`, {
        headers: {
          cookie: member.cookie,
          "x-user-role": "OWNER",
          "x-tenant-id": tenant.id,
        },
      });
      expect(response.status()).toBe(403);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: member.userId } });
    }
  });
});

test.describe("Tenant membership authorization security — ADMIN privilege escalation", () => {
  test("ADMIN kendisini OWNER'a yükseltemez", async ({ request }) => {
    const tenant = await prisma.tenant.create({
      data: { name: "Escalation Co", slug: `escalation-${randomUUID()}` },
    });
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const admin = await createUserWithMembership(MembershipRole.ADMIN, tenant.id);
    const adminMembership = await prisma.membership.findFirstOrThrow({
      where: { tenantId: tenant.id, userId: admin.userId },
    });

    try {
      const response = await request.patch(
        `/api/tenants/${tenant.id}/members/${adminMembership.id}`,
        { headers: { cookie: admin.cookie }, data: { role: "OWNER" } },
      );
      expect(response.status()).toBe(403);

      const unchanged = await prisma.membership.findUniqueOrThrow({ where: { id: adminMembership.id } });
      expect(unchanged.role).toBe("ADMIN");
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.deleteMany({ where: { id: { in: [owner.userId, admin.userId] } } });
    }
  });

  test("ADMIN mevcut bir OWNER'ı düşüremez veya çıkaramaz (ownership takeover koruması)", async ({ request }) => {
    const tenant = await prisma.tenant.create({
      data: { name: "Ownership Co", slug: `ownership-${randomUUID()}` },
    });
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const admin = await createUserWithMembership(MembershipRole.ADMIN, tenant.id);
    const ownerMembership = await prisma.membership.findFirstOrThrow({
      where: { tenantId: tenant.id, userId: owner.userId },
    });

    try {
      const demoteRes = await request.patch(
        `/api/tenants/${tenant.id}/members/${ownerMembership.id}`,
        { headers: { cookie: admin.cookie }, data: { role: "MEMBER" } },
      );
      expect(demoteRes.status()).toBe(403);

      const removeRes = await request.delete(
        `/api/tenants/${tenant.id}/members/${ownerMembership.id}`,
        { headers: { cookie: admin.cookie } },
      );
      expect(removeRes.status()).toBe(403);

      const unchanged = await prisma.membership.findUniqueOrThrow({ where: { id: ownerMembership.id } });
      expect(unchanged.role).toBe("OWNER");
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.deleteMany({ where: { id: { in: [owner.userId, admin.userId] } } });
    }
  });
});

test.describe("Tenant membership authorization security — son OWNER koruması regresyonu (HTTP)", () => {
  test("OWNER, kendi (son) OWNER membership'ini HTTP üzerinden silemez", async ({ request }) => {
    const tenant = await prisma.tenant.create({
      data: { name: "Last Owner Co", slug: `last-owner-${randomUUID()}` },
    });
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const ownerMembership = await prisma.membership.findFirstOrThrow({
      where: { tenantId: tenant.id, userId: owner.userId },
    });

    try {
      const response = await request.delete(
        `/api/tenants/${tenant.id}/members/${ownerMembership.id}`,
        { headers: { cookie: owner.cookie } },
      );
      expect(response.status()).toBe(409);

      const stillThere = await prisma.membership.findUnique({ where: { id: ownerMembership.id } });
      expect(stillThere).not.toBeNull();
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });
});
