import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { prisma } from "../src/lib/prisma";
import {
  createDebtCredit,
  deleteDebtCredit,
  listDebtCredits,
  updateDebtCredit,
} from "../src/lib/finance/debt-credit";

/**
 * `DebtCredit` iş kuralları — gerçek DB'ye karşı, HTTP olmadan (Issue #70).
 *
 * Yetkilendirme burada test EDİLMEZ: servis fonksiyonları authorization kararı vermez, o iş
 * route'lardaki `requirePermission()`ındır (bkz. `security/debt-credit-security.spec.ts`).
 * Buradaki konu: doğrulama, para hassasiyeti, durum geçişleri, sıralama ve tenant scope'u.
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
    data: { name: "Borc Testi", slug: `debt-${randomUUID()}` },
    select: { id: true },
  });
  createdTenantIds.push(tenant.id);
  return tenant.id;
}

async function seedActor(): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `debt-actor-${randomUUID()}@example.com` },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  return user.id;
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    type: "DEBT",
    counterparty: `Karsi Taraf ${randomUUID()}`,
    amount: "1500.50",
    currency: "TRY",
    ...overrides,
  };
}

async function seedRecord(
  tenantId: string,
  actorId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const result = await createDebtCredit(tenantId, actorId, input(overrides));
  expect(result.ok, `kayıt oluşturulamadı: ${result.ok ? "" : result.error}`).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.debtCredit.id;
}

test.describe("createDebtCredit() — mutlu yol", () => {
  test("kayıt oluşuyor ve tenant'a bağlanıyor", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    const result = await createDebtCredit(
      tenantId,
      actorId,
      input({ type: "CREDIT", counterparty: "Ahmet Yilmaz", amount: "2500", currency: "usd" }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.debtCredit.type).toBe("CREDIT");
    expect(result.debtCredit.counterparty).toBe("Ahmet Yilmaz");
    expect(result.debtCredit.amount).toBe("2500");
    // Para birimi normalize edilir (hesaplardaki aynı kural).
    expect(result.debtCredit.currency).toBe("USD");
    // Vade verilmediğinde `null`: "tarihi belli değil" meşru bir kayıttır.
    expect(result.debtCredit.dueDate).toBeNull();
    // Yeni kayıt tanımı gereği AÇIKTIR (şemadaki `@default(OPEN)`).
    expect(result.debtCredit.status).toBe("OPEN");

    const row = await prisma.debtCredit.findUniqueOrThrow({ where: { id: result.debtCredit.id } });
    expect(row.tenantId).toBe(tenantId);
  });

  test("tutar Decimal hassasiyetiyle saklanıyor", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    // KRİTİK: `number` ile bu değer bozulurdu (invariant #10).
    const result = await createDebtCredit(
      tenantId,
      actorId,
      input({ amount: "12345678901.2345" }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.debtCredit.amount).toBe("12345678901.2345");

    const row = await prisma.debtCredit.findUniqueOrThrow({ where: { id: result.debtCredit.id } });
    expect(row.amount.toString()).toBe("12345678901.2345");
  });

  test("vade gün hassasiyetinde (UTC gece yarısı) saklanıyor", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    const result = await createDebtCredit(tenantId, actorId, input({ dueDate: "2026-03-15" }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.debtCredit.dueDate?.toISOString()).toBe("2026-03-15T00:00:00.000Z");
  });

  test("karşı taraf adının baştaki/sondaki boşlukları temizleniyor", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    const result = await createDebtCredit(
      tenantId,
      actorId,
      input({ counterparty: "  Mehmet Demir  " }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.debtCredit.counterparty).toBe("Mehmet Demir");
  });

  test("geçmişe dönük kapanmış kayıt açılabiliyor", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    // Sözleşme arayüzden GENİŞTİR: form "kapandı" olarak açtırmaz ama API kabul eder
    // (geçmişteki bir borcu kayda geçirmek meşrudur).
    const result = await createDebtCredit(tenantId, actorId, input({ status: "SETTLED" }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.debtCredit.status).toBe("SETTLED");
  });

  test("başarılı oluşturma audit log satırı yazıyor (tutar YAZILMADAN)", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    const id = await seedRecord(tenantId, actorId, { amount: "999.99" });

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId, action: "DEBT_CREDIT_CREATED", targetId: id },
    });
    expect(log.targetType).toBe("DEBT_CREDIT");
    expect(log.actorUserId).toBe(actorId);
    // Audit log finansal değerlerin ikinci bir kopyası DEĞİLDİR.
    expect(JSON.stringify(log.metadata)).not.toContain("999.99");
  });
});

test.describe("createDebtCredit() — doğrulama", () => {
  const cases: Array<{ name: string; overrides: Record<string, unknown> }> = [
    { name: "tür eksik", overrides: { type: undefined } },
    { name: "tür geçersiz", overrides: { type: "LOAN" } },
    { name: "tür küçük harf", overrides: { type: "debt" } },
    { name: "karşı taraf çok kısa", overrides: { counterparty: "A" } },
    { name: "karşı taraf yalnızca boşluk", overrides: { counterparty: "   " } },
    { name: "karşı taraf 101 karakter", overrides: { counterparty: "x".repeat(101) } },
    { name: "karşı taraf string değil", overrides: { counterparty: 42 } },
    { name: "tutar number (para asla number değildir)", overrides: { amount: 1500 } },
    { name: "tutar sıfır", overrides: { amount: "0" } },
    { name: "tutar negatif (yönü tür taşır)", overrides: { amount: "-100" } },
    { name: "tutar 4'ten fazla ondalık", overrides: { amount: "1.23456" } },
    { name: "tutar yerel biçim", overrides: { amount: "1.234,56" } },
    { name: "para birimi 3 harf değil", overrides: { currency: "TR" } },
    { name: "para birimi rakam içeriyor", overrides: { currency: "TR1" } },
    { name: "vade yerel biçim", overrides: { dueDate: "15.03.2026" } },
    { name: "vade takvimde yok", overrides: { dueDate: "2026-02-31" } },
    { name: "vade tarih-saat", overrides: { dueDate: "2026-03-15T10:00:00Z" } },
    { name: "durum geçersiz", overrides: { status: "PARTIAL" } },
  ];

  for (const { name, overrides } of cases) {
    test(`${name} → 400 ve hiçbir kayıt oluşmuyor`, async () => {
      const tenantId = await seedTenant();
      const actorId = await seedActor();

      const result = await createDebtCredit(tenantId, actorId, input(overrides));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(await prisma.debtCredit.count({ where: { tenantId } })).toBe(0);
    });
  }

  test("vade açıkça null gönderilebilir (vadesiz kayıt)", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    const result = await createDebtCredit(tenantId, actorId, input({ dueDate: null }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.debtCredit.dueDate).toBeNull();
  });
});

test.describe("listDebtCredits() — sıralama ve izolasyon", () => {
  test("önce AÇIK kayıtlar, sonra vadeye göre; vadesizler vadelilerin ARDINDA", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    await seedRecord(tenantId, actorId, { counterparty: "Kapanmis", status: "SETTLED", dueDate: "2020-01-01" });
    await seedRecord(tenantId, actorId, { counterparty: "Vadesiz Acik" });
    await seedRecord(tenantId, actorId, { counterparty: "Gec Vade", dueDate: "2026-12-31" });
    await seedRecord(tenantId, actorId, { counterparty: "Erken Vade", dueDate: "2026-01-01" });

    const records = await listDebtCredits(tenantId);

    // Bu listeye bakan kişi "neyi ödemem gerek" sorusunu sorar: kapanmışlar sona, vadesizler
    // vadelilerin ardına düşer — tarihi olmayan bir kayıt, tarihi geçmişin önüne geçmemeli.
    expect(records.map((record) => record.counterparty)).toEqual([
      "Erken Vade",
      "Gec Vade",
      "Vadesiz Acik",
      "Kapanmis",
    ]);
  });

  test("yalnızca kendi tenant'ının kayıtları dönüyor", async () => {
    const actorId = await seedActor();
    const mine = await seedTenant();
    const theirs = await seedTenant();

    await seedRecord(mine, actorId, { counterparty: "Benim Kaydim" });
    await seedRecord(theirs, actorId, { counterparty: "Komsu Kaydi", amount: "999999" });

    const records = await listDebtCredits(mine);

    expect(records).toHaveLength(1);
    expect(records[0].counterparty).toBe("Benim Kaydim");
    expect(JSON.stringify(records)).not.toContain("999999");
  });

  test("KONTROL GRUBU: aynı kayıt kendi tenant'ında GÖRÜNÜYOR", async () => {
    const actorId = await seedActor();
    const theirs = await seedTenant();
    await seedRecord(theirs, actorId, { counterparty: "Komsu Kaydi", amount: "999999" });

    const records = await listDebtCredits(theirs);
    expect(records[0].counterparty).toBe("Komsu Kaydi");
    expect(records[0].amount).toBe("999999");
  });

  test("tutar listede de string olarak dönüyor", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    await seedRecord(tenantId, actorId, { amount: "0.0001" });

    const records = await listDebtCredits(tenantId);
    expect(typeof records[0].amount).toBe("string");
    expect(records[0].amount).toBe("0.0001");
  });
});

test.describe("updateDebtCredit() — durum geçişleri", () => {
  test("OPEN → SETTLED çalışıyor ve audit log'a yönüyle düşüyor", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const id = await seedRecord(tenantId, actorId);

    const result = await updateDebtCredit(tenantId, id, actorId, { status: "SETTLED" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.debtCredit.status).toBe("SETTLED");

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId, action: "DEBT_CREDIT_UPDATED", targetId: id },
    });
    // "Kapandı" işareti bu modelin en hesap sorulabilir olayıdır; hangi yöne geçildiği alan
    // adından okunamaz, bu yüzden DEĞERİ de yazılır.
    expect(JSON.stringify(log.metadata)).toContain("SETTLED");
  });

  test("SETTLED → OPEN da çalışıyor (yanlış işaretlemenin geri dönüşü var)", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const id = await seedRecord(tenantId, actorId, { status: "SETTLED" });

    // Geri dönüşü yasaklamak, düzeltmenin tek yolunu SİLİP YENİDEN OLUŞTURMAK yapardı;
    // oluşturulma tarihi ve audit izi kaybolurdu.
    const result = await updateDebtCredit(tenantId, id, actorId, { status: "OPEN" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.debtCredit.status).toBe("OPEN");
  });

  test("durum değişimi kaydın DİĞER alanlarına dokunmuyor", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const id = await seedRecord(tenantId, actorId, {
      counterparty: "Dokunulmaz",
      amount: "777.25",
      dueDate: "2026-05-05",
    });

    const result = await updateDebtCredit(tenantId, id, actorId, { status: "SETTLED" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.debtCredit.counterparty).toBe("Dokunulmaz");
    expect(result.debtCredit.amount).toBe("777.25");
    expect(result.debtCredit.dueDate?.toISOString()).toBe("2026-05-05T00:00:00.000Z");
  });
});

test.describe("updateDebtCredit() — alanlar", () => {
  test("yalnızca gönderilen alanlar değişiyor", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const id = await seedRecord(tenantId, actorId, {
      type: "DEBT",
      counterparty: "Eski Ad",
      amount: "100",
      currency: "TRY",
    });

    const result = await updateDebtCredit(tenantId, id, actorId, { counterparty: "Yeni Ad" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.debtCredit.counterparty).toBe("Yeni Ad");
    expect(result.debtCredit.type).toBe("DEBT");
    expect(result.debtCredit.amount).toBe("100");
    expect(result.debtCredit.currency).toBe("TRY");
  });

  test("vade null ile TEMİZLENEBİLİYOR", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const id = await seedRecord(tenantId, actorId, { dueDate: "2026-05-05" });

    const result = await updateDebtCredit(tenantId, id, actorId, { dueDate: null });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.debtCredit.dueDate).toBeNull();
  });

  test("hiçbir alan gönderilmezse 400", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const id = await seedRecord(tenantId, actorId);

    const result = await updateDebtCredit(tenantId, id, actorId, {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  test("geçersiz değer 400 alır ve kayıt DEĞİŞMEZ", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const id = await seedRecord(tenantId, actorId, { amount: "100" });

    for (const patch of [{ amount: "-5" }, { amount: 5 }, { currency: "TR" }, { type: "LOAN" }]) {
      const result = await updateDebtCredit(tenantId, id, actorId, patch);
      expect(result.ok, `beklenen 400: ${JSON.stringify(patch)}`).toBe(false);
    }

    const row = await prisma.debtCredit.findUniqueOrThrow({ where: { id } });
    expect(row.amount.toString()).toBe("100");
    expect(row.currency).toBe("TRY");
    expect(row.type).toBe("DEBT");
  });

  test("başka tenant'ın kaydı güncellenemiyor (404) ve veri DEĞİŞMİYOR", async () => {
    const actorId = await seedActor();
    const mine = await seedTenant();
    const theirs = await seedTenant();
    const theirId = await seedRecord(theirs, actorId, { counterparty: "Komsu", amount: "500" });

    const result = await updateDebtCredit(mine, theirId, actorId, { amount: "1" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);

    const row = await prisma.debtCredit.findUniqueOrThrow({ where: { id: theirId } });
    expect(row.amount.toString()).toBe("500");
  });

  test("var olmayan id ile cross-tenant id AYNI yanıtı veriyor (enumeration engeli)", async () => {
    const actorId = await seedActor();
    const mine = await seedTenant();
    const theirs = await seedTenant();
    const theirId = await seedRecord(theirs, actorId);

    const missing = await updateDebtCredit(mine, `dc_${randomUUID()}`, actorId, { amount: "1" });
    const foreign = await updateDebtCredit(mine, theirId, actorId, { amount: "1" });

    expect(missing.ok).toBe(false);
    expect(foreign.ok).toBe(false);
    if (missing.ok || foreign.ok) return;
    expect(missing.status).toBe(foreign.status);
    expect(missing.error).toBe(foreign.error);
  });
});

test.describe("deleteDebtCredit()", () => {
  test("kendi tenant'ının kaydı siliniyor ve audit log yazılıyor", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const id = await seedRecord(tenantId, actorId);

    const result = await deleteDebtCredit(tenantId, id, actorId);

    expect(result.ok).toBe(true);
    expect(await prisma.debtCredit.count({ where: { id } })).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { tenantId, action: "DEBT_CREDIT_DELETED", targetId: id },
      }),
    ).toBe(1);
  });

  test("başka tenant'ın kaydı silinemiyor (404) ve kayıt DURUYOR", async () => {
    const actorId = await seedActor();
    const mine = await seedTenant();
    const theirs = await seedTenant();
    const theirId = await seedRecord(theirs, actorId);

    const result = await deleteDebtCredit(mine, theirId, actorId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
    expect(await prisma.debtCredit.count({ where: { id: theirId } })).toBe(1);
  });

  test("tenant silinince kayıtları da gidiyor (cascade)", async () => {
    const actorId = await seedActor();
    const tenantId = await seedTenant();
    await seedRecord(tenantId, actorId);

    await prisma.tenant.delete({ where: { id: tenantId } });

    expect(await prisma.debtCredit.count({ where: { tenantId } })).toBe(0);
  });
});
