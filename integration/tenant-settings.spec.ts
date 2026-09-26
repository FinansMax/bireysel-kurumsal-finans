import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { prisma } from "../src/lib/prisma";
import { updateTenantSettings } from "../src/lib/tenants/settings";

/**
 * Tenant ayarları — ad ve varsayılan para birimi (Issue #86).
 *
 * Yetkilendirme burada test EDİLMEZ (bkz. `security/tenant-settings-security.spec.ts`).
 * Buradaki konu: doğrulama, kısmi güncelleme (PATCH semantiği), atomik yazım ve audit log.
 */

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

test.afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

async function seedTenant(): Promise<string> {
  const tenant = await prisma.tenant.create({
    data: { name: "Ayar Testi", slug: `settings-${randomUUID()}` },
    select: { id: true },
  });
  createdTenantIds.push(tenant.id);
  return tenant.id;
}

async function seedActor(): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `settings-actor-${randomUUID()}@example.com` },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  return user.id;
}

test.describe("updateTenantSettings() — varsayılanlar", () => {
  test("migration sonrası mevcut tenant TRY varsayılanını taşıyor", async () => {
    const tenantId = await seedTenant();

    const tenant = await prisma.tenant.findFirstOrThrow({
      where: { id: tenantId },
      select: { defaultCurrency: true },
    });
    expect(tenant.defaultCurrency).toBe("TRY");
  });
});

test.describe("updateTenantSettings() — kısmi güncelleme", () => {
  test("yalnızca ad gönderilirse para birimi DEĞİŞMEZ", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    const result = await updateTenantSettings(tenantId, actorId, { name: "Yeni Ad" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tenant.name).toBe("Yeni Ad");
    expect(result.tenant.defaultCurrency).toBe("TRY");
  });

  test("yalnızca para birimi gönderilirse ad DEĞİŞMEZ", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    const result = await updateTenantSettings(tenantId, actorId, { defaultCurrency: "USD" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tenant.name).toBe("Ayar Testi");
    expect(result.tenant.defaultCurrency).toBe("USD");
  });

  test("ikisi birden gönderilirse ikisi birden güncellenir", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    const result = await updateTenantSettings(tenantId, actorId, {
      name: "İkisi Birden",
      defaultCurrency: "EUR",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tenant.name).toBe("İkisi Birden");
    expect(result.tenant.defaultCurrency).toBe("EUR");
  });

  test("hiçbir alan gönderilmezse 400 ve satır DEĞİŞMEZ", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    const result = await updateTenantSettings(tenantId, actorId, {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);

    const tenant = await prisma.tenant.findFirstOrThrow({ where: { id: tenantId } });
    expect(tenant.name).toBe("Ayar Testi");
  });
});

test.describe("updateTenantSettings() — doğrulama", () => {
  test("1 karakterlik ad 400 alır (min 2)", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    const result = await updateTenantSettings(tenantId, actorId, { name: "A" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  test("101 karakterlik ad 400 alır (max 100)", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    const result = await updateTenantSettings(tenantId, actorId, { name: "a".repeat(101) });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  test("2 harfli ve 4 harfli para birimi kodları 400 alır (ISO 4217 tam 3 harf)", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    for (const code of ["TR", "TRYY", "12A", ""]) {
      const result = await updateTenantSettings(tenantId, actorId, { defaultCurrency: code });
      expect(result.ok, `beklenen 400: "${code}"`).toBe(false);
    }
  });

  test("küçük harfli kod normalize edilip KABUL edilir (kontrol grubu)", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    const result = await updateTenantSettings(tenantId, actorId, { defaultCurrency: "try" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tenant.defaultCurrency).toBe("TRY");
  });

  test("name string değilse 400", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    const result = await updateTenantSettings(tenantId, actorId, { name: 123 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  test("var olmayan tenant 404 alır", async () => {
    const actorId = await seedActor();

    const result = await updateTenantSettings("does-not-exist", actorId, { name: "Fark Etmez" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
  });
});

test.describe("updateTenantSettings() — audit log", () => {
  test("başarılı güncelleme audit log'a düşüyor (yalnızca değişen alanlar)", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    await updateTenantSettings(tenantId, actorId, { name: "Audit Testi" });

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId, action: "TENANT_SETTINGS_UPDATED" },
    });
    expect(entry.targetType).toBe("TENANT");
    expect(entry.targetId).toBe(tenantId);
    expect(entry.actorUserId).toBe(actorId);
    expect(entry.metadata).toMatchObject({ updatedFields: ["name"] });
  });

  test("REDDEDİLEN istek (400) audit log YAZMAZ", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    await updateTenantSettings(tenantId, actorId, { name: "A" }); // 400
    await updateTenantSettings(tenantId, actorId, {}); // 400

    expect(await prisma.auditLog.count({ where: { tenantId } })).toBe(0);
  });
});

test.describe("updateTenantSettings() — tenant izolasyonu", () => {
  test("bir tenant'ın adını değiştirmek DİĞERİNİ etkilemiyor", async () => {
    const actorId = await seedActor();
    const mine = await seedTenant();
    const theirs = await seedTenant();

    await updateTenantSettings(mine, actorId, { name: "Benim Adım" });

    const theirsRow = await prisma.tenant.findFirstOrThrow({ where: { id: theirs } });
    expect(theirsRow.name).toBe("Ayar Testi");
  });
});
