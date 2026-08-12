import { randomUUID } from "node:crypto";

import { encode } from "next-auth/jwt";
import { expect, test } from "@playwright/test";

import { decodeActiveTenantCookie } from "../src/lib/tenants/active-tenant";
import { prisma } from "../src/lib/prisma";

import { createSessionCookieHeader } from "./support/session";
import { getSetCookieValues } from "../e2e/support/auth";

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe("Active tenant security — cookie ayrımı", () => {
  test("session-token cookie'si, farklı salt kullanıldığı için active-tenant cookie'si olarak replay edilemiyor", async () => {
    const secret = process.env.AUTH_SECRET!;
    // Session cookie'siyle AYNI salt'ı ("authjs.session-token") kullanarak bir değer üretip
    // active-tenant decoder'ına veriyoruz — farklı salt kullanıldığı için reddedilmeli.
    const sessionLikeValue = await encode({
      secret,
      salt: "authjs.session-token",
      token: { tenantId: "some-tenant-id" },
    });

    const decoded = await decodeActiveTenantCookie(sessionLikeValue);
    expect(decoded).toBeNull();
  });
});

test.describe("Active tenant security — enumeration koruması", () => {
  test("var olmayan tenantId ile üyesi olunmayan (gerçek) tenantId AYNI status + body döner", async ({
    request,
  }) => {
    const email = `sec-active-${randomUUID()}@example.com`;
    const user = await prisma.user.create({ data: { email } });
    const realForeignTenant = await prisma.tenant.create({
      data: { name: "Foreign Co", slug: `foreign-${randomUUID()}` },
    });
    const cookie = await createSessionCookieHeader({ sub: user.id, email });

    try {
      const forNonexistent = await request.post("/api/tenants/active", {
        headers: { cookie },
        data: { tenantId: `nonexistent-${randomUUID()}` },
      });
      const forRealButForeign = await request.post("/api/tenants/active", {
        headers: { cookie },
        data: { tenantId: realForeignTenant.id },
      });

      expect(forNonexistent.status()).toBe(forRealButForeign.status());
      expect(await forNonexistent.json()).toEqual(await forRealButForeign.json());
    } finally {
      await prisma.tenant.delete({ where: { id: realForeignTenant.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});

test.describe("Active tenant security — cookie güvenlik ayarları", () => {
  test("aktif tenant cookie'si HttpOnly ve SameSite=Lax olarak set ediliyor", async ({ request }) => {
    const email = `sec-active-flags-${randomUUID()}@example.com`;
    const user = await prisma.user.create({ data: { email } });
    const tenant = await prisma.tenant.create({
      data: { name: "Flags Co", slug: `flags-${randomUUID()}` },
    });
    await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, role: "MEMBER" } });
    const cookie = await createSessionCookieHeader({ sub: user.id, email });

    try {
      const response = await request.post("/api/tenants/active", {
        headers: { cookie },
        data: { tenantId: tenant.id },
      });

      const activeCookie = getSetCookieValues(response).find((c) => c.startsWith("active-tenant="));
      expect(activeCookie).toBeTruthy();
      expect(activeCookie?.toLowerCase()).toContain("httponly");
      expect(activeCookie?.toLowerCase()).toContain("samesite=lax");
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
