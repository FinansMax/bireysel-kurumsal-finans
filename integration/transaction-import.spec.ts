import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { exportTransactionsCsv } from "../src/lib/export/transactions-csv";
import { parseCsv, unescapeFormulaInjection } from "../src/lib/import/csv-parse";
import { importTransactionsCsv, MAX_IMPORT_ROWS } from "../src/lib/import/transactions-csv";
import { prisma } from "../src/lib/prisma";

/**
 * İşlem CSV içe aktarma — gerçek DB'ye karşı, HTTP olmadan (Issue #83). HTTP tarafı (yetki,
 * boyut, content-type) `security/transaction-import-security.spec.ts`'tedir.
 *
 * Her testin asıl kanıtı BAKİYEDİR: işlem satırları doğru yazılsa bile bakiye kaymadıysa ya da
 * iki kez kaydıysa içe aktarma yanlıştır.
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
    data: { name: "Ice Aktarma", slug: `imp-${randomUUID()}` },
    select: { id: true },
  });
  createdTenantIds.push(tenant.id);
  return tenant.id;
}

async function createActor(): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `imp-${randomUUID()}@example.com` },
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

async function balanceOf(tenantId: string, accountId: string): Promise<string> {
  const account = await prisma.account.findFirstOrThrow({
    where: { id: accountId, tenantId },
    select: { balance: true },
  });
  return account.balance.toString();
}

const HEADER = "type,amount,description,occurred_at,account_id,category_id";

test.describe("parseCsv()", () => {
  test("alıntı, kaçırılmış tırnak, alan içi virgül/satır sonu, CRLF ve BOM", async () => {
    const parsed = parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\n"çok\nsatır",z\n\n');
    expect(parsed).toEqual({
      ok: true,
      records: [
        ["a", "b"],
        ["x, y", 'he said "hi"'],
        ["çok\nsatır", "z"],
      ],
    });
  });

  test("kapanmamış tırnak ve tırnak sonrası çöp HATA — sessizce birleştirilmiyor", async () => {
    expect(parseCsv('a,"b\n').ok).toBe(false);
    expect(parseCsv('"a"b,c\n').ok).toBe(false);
    expect(parseCsv('a"b,c\n').ok).toBe(false);
  });

  test("formül kaçırması yalnızca dışa aktarımın ürettiği desende geri alınıyor", async () => {
    expect(unescapeFormulaInjection("'=SUM(A1)")).toBe("=SUM(A1)");
    expect(unescapeFormulaInjection("'-500 düzeltme")).toBe("-500 düzeltme");
    // Kontrol grubu: başka `'` ile başlayan metne dokunulmuyor.
    expect(unescapeFormulaInjection("'tırnaklı not")).toBe("'tırnaklı not");
  });
});

test.describe("importTransactionsCsv() — mutlu yol", () => {
  test("geçerli satırlar kaydediliyor ve bakiye hesap başına DOĞRU kayıyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const a = await createAccount(tenantId, "100.0000");
    const b = await createAccount(tenantId, "0");
    const salary = await createCategory(tenantId, "INCOME");

    const csv = [
      HEADER,
      `INCOME,1000.50,Maaş,2026-03-01,${a},${salary}`,
      `EXPENSE,0.25,Kahve,2026-03-02,${a},`,
      `EXPENSE,10,,2026-03-03T09:30:00.000Z,${b},`,
    ].join("\n");

    const result = await importTransactionsCsv(tenantId, actorId, csv);
    expect(result).toEqual({ ok: true, imported: 3, errors: [] });

    // 100 + 1000.50 - 0.25 ; 0 - 10 — Decimal hassasiyetinde, kayan nokta yok.
    expect(await balanceOf(tenantId, a)).toBe("1100.25");
    expect(await balanceOf(tenantId, b)).toBe("-10");
    expect(await prisma.transaction.count({ where: { tenantId } })).toBe(3);

    const saved = await prisma.transaction.findFirstOrThrow({
      where: { tenantId, accountId: b },
      select: { description: true, type: true },
    });
    expect(saved).toEqual({ description: null, type: "EXPENSE" });
  });

  test("TEK audit kaydı yazılıyor ve tutar taşımıyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const a = await createAccount(tenantId);

    await importTransactionsCsv(
      tenantId,
      actorId,
      [HEADER, `INCOME,5,,2026-03-01,${a},`, `INCOME,7,,2026-03-01,${a},`].join("\n"),
    );

    const logs = await prisma.auditLog.findMany({
      where: { tenantId, action: "TRANSACTIONS_IMPORTED" },
      select: { actorUserId: true, metadata: true },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].actorUserId).toBe(actorId);
    expect(logs[0].metadata).toEqual({ count: 2, accountIds: [a] });
    // Satır başına TRANSACTION_CREATED yazılmadı.
    expect(
      await prisma.auditLog.count({ where: { tenantId, action: "TRANSACTION_CREATED" } }),
    ).toBe(0);
  });

  test("dışa aktar → içe aktar döngüsü: aynı kayıtlar, formül kaçırması geri alınmış", async () => {
    const source = await createTenant();
    const actorId = await createActor();
    const sourceAccount = await createAccount(source);
    await prisma.transaction.create({
      data: {
        tenantId: source,
        accountId: sourceAccount,
        type: "EXPENSE",
        amount: "42.5",
        description: "=HYPERLINK(\"x\")",
        occurredAt: new Date("2026-02-10T08:00:00.000Z"),
      },
    });

    const exported = await exportTransactionsCsv(source, {});
    expect(exported).toContain("'=HYPERLINK");

    // Aynı dosya, aynı tenant'a geri yükleniyor (id/created_at/updated_at yok sayılır).
    const result = await importTransactionsCsv(source, actorId, exported);
    expect(result).toEqual({ ok: true, imported: 1, errors: [] });

    const rows = await prisma.transaction.findMany({
      where: { tenantId: source },
      select: { description: true, amount: true, occurredAt: true },
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.description).toBe('=HYPERLINK("x")');
      expect(row.amount.toString()).toBe("42.5");
      expect(row.occurredAt.toISOString()).toBe("2026-02-10T08:00:00.000Z");
    }
  });
});

test.describe("importTransactionsCsv() — satır hataları", () => {
  test("hatalı satırlar satır numarasıyla raporlanıyor, geçerliler kaydediliyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const a = await createAccount(tenantId);
    const income = await createCategory(tenantId, "INCOME");

    const csv = [
      HEADER,
      `INCOME,10,ok,2026-03-01,${a},`, // 2: geçerli
      `expense,10,,2026-03-01,${a},`, // 3: API ile aynı katılık, küçük harf geçersiz
      `INCOME,-5,,2026-03-01,${a},`, // 4
      `INCOME,1.12345,,2026-03-01,${a},`, // 5
      `INCOME,10,,2026-02-30,${a},`, // 6
      `INCOME,10,,2026-03-01,yok-${randomUUID()},`, // 7
      `EXPENSE,10,,2026-03-01,${a},${income}`, // 8: tür uyuşmazlığı
      `INCOME,10,,2026-03-01`, // 9: eksik sütun
      `EXPENSE,3,"  '=SUM(A1)  ",2026-03-02,${a},`, // 10: geçerli; kırp + kaçırmayı çöz
    ].join("\n");

    const result = await importTransactionsCsv(tenantId, actorId, csv);
    expect(result).toEqual({
      ok: true,
      imported: 2,
      errors: [
        { line: 3, code: "invalid_type" },
        { line: 4, code: "invalid_amount" },
        { line: 5, code: "invalid_amount" },
        { line: 6, code: "invalid_occurred_at" },
        { line: 7, code: "account_not_found" },
        { line: 8, code: "category_type_mismatch" },
        { line: 9, code: "column_count" },
      ],
    });
    expect(await balanceOf(tenantId, a)).toBe("7");

    // Satır 10: boşluklar kırpıldı VE dışa aktarımın formül kaçırması çözüldü.
    const expense = await prisma.transaction.findFirstOrThrow({
      where: { tenantId, type: "EXPENSE" },
      select: { description: true },
    });
    expect(expense.description).toBe("=SUM(A1)");
  });

  test("BAŞKA tenant'ın hesabı: 'bulunamadı' — olmayan id ile aynı kod, veri sızmıyor/yazılmıyor", async () => {
    const mine = await createTenant();
    const theirs = await createTenant();
    const actorId = await createActor();
    const theirAccount = await createAccount(theirs, "500");
    const myAccount = await createAccount(mine);

    const result = await importTransactionsCsv(
      mine,
      actorId,
      [
        HEADER,
        `INCOME,99,,2026-03-01,${theirAccount},`,
        `INCOME,99,,2026-03-01,yok-${randomUUID()},`,
        // Kontrol grubu: kendi hesabına yazılabiliyor.
        `INCOME,1,,2026-03-01,${myAccount},`,
      ].join("\n"),
    );

    expect(result).toEqual({
      ok: true,
      imported: 1,
      errors: [
        { line: 2, code: "account_not_found" },
        { line: 3, code: "account_not_found" },
      ],
    });
    expect(await balanceOf(theirs, theirAccount)).toBe("500");
    expect(await prisma.transaction.count({ where: { tenantId: theirs } })).toBe(0);
    expect(await prisma.transaction.count({ where: { accountId: theirAccount } })).toBe(0);
  });

  test("hiçbir satır geçerli değilse 400 ve HİÇBİR ŞEY yazılmıyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const a = await createAccount(tenantId, "10");

    const result = await importTransactionsCsv(
      tenantId,
      actorId,
      [HEADER, `INCOME,abc,,2026-03-01,${a},`].join("\n"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toBe("no_valid_rows");
    expect(await prisma.transaction.count({ where: { tenantId } })).toBe(0);
    expect(await balanceOf(tenantId, a)).toBe("10");
  });
});

test.describe("importTransactionsCsv() — dosya hataları", () => {
  const cases: Array<[string, string, string]> = [
    ["boş dosya", "", "empty_file"],
    ["yalnızca başlık", HEADER, "empty_file"],
    ["bozuk tırnak", `${HEADER}\n"INCOME,1`, "malformed_csv"],
    ["zorunlu sütun eksik", "type,amount\nINCOME,1", "missing_columns"],
    // `tenant_id` sütunu: dosya kendi tenant'ını SEÇEMEZ — bilinmeyen sütun olarak reddedilir.
    ["bilinmeyen sütun", `${HEADER},tenant_id\nINCOME,1,,2026-03-01,x,,t`, "unknown_columns"],
    ["tekrarlanan sütun", `${HEADER},amount\n`, "duplicate_columns"],
  ];

  for (const [label, csv, expected] of cases) {
    test(`${label} → 400 ${expected}, hiçbir şey yazılmıyor`, async () => {
      const tenantId = await createTenant();
      const actorId = await createActor();

      const result = await importTransactionsCsv(tenantId, actorId, csv);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(result.error).toBe(expected);
      expect(await prisma.transaction.count({ where: { tenantId } })).toBe(0);
    });
  }

  test(`${MAX_IMPORT_ROWS} satırdan fazlası reddediliyor (sınırın kendisi kabul)`, async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const a = await createAccount(tenantId);
    const line = `INCOME,1,,2026-03-01,${a},`;

    const tooMany = await importTransactionsCsv(
      tenantId,
      actorId,
      [HEADER, ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => line)].join("\n"),
    );
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.error).toBe("too_many_rows");
    expect(await prisma.transaction.count({ where: { tenantId } })).toBe(0);

    const exact = await importTransactionsCsv(
      tenantId,
      actorId,
      [HEADER, ...Array.from({ length: MAX_IMPORT_ROWS }, () => line)].join("\n"),
    );
    expect(exact).toEqual({ ok: true, imported: MAX_IMPORT_ROWS, errors: [] });
    expect(await balanceOf(tenantId, a)).toBe(String(MAX_IMPORT_ROWS));
  });
});
