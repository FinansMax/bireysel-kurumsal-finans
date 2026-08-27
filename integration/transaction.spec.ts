import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { prisma } from "../src/lib/prisma";
import {
  createTransaction,
  deleteTransaction,
  listTransactions,
  updateTransaction,
} from "../src/lib/finance/transaction";

/**
 * `Transaction` iş kuralları — gerçek DB'ye karşı, HTTP olmadan (Issue #53).
 *
 * Yetkilendirme burada test EDİLMEZ: servis fonksiyonları authorization kararı vermez, o iş
 * route'lardaki `requirePermission()`'ındır (bkz. `security/transaction-security.spec.ts`).
 * Buradaki konu: doğrulama, BAKİYE DOĞRULUĞU, hesap/kategori bağlarının tenant içinde
 * çözülmesi, atomiklik ve eşzamanlılık davranışı.
 *
 * Bu suite'in ana iddiası tek cümledir: `Account.balance`, o hesabın işlemlerinin toplamına
 * HER ZAMAN eşit kalır — oluşturma, güncelleme, silme ve başarısız denemelerden sonra da.
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
    data: { name: "Islem Testi", slug: `tx-${randomUUID()}` },
    select: { id: true },
  });
  createdTenantIds.push(tenant.id);
  return tenant.id;
}

async function createActor(): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `tx-actor-${randomUUID()}@example.com` },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  return user.id;
}

async function createAccount(tenantId: string, balance = "0"): Promise<string> {
  const account = await prisma.account.create({
    data: { tenantId, name: `Hesap ${randomUUID()}`, type: "CASH", currency: "TRY", balance },
    select: { id: true },
  });
  return account.id;
}

async function createCategory(tenantId: string, type: "INCOME" | "EXPENSE"): Promise<string> {
  const category = await prisma.category.create({
    data: { tenantId, name: `Kategori ${randomUUID()}`, type },
    select: { id: true },
  });
  return category.id;
}

/**
 * Bakiyeyi sabit ölçekli metin olarak okur.
 *
 * `toFixed(4)` BİLEREK: `Decimal.toString()` ölçeği duruma göre farklı basabilir ("-100" ile
 * "-100.0000"), o zaman testin kırmızıya dönmesi gerçek bir hatadan değil biçimden gelirdi.
 */
async function balanceOf(accountId: string): Promise<string> {
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: accountId },
    select: { balance: true },
  });
  return account.balance.toFixed(4);
}

test.describe("createTransaction() — mutlu yol ve bakiye etkisi", () => {
  test("gider işlemi bakiyeyi AZALTIR ve kayıt tenant'a bağlanır", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId, "1000");

    const result = await createTransaction(tenantId, actorId, {
      accountId,
      type: "EXPENSE",
      amount: "250.75",
      description: "Ocak kirasi",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.transaction.amount).toBe("250.75");
    expect(result.transaction.type).toBe("EXPENSE");
    expect(await balanceOf(accountId)).toBe("749.2500");

    const row = await prisma.transaction.findUniqueOrThrow({
      where: { id: result.transaction.id },
    });
    expect(row.tenantId).toBe(tenantId);
  });

  test("gelir işlemi bakiyeyi ARTIRIR", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId, "1000");

    const result = await createTransaction(tenantId, actorId, {
      accountId,
      type: "INCOME",
      amount: "0.0001",
    });

    expect(result.ok).toBe(true);
    // En küçük ölçek (4 basamak) korunuyor mu: `number`a düşen bir dönüşüm burada kaybolurdu.
    expect(await balanceOf(accountId)).toBe("1000.0001");
  });

  test("art arda işlemler birikimli uygulanır", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId);

    await createTransaction(tenantId, actorId, { accountId, type: "INCOME", amount: "100.10" });
    await createTransaction(tenantId, actorId, { accountId, type: "EXPENSE", amount: "30.05" });
    await createTransaction(tenantId, actorId, { accountId, type: "EXPENSE", amount: "0.05" });

    expect(await balanceOf(accountId)).toBe("70.0000");
  });

  test("uyumlu kategori bağlanabiliyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId);
    const categoryId = await createCategory(tenantId, "EXPENSE");

    const result = await createTransaction(tenantId, actorId, {
      accountId,
      categoryId,
      type: "EXPENSE",
      amount: "10",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transaction.categoryId).toBe(categoryId);
  });

  test("kategori opsiyoneldir; verilmezse kayıt kategorisiz oluşur", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId);

    const result = await createTransaction(tenantId, actorId, {
      accountId,
      type: "INCOME",
      amount: "5",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transaction.categoryId).toBeNull();
  });

  test("boş/boşluk-only açıklama null'a indirgenir, dolu açıklama kırpılır", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId);

    const blank = await createTransaction(tenantId, actorId, {
      accountId,
      type: "INCOME",
      amount: "1",
      description: "   ",
    });
    expect(blank.ok).toBe(true);
    if (!blank.ok) return;
    expect(blank.transaction.description).toBeNull();

    const filled = await createTransaction(tenantId, actorId, {
      accountId,
      type: "INCOME",
      amount: "1",
      description: "  Not  ",
    });
    expect(filled.ok).toBe(true);
    if (!filled.ok) return;
    expect(filled.transaction.description).toBe("Not");
  });

  test("occurredAt gönderilmezse 'şimdi' varsayılır", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId);

    const before = Date.now();
    const result = await createTransaction(tenantId, actorId, {
      accountId,
      type: "INCOME",
      amount: "1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const occurred = result.transaction.occurredAt.getTime();
    // Saat dilimi kaymasını değil, yalnızca "makul bir şimdi" olduğunu iddia ediyoruz.
    expect(occurred).toBeGreaterThanOrEqual(before - 60_000);
    expect(occurred).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  test("occurredAt verilirse aynen kaydedilir (createdAt'ten AYRI alan)", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId);

    const result = await createTransaction(tenantId, actorId, {
      accountId,
      type: "EXPENSE",
      amount: "1",
      occurredAt: "2020-03-15T10:30:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transaction.occurredAt.toISOString()).toBe("2020-03-15T10:30:00.000Z");
    // Geçmişe dönük kayıt: `createdAt` bugündür, `occurredAt` 2020.
    expect(result.transaction.createdAt.getTime()).toBeGreaterThan(
      result.transaction.occurredAt.getTime(),
    );
  });

  test("başarılı oluşturma audit log satırı yazıyor (tutar TAŞIMADAN)", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId);

    const result = await createTransaction(tenantId, actorId, {
      accountId,
      type: "EXPENSE",
      amount: "123.45",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const log = await prisma.auditLog.findFirst({
      where: { tenantId, action: "TRANSACTION_CREATED", targetId: result.transaction.id },
    });
    expect(log).not.toBeNull();
    expect(log?.actorUserId).toBe(actorId);
    // Audit log finansal tutarların ikinci bir kopyası DEĞİLDİR (account.ts ile aynı karar).
    expect(JSON.stringify(log?.metadata)).not.toContain("123.45");
    expect(log?.metadata).toEqual({ type: "EXPENSE", accountId });
  });
});

test.describe("createTransaction() — doğrulama", () => {
  const invalidCases: Array<{ label: string; input: Record<string, unknown> }> = [
    { label: "tutar negatif", input: { amount: "-10" } },
    { label: "tutar sıfır", input: { amount: "0" } },
    { label: "tutar sıfır (ondalıklı)", input: { amount: "0.0000" } },
    { label: "tutar number (string olmalı)", input: { amount: 10 } },
    { label: "tutar 4'ten fazla ondalık", input: { amount: "1.23456" } },
    { label: "tutar yerelleştirilmiş biçim", input: { amount: "1.234,56" } },
    { label: "tutar eksik", input: { amount: undefined } },
    { label: "tür geçersiz", input: { type: "TRANSFER" } },
    { label: "tür küçük harf", input: { type: "expense" } },
    { label: "tür eksik", input: { type: undefined } },
    { label: "accountId eksik", input: { accountId: undefined } },
    { label: "accountId string değil", input: { accountId: 42 } },
    { label: "açıklama çok uzun", input: { description: "A".repeat(501) } },
    { label: "açıklama string değil", input: { description: 42 } },
    { label: "occurredAt geçersiz metin", input: { occurredAt: "dun" } },
    { label: "occurredAt yerelleştirilmiş biçim", input: { occurredAt: "15.03.2020" } },
    // JavaScript "2026-02-31"i hataya çevirmez, sessizce 3 Mart'a TAŞIR — bu yüzden takvim
    // kontrolü elle yapılır (bkz. `isRealCalendarDate()`).
    { label: "occurredAt takvimde olmayan gün", input: { occurredAt: "2026-02-31" } },
    { label: "occurredAt geçersiz ay", input: { occurredAt: "2026-13-01" } },
    { label: "occurredAt yalnızca yıl", input: { occurredAt: "2026" } },
    { label: "categoryId string değil", input: { categoryId: 7 } },
  ];

  for (const { label, input } of invalidCases) {
    test(`${label} → 400, kayıt oluşmuyor ve BAKİYE DEĞİŞMİYOR`, async () => {
      const tenantId = await createTenant();
      const actorId = await createActor();
      const accountId = await createAccount(tenantId, "500");

      const result = await createTransaction(tenantId, actorId, {
        accountId,
        type: "EXPENSE",
        amount: "10",
        ...input,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);

      expect(await prisma.transaction.count({ where: { tenantId } })).toBe(0);
      expect(await balanceOf(accountId)).toBe("500.0000");
    });
  }

  test("duyarlılık kanıtı: aynı girdi geçerli hâliyle 201 üretiyor", async () => {
    // Yukarıdaki 400'ler girdinin KENDİSİNDEN geliyor olmalı, kurulumun bozukluğundan değil.
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId, "500");

    const result = await createTransaction(tenantId, actorId, {
      accountId,
      type: "EXPENSE",
      amount: "10",
    });

    expect(result.ok).toBe(true);
    expect(await balanceOf(accountId)).toBe("490.0000");
  });

  test("büyük tutarın 4 ondalık hassasiyeti kayan noktaya düşmüyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId, "0");

    // `number` üzerinden geçen bir dönüşüm bu değeri yuvarlardı (invariant #10).
    await createTransaction(tenantId, actorId, {
      accountId,
      type: "INCOME",
      amount: "99999999999.9999",
    });

    expect(await balanceOf(accountId)).toBe("99999999999.9999");
  });
});

test.describe("createTransaction() — hesap ve kategori bağları tenant içinde çözülür", () => {
  test("BAŞKA tenant'ın hesabı 404 — kayıt oluşmuyor, o hesabın bakiyesi değişmiyor", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const actorId = await createActor();
    const foreignAccountId = await createAccount(tenantB, "1000");

    const result = await createTransaction(tenantA, actorId, {
      accountId: foreignAccountId,
      type: "EXPENSE",
      amount: "100",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);

    expect(await prisma.transaction.count({ where: { tenantId: tenantA } })).toBe(0);
    expect(await balanceOf(foreignAccountId)).toBe("1000.0000");
  });

  test("var olmayan hesap ile cross-tenant hesap AYNI yanıtı veriyor (enumeration engeli)", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const actorId = await createActor();
    const foreignAccountId = await createAccount(tenantB);

    const crossTenant = await createTransaction(tenantA, actorId, {
      accountId: foreignAccountId,
      type: "INCOME",
      amount: "1",
    });
    const nonExistent = await createTransaction(tenantA, actorId, {
      accountId: `acc-${randomUUID()}`,
      type: "INCOME",
      amount: "1",
    });

    expect(crossTenant).toEqual(nonExistent);
  });

  test("BAŞKA tenant'ın kategorisi 404 — kayıt oluşmuyor, bakiye değişmiyor", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantA, "300");
    const foreignCategoryId = await createCategory(tenantB, "EXPENSE");

    const result = await createTransaction(tenantA, actorId, {
      accountId,
      categoryId: foreignCategoryId,
      type: "EXPENSE",
      amount: "100",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);

    expect(await prisma.transaction.count({ where: { tenantId: tenantA } })).toBe(0);
    expect(await balanceOf(accountId)).toBe("300.0000");
  });

  test("gider işlemine GELİR kategorisi bağlanamaz (400) — atomiklik korunur", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId, "300");
    const incomeCategoryId = await createCategory(tenantId, "INCOME");

    const result = await createTransaction(tenantId, actorId, {
      accountId,
      categoryId: incomeCategoryId,
      type: "EXPENSE",
      amount: "100",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // "Yok" değil "yanlış tür": kategori çağıranın kendi tenant'ındadır, bilgi sızmaz.
    expect(result.status).toBe(400);

    // Kritik: kayıt da bakiye de hiç dokunulmamış olmalı (tek transaction, kısmi yazma yok).
    expect(await prisma.transaction.count({ where: { tenantId } })).toBe(0);
    expect(await balanceOf(accountId)).toBe("300.0000");
  });

  test("gelir işlemine gelir kategorisi bağlanabilir (duyarlılık kanıtı)", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId);
    const incomeCategoryId = await createCategory(tenantId, "INCOME");

    const result = await createTransaction(tenantId, actorId, {
      accountId,
      categoryId: incomeCategoryId,
      type: "INCOME",
      amount: "100",
    });

    expect(result.ok).toBe(true);
  });
});

test.describe("listTransactions()", () => {
  test("yalnızca kendi tenant'ının işlemleri dönüyor", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const actorId = await createActor();
    const accountA = await createAccount(tenantA);
    const accountB = await createAccount(tenantB);

    await createTransaction(tenantA, actorId, {
      accountId: accountA,
      type: "INCOME",
      amount: "1",
      description: "A islemi",
    });
    await createTransaction(tenantB, actorId, {
      accountId: accountB,
      type: "INCOME",
      amount: "2",
      description: "B islemi",
    });

    const listA = await listTransactions(tenantA);
    expect(listA).toHaveLength(1);
    expect(listA[0].description).toBe("A islemi");
    expect(JSON.stringify(listA)).not.toContain("B islemi");
  });

  test("sıralama: gerçekleşme tarihi yeniden eskiye", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId);

    await createTransaction(tenantId, actorId, {
      accountId,
      type: "INCOME",
      amount: "1",
      description: "orta",
      occurredAt: "2024-06-15",
    });
    await createTransaction(tenantId, actorId, {
      accountId,
      type: "INCOME",
      amount: "1",
      description: "en eski",
      occurredAt: "2020-01-01",
    });
    await createTransaction(tenantId, actorId, {
      accountId,
      type: "INCOME",
      amount: "1",
      description: "en yeni",
      occurredAt: "2025-12-31",
    });

    const list = await listTransactions(tenantId);
    expect(list.map((transaction) => transaction.description)).toEqual([
      "en yeni",
      "orta",
      "en eski",
    ]);
  });

  test("tutarlar string olarak dönüyor (JSON sözleşmesi)", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId);

    await createTransaction(tenantId, actorId, { accountId, type: "INCOME", amount: "12.5" });

    const [transaction] = await listTransactions(tenantId);
    expect(typeof transaction.amount).toBe("string");
  });
});

test.describe("updateTransaction() — bakiye düzeltmesi", () => {
  test("tutar değişimi bakiyeye yalnızca FARKI uyguluyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId, "1000");

    const created = await createTransaction(tenantId, actorId, {
      accountId,
      type: "EXPENSE",
      amount: "100",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(await balanceOf(accountId)).toBe("900.0000");

    const result = await updateTransaction(tenantId, created.transaction.id, actorId, {
      amount: "250",
    });

    expect(result.ok).toBe(true);
    // 1000 - 250 = 750; "eski etkiyi geri al, yenisini uygula" doğru çalışmalı.
    expect(await balanceOf(accountId)).toBe("750.0000");
  });

  test("tür değişimi (gider → gelir) bakiyeyi iki kat kaydırıyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId, "1000");

    const created = await createTransaction(tenantId, actorId, {
      accountId,
      type: "EXPENSE",
      amount: "100",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await updateTransaction(tenantId, created.transaction.id, actorId, { type: "INCOME" });

    // 900 (gider uygulanmış) → geri al (+100) → gelir uygula (+100) = 1100.
    expect(await balanceOf(accountId)).toBe("1100.0000");
  });

  test("hesap değişimi etkiyi eski hesaptan alıp yenisine taşıyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const sourceId = await createAccount(tenantId, "1000");
    const targetId = await createAccount(tenantId, "1000");

    const created = await createTransaction(tenantId, actorId, {
      accountId: sourceId,
      type: "EXPENSE",
      amount: "300",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(await balanceOf(sourceId)).toBe("700.0000");

    const result = await updateTransaction(tenantId, created.transaction.id, actorId, {
      accountId: targetId,
    });

    expect(result.ok).toBe(true);
    expect(await balanceOf(sourceId)).toBe("1000.0000");
    expect(await balanceOf(targetId)).toBe("700.0000");
  });

  test("tutar VE hesap birlikte değişebiliyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const sourceId = await createAccount(tenantId, "1000");
    const targetId = await createAccount(tenantId, "0");

    const created = await createTransaction(tenantId, actorId, {
      accountId: sourceId,
      type: "INCOME",
      amount: "50",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await updateTransaction(tenantId, created.transaction.id, actorId, {
      accountId: targetId,
      amount: "75",
    });

    expect(await balanceOf(sourceId)).toBe("1000.0000");
    expect(await balanceOf(targetId)).toBe("75.0000");
  });

  test("yalnızca açıklama değişirse bakiye HİÇ değişmiyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId, "1000");

    const created = await createTransaction(tenantId, actorId, {
      accountId,
      type: "EXPENSE",
      amount: "100",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await updateTransaction(tenantId, created.transaction.id, actorId, { description: "Yeni not" });

    expect(await balanceOf(accountId)).toBe("900.0000");
  });
});

test.describe("updateTransaction() — doğrulama ve tenant scope'u", () => {
  test("tür değişimi mevcut kategoriyi yanlış tarafta bırakıyorsa 400 ve HİÇBİR ŞEY değişmiyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId, "1000");
    const expenseCategoryId = await createCategory(tenantId, "EXPENSE");

    const created = await createTransaction(tenantId, actorId, {
      accountId,
      categoryId: expenseCategoryId,
      type: "EXPENSE",
      amount: "100",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await updateTransaction(tenantId, created.transaction.id, actorId, {
      type: "INCOME",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);

    // Kayıt ve bakiye rollback edilmiş olmalı.
    const row = await prisma.transaction.findUniqueOrThrow({
      where: { id: created.transaction.id },
    });
    expect(row.type).toBe("EXPENSE");
    expect(await balanceOf(accountId)).toBe("900.0000");
  });

  test("tür ile kategori BİRLİKTE değiştirilirse güncelleme geçiyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId, "1000");
    const expenseCategoryId = await createCategory(tenantId, "EXPENSE");
    const incomeCategoryId = await createCategory(tenantId, "INCOME");

    const created = await createTransaction(tenantId, actorId, {
      accountId,
      categoryId: expenseCategoryId,
      type: "EXPENSE",
      amount: "100",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await updateTransaction(tenantId, created.transaction.id, actorId, {
      type: "INCOME",
      categoryId: incomeCategoryId,
    });

    expect(result.ok).toBe(true);
    expect(await balanceOf(accountId)).toBe("1100.0000");
  });

  test("categoryId: null kategoriyi kaldırıyor (tür değişimini de serbest bırakır)", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId);
    const expenseCategoryId = await createCategory(tenantId, "EXPENSE");

    const created = await createTransaction(tenantId, actorId, {
      accountId,
      categoryId: expenseCategoryId,
      type: "EXPENSE",
      amount: "10",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await updateTransaction(tenantId, created.transaction.id, actorId, {
      type: "INCOME",
      categoryId: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transaction.categoryId).toBeNull();
  });

  test("BAŞKA tenant'ın hesabına taşınamıyor (404) ve hiçbir bakiye değişmiyor", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const actorId = await createActor();
    const ownAccountId = await createAccount(tenantA, "1000");
    const foreignAccountId = await createAccount(tenantB, "1000");

    const created = await createTransaction(tenantA, actorId, {
      accountId: ownAccountId,
      type: "EXPENSE",
      amount: "100",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await updateTransaction(tenantA, created.transaction.id, actorId, {
      accountId: foreignAccountId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);

    expect(await balanceOf(ownAccountId)).toBe("900.0000");
    expect(await balanceOf(foreignAccountId)).toBe("1000.0000");
  });

  test("başka tenant'ın işlemi güncellenemiyor (404) ve veri DEĞİŞMİYOR", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const actorId = await createActor();
    const foreignAccountId = await createAccount(tenantB, "1000");

    const foreign = await createTransaction(tenantB, actorId, {
      accountId: foreignAccountId,
      type: "EXPENSE",
      amount: "100",
      description: "B islemi",
    });
    expect(foreign.ok).toBe(true);
    if (!foreign.ok) return;

    const result = await updateTransaction(tenantA, foreign.transaction.id, actorId, {
      amount: "999",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);

    const row = await prisma.transaction.findUniqueOrThrow({
      where: { id: foreign.transaction.id },
    });
    expect(row.amount.toFixed(4)).toBe("100.0000");
    expect(await balanceOf(foreignAccountId)).toBe("900.0000");
  });

  test("var olmayan id ile cross-tenant id AYNI yanıtı veriyor (enumeration engeli)", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const actorId = await createActor();
    const foreignAccountId = await createAccount(tenantB);

    const foreign = await createTransaction(tenantB, actorId, {
      accountId: foreignAccountId,
      type: "INCOME",
      amount: "1",
    });
    expect(foreign.ok).toBe(true);
    if (!foreign.ok) return;

    const crossTenant = await updateTransaction(tenantA, foreign.transaction.id, actorId, {
      amount: "2",
    });
    const nonExistent = await updateTransaction(tenantA, `tx-${randomUUID()}`, actorId, {
      amount: "2",
    });

    expect(crossTenant).toEqual(nonExistent);
  });

  test("hiçbir alan gönderilmezse 400", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId);

    const created = await createTransaction(tenantId, actorId, {
      accountId,
      type: "INCOME",
      amount: "1",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await updateTransaction(tenantId, created.transaction.id, actorId, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  test("geçersiz tutar 400 ve bakiye korunuyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId, "1000");

    const created = await createTransaction(tenantId, actorId, {
      accountId,
      type: "EXPENSE",
      amount: "100",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await updateTransaction(tenantId, created.transaction.id, actorId, {
      amount: "-5",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(await balanceOf(accountId)).toBe("900.0000");
  });

  test("başarılı güncelleme audit log satırı yazıyor (yalnızca değişen alan adlarıyla)", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId);

    const created = await createTransaction(tenantId, actorId, {
      accountId,
      type: "INCOME",
      amount: "1",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await updateTransaction(tenantId, created.transaction.id, actorId, { amount: "2" });

    const log = await prisma.auditLog.findFirst({
      where: { tenantId, action: "TRANSACTION_UPDATED", targetId: created.transaction.id },
    });
    expect(log).not.toBeNull();
    expect(log?.metadata).toEqual({ updatedFields: ["amount"] });
  });
});

test.describe("deleteTransaction()", () => {
  test("silme, işlemin bakiyeye etkisini geri alıyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId, "1000");

    const created = await createTransaction(tenantId, actorId, {
      accountId,
      type: "EXPENSE",
      amount: "250",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(await balanceOf(accountId)).toBe("750.0000");

    const result = await deleteTransaction(tenantId, created.transaction.id, actorId);

    expect(result.ok).toBe(true);
    expect(await balanceOf(accountId)).toBe("1000.0000");
    expect(await prisma.transaction.count({ where: { tenantId } })).toBe(0);

    const log = await prisma.auditLog.findFirst({
      where: { tenantId, action: "TRANSACTION_DELETED", targetId: created.transaction.id },
    });
    expect(log).not.toBeNull();
  });

  test("başka tenant'ın işlemi silinemiyor (404), kayıt ve bakiye DURUYOR", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const actorId = await createActor();
    const foreignAccountId = await createAccount(tenantB, "1000");

    const foreign = await createTransaction(tenantB, actorId, {
      accountId: foreignAccountId,
      type: "EXPENSE",
      amount: "100",
    });
    expect(foreign.ok).toBe(true);
    if (!foreign.ok) return;

    const result = await deleteTransaction(tenantA, foreign.transaction.id, actorId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);

    expect(await prisma.transaction.count({ where: { id: foreign.transaction.id } })).toBe(1);
    expect(await balanceOf(foreignAccountId)).toBe("900.0000");
  });

  test("tenant silinince işlemleri de gidiyor (cascade, hesap FK'sine RAĞMEN)", async () => {
    // Bu test şemadaki `onDelete: NoAction` kararının kanıtıdır: `RESTRICT` seçilseydi
    // tenant→account ve tenant→transaction cascade'leri aynı ifadede çalışırken kontrol
    // ertelenemez ve bu MEŞRU silme de hatayla kesilirdi (bkz. prisma/schema.prisma).
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId);

    await createTransaction(tenantId, actorId, { accountId, type: "INCOME", amount: "1" });

    await prisma.tenant.delete({ where: { id: tenantId } });

    expect(await prisma.transaction.count({ where: { tenantId } })).toBe(0);
    expect(await prisma.account.count({ where: { tenantId } })).toBe(0);
  });
});

test.describe("Eşzamanlılık — bakiye asla bozulmuyor", () => {
  test("eşzamanlı iki oluşturma, iki etkiyi de tam olarak uyguluyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId, "1000");

    // Bakiye `increment` ile atomik kaydırıldığı için "oku-topla-yaz" kaybı (lost update)
    // oluşamaz; iki etkinin ikisi de görünmelidir.
    await Promise.all([
      createTransaction(tenantId, actorId, { accountId, type: "EXPENSE", amount: "100" }),
      createTransaction(tenantId, actorId, { accountId, type: "EXPENSE", amount: "250" }),
    ]);

    expect(await balanceOf(accountId)).toBe("650.0000");
    expect(await prisma.transaction.count({ where: { tenantId } })).toBe(2);
  });

  test("eşzamanlı iki silme, bakiyeyi YALNIZCA BİR KEZ geri alıyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId, "1000");

    const created = await createTransaction(tenantId, actorId, {
      accountId,
      type: "EXPENSE",
      amount: "100",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // `deleteMany` + `count === 1` kapısı olmasaydı, ikinci silme de +100 uygular ve bakiye
    // 1100'e çıkardı.
    const [first, second] = await Promise.all([
      deleteTransaction(tenantId, created.transaction.id, actorId),
      deleteTransaction(tenantId, created.transaction.id, actorId),
    ]);

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect(await balanceOf(accountId)).toBe("1000.0000");
  });

  test("eşzamanlı iki güncelleme sonrası bakiye, işlemin SON tutarıyla tutarlı", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId, "0");

    const created = await createTransaction(tenantId, actorId, {
      accountId,
      type: "EXPENSE",
      amount: "100",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Güncelleme, eski tutarı OKUYUP farkını uygular; varsayılan izolasyonda birden fazla
    // istek aynı eski değeri okuyup her biri kendi farkını uygulayabilirdi (bkz.
    // `updateTransaction()` dokümantasyonu). `runSerializable()` kaybedeni yeniden dener.
    //
    // ALTI eşzamanlı istek BİLEREK: iki istekle okumalar pratikte iç içe geçmiyor ve test,
    // `Serializable` kaldırılsa bile yeşil kalıyordu — yani hiçbir şey kanıtlamıyordu.
    // (Aynı ölçüm `membership-concurrency.spec.ts`'te de yapılmıştı.)
    const amounts = ["200", "300", "400", "500", "600", "700"];
    const results = await Promise.all(
      amounts.map((amount) =>
        updateTransaction(tenantId, created.transaction.id, actorId, { amount }),
      ),
    );

    // Denemeler tükenirse 503 meşrudur; 500/sessiz bozulma değil.
    for (const result of results) {
      if (!result.ok) {
        expect(result.status).toBe(503);
      }
    }

    const row = await prisma.transaction.findUniqueOrThrow({
      where: { id: created.transaction.id },
      select: { amount: true },
    });

    // ASIL İDDİA: hangi güncelleme kazanırsa kazansın, bakiye son tutarın tam tersidir.
    expect(await balanceOf(accountId)).toBe(row.amount.negated().toFixed(4));
  });
});

test.describe("listTransactions() — filtreler (Issue #56)", () => {
  /** Tek tenant + tek hesap üzerinde, tarihleri ve açıklamaları bilinen bir veri kümesi. */
  async function seed() {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountA = await createAccount(tenantId);
    const accountB = await createAccount(tenantId);
    const marketId = await createCategory(tenantId, "EXPENSE");
    const maasId = await createCategory(tenantId, "INCOME");

    await createTransaction(tenantId, actorId, {
      accountId: accountA,
      categoryId: marketId,
      type: "EXPENSE",
      amount: "10",
      description: "Ocak kirasi",
      occurredAt: "2026-01-10",
    });
    await createTransaction(tenantId, actorId, {
      accountId: accountA,
      categoryId: maasId,
      type: "INCOME",
      amount: "20",
      description: "Subat maasi",
      occurredAt: "2026-02-20",
    });
    await createTransaction(tenantId, actorId, {
      accountId: accountB,
      type: "EXPENSE",
      amount: "30",
      description: "Mart yakiti",
      occurredAt: "2026-03-30",
    });

    return { tenantId, actorId, accountA, accountB, marketId, maasId };
  }

  function descriptions(rows: Array<{ description: string | null }>): string[] {
    return rows.map((row) => row.description ?? "");
  }

  test("filtresiz çağrı hepsini döndürüyor (diğer testlerin kontrol grubu)", async () => {
    const { tenantId } = await seed();
    expect(await listTransactions(tenantId)).toHaveLength(3);
  });

  test("from: verilen günden İTİBAREN", async () => {
    const { tenantId } = await seed();

    const rows = await listTransactions(tenantId, { from: new Date("2026-02-20T00:00:00Z") });
    expect(descriptions(rows).sort()).toEqual(["Mart yakiti", "Subat maasi"]);
  });

  test("to: verilen GÜNÜN SONUNA kadar — o gün saat 10:00'daki kayıt DAHİL", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId);

    // Bu testin varlık sebebi: `lte: 2026-03-15T00:00:00Z` yazılsaydı bu kayıt DIŞARIDA
    // kalırdı ve kullanıcının gördüğü listeyle filtre sonucu sessizce ayrışırdı.
    await createTransaction(tenantId, actorId, {
      accountId,
      type: "EXPENSE",
      amount: "1",
      description: "Sinirdaki kayit",
      occurredAt: "2026-03-15T10:00:00.000Z",
    });
    await createTransaction(tenantId, actorId, {
      accountId,
      type: "EXPENSE",
      amount: "1",
      description: "Ertesi gun",
      occurredAt: "2026-03-16T00:00:00.000Z",
    });

    const rows = await listTransactions(tenantId, { to: new Date("2026-03-15T00:00:00Z") });

    expect(descriptions(rows)).toEqual(["Sinirdaki kayit"]);
  });

  test("from + to birlikte aralık kuruyor (iki uç da dahil)", async () => {
    const { tenantId } = await seed();

    const rows = await listTransactions(tenantId, {
      from: new Date("2026-01-10T00:00:00Z"),
      to: new Date("2026-02-20T00:00:00Z"),
    });

    expect(descriptions(rows).sort()).toEqual(["Ocak kirasi", "Subat maasi"]);
  });

  test("accountId: yalnızca o hesabın işlemleri", async () => {
    const { tenantId, accountB } = await seed();

    const rows = await listTransactions(tenantId, { accountId: accountB });
    expect(descriptions(rows)).toEqual(["Mart yakiti"]);
  });

  test("categoryId: yalnızca o kategorinin işlemleri", async () => {
    const { tenantId, maasId } = await seed();

    const rows = await listTransactions(tenantId, { categoryId: maasId });
    expect(descriptions(rows)).toEqual(["Subat maasi"]);
  });

  test("q: açıklamada geçen metin, büyük/küçük harf DUYARSIZ", async () => {
    const { tenantId } = await seed();

    expect(descriptions(await listTransactions(tenantId, { q: "kira" }))).toEqual(["Ocak kirasi"]);
    // Duyarsızlık kanıtı: aynı sonuç büyük harfle de gelmeli.
    expect(descriptions(await listTransactions(tenantId, { q: "KIRA" }))).toEqual(["Ocak kirasi"]);
  });

  test("q: eşleşme yoksa boş liste (tüm liste DEĞİL)", async () => {
    const { tenantId } = await seed();

    // Filtrenin sessizce yok sayılması hâlinde burada 3 satır dönerdi.
    expect(await listTransactions(tenantId, { q: "hicbiryerde-gecmeyen" })).toHaveLength(0);
  });

  test("açıklaması null olan kayıt q filtresine takılmıyor (çökme de yok)", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId);

    await createTransaction(tenantId, actorId, {
      accountId,
      type: "EXPENSE",
      amount: "1",
    });

    expect(await listTransactions(tenantId, { q: "herhangi" })).toHaveLength(0);
    expect(await listTransactions(tenantId)).toHaveLength(1);
  });

  test("filtreler BİRLİKTE daraltıyor (VE mantığı)", async () => {
    const { tenantId, accountA, marketId } = await seed();

    const rows = await listTransactions(tenantId, {
      accountId: accountA,
      categoryId: marketId,
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-01-31T00:00:00Z"),
      q: "kira",
    });
    expect(descriptions(rows)).toEqual(["Ocak kirasi"]);

    // Duyarlılık: tek bir kısıt bile eşleşmezse sonuç boşalır.
    expect(
      await listTransactions(tenantId, { accountId: accountA, categoryId: marketId, q: "maas" }),
    ).toHaveLength(0);
  });

  test("HİÇBİR filtre tenant scope'unun yerine geçmiyor", async () => {
    const { tenantId: tenantA } = await seed();
    const tenantB = await createTenant();
    const actorId = await createActor();
    const foreignAccount = await createAccount(tenantB);
    const foreignCategory = await createCategory(tenantB, "EXPENSE");

    await createTransaction(tenantB, actorId, {
      accountId: foreignAccount,
      categoryId: foreignCategory,
      type: "EXPENSE",
      amount: "99",
      description: "Ocak kirasi",
      occurredAt: "2026-01-10",
    });

    // Yabancı tenant'ın kaydı, AYNI açıklama/tarihle bile A'nın sonuçlarına giremez.
    for (const filters of [
      { q: "Ocak kirasi" },
      { from: new Date("2026-01-01T00:00:00Z") },
      { to: new Date("2026-12-31T00:00:00Z") },
      // Yabancı id'ler: hata değil, yalnızca boş sonuç (arama zaten tenant içinde yapılır).
      { accountId: foreignAccount },
      { categoryId: foreignCategory },
    ]) {
      const rows = await listTransactions(tenantA, filters);
      expect(JSON.stringify(rows)).not.toContain(tenantB);
      expect(rows.every((row) => row.amount !== "99")).toBe(true);
    }

    expect(await listTransactions(tenantA, { accountId: foreignAccount })).toHaveLength(0);
  });

  test("filtrelenmiş sonuç da tarihe göre sıralı kalıyor", async () => {
    const { tenantId, accountA } = await seed();

    const rows = await listTransactions(tenantId, { accountId: accountA });
    expect(descriptions(rows)).toEqual(["Subat maasi", "Ocak kirasi"]);
  });
});
