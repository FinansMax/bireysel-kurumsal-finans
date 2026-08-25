import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { prisma } from "../src/lib/prisma";
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from "../src/lib/finance/category";

/**
 * `Category` iş kuralları — gerçek DB'ye karşı, HTTP olmadan (Issue #49).
 *
 * Yetkilendirme burada test EDİLMEZ: servis fonksiyonları authorization kararı vermez, o iş
 * route'lardaki `requirePermission()`'ındır (bkz. `security/category-security.spec.ts`).
 * Buradaki konu: doğrulama, tür+isim benzersizliği, tenant scope'u ve eşzamanlılık davranışı.
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
    data: { name: "Kategori Testi", slug: `cat-${randomUUID()}` },
    select: { id: true },
  });
  createdTenantIds.push(tenant.id);
  return tenant.id;
}

async function createActor(): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `cat-actor-${randomUUID()}@example.com` },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  return user.id;
}

function validInput(overrides: Record<string, unknown> = {}) {
  return { name: `Kategori ${randomUUID()}`, type: "EXPENSE", ...overrides };
}

test.describe("createCategory() — mutlu yol", () => {
  test("kategori oluşturuluyor ve tenant'a bağlanıyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();

    const result = await createCategory(tenantId, actorId, validInput({ name: "Kira Gideri" }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.category.name).toBe("Kira Gideri");
    expect(result.category.type).toBe("EXPENSE");

    const row = await prisma.category.findUniqueOrThrow({ where: { id: result.category.id } });
    expect(row.tenantId).toBe(tenantId);
  });

  test("gelir kategorisi de oluşturulabiliyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();

    const result = await createCategory(tenantId, actorId, validInput({ type: "INCOME" }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.category.type).toBe("INCOME");
  });

  test("isimdeki baştaki/sondaki boşluklar kırpılıyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();

    const result = await createCategory(tenantId, actorId, validInput({ name: "  Yakit  " }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.category.name).toBe("Yakit");
  });

  test("başarılı oluşturma audit log satırı yazıyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();

    const result = await createCategory(tenantId, actorId, validInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const log = await prisma.auditLog.findFirst({
      where: { tenantId, action: "CATEGORY_CREATED", targetId: result.category.id },
    });
    expect(log).not.toBeNull();
    expect(log?.actorUserId).toBe(actorId);
  });
});

test.describe("createCategory() — doğrulama", () => {
  const invalidCases: Array<{ label: string; input: Record<string, unknown> }> = [
    { label: "isim eksik", input: { name: undefined } },
    { label: "isim çok kısa", input: { name: "A" } },
    { label: "isim yalnızca boşluk", input: { name: "   " } },
    { label: "isim çok uzun", input: { name: "A".repeat(101) } },
    { label: "isim string değil", input: { name: 42 } },
    { label: "tür geçersiz", input: { type: "TRANSFER" } },
    { label: "tür küçük harf (enum birebir eşleşmeli)", input: { type: "income" } },
    { label: "tür eksik", input: { type: undefined } },
    { label: "tür string değil", input: { type: 1 } },
  ];

  for (const { label, input } of invalidCases) {
    test(`${label} → 400 ve hiçbir kayıt oluşmuyor`, async () => {
      const tenantId = await createTenant();
      const actorId = await createActor();

      const result = await createCategory(tenantId, actorId, validInput(input));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);

      expect(await prisma.category.count({ where: { tenantId } })).toBe(0);
    });
  }

  test("aynı tenant + aynı TÜR içinde aynı isim 409 — ikinci kayıt oluşmaz", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();

    const first = await createCategory(tenantId, actorId, { name: "Diger", type: "EXPENSE" });
    expect(first.ok).toBe(true);

    const second = await createCategory(tenantId, actorId, { name: "Diger", type: "EXPENSE" });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.status).toBe(409);

    expect(await prisma.category.count({ where: { tenantId } })).toBe(1);
  });

  test("aynı isim FARKLI türlerde serbest (unique anahtar türü de içerir)", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();

    // Bu, `Account`tan bilinçli ayrılan tek karardır: "Diğer"/"Faiz"/"Kira" gibi isimler hem
    // gelir hem gider tarafında doğaldır (bkz. prisma/schema.prisma'daki Category notu).
    const expense = await createCategory(tenantId, actorId, { name: "Faiz", type: "EXPENSE" });
    const income = await createCategory(tenantId, actorId, { name: "Faiz", type: "INCOME" });

    expect(expense.ok).toBe(true);
    expect(income.ok).toBe(true);
    expect(await prisma.category.count({ where: { tenantId } })).toBe(2);
  });

  test("FARKLI tenant'larda aynı isim + tür serbest (unique tenant başınadır)", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const actorId = await createActor();

    expect((await createCategory(tenantA, actorId, { name: "Market", type: "EXPENSE" })).ok).toBe(
      true,
    );
    expect((await createCategory(tenantB, actorId, { name: "Market", type: "EXPENSE" })).ok).toBe(
      true,
    );
  });

  test("eşzamanlı aynı isimli iki istekten yalnızca biri kazanıyor (yarış durumu)", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();

    // "Önce kontrol et sonra yaz" deseni burada ikisini de oluştururdu; unique constraint
    // yarışı DB seviyesinde kapatır.
    const [a, b] = await Promise.all([
      createCategory(tenantId, actorId, { name: "Ortak", type: "INCOME" }),
      createCategory(tenantId, actorId, { name: "Ortak", type: "INCOME" }),
    ]);

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await prisma.category.count({ where: { tenantId } })).toBe(1);
  });
});

test.describe("listCategories()", () => {
  test("yalnızca kendi tenant'ının kategorileri dönüyor", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const actorId = await createActor();

    await createCategory(tenantA, actorId, { name: "A Kategorisi", type: "EXPENSE" });
    await createCategory(tenantB, actorId, { name: "B Kategorisi", type: "EXPENSE" });

    const listA = await listCategories(tenantA);
    expect(listA).toHaveLength(1);
    expect(listA[0].name).toBe("A Kategorisi");
    expect(listA.some((category) => category.name === "B Kategorisi")).toBe(false);
  });

  test("tür filtresi yalnızca o yöndeki kategorileri döndürüyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();

    await createCategory(tenantId, actorId, { name: "Maas", type: "INCOME" });
    await createCategory(tenantId, actorId, { name: "Market", type: "EXPENSE" });

    const income = await listCategories(tenantId, "INCOME");
    expect(income).toHaveLength(1);
    expect(income[0].name).toBe("Maas");

    const expense = await listCategories(tenantId, "EXPENSE");
    expect(expense).toHaveLength(1);
    expect(expense[0].name).toBe("Market");

    // Duyarlılık kanıtı: filtresiz çağrı ikisini de döndürür — yani yukarıdaki tek elemanlı
    // sonuçlar filtrenin ÇALIŞMASINDAN geliyor, listenin boş olmasından değil.
    expect(await listCategories(tenantId)).toHaveLength(2);
  });

  test("tür filtresi tenant scope'unun YERİNE GEÇMİYOR", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const actorId = await createActor();

    await createCategory(tenantB, actorId, { name: "Yabanci Gelir", type: "INCOME" });

    expect(await listCategories(tenantA, "INCOME")).toHaveLength(0);
  });

  test("sıralama: önce tür, sonra isim (arayüzde gruplu ve alfabetik görünür)", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();

    // ASCII isimler bilinçli: sıralama iddiası DB collation'ının Türkçe harf davranışına
    // değil, yalnızca `orderBy` sözleşmesine dayanmalı.
    await createCategory(tenantId, actorId, { name: "Zebra", type: "EXPENSE" });
    await createCategory(tenantId, actorId, { name: "Alfa", type: "EXPENSE" });
    await createCategory(tenantId, actorId, { name: "Beta", type: "INCOME" });

    const list = await listCategories(tenantId);
    // Postgres enum'ları TANIM sırasına göre sıralanır: INCOME, EXPENSE.
    expect(list.map((category) => `${category.type}:${category.name}`)).toEqual([
      "INCOME:Beta",
      "EXPENSE:Alfa",
      "EXPENSE:Zebra",
    ]);
  });
});

test.describe("updateCategory()", () => {
  test("yalnızca gönderilen alanlar değişiyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const created = await createCategory(tenantId, actorId, { name: "Eski", type: "EXPENSE" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await updateCategory(tenantId, created.category.id, actorId, { name: "Yeni" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.category.name).toBe("Yeni");
    expect(result.category.type).toBe("EXPENSE");
  });

  test("tür değiştirilebiliyor (yanlış tarafa açılmış kategori düzeltilebilir)", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const created = await createCategory(tenantId, actorId, { name: "Kira", type: "EXPENSE" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await updateCategory(tenantId, created.category.id, actorId, {
      type: "INCOME",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.category.type).toBe("INCOME");
    expect(result.category.name).toBe("Kira");
  });

  test("tür değişimi hedef tarafta isim çakışması yaratıyorsa 409", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();

    await createCategory(tenantId, actorId, { name: "Faiz", type: "INCOME" });
    const expense = await createCategory(tenantId, actorId, { name: "Faiz", type: "EXPENSE" });
    expect(expense.ok).toBe(true);
    if (!expense.ok) return;

    const result = await updateCategory(tenantId, expense.category.id, actorId, {
      type: "INCOME",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);

    // Kontrol grubu: çakışan güncelleme uygulanMAMIŞ olmalı.
    const row = await prisma.category.findUniqueOrThrow({ where: { id: expense.category.id } });
    expect(row.type).toBe("EXPENSE");
  });

  test("aynı tür içinde isim çakışması 409 döner", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();

    const first = await createCategory(tenantId, actorId, { name: "Bir", type: "EXPENSE" });
    const second = await createCategory(tenantId, actorId, { name: "Iki", type: "EXPENSE" });
    expect(first.ok && second.ok).toBe(true);
    if (!second.ok) return;

    const result = await updateCategory(tenantId, second.category.id, actorId, { name: "Bir" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
  });

  test("geçersiz tür 400 ve kayıt değişmiyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const created = await createCategory(tenantId, actorId, { name: "Sabit", type: "EXPENSE" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await updateCategory(tenantId, created.category.id, actorId, {
      type: "TRANSFER",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);

    const row = await prisma.category.findUniqueOrThrow({ where: { id: created.category.id } });
    expect(row.type).toBe("EXPENSE");
  });

  test("hiçbir alan gönderilmezse 400", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const created = await createCategory(tenantId, actorId, validInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await updateCategory(tenantId, created.category.id, actorId, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  test("başka tenant'ın kategorisi güncellenemiyor (404) ve veri DEĞİŞMİYOR", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const actorId = await createActor();

    const foreign = await createCategory(tenantB, actorId, { name: "B Kategori", type: "INCOME" });
    expect(foreign.ok).toBe(true);
    if (!foreign.ok) return;

    // Tenant A context'inde, tenant B'ye ait GEÇERLİ bir id ile deneme.
    const result = await updateCategory(tenantA, foreign.category.id, actorId, {
      name: "Ele Gecti",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);

    const row = await prisma.category.findUniqueOrThrow({ where: { id: foreign.category.id } });
    expect(row.name).toBe("B Kategori");
  });

  test("var olmayan id ile cross-tenant id AYNI yanıtı veriyor (enumeration engeli)", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const actorId = await createActor();

    const foreign = await createCategory(tenantB, actorId, validInput());
    expect(foreign.ok).toBe(true);
    if (!foreign.ok) return;

    const crossTenant = await updateCategory(tenantA, foreign.category.id, actorId, { name: "X" });
    const nonExistent = await updateCategory(tenantA, `nonexistent-${randomUUID()}`, actorId, {
      name: "X",
    });

    expect(crossTenant).toEqual(nonExistent);
  });

  test("başarılı güncelleme audit log satırı yazıyor (yalnızca değişen alan adlarıyla)", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const created = await createCategory(tenantId, actorId, { name: "Once", type: "EXPENSE" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await updateCategory(tenantId, created.category.id, actorId, { name: "Sonra" });

    const log = await prisma.auditLog.findFirst({
      where: { tenantId, action: "CATEGORY_UPDATED", targetId: created.category.id },
    });
    expect(log).not.toBeNull();
    expect(log?.metadata).toEqual({ updatedFields: ["name"] });
  });
});

test.describe("deleteCategory()", () => {
  test("kendi tenant'ının kategorisi siliniyor", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    const created = await createCategory(tenantId, actorId, validInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await deleteCategory(tenantId, created.category.id, actorId);
    expect(result.ok).toBe(true);
    expect(await prisma.category.count({ where: { tenantId } })).toBe(0);

    const log = await prisma.auditLog.findFirst({
      where: { tenantId, action: "CATEGORY_DELETED", targetId: created.category.id },
    });
    expect(log).not.toBeNull();
  });

  test("başka tenant'ın kategorisi silinemiyor (404) ve kayıt DURUYOR", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const actorId = await createActor();

    const foreign = await createCategory(tenantB, actorId, validInput());
    expect(foreign.ok).toBe(true);
    if (!foreign.ok) return;

    const result = await deleteCategory(tenantA, foreign.category.id, actorId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);

    expect(await prisma.category.count({ where: { id: foreign.category.id } })).toBe(1);
  });

  test("tenant silinince kategorileri de gidiyor (cascade)", async () => {
    const tenantId = await createTenant();
    const actorId = await createActor();
    await createCategory(tenantId, actorId, validInput());

    await prisma.tenant.delete({ where: { id: tenantId } });

    expect(await prisma.category.count({ where: { tenantId } })).toBe(0);
  });
});
