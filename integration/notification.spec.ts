import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { prisma } from "../src/lib/prisma";
import {
  createNotification,
  listNotifications,
  markNotificationRead,
  MAX_NOTIFICATION_MESSAGE_LENGTH,
  NOTIFICATION_LIST_LIMIT,
} from "../src/lib/notifications/notification";

/**
 * Bildirim iş kuralları — gerçek DB'ye karşı, HTTP olmadan (Issue #76). Yetki/izolasyonun
 * HTTP tarafı `security/notification-security.spec.ts`'tedir.
 */

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

test.afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

async function createTenant(): Promise<string> {
  const tenant = await prisma.tenant.create({
    data: { name: "Bildirim Testi", slug: `notif-${randomUUID()}` },
    select: { id: true },
  });
  createdTenantIds.push(tenant.id);
  return tenant.id;
}

async function createMember(tenantId: string): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `notif-${randomUUID()}@example.com` },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  await prisma.membership.create({ data: { userId: user.id, tenantId, role: "MEMBER" } });
  return user.id;
}

test.describe("createNotification()", () => {
  test("üyeye bildirim yazılıyor; mesaj kırpılıyor, okunmamış başlıyor", async () => {
    const tenantId = await createTenant();
    const userId = await createMember(tenantId);

    const result = await createNotification(tenantId, userId, "  Vade yaklaşıyor  ");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notification.message).toBe("Vade yaklaşıyor");
    expect(result.notification.readAt).toBeNull();
  });

  const invalidMessages: Array<[string, unknown]> = [
    ["boş", ""],
    ["yalnızca boşluk", "   "],
    ["çok uzun", "a".repeat(MAX_NOTIFICATION_MESSAGE_LENGTH + 1)],
    ["string değil", 42],
    ["null", null],
  ];
  for (const [label, message] of invalidMessages) {
    test(`mesaj ${label} → 400 ve satır yok`, async () => {
      const tenantId = await createTenant();
      const userId = await createMember(tenantId);

      const result = await createNotification(tenantId, userId, message);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(await prisma.notification.count({ where: { tenantId } })).toBe(0);
    });
  }

  test("sınır: tam 500 karakter kabul", async () => {
    const tenantId = await createTenant();
    const userId = await createMember(tenantId);
    const result = await createNotification(
      tenantId,
      userId,
      "a".repeat(MAX_NOTIFICATION_MESSAGE_LENGTH),
    );
    expect(result.ok).toBe(true);
  });

  test("tenant üyesi olmayan kullanıcıya yazılamıyor (404)", async () => {
    const tenantId = await createTenant();
    const otherTenantId = await createTenant();
    const outsider = await createMember(otherTenantId);

    const result = await createNotification(tenantId, outsider, "Merhaba");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
    expect(await prisma.notification.count({ where: { tenantId } })).toBe(0);
  });
});

test.describe("listNotifications()", () => {
  test("en yeni önce; yalnızca bu kullanıcının ve bu tenant'ın kayıtları", async () => {
    const tenantId = await createTenant();
    const otherTenantId = await createTenant();
    const userId = await createMember(tenantId);
    const peerId = await createMember(tenantId);
    await prisma.membership.create({ data: { userId, tenantId: otherTenantId, role: "MEMBER" } });

    await prisma.notification.create({
      data: { tenantId, userId, message: "eski", createdAt: new Date("2026-01-01T00:00:00Z") },
    });
    await prisma.notification.create({
      data: { tenantId, userId, message: "yeni", createdAt: new Date("2026-02-01T00:00:00Z") },
    });
    await prisma.notification.create({ data: { tenantId, userId: peerId, message: "komsu" } });
    await prisma.notification.create({
      data: { tenantId: otherTenantId, userId, message: "baska-tenant" },
    });

    const rows = await listNotifications(tenantId, userId, { unreadOnly: false });
    expect(rows.map((row) => row.message)).toEqual(["yeni", "eski"]);
  });

  test("unreadOnly yalnızca okunmamışları döndürüyor (kontrol grubu: tümü iki kayıt)", async () => {
    const tenantId = await createTenant();
    const userId = await createMember(tenantId);
    await prisma.notification.create({ data: { tenantId, userId, message: "okundu", readAt: new Date() } });
    await prisma.notification.create({ data: { tenantId, userId, message: "okunmadi" } });

    const all = await listNotifications(tenantId, userId, { unreadOnly: false });
    expect(all).toHaveLength(2);

    const unread = await listNotifications(tenantId, userId, { unreadOnly: true });
    expect(unread.map((row) => row.message)).toEqual(["okunmadi"]);
  });

  test(`liste ${NOTIFICATION_LIST_LIMIT} kayıtla sınırlı`, async () => {
    const tenantId = await createTenant();
    const userId = await createMember(tenantId);
    await prisma.notification.createMany({
      data: Array.from({ length: NOTIFICATION_LIST_LIMIT + 5 }, (_, index) => ({
        tenantId,
        userId,
        message: `m${index}`,
      })),
    });

    const rows = await listNotifications(tenantId, userId, { unreadOnly: false });
    expect(rows).toHaveLength(NOTIFICATION_LIST_LIMIT);
  });
});

test.describe("markNotificationRead()", () => {
  test("okundu işaretliyor; ikinci çağrı ilk okunma anını DEĞİŞTİRMİYOR (idempotent)", async () => {
    const tenantId = await createTenant();
    const userId = await createMember(tenantId);
    const row = await prisma.notification.create({
      data: { tenantId, userId, message: "x" },
      select: { id: true },
    });

    const first = await markNotificationRead(tenantId, userId, row.id, new Date("2026-03-01T10:00:00Z"));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.notification.readAt).toEqual(new Date("2026-03-01T10:00:00Z"));

    const second = await markNotificationRead(tenantId, userId, row.id, new Date("2026-03-02T10:00:00Z"));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.notification.readAt).toEqual(new Date("2026-03-01T10:00:00Z"));
  });

  test("başka kullanıcının bildirimi ile olmayan id AYNI sonucu veriyor ve satır değişmiyor", async () => {
    const tenantId = await createTenant();
    const ownerOfRow = await createMember(tenantId);
    const intruder = await createMember(tenantId);
    const row = await prisma.notification.create({
      data: { tenantId, userId: ownerOfRow, message: "x" },
      select: { id: true },
    });

    const peer = await markNotificationRead(tenantId, intruder, row.id);
    const missing = await markNotificationRead(tenantId, intruder, `yok-${randomUUID()}`);
    expect(peer).toEqual(missing);
    expect(peer.ok).toBe(false);

    const stored = await prisma.notification.findFirstOrThrow({ where: { id: row.id, tenantId } });
    expect(stored.readAt).toBeNull();
  });

  test("eşzamanlı iki işaret: tek bir readAt yazılıyor, ikisi de başarılı", async () => {
    const tenantId = await createTenant();
    const userId = await createMember(tenantId);
    const row = await prisma.notification.create({
      data: { tenantId, userId, message: "x" },
      select: { id: true },
    });

    const [a, b] = await Promise.all([
      markNotificationRead(tenantId, userId, row.id, new Date("2026-04-01T00:00:00Z")),
      markNotificationRead(tenantId, userId, row.id, new Date("2026-04-02T00:00:00Z")),
    ]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // Hangisi kazanırsa kazansın, iki yanıt AYNI anı görmeli — sonradan gelen üzerine yazmadı.
    expect(a.notification.readAt).toEqual(b.notification.readAt);
  });

  test("tenant silinince bildirimleri de gidiyor (cascade)", async () => {
    const tenantId = await createTenant();
    const userId = await createMember(tenantId);
    await prisma.notification.create({ data: { tenantId, userId, message: "x" } });

    await prisma.tenant.delete({ where: { id: tenantId } });
    expect(await prisma.notification.count({ where: { tenantId } })).toBe(0);
  });
});
