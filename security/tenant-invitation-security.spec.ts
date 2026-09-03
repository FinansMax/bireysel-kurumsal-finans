import { randomUUID } from "node:crypto";

import { MembershipRole } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { hashInvitationToken } from "../src/lib/tenants/invitation";
import { prisma } from "../src/lib/prisma";

import {
  clearInvitationOutboxEntry,
  extractTokenFromAcceptUrl,
  readInvitationOutboxEntry,
} from "../e2e/support/invitation-outbox";
import {
  combineCookieHeaders,
  createActiveTenantCookieHeader,
  createSessionCookieHeader,
} from "./support/session";

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function createUserWithMembership(role: MembershipRole, tenantId: string, email?: string) {
  const userEmail = email ?? `sec-invite-${randomUUID()}@example.com`;
  // #190: doğrulanmamış hesap davet KABUL EDEMEZ. Bu spec'in konusu davet güvenliği;
  // doğrulama onun ÖN KOŞULU — kurulumda doğrulanmış bir hesap oluşturulur.
  const user = await prisma.user.create({
    data: { email: userEmail, emailVerified: new Date() },
  });
  await prisma.membership.create({ data: { userId: user.id, tenantId, role } });

  const sessionCookie = await createSessionCookieHeader({ sub: user.id, email: userEmail });
  const activeTenantCookie = await createActiveTenantCookieHeader(tenantId);
  const cookie = combineCookieHeaders(sessionCookie, activeTenantCookie);

  return { userId: user.id, email: userEmail, cookie };
}

async function createUserWithoutMembership(email?: string) {
  const userEmail = email ?? `sec-invite-user-${randomUUID()}@example.com`;
  // #190: doğrulanmamış hesap davet KABUL EDEMEZ. Bu spec'in konusu davet güvenliği;
  // doğrulama onun ÖN KOŞULU — kurulumda doğrulanmış bir hesap oluşturulur.
  const user = await prisma.user.create({
    data: { email: userEmail, emailVerified: new Date() },
  });
  const sessionCookie = await createSessionCookieHeader({ sub: user.id, email: userEmail });
  return { userId: user.id, email: userEmail, cookie: sessionCookie };
}

test.describe("Tenant invitation security — authorization (Issue #14)", () => {
  test("OWNER davet oluşturabiliyor (201)", async ({ request }) => {
    const tenant = await prisma.tenant.create({ data: { name: "Owner Invite Co", slug: `owner-invite-${randomUUID()}` } });
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const inviteeEmail = `invitee-${randomUUID()}@example.com`;

    try {
      const response = await request.post(`/api/tenants/${tenant.id}/invitations`, {
        headers: { cookie: owner.cookie },
        data: { email: inviteeEmail, role: "MEMBER" },
      });
      expect(response.status()).toBe(201);
    } finally {
      clearInvitationOutboxEntry(inviteeEmail);
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("ADMIN davet oluşturabiliyor (201)", async ({ request }) => {
    const tenant = await prisma.tenant.create({ data: { name: "Admin Invite Co", slug: `admin-invite-${randomUUID()}` } });
    const admin = await createUserWithMembership(MembershipRole.ADMIN, tenant.id);
    const inviteeEmail = `invitee-${randomUUID()}@example.com`;

    try {
      const response = await request.post(`/api/tenants/${tenant.id}/invitations`, {
        headers: { cookie: admin.cookie },
        data: { email: inviteeEmail, role: "MEMBER" },
      });
      expect(response.status()).toBe(201);
    } finally {
      clearInvitationOutboxEntry(inviteeEmail);
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: admin.userId } });
    }
  });

  test("MEMBER davet oluşturamaz (403) ve hiçbir invitation kaydı üretilmez", async ({ request }) => {
    const tenant = await prisma.tenant.create({ data: { name: "Member Invite Co", slug: `member-invite-${randomUUID()}` } });
    const member = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);
    const inviteeEmail = `invitee-${randomUUID()}@example.com`;

    try {
      const response = await request.post(`/api/tenants/${tenant.id}/invitations`, {
        headers: { cookie: member.cookie },
        data: { email: inviteeEmail, role: "MEMBER" },
      });
      expect(response.status()).toBe(403);

      const invitations = await prisma.tenantInvitation.findMany({ where: { tenantId: tenant.id } });
      expect(invitations).toHaveLength(0);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: member.userId } });
    }
  });

  test("authentication olmadan davet oluşturulamaz (401)", async ({ request }) => {
    const tenant = await prisma.tenant.create({ data: { name: "Anon Invite Co", slug: `anon-invite-${randomUUID()}` } });

    try {
      const response = await request.post(`/api/tenants/${tenant.id}/invitations`, {
        data: { email: "someone@example.com", role: "MEMBER" },
      });
      expect(response.status()).toBe(401);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
    }
  });

  test("ADMIN, OWNER rolüyle davet oluşturamaz (403) — privilege escalation koruması", async ({ request }) => {
    const tenant = await prisma.tenant.create({ data: { name: "Admin Escalation Co", slug: `admin-esc-invite-${randomUUID()}` } });
    const admin = await createUserWithMembership(MembershipRole.ADMIN, tenant.id);
    const inviteeEmail = `invitee-${randomUUID()}@example.com`;

    try {
      const response = await request.post(`/api/tenants/${tenant.id}/invitations`, {
        headers: { cookie: admin.cookie },
        data: { email: inviteeEmail, role: "OWNER" },
      });
      expect(response.status()).toBe(403);

      const invitations = await prisma.tenantInvitation.findMany({ where: { tenantId: tenant.id } });
      expect(invitations).toHaveLength(0);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: admin.userId } });
    }
  });

  test("sahte actorRole/tenantId body alanları authorization kararını etkilemez", async ({ request }) => {
    const tenant = await prisma.tenant.create({ data: { name: "Spoof Invite Co", slug: `spoof-invite-${randomUUID()}` } });
    const member = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);

    try {
      const response = await request.post(`/api/tenants/${tenant.id}/invitations`, {
        headers: { cookie: member.cookie },
        data: { email: "spoofed@example.com", role: "OWNER", actorRole: "OWNER", tenantId: "some-other-tenant" },
      });
      expect(response.status()).toBe(403);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: member.userId } });
    }
  });

  test("aktif tenant URL'deki tenantId'den farklıysa davet oluşturulamaz (403) — tenant boundary bypass koruması", async ({
    request,
  }) => {
    const activeTenant = await prisma.tenant.create({ data: { name: "Active Invite Co", slug: `active-invite-${randomUUID()}` } });
    const otherTenant = await prisma.tenant.create({ data: { name: "Other Invite Co", slug: `other-invite-${randomUUID()}` } });
    const owner = await createUserWithMembership(MembershipRole.OWNER, activeTenant.id);
    await prisma.membership.create({
      data: { userId: owner.userId, tenantId: otherTenant.id, role: MembershipRole.OWNER },
    });

    try {
      const response = await request.post(`/api/tenants/${otherTenant.id}/invitations`, {
        headers: { cookie: owner.cookie },
        data: { email: "someone@example.com", role: "MEMBER" },
      });
      expect(response.status()).toBe(403);

      const invitations = await prisma.tenantInvitation.findMany({ where: { tenantId: otherTenant.id } });
      expect(invitations).toHaveLength(0);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [activeTenant.id, otherTenant.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });
});

test.describe("Tenant invitation security — token güvenliği", () => {
  test("raw invitation token API response'unda YOK (sadece test outbox dosyasında)", async ({ request }) => {
    const tenant = await prisma.tenant.create({ data: { name: "Token Leak Co", slug: `token-leak-${randomUUID()}` } });
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const inviteeEmail = `invitee-${randomUUID()}@example.com`;

    try {
      const response = await request.post(`/api/tenants/${tenant.id}/invitations`, {
        headers: { cookie: owner.cookie },
        data: { email: inviteeEmail, role: "MEMBER" },
      });
      expect(response.status()).toBe(201);

      const rawText = await response.text();
      expect(rawText.toLowerCase()).not.toContain("token");

      const body = JSON.parse(rawText);
      expect(Object.keys(body.invitation).sort()).toEqual(
        ["createdAt", "email", "expiresAt", "id", "role", "tenantId"].sort(),
      );
    } finally {
      clearInvitationOutboxEntry(inviteeEmail);
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("raw invitation token DB'de hiçbir yerde saklanmıyor (sadece SHA-256 hash'i)", async ({ request }) => {
    const tenant = await prisma.tenant.create({ data: { name: "Token Hash Co", slug: `token-hash-${randomUUID()}` } });
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const inviteeEmail = `invitee-${randomUUID()}@example.com`;

    try {
      await request.post(`/api/tenants/${tenant.id}/invitations`, {
        headers: { cookie: owner.cookie },
        data: { email: inviteeEmail, role: "MEMBER" },
      });

      const entry = readInvitationOutboxEntry(inviteeEmail);
      if (!entry) throw new Error("outbox entry bulunamadı");
      const rawToken = extractTokenFromAcceptUrl(entry.acceptUrl);

      const stored = await prisma.tenantInvitation.findFirstOrThrow({
        where: { tokenHash: hashInvitationToken(rawToken) },
      });
      expect(JSON.stringify(stored)).not.toContain(rawToken);
    } finally {
      clearInvitationOutboxEntry(inviteeEmail);
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("geçersiz token güvenli, genel bir hata döner (Prisma/stack trace sızmaz)", async ({ request }) => {
    const user = await createUserWithoutMembership();

    try {
      const response = await request.post("/api/invitations/accept", {
        headers: { cookie: user.cookie },
        data: { token: "not-a-real-token" },
      });
      expect(response.status()).toBe(400);

      const rawText = await response.text();
      expect(rawText.toLowerCase()).not.toContain("prisma");
      expect(rawText.toLowerCase()).not.toContain("stack");
      expect(rawText.toLowerCase()).not.toContain("at ");
    } finally {
      await prisma.user.delete({ where: { id: user.userId } });
    }
  });

  test("accept endpoint authentication gerektirir (401)", async ({ request }) => {
    const response = await request.post("/api/invitations/accept", {
      data: { token: "whatever" },
    });
    expect(response.status()).toBe(401);
  });
});

test.describe("Tenant invitation security — accept akışı", () => {
  async function createInvitationViaApi(
    request: import("@playwright/test").APIRequestContext,
    tenantId: string,
    ownerCookie: string,
    email: string,
    role: string,
  ): Promise<string> {
    const response = await request.post(`/api/tenants/${tenantId}/invitations`, {
      headers: { cookie: ownerCookie },
      data: { email, role },
    });
    expect(response.status()).toBe(201);
    const entry = readInvitationOutboxEntry(email);
    if (!entry) throw new Error("outbox entry bulunamadı");
    return extractTokenFromAcceptUrl(entry.acceptUrl);
  }

  test("geçerli davet kabul edilir ve doğru role sahip Membership oluşur (200)", async ({ request }) => {
    const tenant = await prisma.tenant.create({ data: { name: "Accept Co", slug: `accept-${randomUUID()}` } });
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const invitee = await createUserWithoutMembership();

    try {
      const token = await createInvitationViaApi(request, tenant.id, owner.cookie, invitee.email, "ADMIN");

      const response = await request.post("/api/invitations/accept", {
        headers: { cookie: invitee.cookie },
        data: { token },
      });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.membership.role).toBe("ADMIN");
      expect(body.membership.tenantId).toBe(tenant.id);
    } finally {
      clearInvitationOutboxEntry(invitee.email);
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.deleteMany({ where: { id: { in: [owner.userId, invitee.userId] } } });
    }
  });

  test("başka email'e login olmuş kullanıcı invitation'ı kabul edemez (403) — invitation email eşleşmesi zorunlu", async ({
    request,
  }) => {
    const tenant = await prisma.tenant.create({ data: { name: "Wrong Email Co", slug: `wrong-email-${randomUUID()}` } });
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const invitee = await createUserWithoutMembership();
    const impostor = await createUserWithoutMembership();

    try {
      const token = await createInvitationViaApi(request, tenant.id, owner.cookie, invitee.email, "MEMBER");

      const response = await request.post("/api/invitations/accept", {
        headers: { cookie: impostor.cookie },
        data: { token },
      });
      expect(response.status()).toBe(403);

      const membership = await prisma.membership.findUnique({
        where: { userId_tenantId: { userId: impostor.userId, tenantId: tenant.id } },
      });
      expect(membership).toBeNull();
    } finally {
      clearInvitationOutboxEntry(invitee.email);
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.deleteMany({ where: { id: { in: [owner.userId, invitee.userId, impostor.userId] } } });
    }
  });

  test("kullanılmış token tekrar kabul edilemez (400)", async ({ request }) => {
    const tenant = await prisma.tenant.create({ data: { name: "Reuse Co", slug: `reuse-${randomUUID()}` } });
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const invitee = await createUserWithoutMembership();

    try {
      const token = await createInvitationViaApi(request, tenant.id, owner.cookie, invitee.email, "MEMBER");

      const first = await request.post("/api/invitations/accept", {
        headers: { cookie: invitee.cookie },
        data: { token },
      });
      expect(first.status()).toBe(200);

      const second = await request.post("/api/invitations/accept", {
        headers: { cookie: invitee.cookie },
        data: { token },
      });
      expect(second.status()).toBe(400);
    } finally {
      clearInvitationOutboxEntry(invitee.email);
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.deleteMany({ where: { id: { in: [owner.userId, invitee.userId] } } });
    }
  });

  test("başka tenant'ın davet context'ine erişim mümkün değil — davet accept edilince yalnızca kendi tenant'ında membership oluşur", async ({
    request,
  }) => {
    const tenantA = await prisma.tenant.create({ data: { name: "Tenant A Invite", slug: `tenant-a-invite-${randomUUID()}` } });
    const tenantB = await prisma.tenant.create({ data: { name: "Tenant B Invite", slug: `tenant-b-invite-${randomUUID()}` } });
    const ownerA = await createUserWithMembership(MembershipRole.OWNER, tenantA.id);
    const invitee = await createUserWithoutMembership();

    try {
      const token = await createInvitationViaApi(request, tenantA.id, ownerA.cookie, invitee.email, "MEMBER");

      const response = await request.post("/api/invitations/accept", {
        headers: { cookie: invitee.cookie },
        data: { token },
      });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.membership.tenantId).toBe(tenantA.id);

      const membershipInB = await prisma.membership.findUnique({
        where: { userId_tenantId: { userId: invitee.userId, tenantId: tenantB.id } },
      });
      expect(membershipInB).toBeNull();
    } finally {
      clearInvitationOutboxEntry(invitee.email);
      await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [ownerA.userId, invitee.userId] } } });
    }
  });

  test("kullanıcı zaten tenant member ise duplicate membership oluşturulmaz (409)", async ({ request }) => {
    const tenant = await prisma.tenant.create({ data: { name: "Already Member Co", slug: `already-member-${randomUUID()}` } });
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const existingMember = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);

    try {
      const token = await createInvitationViaApi(request, tenant.id, owner.cookie, existingMember.email, "OWNER");

      const response = await request.post("/api/invitations/accept", {
        headers: { cookie: existingMember.cookie },
        data: { token },
      });
      expect(response.status()).toBe(409);

      const membership = await prisma.membership.findUniqueOrThrow({
        where: { userId_tenantId: { userId: existingMember.userId, tenantId: tenant.id } },
      });
      expect(membership.role).toBe("MEMBER");
    } finally {
      clearInvitationOutboxEntry(existingMember.email);
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.deleteMany({ where: { id: { in: [owner.userId, existingMember.userId] } } });
    }
  });
});
