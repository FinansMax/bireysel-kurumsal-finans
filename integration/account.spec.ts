import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { prisma } from "../src/lib/prisma";
import {
  createAccount,
  deleteAccount,
  listAccounts,
  updateAccount,
} from "../src/lib/finance/account";

/**
 * `Account` iş kuralları — gerçek DB'ye karşı, HTTP olmadan (Issue #46).
 *
 * Yetkilendirme burada test EDİLMEZ: servis fonksiyonları authorization kararı vermez, o iş
 * route'lardaki `requirePermission()`'ındır (bkz. `security/account-security.spec.ts`).
 * Buradaki konu: doğrulama, para hassasiyeti, tenant scope'u ve eşzamanlılık davranışı.
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
    data: { name: "Hesap Testi", slug: `acc-${randomUUID()}` },
    select: { id: true },
  });
  createdTenantIds.push(tenant.id);
  return tenant.id;
}

async function createActor(): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `acc-actor-${randomUUID()}@example.com` },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  return user.id;
}

function validInput(overrides: Record<string, unknown> = {}) {
  return { name: `Hesap ${randomUUID()}`, type: "BANK", currency: "TRY", ...overrides };
}

test.describe("createAccount() — mutlu yol", () => {
  test("hesap oluşturuluyor ve tenant'a bağlanıyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();

    const result = await createAccount(tenantId, actorId, validInput({ name: "Vadesiz TL" }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.account.name).toBe("Vadesiz TL");
    expect(result.account.type).toBe("BANK");
    expect(result.account.currency).toBe("TRY");
    // Açılış bakiyesi verilmediğinde şemadaki `@default(0)` geçerlidir.
    expect(result.account.balance).toBe("0");

    const row = await prisma.account.findUniqueOrThrow({ where: { id: result.account.id } });
    expect(row.tenantId).toBe(tenantId);
  });

  test("açılış bakiyesi string olarak alınıp Decimal hassasiyetiyle saklanıyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();

    // KRİTİK: 0.1 + 0.2 gibi değerler `number` ile 0.30000000000000004 olur. Decimal ile
    // saklanan bu tutar, virgülden sonraki 4 basamağı BOZULMADAN geri gelmelidir.
    const result = await createAccount(
      tenantId,
      actorId,
      validInput({ balance: "12345678901.2345" }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.account.balance).toBe("12345678901.2345");

    const row = await prisma.account.findUniqueOrThrow({ where: { id: result.account.id } });
    expect(row.balance.toString()).toBe("12345678901.2345");
  });

  test("negatif bakiye kabul ediliyor (eksiye düşmüş hesap / kredi kartı)", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();

    const result = await createAccount(tenantId, actorId, validInput({ balance: "-2500.75" }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.account.balance).toBe("-2500.75");
  });

  test("para birimi normalize ediliyor (küçük harf + boşluk)", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();

    const result = await createAccount(tenantId, actorId, validInput({ currency: " usd " }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.account.currency).toBe("USD");
  });

  test("başarılı oluşturma audit log satırı yazıyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();

    const result = await createAccount(tenantId, actorId, validInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const log = await prisma.auditLog.findFirst({
      where: { tenantId, action: "ACCOUNT_CREATED", targetId: result.account.id },
    });
    expect(log).not.toBeNull();
    expect(log?.actorUserId).toBe(actorId);
  });
});

test.describe("createAccount() — doğrulama", () => {
  const invalidCases: Array<{ label: string; input: Record<string, unknown> }> = [
    { label: "isim eksik", input: { name: undefined } },
    { label: "isim çok kısa", input: { name: "A" } },
    { label: "isim çok uzun", input: { name: "A".repeat(101) } },
    { label: "isim string değil", input: { name: 42 } },
    { label: "tür geçersiz", input: { type: "CRYPTO" } },
    { label: "tür eksik", input: { type: undefined } },
    { label: "para birimi 3 harf değil", input: { currency: "TRYY" } },
    { label: "para birimi rakam içeriyor", input: { currency: "TR1" } },
    { label: "bakiye number (para asla number değildir)", input: { balance: 100.5 } },
    { label: "bakiye null", input: { balance: null } },
    { label: "bakiye 4'ten fazla ondalık", input: { balance: "10.12345" } },
    { label: "bakiye virgüllü yerel biçim", input: { balance: "1.234,56" } },
    { label: "bakiye sayı değil", input: { balance: "abc" } },
  ];

  for (const { label, input } of invalidCases) {
    test(`${label} → 400 ve hiçbir kayıt oluşmuyor`, async () => {
      const tenantId = await createTenant();
      const actorId = await createActor();

      const result = await createAccount(tenantId, actorId, validInput(input));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);

      expect(await prisma.account.count({ where: { tenantId } })).toBe(0);
    });
  }

  test("aynı tenant'ta aynı isim 409 (unique constraint) — ikinci kayıt oluşmaz", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();

    const first = await createAccount(tenantId, actorId, validInput({ name: "Kasa" }));
    expect(first.ok).toBe(true);

    const second = await createAccount(tenantId, actorId, validInput({ name: "Kasa" }));
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.status).toBe(409);

    expect(await prisma.account.count({ where: { tenantId } })).toBe(1);
  });

  test("FARKLI tenant'larda aynı isim serbest (unique tenant başınadır)", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const actorId = await createActor();

    expect((await createAccount(tenantA, actorId, validInput({ name: "Kasa" }))).ok).toBe(true);
    expect((await createAccount(tenantB, actorId, validInput({ name: "Kasa" }))).ok).toBe(true);
  });

  test("eşzamanlı aynı isimli iki istekten yalnızca biri kazanıyor (yarış durumu)", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();

    // "Önce kontrol et sonra yaz" deseni burada ikisini de oluştururdu; unique constraint
    // yarışı DB seviyesinde kapatır.
    const [a, b] = await Promise.all([
      createAccount(tenantId, actorId, validInput({ name: "Ortak" })),
      createAccount(tenantId, actorId, validInput({ name: "Ortak" })),
    ]);

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await prisma.account.count({ where: { tenantId } })).toBe(1);
  });
});

test.describe("listAccounts() — tenant izolasyonu", () => {
  test("yalnızca kendi tenant'ının hesapları dönüyor", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const actorId = await createActor();

    await createAccount(tenantA, actorId, validInput({ name: "A Hesabi" }));
    await createAccount(tenantB, actorId, validInput({ name: "B Hesabi" }));

    const listA = await listAccounts(tenantA);
    expect(listA).toHaveLength(1);
    expect(listA[0].name).toBe("A Hesabi");
    expect(listA.some((account) => account.name === "B Hesabi")).toBe(false);
  });

  test("bakiye listede de string olarak dönüyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    await createAccount(tenantId, actorId, validInput({ balance: "1000.5000" }));

    const [account] = await listAccounts(tenantId);
    expect(typeof account.balance).toBe("string");
    // Decimal(19,4) son sıfırları korur; sözleşme "string" olduğu için biçim aynen yansır.
    expect(account.balance).toBe("1000.5");
  });
});

test.describe("updateAccount()", () => {
  test("yalnızca gönderilen alanlar değişiyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const created = await createAccount(
      tenantId,
      actorId,
      validInput({ name: "Eski", balance: "10.0000", currency: "TRY" }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await updateAccount(tenantId, created.account.id, actorId, { name: "Yeni" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.account.name).toBe("Yeni");
    expect(result.account.balance).toBe("10");
    expect(result.account.currency).toBe("TRY");
  });

  test("bakiye güncellemesi Decimal hassasiyetini koruyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const created = await createAccount(tenantId, actorId, validInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await updateAccount(tenantId, created.account.id, actorId, {
      balance: "0.3000",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.account.balance).toBe("0.3");
  });

  test("hiçbir alan gönderilmezse 400", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const created = await createAccount(tenantId, actorId, validInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await updateAccount(tenantId, created.account.id, actorId, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  test("başka tenant'ın hesabı güncellenemiyor (404) ve veri DEĞİŞMİYOR", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const actorId = await createActor();

    const foreign = await createAccount(tenantB, actorId, validInput({ name: "B Hesabi" }));
    expect(foreign.ok).toBe(true);
    if (!foreign.ok) return;

    // Tenant A context'inde, tenant B'ye ait GEÇERLİ bir id ile deneme.
    const result = await updateAccount(tenantA, foreign.account.id, actorId, { name: "Ele Gecti" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);

    const row = await prisma.account.findUniqueOrThrow({ where: { id: foreign.account.id } });
    expect(row.name).toBe("B Hesabi");
  });

  test("var olmayan id ile cross-tenant id AYNI yanıtı veriyor (enumeration engeli)", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const actorId = await createActor();

    const foreign = await createAccount(tenantB, actorId, validInput());
    expect(foreign.ok).toBe(true);
    if (!foreign.ok) return;

    const crossTenant = await updateAccount(tenantA, foreign.account.id, actorId, { name: "X" });
    const nonExistent = await updateAccount(tenantA, `nonexistent-${randomUUID()}`, actorId, {
      name: "X",
    });

    expect(crossTenant).toEqual(nonExistent);
  });

  test("isim çakışması 409 döner", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();

    const first = await createAccount(tenantId, actorId, validInput({ name: "Bir" }));
    const second = await createAccount(tenantId, actorId, validInput({ name: "Iki" }));
    expect(first.ok && second.ok).toBe(true);
    if (!second.ok) return;

    const result = await updateAccount(tenantId, second.account.id, actorId, { name: "Bir" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
  });
});

test.describe("deleteAccount()", () => {
  test("kendi tenant'ının hesabı siliniyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const created = await createAccount(tenantId, actorId, validInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await deleteAccount(tenantId, created.account.id, actorId);
    expect(result.ok).toBe(true);
    expect(await prisma.account.count({ where: { tenantId } })).toBe(0);
  });

  test("başka tenant'ın hesabı silinemiyor (404) ve kayıt DURUYOR", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const actorId = await createActor();

    const foreign = await createAccount(tenantB, actorId, validInput());
    expect(foreign.ok).toBe(true);
    if (!foreign.ok) return;

    const result = await deleteAccount(tenantA, foreign.account.id, actorId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);

    expect(await prisma.account.count({ where: { id: foreign.account.id } })).toBe(1);
  });

  test("tenant silinince hesapları da gidiyor (cascade)", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    await createAccount(tenantId, actorId, validInput());

    await prisma.tenant.delete({ where: { id: tenantId } });

    expect(await prisma.account.count({ where: { tenantId } })).toBe(0);
  });
});
