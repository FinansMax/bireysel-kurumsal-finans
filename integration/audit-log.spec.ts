import { randomUUID } from "node:crypto";

import { MembershipRole } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "../src/lib/audit/actions";
import { sanitizeMetadata } from "../src/lib/audit/sanitize";
import { writeAuditLog } from "../src/lib/audit/write-audit-log";
import { authenticateUser } from "../src/lib/auth/authenticate";
import { registerUser } from "../src/lib/auth/signup";
import { prisma } from "../src/lib/prisma";
import { createTenant } from "../src/lib/tenants/create-tenant";
import { updateMemberRole } from "../src/lib/tenants/membership";

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function createUser(email?: string) {
  const result = await registerUser({
    email: email ?? `audit-${randomUUID()}@example.com`,
    password: "S3curePassw0rd!",
  });
  if (!result.ok) throw new Error("test setup failed: registerUser");
  return result.user;
}

async function createTestTenant() {
  return prisma.tenant.create({ data: { name: "Audit Co", slug: `audit-co-${randomUUID()}` } });
}

async function addMember(userId: string, tenantId: string, role: MembershipRole) {
  return prisma.membership.create({ data: { userId, tenantId, role } });
}

async function cleanup(userIds: string[], tenantIds: string[]) {
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: { in: userIds } }, { tenantId: { in: tenantIds } }] } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

/**
 * `writeAuditLog()`'un içindeki `prisma.auditLog.create`'i geçici olarak, DB'ye ASLA
 * ulaşmayan bir hata fırlatan sahte implementasyonla değiştirir. Bu bir production
 * backdoor'u DEĞİLDİR — üretim kodu hiç değişmez; sadece test dosyasında, paylaşılan
 * `prisma` client'ının bir metodu tek bir test süresince monkey-patch'lenir ve `finally`
 * içinde orijinaline geri döndürülür. Amaç: audit insert'i GERÇEKTEN başarısız olduğunda
 * ana business operation'ın (tenant creation, role change) yine de başarılı kaldığını
 * kanıtlamak (Issue #15, best-effort gereksinimi).
 */
async function withBrokenAuditWrites<T>(fn: () => Promise<T>): Promise<T> {
  type CreateFn = typeof prisma.auditLog.create;
  const original: CreateFn = prisma.auditLog.create.bind(prisma.auditLog);
  prisma.auditLog.create = (async () => {
    throw new Error("simulated audit DB failure");
  }) as unknown as CreateFn;

  try {
    return await fn();
  } finally {
    prisma.auditLog.create = original;
  }
}

test.describe("writeAuditLog() — temel davranış", () => {
  test("verilen alanlarla bir AuditLog satırı oluşturuyor", async () => {
    const user = await createUser();
    const tenant = await createTestTenant();

    try {
      await writeAuditLog({
        actorUserId: user.id,
        tenantId: tenant.id,
        action: AUDIT_ACTIONS.TENANT_CREATED,
        targetType: AUDIT_TARGET_TYPES.TENANT,
        targetId: tenant.id,
        metadata: { foo: "bar" },
      });

      const rows = await prisma.auditLog.findMany({ where: { tenantId: tenant.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].actorUserId).toBe(user.id);
      expect(rows[0].action).toBe("TENANT_CREATED");
      expect(rows[0].targetType).toBe("TENANT");
      expect(rows[0].targetId).toBe(tenant.id);
      expect(rows[0].metadata).toEqual({ foo: "bar" });
    } finally {
      await cleanup([user.id], [tenant.id]);
    }
  });

  test("actorUserId ve tenantId nullable — başarısız login gibi tenant-bağımsız olaylar için", async () => {
    await writeAuditLog({ action: AUDIT_ACTIONS.AUTH_LOGIN_FAILURE });

    const rows = await prisma.auditLog.findMany({
      where: { action: "AUTH_LOGIN_FAILURE", actorUserId: null, tenantId: null },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(rows).toHaveLength(1);

    await prisma.auditLog.delete({ where: { id: rows[0].id } });
  });

  test("DB write hatası (geçersiz FK) exception fırlatmıyor ve satır oluşturmuyor (best-effort)", async () => {
    const bogusUserId = `does-not-exist-${randomUUID()}`;

    await expect(
      writeAuditLog({ actorUserId: bogusUserId, action: AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS }),
    ).resolves.toBeUndefined();

    const rows = await prisma.auditLog.findMany({ where: { actorUserId: bogusUserId } });
    expect(rows).toHaveLength(0);
  });
});

test.describe("sanitizeMetadata() — hassas veri redaksiyonu", () => {
  test("üst seviye hassas key'ler redakte ediliyor", () => {
    const result = sanitizeMetadata({
      password: "hunter2",
      passwordHash: "abc123",
      sessionToken: "tok_live_xyz",
      resetToken: "reset_xyz",
      invitationToken: "invite_xyz",
      authorization: "Bearer abc",
      cookie: "authjs.session-token=xyz",
      secret: "shh",
      apiKey: "sk_live_123",
      oauthCredential: "cred_xyz",
      previousRole: "MEMBER",
      newRole: "ADMIN",
    });

    expect(result).toEqual({
      password: "[REDACTED]",
      passwordHash: "[REDACTED]",
      sessionToken: "[REDACTED]",
      resetToken: "[REDACTED]",
      invitationToken: "[REDACTED]",
      authorization: "[REDACTED]",
      cookie: "[REDACTED]",
      secret: "[REDACTED]",
      apiKey: "[REDACTED]",
      oauthCredential: "[REDACTED]",
      previousRole: "MEMBER",
      newRole: "ADMIN",
    });
  });

  test("nested object içindeki hassas key'ler de redakte ediliyor", () => {
    const result = sanitizeMetadata({
      user: { email: "a@example.com", password: "hunter2" },
      request: { headers: { authorization: "Bearer abc", "x-request-id": "req-1" } },
    });

    expect(result).toEqual({
      user: { email: "a@example.com", password: "[REDACTED]" },
      request: { headers: { authorization: "[REDACTED]", "x-request-id": "req-1" } },
    });
  });

  test("nested array içindeki hassas key'ler de redakte ediliyor", () => {
    const result = sanitizeMetadata({
      attempts: [
        { email: "a@example.com", password: "hunter2" },
        { email: "b@example.com", token: "tok_xyz" },
      ],
    });

    expect(result).toEqual({
      attempts: [
        { email: "a@example.com", password: "[REDACTED]" },
        { email: "b@example.com", token: "[REDACTED]" },
      ],
    });
  });

  test("hassas olmayan veri değişmeden kalıyor", () => {
    const result = sanitizeMetadata({ previousRole: "MEMBER", newRole: "ADMIN", count: 3 });
    expect(result).toEqual({ previousRole: "MEMBER", newRole: "ADMIN", count: 3 });
  });
});

test.describe("Login audit (authenticateUser)", () => {
  test("başarılı login → AUTH_LOGIN_SUCCESS, doğru actorUserId/targetId", async () => {
    const email = `audit-login-ok-${randomUUID()}@example.com`;
    const password = "S3curePassw0rd!";
    const signup = await registerUser({ email, password });
    expect(signup.ok).toBe(true);
    if (!signup.ok) return;

    try {
      const user = await authenticateUser({ email, password });
      expect(user).not.toBeNull();

      const rows = await prisma.auditLog.findMany({
        where: { action: "AUTH_LOGIN_SUCCESS", actorUserId: signup.user.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].targetType).toBe("USER");
      expect(rows[0].targetId).toBe(signup.user.id);
    } finally {
      await cleanup([signup.user.id], []);
    }
  });

  test("başarısız login (yanlış şifre) → AUTH_LOGIN_FAILURE, actorUserId null", async () => {
    const email = `audit-login-wrong-${randomUUID()}@example.com`;
    const signup = await registerUser({ email, password: "S3curePassw0rd!" });
    expect(signup.ok).toBe(true);
    if (!signup.ok) return;

    try {
      const before = await prisma.auditLog.count({ where: { action: "AUTH_LOGIN_FAILURE" } });

      const user = await authenticateUser({ email, password: "WrongPassword!" });
      expect(user).toBeNull();

      const after = await prisma.auditLog.count({ where: { action: "AUTH_LOGIN_FAILURE" } });
      expect(after).toBe(before + 1);

      const rows = await prisma.auditLog.findMany({
        where: { action: "AUTH_LOGIN_FAILURE" },
        orderBy: { createdAt: "desc" },
        take: 1,
      });
      expect(rows[0].actorUserId).toBeNull();
    } finally {
      await cleanup([signup.user.id], []);
    }
  });

  test("başarısız login (bilinmeyen e-posta) → AUTH_LOGIN_FAILURE, actorUserId null, PII saklanmıyor", async () => {
    const unknownEmail = `audit-login-unknown-${randomUUID()}@example.com`;

    const user = await authenticateUser({ email: unknownEmail, password: "WhateverPassword!" });
    expect(user).toBeNull();

    const rows = await prisma.auditLog.findMany({
      where: { action: "AUTH_LOGIN_FAILURE" },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].actorUserId).toBeNull();
    // Girilen e-posta metadata'ya KONMAZ (user enumeration / gereksiz PII engeli).
    expect(rows[0].metadata).toBeNull();
    expect(JSON.stringify(rows[0])).not.toContain(unknownEmail);

    await prisma.auditLog.delete({ where: { id: rows[0].id } });
  });

  test("login audit kayıtlarında (başarılı/başarısız) plaintext şifre veya token yok", async () => {
    const email = `audit-login-noleak-${randomUUID()}@example.com`;
    const password = "S3curePassw0rd!";
    const signup = await registerUser({ email, password });
    expect(signup.ok).toBe(true);
    if (!signup.ok) return;

    try {
      await authenticateUser({ email, password });
      await authenticateUser({ email, password: "WrongPassword!" });

      const rows = await prisma.auditLog.findMany({
        where: { OR: [{ actorUserId: signup.user.id }, { action: "AUTH_LOGIN_FAILURE" }] },
        orderBy: { createdAt: "desc" },
        take: 5,
      });
      for (const row of rows) {
        expect(JSON.stringify(row)).not.toContain(password);
        expect(JSON.stringify(row)).not.toContain("WrongPassword!");
      }
    } finally {
      await cleanup([signup.user.id], []);
    }
  });
});

test.describe("Tenant creation audit (createTenant)", () => {
  test("başarılı tenant creation → TENANT_CREATED, doğru actorUserId/tenantId", async () => {
    const user = await createUser();
    let tenantId: string | undefined;

    try {
      const result = await createTenant(user.id, { name: "Audit Test Tenant" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      tenantId = result.tenant.id;

      const rows = await prisma.auditLog.findMany({ where: { tenantId: result.tenant.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe("TENANT_CREATED");
      expect(rows[0].actorUserId).toBe(user.id);
      expect(rows[0].targetType).toBe("TENANT");
      expect(rows[0].targetId).toBe(result.tenant.id);
    } finally {
      await cleanup([user.id], tenantId ? [tenantId] : []);
    }
  });

  test("audit DB write başarısız olsa bile tenant creation başarılı kalıyor (best-effort)", async () => {
    const user = await createUser();
    let tenantId: string | undefined;

    try {
      const result = await withBrokenAuditWrites(() => createTenant(user.id, { name: "Resilient Tenant" }));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      tenantId = result.tenant.id;

      const persisted = await prisma.tenant.findUnique({ where: { id: result.tenant.id } });
      expect(persisted).not.toBeNull();

      // Audit insert gerçekten başarısız olduğu için hiçbir satır oluşmamış olmalı.
      const rows = await prisma.auditLog.findMany({ where: { tenantId: result.tenant.id } });
      expect(rows).toHaveLength(0);
    } finally {
      await cleanup([user.id], tenantId ? [tenantId] : []);
    }
  });
});

test.describe("Membership role change audit (updateMemberRole)", () => {
  test("başarılı rol değişikliği → MEMBERSHIP_ROLE_CHANGED, doğru actorUserId/tenantId/targetId + previousRole/newRole", async () => {
    const owner = await createUser();
    const tenant = await createTestTenant();
    await addMember(owner.id, tenant.id, MembershipRole.OWNER);
    const member = await createUser();
    const membership = await addMember(member.id, tenant.id, MembershipRole.MEMBER);

    try {
      const result = await updateMemberRole(tenant.id, membership.id, owner.id, MembershipRole.OWNER, "ADMIN");
      expect(result.ok).toBe(true);

      const rows = await prisma.auditLog.findMany({ where: { tenantId: tenant.id, action: "MEMBERSHIP_ROLE_CHANGED" } });
      expect(rows).toHaveLength(1);
      expect(rows[0].actorUserId).toBe(owner.id);
      expect(rows[0].tenantId).toBe(tenant.id);
      expect(rows[0].targetType).toBe("MEMBERSHIP");
      expect(rows[0].targetId).toBe(membership.id);
      expect(rows[0].metadata).toEqual({ previousRole: "MEMBER", newRole: "ADMIN" });
    } finally {
      await cleanup([owner.id, member.id], [tenant.id]);
    }
  });

  test("yetkisiz/başarısız role-change denemesi (403) audit success event üretmiyor", async () => {
    const owner = await createUser();
    const tenant = await createTestTenant();
    await addMember(owner.id, tenant.id, MembershipRole.OWNER);
    const admin = await createUser();
    const adminMembership = await addMember(admin.id, tenant.id, MembershipRole.ADMIN);

    try {
      // ADMIN kendisini OWNER yapmaya çalışıyor — 403 ile reddedilmeli.
      const result = await updateMemberRole(tenant.id, adminMembership.id, admin.id, MembershipRole.ADMIN, "OWNER");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(403);

      const rows = await prisma.auditLog.findMany({ where: { tenantId: tenant.id, action: "MEMBERSHIP_ROLE_CHANGED" } });
      expect(rows).toHaveLength(0);
    } finally {
      await cleanup([owner.id, admin.id], [tenant.id]);
    }
  });

  test("geçersiz rol (400) audit success event üretmiyor", async () => {
    const owner = await createUser();
    const tenant = await createTestTenant();
    await addMember(owner.id, tenant.id, MembershipRole.OWNER);
    const member = await createUser();
    const membership = await addMember(member.id, tenant.id, MembershipRole.MEMBER);

    try {
      const result = await updateMemberRole(tenant.id, membership.id, owner.id, MembershipRole.OWNER, "SUPERADMIN");
      expect(result.ok).toBe(false);

      const rows = await prisma.auditLog.findMany({ where: { tenantId: tenant.id, action: "MEMBERSHIP_ROLE_CHANGED" } });
      expect(rows).toHaveLength(0);
    } finally {
      await cleanup([owner.id, member.id], [tenant.id]);
    }
  });

  test("audit DB write başarısız olsa bile role change başarılı kalıyor (best-effort)", async () => {
    const owner = await createUser();
    const tenant = await createTestTenant();
    await addMember(owner.id, tenant.id, MembershipRole.OWNER);
    const member = await createUser();
    const membership = await addMember(member.id, tenant.id, MembershipRole.MEMBER);

    try {
      const result = await withBrokenAuditWrites(() =>
        updateMemberRole(tenant.id, membership.id, owner.id, MembershipRole.OWNER, "ADMIN"),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.member.role).toBe("ADMIN");

      const persisted = await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } });
      expect(persisted.role).toBe("ADMIN");

      const rows = await prisma.auditLog.findMany({ where: { tenantId: tenant.id, action: "MEMBERSHIP_ROLE_CHANGED" } });
      expect(rows).toHaveLength(0);
    } finally {
      await cleanup([owner.id, member.id], [tenant.id]);
    }
  });

  test("farklı tenant'lardaki eşzamanlı rol değişiklikleri birbirinin audit kaydına yanlış tenantId ile karışmıyor", async () => {
    const ownerA = await createUser();
    const tenantA = await createTestTenant();
    await addMember(ownerA.id, tenantA.id, MembershipRole.OWNER);
    const memberA = await createUser();
    const membershipA = await addMember(memberA.id, tenantA.id, MembershipRole.MEMBER);

    const ownerB = await createUser();
    const tenantB = await createTestTenant();
    await addMember(ownerB.id, tenantB.id, MembershipRole.OWNER);
    const memberB = await createUser();
    const membershipB = await addMember(memberB.id, tenantB.id, MembershipRole.MEMBER);

    try {
      await Promise.all([
        updateMemberRole(tenantA.id, membershipA.id, ownerA.id, MembershipRole.OWNER, "ADMIN"),
        updateMemberRole(tenantB.id, membershipB.id, ownerB.id, MembershipRole.OWNER, "ADMIN"),
      ]);

      const rowsA = await prisma.auditLog.findMany({ where: { tenantId: tenantA.id, action: "MEMBERSHIP_ROLE_CHANGED" } });
      const rowsB = await prisma.auditLog.findMany({ where: { tenantId: tenantB.id, action: "MEMBERSHIP_ROLE_CHANGED" } });

      expect(rowsA).toHaveLength(1);
      expect(rowsB).toHaveLength(1);
      expect(rowsA[0].targetId).toBe(membershipA.id);
      expect(rowsB[0].targetId).toBe(membershipB.id);
      expect(rowsA[0].actorUserId).toBe(ownerA.id);
      expect(rowsB[0].actorUserId).toBe(ownerB.id);
    } finally {
      await cleanup([ownerA.id, memberA.id, ownerB.id, memberB.id], [tenantA.id, tenantB.id]);
    }
  });
});
