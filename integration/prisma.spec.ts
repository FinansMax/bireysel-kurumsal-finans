import { randomUUID } from "node:crypto";

import { MembershipRole } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe("Prisma veritabanı bağlantısı", () => {
  test("test veritabanına bağlanılabiliyor", async () => {
    const count = await prisma.user.count();
    expect(typeof count).toBe("number");
  });
});

test.describe("User / Tenant / Membership", () => {
  test("kullanıcı, tenant ve OWNER rolünde membership oluşturulabiliyor", async () => {
    const suffix = randomUUID();
    const user = await prisma.user.create({
      data: { email: `owner-${suffix}@example.com` },
    });
    const tenant = await prisma.tenant.create({
      data: { name: "Test Tenant", slug: `owner-tenant-${suffix}` },
    });

    try {
      const membership = await prisma.membership.create({
        data: { userId: user.id, tenantId: tenant.id, role: MembershipRole.OWNER },
      });

      expect(membership.userId).toBe(user.id);
      expect(membership.tenantId).toBe(tenant.id);
      expect(membership.role).toBe(MembershipRole.OWNER);
    } finally {
      // Membership kayıtları User/Tenant silindiğinde cascade ile temizlenir.
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("aynı userId + tenantId kombinasyonu ikinci kez oluşturulamaz", async () => {
    const suffix = randomUUID();
    const user = await prisma.user.create({
      data: { email: `dup-${suffix}@example.com` },
    });
    const tenant = await prisma.tenant.create({
      data: { name: "Dup Tenant", slug: `dup-tenant-${suffix}` },
    });

    try {
      await prisma.membership.create({
        data: { userId: user.id, tenantId: tenant.id, role: MembershipRole.MEMBER },
      });

      await expect(
        prisma.membership.create({
          data: { userId: user.id, tenantId: tenant.id, role: MembershipRole.ADMIN },
        }),
      ).rejects.toThrow();
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("MembershipRole enum değerleri (OWNER, ADMIN, MEMBER) kullanılabiliyor", async () => {
    const suffix = randomUUID();
    const roles = [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MEMBER];
    const user = await prisma.user.create({
      data: { email: `roles-${suffix}@example.com` },
    });
    const tenantIds: string[] = [];

    try {
      for (const role of roles) {
        const tenant = await prisma.tenant.create({
          data: { name: `Role Tenant ${role}`, slug: `role-${role.toLowerCase()}-${suffix}` },
        });
        tenantIds.push(tenant.id);

        const membership = await prisma.membership.create({
          data: { userId: user.id, tenantId: tenant.id, role },
        });

        expect(membership.role).toBe(role);
      }
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
