import { randomUUID } from "node:crypto";

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

async function addMember(userId: string, tenantId: string, role: "OWNER" | "ADMIN" | "MEMBER") {
  return prisma.membership.create({ data: { userId, tenantId, role } });
}

/** Setup: bir tenant + bir OWNER kullanıcısı oluşturur. */
async function setupTenantWithOwner() {
  const ownerId = await createUser();
  const tenant = await createTenant();
  const ownerMembership = await addMember(ownerId, tenant.id, "OWNER");
  return { ownerId, tenant, ownerMembership };
}

async function cleanup(userIds: string[], tenantIds: string[]) {
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

test.describe("listMembers()", () => {
  test("OWNER kendi tenant üyelerini listeleyebiliyor, sadece o tenant'ın üyeleri döner", async () => {
    const { ownerId, tenant } = await setupTenantWithOwner();
    const memberId = await createUser();
    await addMember(memberId, tenant.id, "MEMBER");

    // Başka bir tenant + kullanıcı: sızmamalı.
    const otherOwnerId = await createUser();
    const otherTenant = await createTenant();
    await addMember(otherOwnerId, otherTenant.id, "OWNER");

    try {
      const result = await listMembers(tenant.id, ownerId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.members).toHaveLength(2);
      expect(result.members.every((m) => m.userId === ownerId || m.userId === memberId)).toBe(true);
      expect(result.members.some((m) => m.userId === otherOwnerId)).toBe(false);
    } finally {
      await cleanup([ownerId, memberId, otherOwnerId], [tenant.id, otherTenant.id]);
    }
  });

  test("ilgili tenant'ta OWNER olmayan kullanıcı 403 alır (başka tenant sızıntısı yok)", async () => {
    const { ownerId, tenant } = await setupTenantWithOwner();
    const strangerId = await createUser();

    try {
      const result = await listMembers(tenant.id, strangerId);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(403);
    } finally {
      await cleanup([ownerId, strangerId], [tenant.id]);
    }
  });
});

test.describe("updateMemberRole()", () => {
  test("OWNER bir MEMBER'ın rolünü ADMIN'e değiştirebiliyor", async () => {
    const { ownerId, tenant } = await setupTenantWithOwner();
    const memberId = await createUser();
    const membership = await addMember(memberId, tenant.id, "MEMBER");

    try {
      const result = await updateMemberRole(tenant.id, membership.id, ownerId, "ADMIN");
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
    const membership = await addMember(memberId, tenant.id, "MEMBER");

    try {
      const result = await updateMemberRole(tenant.id, membership.id, ownerId, "SUPERADMIN");
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
      const result = await updateMemberRole(tenant.id, ownerMembership.id, ownerId, "MEMBER");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(409);

      const stillOwner = await prisma.membership.findUniqueOrThrow({ where: { id: ownerMembership.id } });
      expect(stillOwner.role).toBe("OWNER");
    } finally {
      await cleanup([ownerId], [tenant.id]);
    }
  });

  test("birden fazla OWNER varsa birinin rolü düşürülebiliyor", async () => {
    const { ownerId, tenant, ownerMembership } = await setupTenantWithOwner();
    const secondOwnerId = await createUser();
    await addMember(secondOwnerId, tenant.id, "OWNER");

    try {
      const result = await updateMemberRole(tenant.id, ownerMembership.id, ownerId, "MEMBER");
      expect(result.ok).toBe(true);
    } finally {
      await cleanup([ownerId, secondOwnerId], [tenant.id]);
    }
  });

  test("başka tenant'a ait membershipId ile update edilirse 404 döner ve veri değişmez", async () => {
    const { ownerId, tenant } = await setupTenantWithOwner();
    const otherOwnerId = await createUser();
    const otherTenant = await createTenant();
    const otherOwnerMembership = await addMember(otherOwnerId, otherTenant.id, "OWNER");

    try {
      const result = await updateMemberRole(tenant.id, otherOwnerMembership.id, ownerId, "MEMBER");
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

test.describe("removeMember()", () => {
  test("OWNER bir üyeyi tenant'tan çıkarabiliyor", async () => {
    const { ownerId, tenant } = await setupTenantWithOwner();
    const memberId = await createUser();
    const membership = await addMember(memberId, tenant.id, "MEMBER");

    try {
      const result = await removeMember(tenant.id, membership.id, ownerId);
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
      const result = await removeMember(tenant.id, ownerMembership.id, ownerId);
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
    const otherOwnerMembership = await addMember(otherOwnerId, otherTenant.id, "OWNER");

    try {
      const result = await removeMember(tenant.id, otherOwnerMembership.id, ownerId);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);

      const stillThere = await prisma.membership.findUnique({ where: { id: otherOwnerMembership.id } });
      expect(stillThere).not.toBeNull();
    } finally {
      await cleanup([ownerId, otherOwnerId], [tenant.id, otherTenant.id]);
    }
  });

  test("ilgili tenant'ın OWNER'ı olmayan kullanıcı üye çıkaramaz (403)", async () => {
    const { ownerId, tenant } = await setupTenantWithOwner();
    const memberId = await createUser();
    const membership = await addMember(memberId, tenant.id, "MEMBER");
    const strangerId = await createUser();

    try {
      const result = await removeMember(tenant.id, membership.id, strangerId);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(403);
    } finally {
      await cleanup([ownerId, memberId, strangerId], [tenant.id]);
    }
  });
});
