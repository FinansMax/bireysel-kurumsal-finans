import { randomUUID } from "node:crypto";

import { CategoryType } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { MODULES, type ModuleSeed } from "../src/lib/modules/catalog";
import { setModuleEnabled } from "../src/lib/modules/tenant-module";
import { prisma } from "../src/lib/prisma";

/**
 * Modül seed mekanizması (Issue #154).
 *
 * NEDEN BU TESTLER VAR: seed, bir modül bir tenant'ta İLK KEZ açıldığında çalışır. "İlk kez"
 * kararı bir okumaya (`seededAt`) dayandığı için, iki eşzamanlı "aç" isteği naif bir
 * implementasyonda İKİ KEZ seed çalıştırıp veriyi ÇİFTLERDİ. Bu dosya o yarışın kapalı
 * olduğunu ve kapat/aç döngüsünün seed'i tekrarlamadığını sabitler.
 *
 * Katalogdaki hiçbir modülün bugün seed'i yok (gerçek veri #157'yi bekliyor), bu yüzden testler
 * `seeds` seçeneğiyle kendi seed'lerini enjekte eder — mekanizmayı atlamadan, yalnızca kaynağı
 * değiştirerek.
 */

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

test.afterAll(async () => {
  if (createdTenantIds.length > 0) {
    await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

async function setup() {
  const tenant = await prisma.tenant.create({
    data: { name: "Seed Test", slug: `seed-${randomUUID()}` },
    select: { id: true },
  });
  createdTenantIds.push(tenant.id);

  const user = await prisma.user.create({
    data: { email: `seed-${randomUUID()}@example.com` },
    select: { id: true },
  });
  createdUserIds.push(user.id);

  return { tenantId: tenant.id, userId: user.id };
}

/**
 * Seed'in gerçekten veri yazdığını görebilmek için `Category` kullanılır: mevcut, tenant-scoped
 * ve `@@unique([tenantId, name, type])` taşıyan bir model. Sahte bir tablo yaratmak yerine
 * gerçek bir yazma yapmak, transaction sınırının ve rollback'in gerçekten çalıştığını kanıtlar.
 */
function countingSeed(marker: string) {
  let calls = 0;
  const seed: ModuleSeed = async (tx, tenantId) => {
    calls += 1;
    await tx.category.create({
      data: { tenantId, name: `${marker}-${calls}`, type: CategoryType.EXPENSE },
    });
  };
  return { seed, calls: () => calls };
}

test.describe("Modül seed — bir kez çalışır", () => {
  test("aç → kapat → aç: seed YALNIZCA BİR KEZ çalışır", async () => {
    const { tenantId, userId } = await setup();
    const marker = `once-${randomUUID().slice(0, 8)}`;
    const { seed, calls } = countingSeed(marker);
    const options = { seeds: { [MODULES.CRM]: seed } };

    expect((await setModuleEnabled(tenantId, MODULES.CRM, true, userId, options)).ok).toBe(true);
    expect(calls()).toBe(1);

    expect((await setModuleEnabled(tenantId, MODULES.CRM, false, userId, options)).ok).toBe(true);
    expect((await setModuleEnabled(tenantId, MODULES.CRM, true, userId, options)).ok).toBe(true);

    // Kapatıp tekrar açmak seed'i TEKRARLAMAZ.
    expect(calls()).toBe(1);

    const rows = await prisma.category.count({ where: { tenantId, name: { startsWith: marker } } });
    expect(rows).toBe(1);
  });

  test("seededAt doldurulur ve kapatma onu TEMİZLEMEZ", async () => {
    const { tenantId, userId } = await setup();
    const { seed } = countingSeed(`stamp-${randomUUID().slice(0, 8)}`);
    const options = { seeds: { [MODULES.CRM]: seed } };

    await setModuleEnabled(tenantId, MODULES.CRM, true, userId, options);
    const afterEnable = await prisma.tenantModule.findFirstOrThrow({
      where: { tenantId, moduleKey: MODULES.CRM },
      select: { seededAt: true },
    });
    expect(afterEnable.seededAt).toBeInstanceOf(Date);

    await setModuleEnabled(tenantId, MODULES.CRM, false, userId, options);
    const afterDisable = await prisma.tenantModule.findFirstOrThrow({
      where: { tenantId, moduleKey: MODULES.CRM },
      select: { seededAt: true },
    });
    // Kapatma seed'i GERİ ALMAZ ve damgayı temizlemez.
    expect(afterDisable.seededAt).toEqual(afterEnable.seededAt);
  });

  test("seed'i olmayan modül sorunsuz açılır ve seededAt boş kalır", async () => {
    // Bugün katalogdaki modüllerin durumu budur.
    const { tenantId, userId } = await setup();

    expect((await setModuleEnabled(tenantId, MODULES.CRM, true, userId)).ok).toBe(true);

    const row = await prisma.tenantModule.findFirstOrThrow({
      where: { tenantId, moduleKey: MODULES.CRM },
      select: { seededAt: true, enabled: true },
    });
    expect(row.enabled).toBe(true);
    expect(row.seededAt).toBeNull();
  });
});

test.describe("Modül seed — eşzamanlılık", () => {
  test("EŞZAMANLI iki 'aç' isteği tek seed üretir (duplicate yok)", async () => {
    /**
     * Asıl kabul kriteri. `seededAt` okuması ve seed yazması AYNI serializable transaction
     * içinde olduğu için, iki istekten biri serialization hatası alıp yeniden dener ve ikinci
     * denemede `seededAt` dolu bulur.
     */
    const { tenantId, userId } = await setup();
    const marker = `race-${randomUUID().slice(0, 8)}`;
    const { seed, calls } = countingSeed(marker);
    const options = { seeds: { [MODULES.CRM]: seed } };

    const results = await Promise.all([
      setModuleEnabled(tenantId, MODULES.CRM, true, userId, options),
      setModuleEnabled(tenantId, MODULES.CRM, true, userId, options),
    ]);

    // İkisi de başarılı olabilir (idempotent "aç"), ama seed'in YAZDIĞI kayıt tek olmalı.
    expect(results.every((r) => r.ok)).toBe(true);

    const rows = await prisma.category.count({ where: { tenantId, name: { startsWith: marker } } });
    expect(rows, `seed ${calls()} kez çağrıldı`).toBe(1);
  });
});

test.describe("Modül seed — hata durumu", () => {
  test("seed patlarsa modül AÇILMAZ, veri kalmaz ve 500 DEĞİL 503 döner", async () => {
    const { tenantId, userId } = await setup();
    const marker = `fail-${randomUUID().slice(0, 8)}`;

    const failingSeed: ModuleSeed = async (tx, seedTenantId) => {
      // Önce yazar, sonra patlar: rollback'in gerçekten çalıştığını görebilmek için.
      await tx.category.create({
        data: { tenantId: seedTenantId, name: marker, type: CategoryType.EXPENSE },
      });
      throw new Error("seed exploded");
    };

    const result = await setModuleEnabled(tenantId, MODULES.CRM, true, userId, {
      seeds: { [MODULES.CRM]: failingSeed },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // 500 değil: durum tutarlı, tekrar denemek mantıklı.
      expect(result.status).toBe(503);
      expect(result.error.toLowerCase()).toContain("default data");
    }

    // ROLLBACK: ne modül satırı ne de seed'in yazdığı kayıt kaldı.
    expect(await prisma.tenantModule.count({ where: { tenantId, moduleKey: MODULES.CRM } })).toBe(0);
    expect(await prisma.category.count({ where: { tenantId, name: marker } })).toBe(0);
  });
});
