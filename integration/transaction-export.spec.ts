import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { toCsv } from "../src/lib/export/csv";
import { createTransaction, listTransactionsForExport } from "../src/lib/finance/transaction";
import { prisma } from "../src/lib/prisma";

/**
 * `listTransactionsForExport()` — dışa aktarma sorgusu (Issue #81).
 *
 * Yetkilendirme ve HTTP katmanı burada test EDİLMEZ (bkz.
 * `security/transaction-export-security.spec.ts`). Buradaki konu: filtreleme, isim
 * zenginleştirme (account/category adı), tenant izolasyonu ve CSV üretiminin kendisi.
 *
 * `TRANSACTION_EXPORT_ROW_LIMIT` (50.000) aşımı BURADA TEST EDİLMEZ: bu kadar satır üretmek
 * suite'i pratik olmayan bir süreye taşırdı; sınır mantığı (`take: limit + 1` + `slice` +
 * `truncated` bayrağı) `listTransactions()`'ın aynı desenle zaten test edilen sayfalama
 * mantığıyla birebir aynıdır (bkz. `transaction.spec.ts` → "Sayfalama").
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
    data: { name: "Disa Aktarma Testi", slug: `tx-export-${randomUUID()}` },
    select: { id: true },
  });
  createdTenantIds.push(tenant.id);
  return tenant.id;
}

async function createActor(): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `tx-export-actor-${randomUUID()}@example.com` },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  return user.id;
}

async function createAccount(tenantId: string, name: string): Promise<string> {
  const account = await prisma.account.create({
    data: { tenantId, name, type: "CASH", currency: "TRY", balance: "0" },
    select: { id: true },
  });
  return account.id;
}

async function createCategory(tenantId: string, name: string, type: "INCOME" | "EXPENSE") {
  const category = await prisma.category.create({
    data: { tenantId, name, type },
    select: { id: true },
  });
  return category.id;
}

test.describe("listTransactionsForExport() — içerik ve zenginleştirme", () => {
  test("hesap ve kategori ADI ile döner (ham id değil)", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId, "Ana Kasa");
    const categoryId = await createCategory(tenantId, "Kira", "EXPENSE");

    await createTransaction(tenantId, actorId, {
      accountId,
      categoryId,
      type: "EXPENSE",
      amount: "500",
      description: "Subat kirasi",
    });

    const { rows, truncated } = await listTransactionsForExport(tenantId);

    expect(truncated).toBe(false);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "EXPENSE",
      amount: "500",
      description: "Subat kirasi",
      accountName: "Ana Kasa",
      categoryName: "Kira",
    });
  });

  test("kategorisiz işlemde categoryName null döner (kategorisiz kayıt meşrudur)", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId, "Kasa");

    await createTransaction(tenantId, actorId, {
      accountId,
      type: "INCOME",
      amount: "100",
    });

    const { rows } = await listTransactionsForExport(tenantId);
    expect(rows[0].categoryName).toBeNull();
  });
});

test.describe("listTransactionsForExport() — filtreler (Issue #56 ile paylaşılan mantık)", () => {
  test("accountId filtresi yalnızca o hesabın kayıtlarını döner", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountA = await createAccount(tenantId, "A");
    const accountB = await createAccount(tenantId, "B");

    await createTransaction(tenantId, actorId, { accountId: accountA, type: "INCOME", amount: "1" });
    await createTransaction(tenantId, actorId, { accountId: accountB, type: "INCOME", amount: "2" });

    const { rows } = await listTransactionsForExport(tenantId, { accountId: accountA });
    expect(rows).toHaveLength(1);
    expect(rows[0].accountName).toBe("A");
  });

  test("from/to filtresi tarih aralığının DIŞINDAKİ kayıtları dışlar", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId, "Kasa");

    await createTransaction(tenantId, actorId, {
      accountId,
      type: "INCOME",
      amount: "1",
      occurredAt: "2026-01-01",
    });
    await createTransaction(tenantId, actorId, {
      accountId,
      type: "INCOME",
      amount: "2",
      occurredAt: "2026-06-01",
    });

    const { rows } = await listTransactionsForExport(tenantId, {
      from: new Date("2026-05-01"),
      to: new Date("2026-07-01"),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe("2");
  });
});

test.describe("listTransactionsForExport() — tenant izolasyonu", () => {
  test("bir tenant'ın işlemleri DİĞERİNİN dışa aktarımında görünmüyor", async () => {
    const mine = await createTenant();
    const theirs = await createTenant();
    const actorId = await createActor();
    const theirsAccount = await createAccount(theirs, "Onların Kasasi");

    await createTransaction(theirs, actorId, {
      accountId: theirsAccount,
      type: "INCOME",
      amount: "999",
    });

    const { rows } = await listTransactionsForExport(mine);
    expect(rows).toHaveLength(0);
  });
});

test.describe("CSV üretimi (src/lib/export/csv.ts ile birleşim)", () => {
  test("üretilen CSV BOM + CRLF taşıyor ve satırlar doğru sırada", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const accountId = await createAccount(tenantId, "Kasa");
    await createTransaction(tenantId, actorId, {
      accountId,
      type: "INCOME",
      amount: "10",
      description: "Not, virgül içerir",
    });

    const { rows } = await listTransactionsForExport(tenantId);
    const csv = toCsv(rows, [
      { header: "amount", value: (row) => row.amount },
      { header: "description", value: (row) => row.description },
    ]);

    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("\r\n");
    // Virgül içeren metin alıntılanmalı (RFC 4180) — `toCsv`'nin kendi testleri
    // `csv.spec.ts`'te var, burada yalnızca gerçek verimizle birleşimi doğrulanır.
    expect(csv).toContain('"Not, virgül içerir"');
  });
});
