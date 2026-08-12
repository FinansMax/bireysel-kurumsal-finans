import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { registerUser } from "../src/lib/auth/signup";
import { prisma } from "../src/lib/prisma";

import { createSessionCookieHeader } from "../security/support/session";

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe("Tenant membership endpoints — auth", () => {
  test("unauthenticated istekler 401 alır", async ({ request }) => {
    const listRes = await request.get("/api/tenants/whatever/members");
    expect(listRes.status()).toBe(401);

    const patchRes = await request.patch("/api/tenants/whatever/members/whatever", {
      data: { role: "ADMIN" },
    });
    expect(patchRes.status()).toBe(401);

    const deleteRes = await request.delete("/api/tenants/whatever/members/whatever");
    expect(deleteRes.status()).toBe(401);
  });

  test("authenticated OWNER üye listesini gerçek HTTP üzerinden alabiliyor", async ({ request }) => {
    const email = `e2e-owner-${randomUUID()}@example.com`;
    const signup = await registerUser({ email, password: "S3curePassw0rd!" });
    if (!signup.ok) throw new Error("test setup failed");

    const tenant = await prisma.tenant.create({
      data: { name: "E2E Co", slug: `e2e-co-${randomUUID()}` },
    });
    await prisma.membership.create({
      data: { userId: signup.user.id, tenantId: tenant.id, role: "OWNER" },
    });
    const cookie = await createSessionCookieHeader({ sub: signup.user.id, email });

    try {
      const response = await request.get(`/api/tenants/${tenant.id}/members`, {
        headers: { cookie },
      });
      expect(response.status()).toBe(200);

      const body = await response.json();
      expect(body.members).toHaveLength(1);
      expect(body.members[0].userId).toBe(signup.user.id);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: signup.user.id } });
    }
  });
});
