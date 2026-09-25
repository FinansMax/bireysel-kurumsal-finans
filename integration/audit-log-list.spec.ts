import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { AUDIT_LOG_PAGE_SIZE, listAuditLog } from "../src/lib/audit/list-audit-log";
import {
  decodeAuditLogCursor,
  encodeAuditLogCursor,
} from "../src/lib/audit/audit-log-cursor";
import { prisma } from "../src/lib/prisma";

/**
 * Denetim kaydı listesi (Issue #78).
 *
 * NEDEN BURADA: sayfalama ve tenant izolasyonu sorgu seviyesinde yaşar; HTTP katmanı
 * `security/audit-log-security.spec.ts`te ayrıca test edilir. Buradaki testler DB'ye karşı koşar
 * ve gerçek satırlar üzerinde çalışır — sahte veriyle sayfalama sınırı kanıtlanamaz.
 */

const createdTenantIds: string[] = [];

test.afterAll(async () => {
  if (createdTenantIds.length > 0) {
    await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
  }
  await prisma.$disconnect();
});

async function seedTenant(label: string): Promise<string> {
  const tenant = await prisma.tenant.create({
    data: { name: label, slug: `${label.toLowerCase()}-${randomUUID()}` },
    select: { id: true },
  });
  createdTenantIds.push(tenant.id);
  return tenant.id;
}

/**
 * Doğrudan `prisma.auditLog.create()` KULLANILIR ve bu bir invariant ihlali DEĞİLDİR.
 *
 * "Audit log yalnızca `writeAuditLog()` ile yazılır" kuralı ÜRETİM kodu içindir: amaç, kaydın
 * typed sabitlerle ve redaksiyondan geçerek yazılmasını garanti etmek. Burada yazılan şey test
 * verisidir ve testin konusu yazma yolu değil, OKUMA yolu. `writeAuditLog()` üzerinden gitmek,
 * her satır için gerçek bir aktör kullanıcı ve tenant bağlamı kurmayı gerektirirdi — testin
 * konusunu gölgeleyen bir kurulum.
 */
async function seedEntries(
  tenantId: string,
  count: number,
  options: { actorUserId?: string | null } = {},
): Promise<void> {
  const now = Date.now();
  await prisma.auditLog.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      tenantId,
      actorUserId: options.actorUserId ?? null,
      action: `TEST_EVENT_${index}`,
      targetType: "TENANT",
      targetId: tenantId,
      // Her satıra AYRI bir an: sıralama ve imleç davranışı, eşit zaman damgalarında
      // ayrıca test ediliyor (aşağıya bakın).
      createdAt: new Date(now - index * 1000),
    })),
  });
}

test.describe("listAuditLog() — sayfalama", () => {
  test("sayfa boyutu kadar kayıt ve devam imleci dönüyor", async () => {
    const tenantId = await seedTenant("AuditPage");
    await seedEntries(tenantId, AUDIT_LOG_PAGE_SIZE + 5);

    const first = await listAuditLog(tenantId);

    expect(first.entries).toHaveLength(AUDIT_LOG_PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();
  });

  test("son sayfada imleç NULL — 'alanın varlığı' değil DEĞERİ okunuyor", async () => {
    const tenantId = await seedTenant("AuditLast");
    await seedEntries(tenantId, 3);

    const page = await listAuditLog(tenantId);

    expect(page.entries).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });

  test("ikinci sayfa ilk sayfayı TEKRARLAMIYOR ve hiçbir kaydı atlamıyor", async () => {
    const tenantId = await seedTenant("AuditWindow");
    const total = AUDIT_LOG_PAGE_SIZE + 7;
    await seedEntries(tenantId, total);

    const first = await listAuditLog(tenantId);
    expect(first.nextCursor).not.toBeNull();

    const cursor = decodeAuditLogCursor(first.nextCursor!);
    expect(cursor).not.toBeNull();

    const second = await listAuditLog(tenantId, cursor);

    const firstIds = first.entries.map((entry) => entry.id);
    const secondIds = second.entries.map((entry) => entry.id);

    // Kesişim BOŞ olmalı: keyset sayfalamanın tüm amacı budur.
    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);
    // Ve birlikte HEPSİNİ kapsamalı — atlanan satır da bir hatadır.
    expect(new Set([...firstIds, ...secondIds]).size).toBe(total);
  });

  test("EŞİT zaman damgalarında da sıra kesin (id ikinci anahtar)", async () => {
    // Anahtar tek alanlı olsaydı, aynı milisaniyedeki satırlar iki sayfanın sınırında ya
    // atlanır ya tekrarlanırdı. Bu test o riski doğrudan kurar.
    const tenantId = await seedTenant("AuditTie");
    const sameInstant = new Date();
    await prisma.auditLog.createMany({
      data: Array.from({ length: AUDIT_LOG_PAGE_SIZE + 3 }, (_, index) => ({
        tenantId,
        action: `TIE_${index}`,
        createdAt: sameInstant,
      })),
    });

    const first = await listAuditLog(tenantId);
    const second = await listAuditLog(tenantId, decodeAuditLogCursor(first.nextCursor!));

    const ids = [...first.entries, ...second.entries].map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(AUDIT_LOG_PAGE_SIZE + 3);
  });

  test("en yeni kayıt en üstte", async () => {
    const tenantId = await seedTenant("AuditOrder");
    await seedEntries(tenantId, 5);

    const page = await listAuditLog(tenantId);
    const timestamps = page.entries.map((entry) => entry.createdAt.getTime());

    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
  });
});

test.describe("listAuditLog() — tenant izolasyonu", () => {
  test("başka tenant'ın kaydı listede YOK", async () => {
    const mine = await seedTenant("AuditMine");
    const other = await seedTenant("AuditOther");
    await seedEntries(mine, 2);
    await seedEntries(other, 2);

    const page = await listAuditLog(mine);
    const rows = await prisma.auditLog.findMany({
      where: { id: { in: page.entries.map((entry) => entry.id) } },
      select: { tenantId: true },
    });

    expect(page.entries).toHaveLength(2);
    expect(rows.every((row) => row.tenantId === mine)).toBe(true);
  });

  test("tenant'ı OLMAYAN kayıtlar (ör. başarısız login) listeye sızmıyor", async () => {
    const tenantId = await seedTenant("AuditGlobal");
    await seedEntries(tenantId, 2);
    // `AuditLog.tenantId` nullable: tenant-bağımsız olaylar için. Tenant'a scope'lu bir liste
    // onları GÖSTERMEMELİ — aksi halde bir çalışma alanının ekranında başka bir bağlamın
    // olayları belirirdi.
    const orphan = await prisma.auditLog.create({
      data: { action: "GLOBAL_EVENT", tenantId: null },
      select: { id: true },
    });

    try {
      const page = await listAuditLog(tenantId);
      expect(page.entries.map((entry) => entry.id)).not.toContain(orphan.id);
      expect(page.entries).toHaveLength(2);
    } finally {
      // Bu satır bir tenant'a bağlı olmadığı için `afterAll`daki tenant silme onu temizlemez.
      await prisma.auditLog.delete({ where: { id: orphan.id } });
    }
  });
});

test.describe("listAuditLog() — görünüm sözleşmesi", () => {
  test("aktör e-postası dönüyor; aktör yoksa null", async () => {
    const tenantId = await seedTenant("AuditActor");
    const email = `audit-actor-${randomUUID()}@example.com`;
    const actor = await prisma.user.create({ data: { email }, select: { id: true } });

    try {
      await seedEntries(tenantId, 1, { actorUserId: actor.id });
      await prisma.auditLog.create({ data: { tenantId, action: "NO_ACTOR" } });

      const page = await listAuditLog(tenantId);
      const withActor = page.entries.find((entry) => entry.action !== "NO_ACTOR");
      const withoutActor = page.entries.find((entry) => entry.action === "NO_ACTOR");

      expect(withActor?.actorEmail).toBe(email);
      expect(withoutActor?.actorEmail).toBeNull();
    } finally {
      await prisma.user.delete({ where: { id: actor.id } });
    }
  });

  test("imleç çift yönlü: kodlanan değer aynen geri çözülüyor", () => {
    const cursor = { createdAt: new Date("2026-09-05T10:20:30.400Z"), id: "cmtnehmbe00isadzkw1rxa388" };
    const decoded = decodeAuditLogCursor(encodeAuditLogCursor(cursor));

    expect(decoded?.id).toBe(cursor.id);
    expect(decoded?.createdAt.toISOString()).toBe(cursor.createdAt.toISOString());
  });

  test("bozuk imleç null döner (sessizce ilk sayfaya DÜŞMEZ)", () => {
    for (const broken of ["", "abc", "!!!", Buffer.from("tek-parca").toString("base64url")]) {
      expect(decodeAuditLogCursor(broken)).toBeNull();
    }

    // KONTROL GRUBU: doğru biçimli bir imleç GERÇEKTEN çözülüyor — aksi halde her şeye `null`
    // dönen bir çözücü de bu testi geçerdi.
    const valid = encodeAuditLogCursor({ createdAt: new Date(), id: "cmtnehmbe00isadzkw1rxa388" });
    expect(decodeAuditLogCursor(valid)).not.toBeNull();
  });
});
