import { randomUUID } from "node:crypto";

import { MembershipRole } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { registerUser } from "../src/lib/auth/signup";
import { listMembers, removeMember, updateMemberRole } from "../src/lib/tenants/membership";
import { prisma } from "../src/lib/prisma";

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function createUser() {
  const email = `member-${randomUUID()}@example.com`;
  const result = await registerUser({ email, password: "S3curePassw0rd!" });
  if (!result.ok) throw new Error("test setup failed: registerUser");
  return result.user.id;
}

async function createTenant() {
  return prisma.tenant.create({
    data: { name: "Test Co", slug: `test-co-${randomUUID()}` },
  });
}

async function addMember(userId: string, tenantId: string, role: MembershipRole) {
  return prisma.membership.create({ data: { userId, tenantId, role } });
}

/** Setup: bir tenant + bir OWNER kullanıcısı oluşturur. */
async function setupTenantWithOwner() {
  const ownerId = await createUser();
  const tenant = await createTenant();
  const ownerMembership = await addMember(ownerId, tenant.id, MembershipRole.OWNER);
  return { ownerId, tenant, ownerMembership };
}

async function cleanup(userIds: string[], tenantIds: string[]) {
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

test.describe("listMembers()", () => {
  // NOT: listMembers() artık authorization kararı vermiyor (bkz. src/lib/tenants/membership.ts
  // dokümantasyonu) — "yetkisiz kullanıcı 403 alır" senaryosu artık HTTP/route seviyesinde
  // test ediliyor (bkz. e2e/tenant-membership.spec.ts, security/tenant-membership-authorization-security.spec.ts),
  // çünkü permission kontrolü Issue #12 ile merkezi `requirePermission()`'a taşındı.
  test("sadece verilen tenant'ın üyelerini döndürür, başka tenant sızmaz", async () => {
    const { ownerId, tenant } = await setupTenantWithOwner();
    const memberId = await createUser();
    await addMember(memberId, tenant.id, MembershipRole.MEMBER);

    const otherOwnerId = await createUser();
    const otherTenant = await createTenant();
    await addMember(otherOwnerId, otherTenant.id, MembershipRole.OWNER);

    try {
      const members = await listMembers(tenant.id);

      expect(members).toHaveLength(2);
      expect(members.every((m) => m.userId === ownerId || m.userId === memberId)).toBe(true);
      expect(members.some((m) => m.userId === otherOwnerId)).toBe(false);
    } finally {
      await cleanup([ownerId, memberId, otherOwnerId], [tenant.id, otherTenant.id]);
    }
  });
});

test.describe("updateMemberRole() — temel davranış", () => {
  test("OWNER bir MEMBER'ın rolünü ADMIN'e değiştirebiliyor", async () => {
    const { ownerId, tenant } = await setupTenantWithOwner();
    const memberId = await createUser();
    const membership = await addMember(memberId, tenant.id, MembershipRole.MEMBER);

    try {
      const result = await updateMemberRole(tenant.id, membership.id, MembershipRole.OWNER, "ADMIN");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.member.role).toBe("ADMIN");
    } finally {
      await cleanup([ownerId, memberId], [tenant.id]);
    }
  });

  test("geçersiz rol 400 ile reddediliyor", async () => {
    const { ownerId, tenant } = await setupTenantWithOwner();
    const memberId = await createUser();
    const membership = await addMember(memberId, tenant.id, MembershipRole.MEMBER);

    try {
      const result = await updateMemberRole(tenant.id, membership.id, MembershipRole.OWNER, "SUPERADMIN");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
    } finally {
      await cleanup([ownerId, memberId], [tenant.id]);
    }
  });

  test("son OWNER'ın rolü düşürülemiyor (409)", async () => {
    const { ownerId, tenant, ownerMembership } = await setupTenantWithOwner();

    try {
      const result = await updateMemberRole(tenant.id, ownerMembership.id, MembershipRole.OWNER, "MEMBER");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(409);

      const stillOwner = await prisma.membership.findUniqueOrThrow({ where: { id: ownerMembership.id } });
      expect(stillOwner.role).toBe("OWNER");
    } finally {
      await cleanup([ownerId], [tenant.id]);
    }
  });

  test("birden fazla OWNER varsa OWNER, diğer OWNER'ın rolünü düşürebiliyor", async () => {
    const { ownerId, tenant, ownerMembership } = await setupTenantWithOwner();
    const secondOwnerId = await createUser();
    await addMember(secondOwnerId, tenant.id, MembershipRole.OWNER);

    try {
      const result = await updateMemberRole(tenant.id, ownerMembership.id, MembershipRole.OWNER, "MEMBER");
      expect(result.ok).toBe(true);
    } finally {
      await cleanup([ownerId, secondOwnerId], [tenant.id]);
    }
  });

  test("başka tenant'a ait membershipId ile update edilirse 404 döner ve veri değişmez", async () => {
    const { ownerId, tenant } = await setupTenantWithOwner();
    const otherOwnerId = await createUser();
    const otherTenant = await createTenant();
    const otherOwnerMembership = await addMember(otherOwnerId, otherTenant.id, MembershipRole.OWNER);

    try {
      const result = await updateMemberRole(tenant.id, otherOwnerMembership.id, MembershipRole.OWNER, "MEMBER");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);

      const unchanged = await prisma.membership.findUniqueOrThrow({ where: { id: otherOwnerMembership.id } });
      expect(unchanged.role).toBe("OWNER");
    } finally {
      await cleanup([ownerId, otherOwnerId], [tenant.id, otherTenant.id]);
    }
  });
});

test.describe("updateMemberRole() — ADMIN yetkileri ve ownership koruması (Issue #12)", () => {
  test("ADMIN bir MEMBER'ın rolünü değiştirebiliyor (izinli yönetim işlemi)", async () => {
    const { ownerId, tenant } = await setupTenantWithOwner();
    const adminId = await createUser();
    await addMember(adminId, tenant.id, MembershipRole.ADMIN);
    const memberId = await createUser();
    const membership = await addMember(memberId, tenant.id, MembershipRole.MEMBER);

    try {
      const result = await updateMemberRole(tenant.id, membership.id, MembershipRole.ADMIN, "ADMIN");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.member.role).toBe("ADMIN");
    } finally {
      await cleanup([ownerId, adminId, memberId], [tenant.id]);
    }
  });

  test("ADMIN kimseyi (kendisi dahil) OWNER yapamaz — privilege escalation koruması", async () => {
    const { ownerId, tenant } = await setupTenantWithOwner();
    const adminId = await createUser();
    const adminMembership = await addMember(adminId, tenant.id, MembershipRole.ADMIN);

    try {
      // ADMIN kendisini OWNER yapmaya çalışıyor.
      const selfPromote = await updateMemberRole(tenant.id, adminMembership.id, MembershipRole.ADMIN, "OWNER");
      expect(selfPromote.ok).toBe(false);
      if (selfPromote.ok) return;
      expect(selfPromote.status).toBe(403);

      const stillAdmin = await prisma.membership.findUniqueOrThrow({ where: { id: adminMembership.id } });
      expect(stillAdmin.role).toBe("ADMIN");
    } finally {
      await cleanup([ownerId, adminId], [tenant.id]);
    }
  });

  test("ADMIN başka bir üyeyi OWNER yapamaz", async () => {
    const { ownerId, tenant } = await setupTenantWithOwner();
    const adminId = await createUser();
    await addMember(adminId, tenant.id, MembershipRole.ADMIN);
    const memberId = await createUser();
    const membership = await addMember(memberId, tenant.id, MembershipRole.MEMBER);

    try {
      const result = await updateMemberRole(tenant.id, membership.id, MembershipRole.ADMIN, "OWNER");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(403);

      const unchanged = await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } });
      expect(unchanged.role).toBe("MEMBER");
    } finally {
      await cleanup([ownerId, adminId, memberId], [tenant.id]);
    }
  });

  test("ADMIN mevcut bir OWNER'ın rolünü değiştiremez (ownership koruması)", async () => {
    const { ownerId, tenant, ownerMembership } = await setupTenantWithOwner();
    const adminId = await createUser();
    await addMember(adminId, tenant.id, MembershipRole.ADMIN);
    // İkinci bir OWNER ekleyelim ki "son OWNER" değil, sırf ownership koruması test edilsin.
    const secondOwnerId = await createUser();
    await addMember(secondOwnerId, tenant.id, MembershipRole.OWNER);

    try {
      const result = await updateMemberRole(tenant.id, ownerMembership.id, MembershipRole.ADMIN, "MEMBER");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(403);

      const unchanged = await prisma.membership.findUniqueOrThrow({ where: { id: ownerMembership.id } });
      expect(unchanged.role).toBe("OWNER");
    } finally {
      await cleanup([ownerId, adminId, secondOwnerId], [tenant.id]);
    }
  });
});

test.describe("removeMember() — temel davranış", () => {
  test("OWNER bir üyeyi tenant'tan çıkarabiliyor", async () => {
    const { ownerId, tenant } = await setupTenantWithOwner();
    const memberId = await createUser();
    const membership = await addMember(memberId, tenant.id, MembershipRole.MEMBER);

    try {
      const result = await removeMember(tenant.id, membership.id, MembershipRole.OWNER);
      expect(result.ok).toBe(true);

      const gone = await prisma.membership.findUnique({ where: { id: membership.id } });
      expect(gone).toBeNull();
    } finally {
      await cleanup([ownerId, memberId], [tenant.id]);
    }
  });

  test("son OWNER silinemiyor (409)", async () => {
    const { ownerId, tenant, ownerMembership } = await setupTenantWithOwner();

    try {
      const result = await removeMember(tenant.id, ownerMembership.id, MembershipRole.OWNER);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(409);

      const stillThere = await prisma.membership.findUnique({ where: { id: ownerMembership.id } });
      expect(stillThere).not.toBeNull();
    } finally {
      await cleanup([ownerId], [tenant.id]);
    }
  });

  test("başka tenant'a ait membershipId ile silinmeye çalışılırsa 404 döner ve veri silinmez", async () => {
    const { ownerId, tenant } = await setupTenantWithOwner();
    const otherOwnerId = await createUser();
    const otherTenant = await createTenant();
    const otherOwnerMembership = await addMember(otherOwnerId, otherTenant.id, MembershipRole.OWNER);

    try {
      const result = await removeMember(tenant.id, otherOwnerMembership.id, MembershipRole.OWNER);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);

      const stillThere = await prisma.membership.findUnique({ where: { id: otherOwnerMembership.id } });
      expect(stillThere).not.toBeNull();
    } finally {
      await cleanup([ownerId, otherOwnerId], [tenant.id, otherTenant.id]);
    }
  });
});

test.describe("removeMember() — ADMIN yetkileri ve ownership koruması (Issue #12)", () => {
  test("ADMIN bir MEMBER'ı çıkarabiliyor (izinli yönetim işlemi)", async () => {
    const { ownerId, tenant } = await setupTenantWithOwner();
    const adminId = await createUser();
    await addMember(adminId, tenant.id, MembershipRole.ADMIN);
    const memberId = await createUser();
    const membership = await addMember(memberId, tenant.id, MembershipRole.MEMBER);

    try {
      const result = await removeMember(tenant.id, membership.id, MembershipRole.ADMIN);
      expect(result.ok).toBe(true);

      const gone = await prisma.membership.findUnique({ where: { id: membership.id } });
      expect(gone).toBeNull();
    } finally {
      await cleanup([ownerId, adminId, memberId], [tenant.id]);
    }
  });

  test("ADMIN bir OWNER'ı çıkaramaz (ownership koruması — son OWNER olmasa bile)", async () => {
    const { ownerId, tenant, ownerMembership } = await setupTenantWithOwner();
    const adminId = await createUser();
    await addMember(adminId, tenant.id, MembershipRole.ADMIN);
    const secondOwnerId = await createUser();
    await addMember(secondOwnerId, tenant.id, MembershipRole.OWNER);

    try {
      const result = await removeMember(tenant.id, ownerMembership.id, MembershipRole.ADMIN);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(403);

      const stillThere = await prisma.membership.findUnique({ where: { id: ownerMembership.id } });
      expect(stillThere).not.toBeNull();
    } finally {
      await cleanup([ownerId, adminId, secondOwnerId], [tenant.id]);
    }
  });
});
