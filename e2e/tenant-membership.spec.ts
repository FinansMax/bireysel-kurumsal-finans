import { randomUUID } from "node:crypto";

import { MembershipRole } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { registerUser } from "../src/lib/auth/signup";
import { prisma } from "../src/lib/prisma";

import {
  combineCookieHeaders,
  createActiveTenantCookieHeader,
  createSessionCookieHeader,
} from "../security/support/session";

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function createSignedInUser(role: MembershipRole, tenantId: string) {
  const email = `e2e-${role.toLowerCase()}-${randomUUID()}@example.com`;
  const signup = await registerUser({ email, password: "S3curePassw0rd!" });
  if (!signup.ok) throw new Error("test setup failed: registerUser");

  await prisma.membership.create({
    data: { userId: signup.user.id, tenantId, role },
  });

  const sessionCookie = await createSessionCookieHeader({ sub: signup.user.id, email });
  const activeTenantCookie = await createActiveTenantCookieHeader(tenantId);
  const cookie = combineCookieHeaders(sessionCookie, activeTenantCookie);

  return { userId: signup.user.id, cookie };
}

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
    const tenant = await prisma.tenant.create({
      data: { name: "E2E Co", slug: `e2e-co-${randomUUID()}` },
    });
    const owner = await createSignedInUser(MembershipRole.OWNER, tenant.id);

    try {
      const response = await request.get(`/api/tenants/${tenant.id}/members`, {
        headers: { cookie: owner.cookie },
      });
      expect(response.status()).toBe(200);

      const body = await response.json();
      expect(body.members).toHaveLength(1);
      expect(body.members[0].userId).toBe(owner.userId);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("ADMIN üyeleri görebiliyor, rol değiştirebiliyor ve üye çıkarabiliyor", async ({ request }) => {
    const tenant = await prisma.tenant.create({
      data: { name: "E2E Co", slug: `e2e-co-${randomUUID()}` },
    });
    const owner = await createSignedInUser(MembershipRole.OWNER, tenant.id);
    const admin = await createSignedInUser(MembershipRole.ADMIN, tenant.id);
    const memberSignup = await registerUser({
      email: `e2e-member-${randomUUID()}@example.com`,
      password: "S3curePassw0rd!",
    });
    if (!memberSignup.ok) throw new Error("test setup failed");
    const memberMembership = await prisma.membership.create({
      data: { userId: memberSignup.user.id, tenantId: tenant.id, role: MembershipRole.MEMBER },
    });

    try {
      const listRes = await request.get(`/api/tenants/${tenant.id}/members`, {
        headers: { cookie: admin.cookie },
      });
      expect(listRes.status()).toBe(200);

      const patchRes = await request.patch(
        `/api/tenants/${tenant.id}/members/${memberMembership.id}`,
        { headers: { cookie: admin.cookie }, data: { role: "ADMIN" } },
      );
      expect(patchRes.status()).toBe(200);

      const deleteRes = await request.delete(
        `/api/tenants/${tenant.id}/members/${memberMembership.id}`,
        { headers: { cookie: admin.cookie } },
      );
      expect(deleteRes.status()).toBe(204);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.deleteMany({
        where: { id: { in: [owner.userId, admin.userId, memberSignup.user.id] } },
      });
    }
  });

  test("MEMBER üyeleri görebiliyor ama rol değiştiremiyor / üye çıkaramıyor (403)", async ({ request }) => {
    const tenant = await prisma.tenant.create({
      data: { name: "E2E Co", slug: `e2e-co-${randomUUID()}` },
    });
    const owner = await createSignedInUser(MembershipRole.OWNER, tenant.id);
    const member = await createSignedInUser(MembershipRole.MEMBER, tenant.id);

    try {
      const listRes = await request.get(`/api/tenants/${tenant.id}/members`, {
        headers: { cookie: member.cookie },
      });
      expect(listRes.status()).toBe(200);

      const ownerMembership = await prisma.membership.findFirstOrThrow({
        where: { tenantId: tenant.id, userId: owner.userId },
      });

      const patchRes = await request.patch(
        `/api/tenants/${tenant.id}/members/${ownerMembership.id}`,
        { headers: { cookie: member.cookie }, data: { role: "MEMBER" } },
      );
      expect(patchRes.status()).toBe(403);

      const deleteRes = await request.delete(
        `/api/tenants/${tenant.id}/members/${ownerMembership.id}`,
        { headers: { cookie: member.cookie } },
      );
      expect(deleteRes.status()).toBe(403);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.deleteMany({ where: { id: { in: [owner.userId, member.userId] } } });
    }
  });
});
