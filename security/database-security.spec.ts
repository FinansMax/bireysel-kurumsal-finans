import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe("Database security — Membership unique constraint", () => {
  test("aynı userId + tenantId için ikinci membership unique constraint nedeniyle reddediliyor", async () => {
    const suffix = randomUUID();
    const user = await prisma.user.create({
      data: { email: `db-security-${suffix}@example.com` },
    });
    const tenant = await prisma.tenant.create({
      data: { name: "DB Security Tenant", slug: `db-security-${suffix}` },
    });

    try {
      await prisma.membership.create({
        data: { userId: user.id, tenantId: tenant.id, role: "MEMBER" },
      });

      await expect(
        prisma.membership.create({
          data: { userId: user.id, tenantId: tenant.id, role: "ADMIN" },
        }),
      ).rejects.toThrow();
    } finally {
      // Tenant/User silinince Membership kayıtları onDelete: Cascade ile temizlenir.
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
