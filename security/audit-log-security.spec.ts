import { randomUUID } from "node:crypto";

import { MembershipRole } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { signInWithCredentials } from "../e2e/support/auth";
import { uniqueTestClientIp } from "../e2e/support/rate-limit";
import { prisma } from "../src/lib/prisma";

import {
  combineCookieHeaders,
  createActiveTenantCookieHeader,
  createSessionCookieHeader,
} from "./support/session";

test.afterAll(async () => {
  await prisma.$disconnect();
});

/** Her çağrı kendi sahte istemci IP'sini kullanır (bkz. `e2e/support/rate-limit.ts`, Issue #27). */
function signUp(request: import("@playwright/test").APIRequestContext, email: string, password: string) {
  return request.post("/api/auth/signup", {
    data: { email, password },
    headers: { "x-forwarded-for": uniqueTestClientIp() },
  });
}

async function createUserWithMembership(role: MembershipRole, tenantId: string, email?: string) {
  const userEmail = email ?? `sec-audit-${randomUUID()}@example.com`;
  const user = await prisma.user.create({ data: { email: userEmail } });
  await prisma.membership.create({ data: { userId: user.id, tenantId, role } });

  const sessionCookie = await createSessionCookieHeader({ sub: user.id, email: userEmail });
  const activeTenantCookie = await createActiveTenantCookieHeader(tenantId);
  const cookie = combineCookieHeaders(sessionCookie, activeTenantCookie);

  return { userId: user.id, email: userEmail, cookie };
}

test.describe("Audit log security — login (HTTP)", () => {
  test("gerçek HTTP sign-in başarılı olduğunda AUTH_LOGIN_SUCCESS satırı oluşuyor", async ({ request }) => {
    const email = `sec-audit-login-ok-${randomUUID()}@example.com`;
    const password = "S3curePassw0rd!";
    const signupResponse = await signUp(request, email, password);
    expect(signupResponse.status()).toBe(201);
    const { user } = await signupResponse.json();

    try {
      await signInWithCredentials(request, email, password);

      const rows = await prisma.auditLog.findMany({
        where: { action: "AUTH_LOGIN_SUCCESS", actorUserId: user.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].targetType).toBe("USER");
      expect(rows[0].targetId).toBe(user.id);
    } finally {
      await prisma.auditLog.deleteMany({ where: { actorUserId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("gerçek HTTP sign-in başarısız olduğunda AUTH_LOGIN_FAILURE satırı oluşuyor, plaintext şifre sızmıyor", async ({
    request,
  }) => {
    const email = `sec-audit-login-fail-${randomUUID()}@example.com`;
    const password = "S3curePassw0rd!";
    await signUp(request, email, password);

    try {
      const before = await prisma.auditLog.count({ where: { action: "AUTH_LOGIN_FAILURE" } });

      await signInWithCredentials(request, email, "WrongPassword!");

      const after = await prisma.auditLog.count({ where: { action: "AUTH_LOGIN_FAILURE" } });
      expect(after).toBe(before + 1);

      const rows = await prisma.auditLog.findMany({
        where: { action: "AUTH_LOGIN_FAILURE" },
        orderBy: { createdAt: "desc" },
        take: 1,
      });
      expect(rows[0].actorUserId).toBeNull();
      expect(JSON.stringify(rows[0])).not.toContain(password);
      expect(JSON.stringify(rows[0])).not.toContain("WrongPassword!");
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  test("hiçbir AuditLog satırı plaintext şifre/secret/token içermiyor (bir dizi login denemesinden sonra)", async ({
    request,
  }) => {
    const email = `sec-audit-noleak-${randomUUID()}@example.com`;
    const password = "S3curePassw0rd!Unique";
    const signupResponse = await signUp(request, email, password);
    const { user } = await signupResponse.json();

    try {
      await signInWithCredentials(request, email, password);
      await signInWithCredentials(request, email, "AnotherWrongPassword!");

      const rows = await prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
      });
      for (const row of rows) {
        const serialized = JSON.stringify(row);
        expect(serialized).not.toContain(password);
        expect(serialized).not.toContain("AnotherWrongPassword!");
      }
    } finally {
      await prisma.auditLog.deleteMany({ where: { actorUserId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});

test.describe("Audit log security — tenant creation (HTTP)", () => {
  test("POST /api/tenants başarılı olduğunda TENANT_CREATED satırı doğru actorUserId/tenantId ile oluşuyor", async ({
    request,
  }) => {
    const email = `sec-audit-tenant-${randomUUID()}@example.com`;
    const password = "S3curePassw0rd!";
    const signupResponse = await signUp(request, email, password);
    const { user } = await signupResponse.json();
    const sessionCookie = await createSessionCookieHeader({ sub: user.id, email });

    try {
      const response = await request.post("/api/tenants", {
        headers: { cookie: sessionCookie, "x-forwarded-for": uniqueTestClientIp() },
        data: { name: "Audit Sec Co" },
      });
      expect(response.status()).toBe(201);
      const { tenant } = await response.json();

      const rows = await prisma.auditLog.findMany({ where: { tenantId: tenant.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe("TENANT_CREATED");
      expect(rows[0].actorUserId).toBe(user.id);
      expect(rows[0].targetType).toBe("TENANT");
      expect(rows[0].targetId).toBe(tenant.id);

      await prisma.tenant.delete({ where: { id: tenant.id } });
    } finally {
      await prisma.auditLog.deleteMany({ where: { actorUserId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});

test.describe("Audit log security — membership role change (HTTP)", () => {
  test("PATCH ile rol değişikliği başarılı olduğunda MEMBERSHIP_ROLE_CHANGED satırı doğru tenantId/actorUserId ile oluşuyor", async ({
    request,
  }) => {
    const tenant = await prisma.tenant.create({ data: { name: "Audit Role Co", slug: `audit-role-${randomUUID()}` } });
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const member = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);
    const memberMembership = await prisma.membership.findFirstOrThrow({
      where: { tenantId: tenant.id, userId: member.userId },
    });

    try {
      const response = await request.patch(`/api/tenants/${tenant.id}/members/${memberMembership.id}`, {
        headers: { cookie: owner.cookie },
        data: { role: "ADMIN" },
      });
      expect(response.status()).toBe(200);

      const rows = await prisma.auditLog.findMany({ where: { tenantId: tenant.id, action: "MEMBERSHIP_ROLE_CHANGED" } });
      expect(rows).toHaveLength(1);
      expect(rows[0].actorUserId).toBe(owner.userId);
      expect(rows[0].tenantId).toBe(tenant.id);
      expect(rows[0].targetType).toBe("MEMBERSHIP");
      expect(rows[0].targetId).toBe(memberMembership.id);
      expect(rows[0].metadata).toEqual({ previousRole: "MEMBER", newRole: "ADMIN" });
    } finally {
      await prisma.auditLog.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.deleteMany({ where: { id: { in: [owner.userId, member.userId] } } });
    }
  });

  test("MEMBER'ın role-change denemesi 403 ile reddedilir ve audit success event üretmez", async ({ request }) => {
    const tenant = await prisma.tenant.create({ data: { name: "Audit Forbidden Co", slug: `audit-forbidden-${randomUUID()}` } });
    const member = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);
    const other = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);
    const otherMembership = await prisma.membership.findFirstOrThrow({
      where: { tenantId: tenant.id, userId: other.userId },
    });

    try {
      const response = await request.patch(`/api/tenants/${tenant.id}/members/${otherMembership.id}`, {
        headers: { cookie: member.cookie },
        data: { role: "ADMIN" },
      });
      expect(response.status()).toBe(403);

      const rows = await prisma.auditLog.findMany({ where: { tenantId: tenant.id, action: "MEMBERSHIP_ROLE_CHANGED" } });
      expect(rows).toHaveLength(0);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.deleteMany({ where: { id: { in: [member.userId, other.userId] } } });
    }
  });

  test("aktif tenant URL'deki tenantId'den farklıysa (403 tenant boundary bypass) audit event üretilmiyor", async ({
    request,
  }) => {
    const activeTenant = await prisma.tenant.create({ data: { name: "Audit Active Co", slug: `audit-active-${randomUUID()}` } });
    const otherTenant = await prisma.tenant.create({ data: { name: "Audit Other Co", slug: `audit-other-${randomUUID()}` } });
    const owner = await createUserWithMembership(MembershipRole.OWNER, activeTenant.id);
    await prisma.membership.create({
      data: { userId: owner.userId, tenantId: otherTenant.id, role: MembershipRole.OWNER },
    });
    const victim = await createUserWithMembership(MembershipRole.MEMBER, otherTenant.id);
    const victimMembership = await prisma.membership.findFirstOrThrow({
      where: { tenantId: otherTenant.id, userId: victim.userId },
    });

    try {
      const response = await request.patch(`/api/tenants/${otherTenant.id}/members/${victimMembership.id}`, {
        headers: { cookie: owner.cookie },
        data: { role: "ADMIN" },
      });
      expect(response.status()).toBe(403);

      const rows = await prisma.auditLog.findMany({
        where: { tenantId: { in: [activeTenant.id, otherTenant.id] }, action: "MEMBERSHIP_ROLE_CHANGED" },
      });
      expect(rows).toHaveLength(0);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [activeTenant.id, otherTenant.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [owner.userId, victim.userId] } } });
    }
  });
});
