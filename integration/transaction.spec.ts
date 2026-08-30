import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { prisma } from "../src/lib/prisma";
import {
  createTransaction,
  deleteTransaction,
  listTransactions,
  TRANSACTIONS_PAGE_SIZE,
  updateTransaction,
  type TransactionFilters,
  type TransactionView,
} from "../src/lib/finance/transaction";
import {
  encodeTransactionCursor,
  parseTransactionCursor,
} from "../src/lib/finance/transaction-cursor";

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

/**
 * Yalnızca satırlarla ilgilenen testler için kısayol (Issue #135).
 *
 * `listTransactions()` sayfalama eklendikten sonra `{ transactions, nextCursor }` döner.
 * Filtre ve sıralama testlerinin konusu imleç DEĞİLDİR; her birinde `.transactions` yazmak
 * onları imleç sözleşmesine gereksizce bağlardı. Sayfalamanın kendisi aşağıdaki ayrı
 * describe'da, TAM dönüş değeriyle test edilir.
 */
async function listRows(
  tenantId: string,
  filters?: TransactionFilters,
): Promise<TransactionView[]> {
  return (await listTransactions(tenantId, filters)).transactions;
}

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

    const listA = await listRows(tenantA);
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

    const list = await listRows(tenantId);
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

    const [transaction] = await listRows(tenantId);
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
    expect(await listRows(tenantId)).toHaveLength(3);
  });

  test("from: verilen günden İTİBAREN", async () => {
    const { tenantId } = await seed();

    const rows = await listRows(tenantId, { from: new Date("2026-02-20T00:00:00Z") });
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

    const rows = await listRows(tenantId, { to: new Date("2026-03-15T00:00:00Z") });

    expect(descriptions(rows)).toEqual(["Sinirdaki kayit"]);
  });

  test("from + to birlikte aralık kuruyor (iki uç da dahil)", async () => {
    const { tenantId } = await seed();

    const rows = await listRows(tenantId, {
      from: new Date("2026-01-10T00:00:00Z"),
      to: new Date("2026-02-20T00:00:00Z"),
    });

    expect(descriptions(rows).sort()).toEqual(["Ocak kirasi", "Subat maasi"]);
  });

  test("accountId: yalnızca o hesabın işlemleri", async () => {
    const { tenantId, accountB } = await seed();

    const rows = await listRows(tenantId, { accountId: accountB });
    expect(descriptions(rows)).toEqual(["Mart yakiti"]);
  });

  test("categoryId: yalnızca o kategorinin işlemleri", async () => {
    const { tenantId, maasId } = await seed();

    const rows = await listRows(tenantId, { categoryId: maasId });
    expect(descriptions(rows)).toEqual(["Subat maasi"]);
  });

  test("q: açıklamada geçen metin, büyük/küçük harf DUYARSIZ", async () => {
    const { tenantId } = await seed();

    expect(descriptions(await listRows(tenantId, { q: "kira" }))).toEqual(["Ocak kirasi"]);
    // Duyarsızlık kanıtı: aynı sonuç büyük harfle de gelmeli.
    expect(descriptions(await listRows(tenantId, { q: "KIRA" }))).toEqual(["Ocak kirasi"]);
  });

  test("q: eşleşme yoksa boş liste (tüm liste DEĞİL)", async () => {
    const { tenantId } = await seed();

    // Filtrenin sessizce yok sayılması hâlinde burada 3 satır dönerdi.
    expect(await listRows(tenantId, { q: "hicbiryerde-gecmeyen" })).toHaveLength(0);
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

    expect(await listRows(tenantId, { q: "herhangi" })).toHaveLength(0);
    expect(await listRows(tenantId)).toHaveLength(1);
  });

  test("filtreler BİRLİKTE daraltıyor (VE mantığı)", async () => {
    const { tenantId, accountA, marketId } = await seed();

    const rows = await listRows(tenantId, {
      accountId: accountA,
      categoryId: marketId,
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-01-31T00:00:00Z"),
      q: "kira",
    });
    expect(descriptions(rows)).toEqual(["Ocak kirasi"]);

    // Duyarlılık: tek bir kısıt bile eşleşmezse sonuç boşalır.
    expect(
      await listRows(tenantId, { accountId: accountA, categoryId: marketId, q: "maas" }),
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
      const rows = await listRows(tenantA, filters);
      expect(JSON.stringify(rows)).not.toContain(tenantB);
      expect(rows.every((row) => row.amount !== "99")).toBe(true);
    }

    expect(await listRows(tenantA, { accountId: foreignAccount })).toHaveLength(0);
  });

  test("filtrelenmiş sonuç da tarihe göre sıralı kalıyor", async () => {
    const { tenantId, accountA } = await seed();

    const rows = await listRows(tenantId, { accountId: accountA });
    expect(descriptions(rows)).toEqual(["Subat maasi", "Ocak kirasi"]);
  });
});

/**
 * Keyset sayfalama (Issue #135).
 *
 * Bu suite'in ana iddiası tek cümledir: liste kaç sayfada okunursa okunsun, HER KAYIT tam
 * olarak BİR KEZ görünür — araya yeni kayıt girse de, sıralama anahtarı eşit olsa da.
 *
 * Kayıtlar burada `createTransaction()` yerine DOĞRUDAN Prisma ile açılır: bu testlerin konusu
 * bakiye değil sıralama/pencere davranışıdır ve `occurredAt` ile `createdAt`in EŞİT olduğu
 * kenar durumu servis üzerinden kurulamaz (o `now()` yazar). Bakiye doğruluğu yukarıdaki
 * suite'lerin işidir.
 */
test.describe("listTransactions() — sayfalama (Issue #135)", () => {
  /**
   * `count` adet işlem açar. Varsayılan olarak her kaydın `occurredAt`i FARKLIDIR (gerçek
   * hayattaki normal durum); `sameKey` verilirse hepsi aynı `occurredAt` VE aynı `createdAt`
   * ile açılır — sıralamanın yalnızca `id` ile ayrıldığı en zor durum.
   */
  async function seedTransactions(
    tenantId: string,
    accountId: string,
    count: number,
    options: { sameKey?: boolean; label?: string } = {},
  ): Promise<void> {
    const label = options.label ?? "kayit";
    const fixed = new Date("2026-01-01T00:00:00.000Z");

    await prisma.transaction.createMany({
      data: Array.from({ length: count }, (_, index) => ({
        tenantId,
        accountId,
        type: "INCOME" as const,
        amount: "1",
        description: `${label}-${String(index).padStart(3, "0")}`,
        occurredAt: options.sameKey ? fixed : new Date(Date.UTC(2026, 0, 1 + index)),
        createdAt: options.sameKey ? fixed : new Date(Date.UTC(2026, 0, 1 + index)),
      })),
    });
  }

  /** Tüm sayfaları imleci izleyerek okur; sayfa sayısını da döndürür. */
  async function readAllPages(
    tenantId: string,
    filters: TransactionFilters = {},
  ): Promise<{ rows: TransactionView[]; pageCount: number }> {
    const rows: TransactionView[] = [];
    let after = parseTransactionCursor(null);
    let pageCount = 0;

    // Sonsuz döngü sigortası: bozuk bir imleç mantığı testi asmak yerine kırmızıya döndürmeli.
    while (pageCount < 50) {
      const page = await listTransactions(tenantId, filters, after);
      rows.push(...page.transactions);
      pageCount += 1;
      if (!page.nextCursor) {
        return { rows, pageCount };
      }
      after = parseTransactionCursor(page.nextCursor);
      expect(after).not.toBeNull();
    }

    throw new Error("Sayfalama bitmedi: imleç ilerlemiyor olabilir");
  }

  test("tek sayfaya sığan liste: nextCursor null (kontrol grubu)", async () => {
    const tenantId = await createTenant();
    const accountId = await createAccount(tenantId);
    await seedTransactions(tenantId, accountId, 3);

    const page = await listTransactions(tenantId);
    expect(page.transactions).toHaveLength(3);
    // Bu iddia duyarlılık kanıtıdır: aşağıdaki testlerin `nextCursor` beklentisi anlamlı
    // olsun diye, imlecin BOŞUNA üretilmediği önce burada gösterilir.
    expect(page.nextCursor).toBeNull();
  });

  test("sayfa boyutu aşılmıyor ve fazlası varsa nextCursor dönüyor", async () => {
    const tenantId = await createTenant();
    const accountId = await createAccount(tenantId);
    await seedTransactions(tenantId, accountId, TRANSACTIONS_PAGE_SIZE + 5);

    const page = await listTransactions(tenantId);
    expect(page.transactions).toHaveLength(TRANSACTIONS_PAGE_SIZE);
    expect(page.nextCursor).not.toBeNull();
  });

  test("tüm sayfalar okunduğunda HER kayıt tam olarak bir kez görünüyor", async () => {
    const tenantId = await createTenant();
    const accountId = await createAccount(tenantId);
    const total = TRANSACTIONS_PAGE_SIZE * 2 + 7;
    await seedTransactions(tenantId, accountId, total);

    const { rows, pageCount } = await readAllPages(tenantId);

    expect(rows).toHaveLength(total);
    expect(new Set(rows.map((row) => row.id)).size).toBe(total);
    // Sayfa sayısı da doğrulanır: tek bir sayfada dönmüş olsaydı yukarıdaki iki iddia da
    // geçerdi ve test sayfalamayı hiç sınamamış olurdu.
    expect(pageCount).toBe(3);
  });

  test("sayfalar arası sıralama korunuyor (birleşim tek bir azalan dizi)", async () => {
    const tenantId = await createTenant();
    const accountId = await createAccount(tenantId);
    await seedTransactions(tenantId, accountId, TRANSACTIONS_PAGE_SIZE + 10);

    const { rows } = await readAllPages(tenantId);

    for (let index = 1; index < rows.length; index += 1) {
      const previous = rows[index - 1];
      const current = rows[index];
      const isDescending =
        previous.occurredAt.getTime() > current.occurredAt.getTime() ||
        (previous.occurredAt.getTime() === current.occurredAt.getTime() &&
          (previous.createdAt.getTime() > current.createdAt.getTime() ||
            (previous.createdAt.getTime() === current.createdAt.getTime() &&
              previous.id > current.id)));
      expect(isDescending).toBe(true);
    }
  });

  test("ARAYA YENİ KAYIT girse bile satır atlanmıyor/tekrarlamıyor", async () => {
    const tenantId = await createTenant();
    const accountId = await createAccount(tenantId);
    await seedTransactions(tenantId, accountId, TRANSACTIONS_PAGE_SIZE + 5, { label: "eski" });

    const first = await listTransactions(tenantId);
    expect(first.nextCursor).not.toBeNull();

    // Yeni kayıt listenin BAŞINA düşer (en yeni `occurredAt`). Offset sayfalamada bu, ikinci
    // sayfanın tüm satırlarını bir kaydırır ve birinci sayfanın son satırı tekrar görünürdü.
    await prisma.transaction.create({
      data: {
        tenantId,
        accountId,
        type: "INCOME",
        amount: "1",
        description: "araya-giren",
        occurredAt: new Date(Date.UTC(2030, 0, 1)),
      },
    });

    const second = await listTransactions(
      tenantId,
      {},
      parseTransactionCursor(first.nextCursor),
    );

    const firstIds = new Set(first.transactions.map((row) => row.id));
    const overlap = second.transactions.filter((row) => firstIds.has(row.id));
    expect(overlap).toHaveLength(0);

    // Araya giren kayıt HİÇ görünmez: imlecin arkasında kalmıştır. Bu doğru davranıştır —
    // keyset sayfalama, okumaya başlanan andaki pencereyi izler.
    expect(second.transactions.map((row) => row.description)).not.toContain("araya-giren");

    // Ve asıl kanıt: iki sayfa birlikte, ekleme öncesi var olan TÜM kayıtları kapsar.
    const seen = [...first.transactions, ...second.transactions].filter(
      (row) => row.description !== "araya-giren",
    );
    expect(new Set(seen.map((row) => row.id)).size).toBe(TRANSACTIONS_PAGE_SIZE + 5);
  });

  test("occurredAt VE createdAt eşitken sıra id ile kesinleşiyor (atlama/tekrar yok)", async () => {
    const tenantId = await createTenant();
    const accountId = await createAccount(tenantId);
    const total = TRANSACTIONS_PAGE_SIZE + 3;
    await seedTransactions(tenantId, accountId, total, { sameKey: true });

    const { rows, pageCount } = await readAllPages(tenantId);

    // Anahtarın ilk iki alanı tüm kayıtlarda AYNI; sayfa sınırını yalnızca `id` ayırabilir.
    //
    // DUYARLILIK — ÖLÇÜLDÜ: keyset koşulundaki üçüncü `OR` dalı (`id: { lt: ... }`) silinip
    // bu test koşulduğunda KIRMIZIYA döner (sayfa 2 boş gelir, 53 yerine 50 kayıt okunur).
    // Yani test, sayfalamanın eşitlik durumundaki asıl mantığını gerçekten sınıyor.
    //
    // BU TESTİN SINAMADIĞI ŞEY, dürüstlük adına: `orderBy`dan `id` düşürüldüğünde test yeşil
    // KALIYOR — Postgres bu boyuttaki eşitlikleri kararlı bir sırayla döndürdüğü için. `id`
    // yine de `orderBy`da olmak ZORUNDADIR: ORDER BY kesin bir toplam sıra vermezse plan
    // değiştiğinde (index seçimi, paralel tarama, tablo büyümesi) eşitlerin sırası kayar ve
    // sayfa sınırındaki satır atlanır. Bu, testle değil ancak SQL semantiğiyle güvenceye
    // alınabilecek bir invariant'tır.
    expect(pageCount).toBe(2);
    expect(rows).toHaveLength(total);
    expect(new Set(rows.map((row) => row.id)).size).toBe(total);
  });

  test("FİLTRE ile birlikte sayfalanıyor: filtre her sayfada geçerli kalıyor", async () => {
    const tenantId = await createTenant();
    const accountA = await createAccount(tenantId);
    const accountB = await createAccount(tenantId);
    await seedTransactions(tenantId, accountA, TRANSACTIONS_PAGE_SIZE + 4, { label: "a" });
    await seedTransactions(tenantId, accountB, TRANSACTIONS_PAGE_SIZE + 4, { label: "b" });

    const { rows } = await readAllPages(tenantId, { accountId: accountA });

    expect(rows).toHaveLength(TRANSACTIONS_PAGE_SIZE + 4);
    // Filtrenin imleçle birlikte DÜŞMEDİĞİ kanıtı: tek bir B kaydı bile sızmamalı.
    expect(rows.every((row) => row.accountId === accountA)).toBe(true);
  });

  test("TENANT İZOLASYONU sayfalamada da korunuyor: yabancı imleç veri açmıyor", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const accountA = await createAccount(tenantA);
    const accountB = await createAccount(tenantB);
    await seedTransactions(tenantA, accountA, 3, { label: "a" });
    await seedTransactions(tenantB, accountB, TRANSACTIONS_PAGE_SIZE + 5, { label: "b" });

    // B'nin ilk sayfasından alınan imleç, A'nın listesinde kullanılıyor.
    const pageB = await listTransactions(tenantB);
    expect(pageB.nextCursor).not.toBeNull();

    const leaked = await listTransactions(tenantA, {}, parseTransactionCursor(pageB.nextCursor));

    // İmleç scope'a DOKUNMAZ: yalnızca pencereyi daraltır. B'nin hiçbir satırı görünmez.
    expect(leaked.transactions.every((row) => row.accountId === accountA)).toBe(true);
    expect(JSON.stringify(leaked.transactions)).not.toContain(tenantB);
  });

  test("elle üretilmiş imleç yalnızca pencereyi kaydırır, scope'u değiştirmez", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const accountA = await createAccount(tenantA);
    const accountB = await createAccount(tenantB);
    await seedTransactions(tenantA, accountA, 5, { label: "a" });
    await seedTransactions(tenantB, accountB, 5, { label: "b" });

    const [foreign] = (await listTransactions(tenantB)).transactions;

    // B'nin GERÇEK bir satırından imleç kurulup A'ya veriliyor — kurcalamanın en güçlü hâli.
    const forged = encodeTransactionCursor({
      occurredAt: foreign.occurredAt,
      createdAt: foreign.createdAt,
      id: foreign.id,
    });

    const page = await listTransactions(tenantA, {}, parseTransactionCursor(forged));
    expect(page.transactions.every((row) => row.accountId === accountA)).toBe(true);
  });

  test("imleç çift yönlü: kodlanan değer aynen geri çözülüyor", async () => {
    const tenantId = await createTenant();
    const accountId = await createAccount(tenantId);
    await seedTransactions(tenantId, accountId, 1);

    const [row] = (await listTransactions(tenantId)).transactions;
    const decoded = parseTransactionCursor(
      encodeTransactionCursor({
        occurredAt: row.occurredAt,
        createdAt: row.createdAt,
        id: row.id,
      }),
    );

    expect(decoded).not.toBeNull();
    expect(decoded?.id).toBe(row.id);
    expect(decoded?.occurredAt.toISOString()).toBe(row.occurredAt.toISOString());
    expect(decoded?.createdAt.toISOString()).toBe(row.createdAt.toISOString());
  });

  test("bozuk imleç null döner (sessizce ilk sayfaya DÜŞMEZ)", async () => {
    const encode = (raw: string): string => Buffer.from(raw, "utf8").toString("base64url");

    for (const broken of [
      "",
      "not-base64!!",
      // Alan sayısı eksik.
      encode("2026-01-01T00:00:00.000Z|abc123"),
      // Tarih takvimde yok — `new Date()` bunu sessizce kaydırırdı, çift yönlü kontrol yakalar.
      encode("2026-13-45T00:00:00.000Z|2026-01-01T00:00:00.000Z|abc123"),
      // Kanonik olmayan biçim: aynı anı gösterir ama geri yazıldığında birebir eşleşmez.
      encode("2026-01-01T00:00:00Z|2026-01-01T00:00:00.000Z|abc123"),
      // Geçerli tarihler ama id boş.
      encode("2026-01-01T00:00:00.000Z|2026-01-01T00:00:00.000Z|"),
    ]) {
      expect(parseTransactionCursor(broken)).toBeNull();
    }

    // Duyarlılık: aynı biçimde ama GEÇERLİ bir imleç kabul edilmeli, yoksa yukarıdaki
    // beklentiler "her şeyi reddeden" bir fonksiyonla da geçerdi.
    expect(
      parseTransactionCursor(encode("2026-01-01T00:00:00.000Z|2026-01-02T00:00:00.000Z|abc123")),
    ).not.toBeNull();
  });
});
