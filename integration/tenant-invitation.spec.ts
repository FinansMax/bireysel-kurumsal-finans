import { randomUUID } from "node:crypto";

import { MembershipRole } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { registerUser } from "../src/lib/auth/signup";
import { acceptInvitation, createInvitation, hashInvitationToken } from "../src/lib/tenants/invitation";
import { removeMember } from "../src/lib/tenants/membership";
import { prisma } from "../src/lib/prisma";

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function createUser(email?: string) {
  const result = await registerUser({
    email: email ?? `invite-${randomUUID()}@example.com`,
    password: "S3curePassw0rd!",
  });
  if (!result.ok) throw new Error("test setup failed: registerUser");
  return result.user;
}

async function createTenant() {
  return prisma.tenant.create({ data: { name: "Invite Co", slug: `invite-co-${randomUUID()}` } });
}

async function addMember(userId: string, tenantId: string, role: MembershipRole) {
  return prisma.membership.create({ data: { userId, tenantId, role } });
}

async function cleanup(userIds: string[], tenantIds: string[]) {
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

/** requestPasswordReset testlerindeki `requestResetAndCaptureUrl` deseniyle aynı: gerçek bir
 * sender enjekte ederek dosya sistemine dokunmadan raw token'ı yakalar. */
async function createInvitationAndCaptureUrl(
  tenantId: string,
  actorRole: MembershipRole,
  actorUserId: string,
  email: string,
  role: MembershipRole,
) {
  let capturedUrl = "";
  const result = await createInvitation(
    tenantId,
    actorRole,
    actorUserId,
    { email, role },
    { invitationSender: { async sendInvitationEmail({ acceptUrl }) { capturedUrl = acceptUrl; } } },
  );
  return { result, capturedUrl };
}

function extractToken(acceptUrl: string): string {
  const token = new URL(acceptUrl).searchParams.get("token");
  if (!token) throw new Error("acceptUrl'de token yok");
  return token;
}

test.describe("createInvitation()", () => {
  test("OWNER bir davet oluşturabiliyor", async () => {
    const tenant = await createTenant();
    const owner = await createUser();
    await addMember(owner.id, tenant.id, MembershipRole.OWNER);

    try {
      const { result } = await createInvitationAndCaptureUrl(
        tenant.id,
        MembershipRole.OWNER,
        owner.id,
        "invitee@example.com",
        MembershipRole.MEMBER,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.invitation.email).toBe("invitee@example.com");
      expect(result.invitation.role).toBe("MEMBER");
      expect(result.invitation.tenantId).toBe(tenant.id);
    } finally {
      await cleanup([owner.id], [tenant.id]);
    }
  });

  test("ADMIN bir davet oluşturabiliyor (MEMBER/ADMIN hedef rolüyle)", async () => {
    const tenant = await createTenant();
    const admin = await createUser();
    await addMember(admin.id, tenant.id, MembershipRole.ADMIN);

    try {
      const { result } = await createInvitationAndCaptureUrl(
        tenant.id,
        MembershipRole.ADMIN,
        admin.id,
        "invitee-admin@example.com",
        MembershipRole.ADMIN,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.invitation.role).toBe("ADMIN");
    } finally {
      await cleanup([admin.id], [tenant.id]);
    }
  });

  test("ADMIN, OWNER rolüyle davet oluşturamaz (403) — privilege escalation koruması", async () => {
    const tenant = await createTenant();
    const admin = await createUser();
    await addMember(admin.id, tenant.id, MembershipRole.ADMIN);

    try {
      const result = await createInvitation(
        tenant.id,
        MembershipRole.ADMIN,
        admin.id,
        { email: "wannabe-owner@example.com", role: "OWNER" },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(403);

      const invitations = await prisma.tenantInvitation.findMany({ where: { tenantId: tenant.id } });
      expect(invitations).toHaveLength(0);
    } finally {
      await cleanup([admin.id], [tenant.id]);
    }
  });

  test("OWNER, OWNER rolüyle davet oluşturabiliyor", async () => {
    const tenant = await createTenant();
    const owner = await createUser();
    await addMember(owner.id, tenant.id, MembershipRole.OWNER);

    try {
      const { result } = await createInvitationAndCaptureUrl(
        tenant.id,
        MembershipRole.OWNER,
        owner.id,
        "co-owner@example.com",
        MembershipRole.OWNER,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.invitation.role).toBe("OWNER");
    } finally {
      await cleanup([owner.id], [tenant.id]);
    }
  });

  test("geçersiz rol 400 ile reddediliyor", async () => {
    const tenant = await createTenant();
    const owner = await createUser();
    await addMember(owner.id, tenant.id, MembershipRole.OWNER);

    try {
      const result = await createInvitation(tenant.id, MembershipRole.OWNER, owner.id, {
        email: "someone@example.com",
        role: "SUPERADMIN",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
    } finally {
      await cleanup([owner.id], [tenant.id]);
    }
  });

  test("geçersiz e-posta 400 ile reddediliyor", async () => {
    const tenant = await createTenant();
    const owner = await createUser();
    await addMember(owner.id, tenant.id, MembershipRole.OWNER);

    try {
      const result = await createInvitation(tenant.id, MembershipRole.OWNER, owner.id, {
        email: "not-an-email",
        role: "MEMBER",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
    } finally {
      await cleanup([owner.id], [tenant.id]);
    }
  });

  test("e-posta normalize ediliyor (trim + lowercase)", async () => {
    const tenant = await createTenant();
    const owner = await createUser();
    await addMember(owner.id, tenant.id, MembershipRole.OWNER);

    try {
      const { result } = await createInvitationAndCaptureUrl(
        tenant.id,
        MembershipRole.OWNER,
        owner.id,
        "  Mixed.Case@Example.com  ",
        MembershipRole.MEMBER,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.invitation.email).toBe("mixed.case@example.com");
    } finally {
      await cleanup([owner.id], [tenant.id]);
    }
  });

  test("raw token DB'de hiçbir yerde saklanmıyor (sadece SHA-256 hash'i)", async () => {
    const tenant = await createTenant();
    const owner = await createUser();
    await addMember(owner.id, tenant.id, MembershipRole.OWNER);

    try {
      const { capturedUrl } = await createInvitationAndCaptureUrl(
        tenant.id,
        MembershipRole.OWNER,
        owner.id,
        "raw-token-check@example.com",
        MembershipRole.MEMBER,
      );
      const rawToken = extractToken(capturedUrl);

      const stored = await prisma.tenantInvitation.findFirstOrThrow({ where: { tenantId: tenant.id } });
      expect(stored.tokenHash).not.toBe(rawToken);
      expect(stored.tokenHash).toBe(hashInvitationToken(rawToken));
      expect(JSON.stringify(stored)).not.toContain(rawToken);
    } finally {
      await cleanup([owner.id], [tenant.id]);
    }
  });

  test("aynı tenant + email için yeniden davet oluşturulunca eski pending davet cancel edilir", async () => {
    const tenant = await createTenant();
    const owner = await createUser();
    await addMember(owner.id, tenant.id, MembershipRole.OWNER);

    try {
      const first = await createInvitationAndCaptureUrl(
        tenant.id,
        MembershipRole.OWNER,
        owner.id,
        "reinvite@example.com",
        MembershipRole.MEMBER,
      );
      expect(first.result.ok).toBe(true);
      if (!first.result.ok) return;
      const firstToken = extractToken(first.capturedUrl);
      const firstInvitationId = first.result.invitation.id;

      const second = await createInvitationAndCaptureUrl(
        tenant.id,
        MembershipRole.OWNER,
        owner.id,
        "reinvite@example.com",
        MembershipRole.ADMIN,
      );
      expect(second.result.ok).toBe(true);
      if (!second.result.ok) return;

      const firstAfter = await prisma.tenantInvitation.findUniqueOrThrow({
        where: { id: firstInvitationId },
      });
      expect(firstAfter.cancelledAt).not.toBeNull();

      const active = await prisma.tenantInvitation.findMany({
        where: { tenantId: tenant.id, email: "reinvite@example.com", cancelledAt: null, usedAt: null },
      });
      expect(active).toHaveLength(1);
      expect(active[0].role).toBe("ADMIN");

      // Eski token artık geçerli değil.
      const rejected = await acceptInvitation(owner.id, "irrelevant@example.com", firstToken);
      expect(rejected.ok).toBe(false);
    } finally {
      await cleanup([owner.id], [tenant.id]);
    }
  });
});

test.describe("acceptInvitation()", () => {
  test("geçerli invitation kabul edilir ve doğru role sahip Membership oluşur", async () => {
    const tenant = await createTenant();
    const owner = await createUser();
    await addMember(owner.id, tenant.id, MembershipRole.OWNER);
    const invitee = await createUser();

    try {
      const { capturedUrl } = await createInvitationAndCaptureUrl(
        tenant.id,
        MembershipRole.OWNER,
        owner.id,
        invitee.email,
        MembershipRole.ADMIN,
      );
      const token = extractToken(capturedUrl);

      const result = await acceptInvitation(invitee.id, invitee.email, token);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.membership.tenantId).toBe(tenant.id);
      expect(result.membership.role).toBe("ADMIN");

      const membership = await prisma.membership.findUniqueOrThrow({
        where: { userId_tenantId: { userId: invitee.id, tenantId: tenant.id } },
      });
      expect(membership.role).toBe("ADMIN");
    } finally {
      await cleanup([owner.id, invitee.id], [tenant.id]);
    }
  });

  test("invitation kabul edildikten sonra used olarak işaretlenir ve tekrar kullanılamaz", async () => {
    const tenant = await createTenant();
    const owner = await createUser();
    await addMember(owner.id, tenant.id, MembershipRole.OWNER);
    const invitee = await createUser();

    try {
      const { capturedUrl } = await createInvitationAndCaptureUrl(
        tenant.id,
        MembershipRole.OWNER,
        owner.id,
        invitee.email,
        MembershipRole.MEMBER,
      );
      const token = extractToken(capturedUrl);

      const first = await acceptInvitation(invitee.id, invitee.email, token);
      expect(first.ok).toBe(true);

      const stored = await prisma.tenantInvitation.findFirstOrThrow({
        where: { tokenHash: hashInvitationToken(token) },
      });
      expect(stored.usedAt).not.toBeNull();

      const second = await acceptInvitation(invitee.id, invitee.email, token);
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.status).toBe(400);
    } finally {
      await cleanup([owner.id, invitee.id], [tenant.id]);
    }
  });

  test("süresi dolmuş token reddediliyor", async () => {
    const tenant = await createTenant();
    const owner = await createUser();
    await addMember(owner.id, tenant.id, MembershipRole.OWNER);
    const invitee = await createUser();

    try {
      const { capturedUrl } = await createInvitationAndCaptureUrl(
        tenant.id,
        MembershipRole.OWNER,
        owner.id,
        invitee.email,
        MembershipRole.MEMBER,
      );
      const token = extractToken(capturedUrl);

      await prisma.tenantInvitation.updateMany({
        where: { tokenHash: hashInvitationToken(token) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const result = await acceptInvitation(invitee.id, invitee.email, token);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);

      const membership = await prisma.membership.findUnique({
        where: { userId_tenantId: { userId: invitee.id, tenantId: tenant.id } },
      });
      expect(membership).toBeNull();
    } finally {
      await cleanup([owner.id, invitee.id], [tenant.id]);
    }
  });

  test("cancelled (invalidate edilmiş) token reddediliyor", async () => {
    const tenant = await createTenant();
    const owner = await createUser();
    await addMember(owner.id, tenant.id, MembershipRole.OWNER);
    const invitee = await createUser();

    try {
      const { capturedUrl } = await createInvitationAndCaptureUrl(
        tenant.id,
        MembershipRole.OWNER,
        owner.id,
        invitee.email,
        MembershipRole.MEMBER,
      );
      const token = extractToken(capturedUrl);

      await prisma.tenantInvitation.updateMany({
        where: { tokenHash: hashInvitationToken(token) },
        data: { cancelledAt: new Date() },
      });

      const result = await acceptInvitation(invitee.id, invitee.email, token);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
    } finally {
      await cleanup([owner.id, invitee.id], [tenant.id]);
    }
  });

  test("başka email'e sahip kullanıcı invitation'ı kabul edemez (403)", async () => {
    const tenant = await createTenant();
    const owner = await createUser();
    await addMember(owner.id, tenant.id, MembershipRole.OWNER);
    const invitee = await createUser();
    const impostor = await createUser();

    try {
      const { capturedUrl } = await createInvitationAndCaptureUrl(
        tenant.id,
        MembershipRole.OWNER,
        owner.id,
        invitee.email,
        MembershipRole.MEMBER,
      );
      const token = extractToken(capturedUrl);

      const result = await acceptInvitation(impostor.id, impostor.email, token);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(403);

      const membership = await prisma.membership.findUnique({
        where: { userId_tenantId: { userId: impostor.id, tenantId: tenant.id } },
      });
      expect(membership).toBeNull();

      // Token yanlış kullanıcı tarafından "yakılmamış" olmalı — rightful sahibi hâlâ kabul edebilmeli.
      const rightfulResult = await acceptInvitation(invitee.id, invitee.email, token);
      expect(rightfulResult.ok).toBe(true);
    } finally {
      await cleanup([owner.id, invitee.id, impostor.id], [tenant.id]);
    }
  });

  test("kullanıcı zaten tenant member ise duplicate membership/privilege escalation oluşturulmaz (409)", async () => {
    const tenant = await createTenant();
    const owner = await createUser();
    await addMember(owner.id, tenant.id, MembershipRole.OWNER);
    const existingMember = await createUser();
    await addMember(existingMember.id, tenant.id, MembershipRole.MEMBER);

    try {
      const { capturedUrl } = await createInvitationAndCaptureUrl(
        tenant.id,
        MembershipRole.OWNER,
        owner.id,
        existingMember.email,
        MembershipRole.OWNER,
      );
      const token = extractToken(capturedUrl);

      const result = await acceptInvitation(existingMember.id, existingMember.email, token);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(409);

      const membership = await prisma.membership.findUniqueOrThrow({
        where: { userId_tenantId: { userId: existingMember.id, tenantId: tenant.id } },
      });
      // Rol YÜKSELTİLMEMİŞ olmalı — hâlâ MEMBER, davetteki OWNER değil.
      expect(membership.role).toBe("MEMBER");

      const allMemberships = await prisma.membership.findMany({
        where: { userId: existingMember.id, tenantId: tenant.id },
      });
      expect(allMemberships).toHaveLength(1);
    } finally {
      await cleanup([owner.id, existingMember.id], [tenant.id]);
    }
  });

  test("yanlış (rastgele) token 400 ile reddediliyor", async () => {
    const invitee = await createUser();
    try {
      const result = await acceptInvitation(invitee.id, invitee.email, "not-a-real-token");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
    } finally {
      await cleanup([invitee.id], []);
    }
  });

  test("concurrent (eşzamanlı) aynı token kabulü: sadece bir Membership oluşur", async () => {
    const tenant = await createTenant();
    const owner = await createUser();
    await addMember(owner.id, tenant.id, MembershipRole.OWNER);
    const invitee = await createUser();

    try {
      const { capturedUrl } = await createInvitationAndCaptureUrl(
        tenant.id,
        MembershipRole.OWNER,
        owner.id,
        invitee.email,
        MembershipRole.MEMBER,
      );
      const token = extractToken(capturedUrl);

      const [resultA, resultB] = await Promise.all([
        acceptInvitation(invitee.id, invitee.email, token),
        acceptInvitation(invitee.id, invitee.email, token),
      ]);

      const outcomes = [resultA.ok, resultB.ok].sort();
      expect(outcomes).toEqual([false, true]);

      const memberships = await prisma.membership.findMany({
        where: { userId: invitee.id, tenantId: tenant.id },
      });
      expect(memberships).toHaveLength(1);
    } finally {
      await cleanup([owner.id, invitee.id], [tenant.id]);
    }
  });
});

test.describe("Tenant isolation (Issue #13 ile tutarlılık)", () => {
  test("bir tenant'ın daveti başka bir tenant context'inde kabul edilemez şekilde membership üretmiyor", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const ownerA = await createUser();
    await addMember(ownerA.id, tenantA.id, MembershipRole.OWNER);
    const invitee = await createUser();

    try {
      const { capturedUrl } = await createInvitationAndCaptureUrl(
        tenantA.id,
        MembershipRole.OWNER,
        ownerA.id,
        invitee.email,
        MembershipRole.MEMBER,
      );
      const token = extractToken(capturedUrl);

      const result = await acceptInvitation(invitee.id, invitee.email, token);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Membership sadece davetin ait olduğu tenantA'da oluşur, tenantB'de DEĞİL.
      expect(result.membership.tenantId).toBe(tenantA.id);

      const membershipInB = await prisma.membership.findUnique({
        where: { userId_tenantId: { userId: invitee.id, tenantId: tenantB.id } },
      });
      expect(membershipInB).toBeNull();
    } finally {
      await cleanup([ownerA.id, invitee.id], [tenantA.id, tenantB.id]);
    }
  });
});

/**
 * Bir üyeyi tenant'tan çıkarmak, o üyenin AÇTIĞI erişimi de kapatmalıdır: aksi halde
 * çıkarılan bir ADMIN'in bekleyen daveti TTL'i boyunca geçerli kalır ve kabul edildiğinde
 * davetliye gerçek bir ADMIN üyeliği verir (insider'ı çıkarmak arka kapıyı kapatmaz).
 * Bkz. `removeMember()` içindeki iptal adımı.
 */
test.describe("removeMember() — çıkarılan üyenin bekleyen davetleri", () => {
  test("çıkarılan ADMIN'in bekleyen daveti artık kabul edilemiyor (arka kapı kapanıyor)", async () => {
    const owner = await createUser();
    const admin = await createUser();
    const invitee = await createUser();
    const tenant = await createTenant();

    try {
      await addMember(owner.id, tenant.id, MembershipRole.OWNER);
      const adminMembership = await addMember(admin.id, tenant.id, MembershipRole.ADMIN);

      // ADMIN, davetliyi ADMIN olarak davet ediyor.
      const { result, capturedUrl } = await createInvitationAndCaptureUrl(
        tenant.id,
        MembershipRole.ADMIN,
        admin.id,
        invitee.email,
        MembershipRole.ADMIN,
      );
      expect(result.ok).toBe(true);
      const token = extractToken(capturedUrl);

      // OWNER, daveti oluşturan ADMIN'i tenant'tan çıkarıyor.
      const removed = await removeMember(tenant.id, adminMembership.id, MembershipRole.OWNER);
      expect(removed.ok).toBe(true);

      // Davet iptal edilmiş olmalı ve diğer geçersiz durumlarla AYNI genel 400'e düşmeli
      // (yeni bir bilgi sızdırmadan).
      const accepted = await acceptInvitation(invitee.id, invitee.email, token);
      expect(accepted.ok).toBe(false);
      if (!accepted.ok) expect(accepted.status).toBe(400);

      // En kritik kısım: davetliye HİÇBİR üyelik verilmemiş olmalı.
      const membership = await prisma.membership.findUnique({
        where: { userId_tenantId: { userId: invitee.id, tenantId: tenant.id } },
      });
      expect(membership).toBeNull();
    } finally {
      await cleanup([owner.id, admin.id, invitee.id], [tenant.id]);
    }
  });

  test("çıkarma yalnızca ÇIKARILAN üyenin davetlerini iptal eder — başkalarınınki geçerli kalır", async () => {
    const owner = await createUser();
    const admin = await createUser();
    const inviteeOfOwner = await createUser();
    const inviteeOfAdmin = await createUser();
    const tenant = await createTenant();

    try {
      await addMember(owner.id, tenant.id, MembershipRole.OWNER);
      const adminMembership = await addMember(admin.id, tenant.id, MembershipRole.ADMIN);

      const ownerInvite = await createInvitationAndCaptureUrl(
        tenant.id,
        MembershipRole.OWNER,
        owner.id,
        inviteeOfOwner.email,
        MembershipRole.MEMBER,
      );
      const adminInvite = await createInvitationAndCaptureUrl(
        tenant.id,
        MembershipRole.ADMIN,
        admin.id,
        inviteeOfAdmin.email,
        MembershipRole.MEMBER,
      );

      await removeMember(tenant.id, adminMembership.id, MembershipRole.OWNER);

      // ADMIN'in daveti iptal edildi...
      const adminResult = await acceptInvitation(
        inviteeOfAdmin.id,
        inviteeOfAdmin.email,
        extractToken(adminInvite.capturedUrl),
      );
      expect(adminResult.ok).toBe(false);

      // ...ama hâlâ üye olan OWNER'ın daveti etkilenmedi.
      const ownerResult = await acceptInvitation(
        inviteeOfOwner.id,
        inviteeOfOwner.email,
        extractToken(ownerInvite.capturedUrl),
      );
      expect(ownerResult.ok).toBe(true);
    } finally {
      await cleanup([owner.id, admin.id, inviteeOfOwner.id, inviteeOfAdmin.id], [tenant.id]);
    }
  });
});
