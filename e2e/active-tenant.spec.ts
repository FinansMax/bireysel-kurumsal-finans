import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { decodeActiveTenantCookie } from "../src/lib/tenants/active-tenant";
import { prisma } from "../src/lib/prisma";
import { createSessionCookieHeader } from "../security/support/session";

import { getSetCookieValues } from "./support/auth";

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function createTenant() {
  return prisma.tenant.create({ data: { name: "E2E Co", slug: `e2e-co-${randomUUID()}` } });
}

test.describe("GET /api/tenants", () => {
  test("unauthenticated istek 401 alır", async ({ request }) => {
    const response = await request.get("/api/tenants");
    expect(response.status()).toBe(401);
  });

  test("authenticated kullanıcı sadece kendi tenant'larını görür", async ({ request }) => {
    const email = `e2e-active-${randomUUID()}@example.com`;
    const user = await prisma.user.create({ data: { email } });
    const otherUser = await prisma.user.create({ data: { email: `e2e-other-${randomUUID()}@example.com` } });
    const ownTenant = await createTenant();
    const otherTenant = await createTenant();

    await prisma.membership.create({ data: { userId: user.id, tenantId: ownTenant.id, role: "OWNER" } });
    await prisma.membership.create({ data: { userId: otherUser.id, tenantId: otherTenant.id, role: "OWNER" } });

    const cookie = await createSessionCookieHeader({ sub: user.id, email });

    try {
      const response = await request.get("/api/tenants", { headers: { cookie } });
      expect(response.status()).toBe(200);

      const body = await response.json();
      expect(body.tenants).toHaveLength(1);
      expect(body.tenants[0].id).toBe(ownTenant.id);
      expect(body.tenants.some((t: { id: string }) => t.id === otherTenant.id)).toBe(false);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [ownTenant.id, otherTenant.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [user.id, otherUser.id] } } });
    }
  });
});

test.describe("POST /api/tenants/active", () => {
  test("unauthenticated istek 401 alır", async ({ request }) => {
    const response = await request.post("/api/tenants/active", { data: { tenantId: "x" } });
    expect(response.status()).toBe(401);
  });

  test("üyesi olduğu tenant'ı aktif seçebiliyor, cookie doğru üretiliyor", async ({ request }) => {
    const email = `e2e-select-${randomUUID()}@example.com`;
    const user = await prisma.user.create({ data: { email } });
    const tenant = await createTenant();
    await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, role: "MEMBER" } });
    const cookie = await createSessionCookieHeader({ sub: user.id, email });

    try {
      const response = await request.post("/api/tenants/active", {
        headers: { cookie },
        data: { tenantId: tenant.id },
      });
      expect(response.status()).toBe(200);

      const activeCookie = getSetCookieValues(response).find((c) => c.startsWith("active-tenant="));
      expect(activeCookie).toBeTruthy();
      expect(activeCookie?.toLowerCase()).toContain("httponly");
      expect(activeCookie?.toLowerCase()).toContain("samesite=lax");

      const rawValue = activeCookie!.split(";")[0].split("=")[1];
      const decodedTenantId = await decodeActiveTenantCookie(rawValue);
      expect(decodedTenantId).toBe(tenant.id);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("üyesi olmadığı bir tenant'ı seçmeye çalışırsa 403 alır", async ({ request }) => {
    const email = `e2e-forbidden-${randomUUID()}@example.com`;
    const user = await prisma.user.create({ data: { email } });
    const foreignTenant = await createTenant();
    // user, foreignTenant'a hiç üye değil.
    const cookie = await createSessionCookieHeader({ sub: user.id, email });

    try {
      const response = await request.post("/api/tenants/active", {
        headers: { cookie },
        data: { tenantId: foreignTenant.id },
      });
      expect(response.status()).toBe(403);
    } finally {
      await prisma.tenant.delete({ where: { id: foreignTenant.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("geçersiz tenantId 400 alır", async ({ request }) => {
    const email = `e2e-invalid-${randomUUID()}@example.com`;
    const user = await prisma.user.create({ data: { email } });
    const cookie = await createSessionCookieHeader({ sub: user.id, email });

    try {
      const response = await request.post("/api/tenants/active", {
        headers: { cookie },
        data: { tenantId: "" },
      });
      expect(response.status()).toBe(400);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("iki tenant arasında geçiş yapıldığında her seferinde doğru cookie üretiliyor", async ({
    request,
  }) => {
    const email = `e2e-switch-${randomUUID()}@example.com`;
    const user = await prisma.user.create({ data: { email } });
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    await prisma.membership.create({ data: { userId: user.id, tenantId: tenantA.id, role: "OWNER" } });
    await prisma.membership.create({ data: { userId: user.id, tenantId: tenantB.id, role: "MEMBER" } });
    const cookie = await createSessionCookieHeader({ sub: user.id, email });

    try {
      const responseA = await request.post("/api/tenants/active", {
        headers: { cookie },
        data: { tenantId: tenantA.id },
      });
      const rawA = getSetCookieValues(responseA)
        .find((c) => c.startsWith("active-tenant="))!
        .split(";")[0]
        .split("=")[1];
      expect(await decodeActiveTenantCookie(rawA)).toBe(tenantA.id);

      const responseB = await request.post("/api/tenants/active", {
        headers: { cookie },
        data: { tenantId: tenantB.id },
      });
      const rawB = getSetCookieValues(responseB)
        .find((c) => c.startsWith("active-tenant="))!
        .split(";")[0]
        .split("=")[1];
      expect(await decodeActiveTenantCookie(rawB)).toBe(tenantB.id);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
