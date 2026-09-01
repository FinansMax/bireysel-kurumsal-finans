import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { prisma } from "../src/lib/prisma";
import {
  isModuleKey,
  MODULES,
  MODULE_CATALOG,
  MODULE_DEFINITIONS,
  modulesDependingOn,
} from "../src/lib/modules/catalog";
import {
  isModuleEnabled,
  listTenantModules,
  setModuleEnabled,
} from "../src/lib/modules/tenant-module";

/**
 * Modül katalogu ve tenant modül durumu (Issue #151).
 *
 * Yetkilendirme burada test EDİLMEZ (bkz. `security/tenant-module-security.spec.ts`).
 * Buradaki konu: katalogun kendi tutarlılığı, katalog+DB birleşimi, bağımlılık kuralları ve
 * tenant scope'u.
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
    data: { name: "Modul Testi", slug: `mod-${randomUUID()}` },
    select: { id: true },
  });
  createdTenantIds.push(tenant.id);
  return tenant.id;
}

async function seedActor(): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `mod-actor-${randomUUID()}@example.com` },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  return user.id;
}

test.describe("Modül katalogu — kendi tutarlılığı", () => {
  test("katalog boş değil ve taranabiliyor (test kendi kendini doğruluyor)", () => {
    expect(MODULE_DEFINITIONS.length).toBeGreaterThanOrEqual(2);
  });

  test("her anahtarın tanımı var ve `key` alanı anahtarla eşleşiyor", () => {
    for (const key of Object.values(MODULES)) {
      const definition = MODULE_CATALOG[key];
      expect(definition, `tanımsız modül: ${key}`).toBeTruthy();
      // `key` alanı ile Record anahtarı ayrışırsa, `modulesDependingOn` gibi her arama bozulur.
      expect(definition.key).toBe(key);
      expect(definition.label.trim().length).toBeGreaterThan(0);
      expect(definition.description.trim().length).toBeGreaterThan(0);
    }
  });

  test("bağımlılıklar KATALOGDA var olan anahtarlara işaret ediyor", () => {
    for (const definition of MODULE_DEFINITIONS) {
      for (const dependency of definition.dependsOn) {
        expect(isModuleKey(dependency), `bilinmeyen bağımlılık: ${dependency}`).toBe(true);
      }
      // Kendine bağımlılık, açılması imkânsız bir modül üretirdi.
      expect(definition.dependsOn).not.toContain(definition.key);
    }
  });

  test("bağımlılık grafiği DÖNGÜSÜZ (aksi halde hiçbiri açılamazdı)", () => {
    // İki modülün birbirine bağımlı olması, ikisini de kalıcı olarak kapalı bırakırdı: her
    // açma denemesi diğerinin kapalı olduğunu görüp 409 dönerdi.
    const visit = (key: (typeof MODULE_DEFINITIONS)[number]["key"], seen: string[]): void => {
      expect(seen, `bağımlılık döngüsü: ${[...seen, key].join(" -> ")}`).not.toContain(key);
      for (const dependency of MODULE_CATALOG[key].dependsOn) {
        visit(dependency, [...seen, key]);
      }
    };

    for (const definition of MODULE_DEFINITIONS) {
      visit(definition.key, []);
    }
  });

  test("modulesDependingOn ters yönü doğru veriyor", () => {
    expect(modulesDependingOn(MODULES.CRM).map((entry) => entry.key)).toEqual([
      MODULES.COLLECTIONS,
    ]);
    expect(modulesDependingOn(MODULES.COLLECTIONS)).toEqual([]);
  });

  test("isModuleKey yalnızca TAM eşleşmeyi kabul eder", () => {
    expect(isModuleKey("crm")).toBe(true);
    expect(isModuleKey("CRM")).toBe(false);
    expect(isModuleKey(" crm ")).toBe(false);
    expect(isModuleKey("")).toBe(false);
    expect(isModuleKey(null)).toBe(false);
    // Prototip zincirinden gelen adlar anahtar sanılmamalı (`Object.hasOwn` kullanılıyor).
    expect(isModuleKey("toString")).toBe(false);
    expect(isModuleKey("constructor")).toBe(false);
  });
});

test.describe("listTenantModules() — katalog + DB birleşimi", () => {
  test("hiç satır yokken TÜM modüller kapalı görünüyor", async () => {
    const tenantId = await seedTenant();

    const modules = await listTenantModules(tenantId);

    // SATIRIN YOKLUĞU = KAPALI. Bu, migration sonrası mevcut tenant'ların etkilenmemesini
    // sağlayan karardır.
    expect(modules).toHaveLength(MODULE_DEFINITIONS.length);
    expect(modules.every((entry) => entry.enabled === false)).toBe(true);
    expect(await prisma.tenantModule.count({ where: { tenantId } })).toBe(0);
  });

  test("sıra KATALOĞUN sırasıdır, DB'nin yazım sırası değil", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    // Önce `crm`, sonra `collections` yazılıyor; ama liste yine katalog sırasında dönmeli.
    await setModuleEnabled(tenantId, MODULES.CRM, true, actorId);
    await setModuleEnabled(tenantId, MODULES.COLLECTIONS, true, actorId);

    const modules = await listTenantModules(tenantId);
    expect(modules.map((entry) => entry.key)).toEqual(
      MODULE_DEFINITIONS.map((definition) => definition.key),
    );
  });

  test("KATALOGDA OLMAYAN eski satır sessizce yok sayılıyor", async () => {
    const tenantId = await seedTenant();

    // Katalogdan kaldırılmış bir modülün satırı uygulamayı KIRMAMALI.
    await prisma.tenantModule.create({
      data: { tenantId, moduleKey: "kaldirilmis-modul", enabled: true },
    });

    const modules = await listTenantModules(tenantId);
    expect(modules).toHaveLength(MODULE_DEFINITIONS.length);
    expect(modules.map((entry) => entry.key)).not.toContain("kaldirilmis-modul");
  });

  test("etiket ve açıklama KATALOGDAN gelir (DB'de tutulmaz)", async () => {
    const tenantId = await seedTenant();

    const modules = await listTenantModules(tenantId);
    const crm = modules.find((entry) => entry.key === MODULES.CRM);

    expect(crm?.label).toBe(MODULE_CATALOG[MODULES.CRM].label);
    expect(crm?.dependsOn).toEqual([]);
  });
});

test.describe("setModuleEnabled() — bağımlılık kuralları", () => {
  test("bağımlılığı olmayan modül doğrudan açılıyor", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    const result = await setModuleEnabled(tenantId, MODULES.CRM, true, actorId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.module.enabled).toBe(true);
    expect(await isModuleEnabled(tenantId, MODULES.CRM)).toBe(true);

    const row = await prisma.tenantModule.findFirstOrThrow({
      where: { tenantId, moduleKey: MODULES.CRM },
    });
    expect(row.enabledAt).not.toBeNull();
  });

  test("bağımlı modül KAPALIYKEN açılamaz (409) ve satır oluşmaz", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    const result = await setModuleEnabled(tenantId, MODULES.COLLECTIONS, true, actorId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    // BAĞIMLILIK OTOMATİK AÇILMAZ: kullanıcı ne açtığını bilmelidir.
    expect(await isModuleEnabled(tenantId, MODULES.CRM)).toBe(false);
    expect(await prisma.tenantModule.count({ where: { tenantId } })).toBe(0);
  });

  test("bağımlılık açıkken açılabiliyor (kontrol grubu)", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    expect((await setModuleEnabled(tenantId, MODULES.CRM, true, actorId)).ok).toBe(true);
    const result = await setModuleEnabled(tenantId, MODULES.COLLECTIONS, true, actorId);

    expect(result.ok).toBe(true);
    expect(await isModuleEnabled(tenantId, MODULES.COLLECTIONS)).toBe(true);
  });

  test("kendisine bağımlı AÇIK modül varken kapatılamaz (409)", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    await setModuleEnabled(tenantId, MODULES.CRM, true, actorId);
    await setModuleEnabled(tenantId, MODULES.COLLECTIONS, true, actorId);

    const result = await setModuleEnabled(tenantId, MODULES.CRM, false, actorId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    // Kural simetriktir: açarken de kapatırken de kullanıcı kararı zorunludur.
    expect(await isModuleEnabled(tenantId, MODULES.CRM)).toBe(true);
  });

  test("bağımlı modül kapatıldıktan SONRA kapatılabiliyor (duyarlılık kanıtı)", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    await setModuleEnabled(tenantId, MODULES.CRM, true, actorId);
    await setModuleEnabled(tenantId, MODULES.COLLECTIONS, true, actorId);

    expect((await setModuleEnabled(tenantId, MODULES.COLLECTIONS, false, actorId)).ok).toBe(true);
    const result = await setModuleEnabled(tenantId, MODULES.CRM, false, actorId);

    expect(result.ok).toBe(true);
    expect(await isModuleEnabled(tenantId, MODULES.CRM)).toBe(false);

    const row = await prisma.tenantModule.findFirstOrThrow({
      where: { tenantId, moduleKey: MODULES.CRM },
    });
    expect(row.disabledAt).not.toBeNull();
  });

  test("KAPALI bağımlı modül engel değildir", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    await setModuleEnabled(tenantId, MODULES.CRM, true, actorId);
    await setModuleEnabled(tenantId, MODULES.COLLECTIONS, true, actorId);
    await setModuleEnabled(tenantId, MODULES.COLLECTIONS, false, actorId);

    // `collections` satırı VAR ama kapalı; kural "açık olan bağımlı" üzerinedir.
    expect((await setModuleEnabled(tenantId, MODULES.CRM, false, actorId)).ok).toBe(true);
  });
});

test.describe("setModuleEnabled() — doğrulama ve tekrar çağrı", () => {
  test("katalogda olmayan anahtar 400 alır ve satır oluşmaz", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    for (const key of ["CRM", " crm ", "uydurma", "", "toString"]) {
      const result = await setModuleEnabled(tenantId, key, true, actorId);
      expect(result.ok, `beklenen 400: ${key}`).toBe(false);
      if (result.ok) continue;
      expect(result.status).toBe(400);
    }

    expect(await prisma.tenantModule.count({ where: { tenantId } })).toBe(0);
  });

  test("`enabled` boolean değilse 400 (string 'true' kabul edilmez)", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    for (const value of ["true", 1, null, undefined, {}]) {
      const result = await setModuleEnabled(tenantId, MODULES.CRM, value, actorId);
      expect(result.ok, `beklenen 400: ${JSON.stringify(value)}`).toBe(false);
    }

    expect(await prisma.tenantModule.count({ where: { tenantId } })).toBe(0);
  });

  test("aynı modülü iki kez açmak ikinci satır ÜRETMEZ (upsert + unique)", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    await setModuleEnabled(tenantId, MODULES.CRM, true, actorId);
    const second = await setModuleEnabled(tenantId, MODULES.CRM, true, actorId);

    expect(second.ok).toBe(true);
    expect(
      await prisma.tenantModule.count({ where: { tenantId, moduleKey: MODULES.CRM } }),
    ).toBe(1);
  });

  test("eşzamanlı iki açma isteğinden ikisi de tek satırda buluşuyor", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    // "Önce var mı diye bak sonra yaz" yarışı DB seviyesinde kapalıdır (`@@unique`).
    const results = await Promise.all([
      setModuleEnabled(tenantId, MODULES.CRM, true, actorId),
      setModuleEnabled(tenantId, MODULES.CRM, true, actorId),
    ]);

    // Serialization çakışmasında 503 meşrudur (geçici); asıl iddia TEK SATIR kalmasıdır.
    for (const result of results) {
      if (!result.ok) {
        expect(result.status).toBe(503);
      }
    }
    expect(
      await prisma.tenantModule.count({ where: { tenantId, moduleKey: MODULES.CRM } }),
    ).toBe(1);
  });

  test("açma ve kapama audit log'a düşüyor (targetId = modül anahtarı)", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    await setModuleEnabled(tenantId, MODULES.CRM, true, actorId);
    await setModuleEnabled(tenantId, MODULES.CRM, false, actorId);

    const enabled = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId, action: "MODULE_ENABLED" },
    });
    expect(enabled.targetType).toBe("MODULE");
    // Satır id'si DEĞİL: kayıt, satır silinse bile anlamlı kalmalı.
    expect(enabled.targetId).toBe(MODULES.CRM);
    expect(enabled.actorUserId).toBe(actorId);

    expect(
      await prisma.auditLog.count({ where: { tenantId, action: "MODULE_DISABLED" } }),
    ).toBe(1);
  });

  test("REDDEDİLEN istek audit log YAZMAZ", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    await setModuleEnabled(tenantId, MODULES.COLLECTIONS, true, actorId); // 409
    await setModuleEnabled(tenantId, "uydurma", true, actorId); // 400

    // Audit "kim ne yaptı" kaydıdır; olmayan bir değişiklik kaydedilmemeli.
    expect(await prisma.auditLog.count({ where: { tenantId } })).toBe(0);
  });
});

test.describe("Modül durumu — tenant izolasyonu", () => {
  test("bir tenant'ta açılan modül DİĞERİNDE kapalı kalıyor", async () => {
    const actorId = await seedActor();
    const mine = await seedTenant();
    const theirs = await seedTenant();

    await setModuleEnabled(theirs, MODULES.CRM, true, actorId);

    expect(await isModuleEnabled(mine, MODULES.CRM)).toBe(false);
    const modules = await listTenantModules(mine);
    expect(modules.every((entry) => entry.enabled === false)).toBe(true);
  });

  test("KONTROL GRUBU: aynı modül kendi tenant'ında açık görünüyor", async () => {
    const actorId = await seedActor();
    const theirs = await seedTenant();

    await setModuleEnabled(theirs, MODULES.CRM, true, actorId);

    expect(await isModuleEnabled(theirs, MODULES.CRM)).toBe(true);
  });

  test("bir tenant'ı kapatmak diğerinin durumunu DEĞİŞTİRMİYOR", async () => {
    const actorId = await seedActor();
    const first = await seedTenant();
    const second = await seedTenant();

    await setModuleEnabled(first, MODULES.CRM, true, actorId);
    await setModuleEnabled(second, MODULES.CRM, true, actorId);
    await setModuleEnabled(first, MODULES.CRM, false, actorId);

    expect(await isModuleEnabled(first, MODULES.CRM)).toBe(false);
    expect(await isModuleEnabled(second, MODULES.CRM)).toBe(true);
  });

  test("isModuleEnabled bilinmeyen anahtar için GÜVENLİ varsayılanı döner", async () => {
    const tenantId = await seedTenant();

    // "Bilinmeyen modül kapalıdır": bir yazım hatası, kapalı olması gereken bir yüzeyi
    // açmamalıdır.
    expect(await isModuleEnabled(tenantId, "uydurma")).toBe(false);
    expect(await isModuleEnabled(tenantId, "CRM")).toBe(false);
  });

  test("tenant silinince modül satırları da gidiyor (cascade)", async () => {
    const actorId = await seedActor();
    const tenantId = await seedTenant();
    await setModuleEnabled(tenantId, MODULES.CRM, true, actorId);

    await prisma.tenant.delete({ where: { id: tenantId } });

    expect(await prisma.tenantModule.count({ where: { tenantId } })).toBe(0);
  });
});
