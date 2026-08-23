import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { registerUser } from "../src/lib/auth/signup";
import { prisma } from "../src/lib/prisma";

import { createSessionCookieHeader } from "../security/support/session";
import { uniqueTestClientIp } from "./support/rate-limit";

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe("POST /api/tenants", () => {
  test("unauthenticated istek 401 alır", async ({ request }) => {
    const response = await request.post("/api/tenants", {
      data: { name: "Nope" },
      headers: { "x-forwarded-for": uniqueTestClientIp() },
    });
    expect(response.status()).toBe(401);
  });

  test("authenticated istek tenant oluşturuyor (201) ve OWNER membership'i içeriyor", async ({
    request,
  }) => {
    const email = `e2e-tenant-${randomUUID()}@example.com`;
    const signup = await registerUser({ email, password: "S3curePassw0rd!" });
    if (!signup.ok) throw new Error("test setup failed");

    const cookie = await createSessionCookieHeader({ sub: signup.user.id, email });
    const slug = `e2e-acme-${randomUUID()}`;

    try {
      const response = await request.post("/api/tenants", {
        headers: { cookie, "x-forwarded-for": uniqueTestClientIp() },
        data: { name: "E2E Acme", slug },
      });
      expect(response.status()).toBe(201);

      const body = await response.json();
      expect(body.tenant.slug).toBe(slug);

      const membership = await prisma.membership.findUniqueOrThrow({
        where: { userId_tenantId: { userId: signup.user.id, tenantId: body.tenant.id } },
      });
      expect(membership.role).toBe("OWNER");
    } finally {
      await prisma.tenant.deleteMany({ where: { slug } });
      await prisma.user.delete({ where: { id: signup.user.id } });
    }
  });
});
