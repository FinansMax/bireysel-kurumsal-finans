import { randomUUID } from "node:crypto";

import { MembershipRole } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import {
  combineCookieHeaders,
  createActiveTenantCookieHeader,
  createSessionCookieHeader,
} from "./support/session";

/**
 * Bildirim API'sinin saldırgan bakışıyla testleri (Issue #76).
 *
 * BU MODELE ÖZGÜ RİSK: tenant izolasyonu YETMEZ. Aynı tenant'ın iki üyesi birbirinin
 * bildirimini görmemeli ve okundu işaretleyememeli — bir OWNER bile. Bu yüzden testlerin
 * çoğu tenant içindeki İKİNCİ KULLANICI'ya karşıdır.
 */

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

test.afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

async function createTenant(label: string) {
  const tenant = await prisma.tenant.create({
    data: { name: label, slug: `${label.toLowerCase()}-${randomUUID()}` },
    select: { id: true },
  });
  createdTenantIds.push(tenant.id);
  return tenant;
}

async function createUserWithMembership(role: MembershipRole, tenantId: string) {
  const email = `sec-notif-${randomUUID()}@example.com`;
  const user = await prisma.user.create({ data: { email }, select: { id: true } });
  createdUserIds.push(user.id);
  await prisma.membership.create({ data: { userId: user.id, tenantId, role } });

  const cookie = combineCookieHeaders(
    await createSessionCookieHeader({ sub: user.id, email }),
    await createActiveTenantCookieHeader(tenantId),
  );

  return { userId: user.id, cookie };
}

async function createNotificationRow(tenantId: string, userId: string, message: string) {
  return prisma.notification.create({
    data: { tenantId, userId, message },
    select: { id: true },
  });
}

function listPath(tenantId: string): string {
  return `/api/tenants/${tenantId}/notifications`;
}

function readPath(tenantId: string, id: string): string {
  return `/api/tenants/${tenantId}/notifications/${id}/read`;
}

test.describe("Notification API — authentication zorunluluğu", () => {
  test("unauthenticated istekler 401 alır ve hiçbir şey değişmez", async ({ request }) => {
    const tenant = await createTenant("NoAuthNotif");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const row = await createNotificationRow(tenant.id, owner.userId, "GizliBildirim");

    const list = await request.get(listPath(tenant.id));
    expect(list.status()).toBe(401);
    expect(await list.text()).not.toContain("GizliBildirim");

    const read = await request.patch(readPath(tenant.id, row.id));
    expect(read.status()).toBe(401);

    const stored = await prisma.notification.findFirstOrThrow({
      where: { id: row.id, tenantId: tenant.id },
    });
    expect(stored.readAt).toBeNull();
  });
});

test.describe("Notification API — aynı tenant içinde kullanıcı izolasyonu", () => {
  test("OWNER bile başka üyenin bildirimini listede GÖRMÜYOR", async ({ request }) => {
    const tenant = await createTenant("PeerNotif");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const member = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);
    await createNotificationRow(tenant.id, member.userId, "UyeninOzelBildirimi");
    await createNotificationRow(tenant.id, owner.userId, "SahibinBildirimi");

    const response = await request.get(listPath(tenant.id), {
      headers: { cookie: owner.cookie },
    });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { notifications: Array<{ message: string }> };

    // KONTROL GRUBU: kendi bildirimi GELİYOR — liste boş olduğu için geçen bir test değil.
    expect(body.notifications.map((n) => n.message)).toEqual(["SahibinBildirimi"]);
    expect(JSON.stringify(body)).not.toContain("UyeninOzelBildirimi");
  });

  test("başka üyenin bildirimi okundu işaretlenemiyor; yanıt var olmayan id ile AYNI", async ({
    request,
  }) => {
    const tenant = await createTenant("PeerReadNotif");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const member = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);
    const theirs = await createNotificationRow(tenant.id, member.userId, "Uyenin");

    const peer = await request.patch(readPath(tenant.id, theirs.id), {
      headers: { cookie: owner.cookie },
    });
    const missing = await request.patch(readPath(tenant.id, `yok-${randomUUID()}`), {
      headers: { cookie: owner.cookie },
    });

    // Enumeration engeli: "var ama senin değil" ile "yok" ayırt edilemez.
    expect(peer.status()).toBe(404);
    expect(missing.status()).toBe(404);
    expect(await peer.json()).toEqual(await missing.json());

    const stored = await prisma.notification.findFirstOrThrow({
      where: { id: theirs.id, tenantId: tenant.id },
    });
    expect(stored.readAt).toBeNull();
  });

  test("KONTROL GRUBU: sahibi kendi bildirimini okundu işaretleyebiliyor", async ({ request }) => {
    const tenant = await createTenant("OwnReadNotif");
    const member = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);
    const mine = await createNotificationRow(tenant.id, member.userId, "Benim");

    const response = await request.patch(readPath(tenant.id, mine.id), {
      headers: { cookie: member.cookie },
    });
    expect(response.status()).toBe(200);

    const stored = await prisma.notification.findFirstOrThrow({
      where: { id: mine.id, tenantId: tenant.id },
    });
    expect(stored.readAt).not.toBeNull();
  });
});

test.describe("Notification API — tenant izolasyonu", () => {
  test("URL'deki tenantId aktif tenant'tan farklıysa 403", async ({ request }) => {
    const mine = await createTenant("MineNotif");
    const theirs = await createTenant("TheirsNotif");
    const user = await createUserWithMembership(MembershipRole.OWNER, mine.id);
    // Aynı kullanıcının DİĞER tenant'ta da bildirimi var ama o tenant'ın üyesi değil.
    const foreign = await createNotificationRow(theirs.id, user.userId, "BaskaTenant");

    const list = await request.get(listPath(theirs.id), { headers: { cookie: user.cookie } });
    expect(list.status()).toBe(403);
    expect(await list.text()).not.toContain("BaskaTenant");

    const read = await request.patch(readPath(theirs.id, foreign.id), {
      headers: { cookie: user.cookie },
    });
    expect(read.status()).toBe(403);
  });

  test("kendi tenant URL'iyle başka tenant'taki bildirime dokunulamıyor (404)", async ({
    request,
  }) => {
    const mine = await createTenant("MineNotif2");
    const theirs = await createTenant("TheirsNotif2");
    const user = await createUserWithMembership(MembershipRole.OWNER, mine.id);
    await prisma.membership.create({
      data: { userId: user.userId, tenantId: theirs.id, role: MembershipRole.MEMBER },
    });
    // Aynı kullanıcıya ait ama BAŞKA tenant'ta: tenant scope'u tek başına bunu ayırmalı.
    const foreign = await createNotificationRow(theirs.id, user.userId, "DigerTenantta");

    const read = await request.patch(readPath(mine.id, foreign.id), {
      headers: { cookie: user.cookie },
    });
    expect(read.status()).toBe(404);

    const list = await request.get(listPath(mine.id), { headers: { cookie: user.cookie } });
    expect(await list.text()).not.toContain("DigerTenantta");

    const stored = await prisma.notification.findFirstOrThrow({
      where: { id: foreign.id, tenantId: theirs.id },
    });
    expect(stored.readAt).toBeNull();
  });
});

test.describe("Notification API — girdi ve yan etki", () => {
  test("geçersiz unread filtresi 400 — sessizce tam listeye dönmüyor", async ({ request }) => {
    const tenant = await createTenant("FilterNotif");
    const user = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);

    for (const query of ["?unread=1", "?unread=yes", "?unread=true&unread=false"]) {
      const response = await request.get(`${listPath(tenant.id)}${query}`, {
        headers: { cookie: user.cookie },
      });
      expect(response.status(), query).toBe(400);
    }
  });

  test("GET listelemek bildirimi okundu İŞARETLEMİYOR (invariant #4)", async ({ request }) => {
    const tenant = await createTenant("GetNotif");
    const user = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);
    const row = await createNotificationRow(tenant.id, user.userId, "Okunmadi");

    const response = await request.get(listPath(tenant.id), { headers: { cookie: user.cookie } });
    expect(response.status()).toBe(200);

    const stored = await prisma.notification.findFirstOrThrow({
      where: { id: row.id, tenantId: tenant.id },
    });
    expect(stored.readAt).toBeNull();
  });

  test("okundu işareti için GET kullanılamıyor (405)", async ({ request }) => {
    const tenant = await createTenant("MethodNotif");
    const user = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);
    const row = await createNotificationRow(tenant.id, user.userId, "Metot");

    const response = await request.get(readPath(tenant.id, row.id), {
      headers: { cookie: user.cookie },
    });
    expect(response.status()).toBe(405);

    const stored = await prisma.notification.findFirstOrThrow({
      where: { id: row.id, tenantId: tenant.id },
    });
    expect(stored.readAt).toBeNull();
  });
});
