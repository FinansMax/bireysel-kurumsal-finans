import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { createTenant } from "../src/lib/tenants/create-tenant";
import { registerUser } from "../src/lib/auth/signup";
import { prisma } from "../src/lib/prisma";

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function createTestUser() {
  const email = `tenant-${randomUUID()}@example.com`;
  const result = await registerUser({ email, password: "S3curePassw0rd!" });
  if (!result.ok) throw new Error("test setup failed: registerUser");
  return result.user.id;
}

test.describe("createTenant()", () => {
  test("authenticated kullanıcı tenant oluşturabiliyor ve OWNER membership birlikte oluşuyor", async () => {
    const userId = await createTestUser();
    const slug = `acme-${randomUUID()}`;

    const result = await createTenant(userId, { name: "Acme Inc", slug });
    try {
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.tenant.name).toBe("Acme Inc");
      expect(result.tenant.slug).toBe(slug);

      const membership = await prisma.membership.findUniqueOrThrow({
        where: { userId_tenantId: { userId, tenantId: result.tenant.id } },
      });
      expect(membership.role).toBe("OWNER");
    } finally {
      if (result.ok) await prisma.tenant.delete({ where: { id: result.tenant.id } });
      await prisma.user.delete({ where: { id: userId } });
    }
  });

  test("slug verilmezse name'den otomatik/güvenli şekilde üretiliyor", async () => {
    const userId = await createTestUser();
    const uniqueName = `Test Şirketi ${randomUUID()}`;

    const result = await createTenant(userId, { name: uniqueName });
    try {
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.tenant.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    } finally {
      if (result.ok) await prisma.tenant.delete({ where: { id: result.tenant.id } });
      await prisma.user.delete({ where: { id: userId } });
    }
  });

  test("duplicate slug 409 ile reddediliyor", async () => {
    const userId = await createTestUser();
    const slug = `dup-${randomUUID()}`;

    const first = await createTenant(userId, { name: "First", slug });
    expect(first.ok).toBe(true);

    try {
      const second = await createTenant(userId, { name: "Second", slug });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.status).toBe(409);
    } finally {
      if (first.ok) await prisma.tenant.delete({ where: { id: first.tenant.id } });
      await prisma.user.delete({ where: { id: userId } });
    }
  });

  test("geçersiz name (boş) 400 ile reddediliyor", async () => {
    const userId = await createTestUser();
    try {
      const result = await createTenant(userId, { name: " " });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
    } finally {
      await prisma.user.delete({ where: { id: userId } });
    }
  });

  test("geçersiz slug (sadece özel karakter) 400 ile reddediliyor", async () => {
    const userId = await createTestUser();
    try {
      const result = await createTenant(userId, { name: "Valid Name", slug: "!!!" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
    } finally {
      await prisma.user.delete({ where: { id: userId } });
    }
  });

  test("transaction başarısız olursa yarım kayıt kalmıyor (geçersiz userId → FK hatası)", async () => {
    const slug = `orphan-${randomUUID()}`;

    await expect(createTenant("non-existent-user-id", { name: "Orphan", slug })).rejects.toThrow();

    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    expect(tenant).toBeNull();
  });
});
