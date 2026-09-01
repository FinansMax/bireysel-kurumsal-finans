import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { prisma } from "../src/lib/prisma";
import { createAccount } from "../src/lib/finance/account";
import { createCategory, deleteCategory } from "../src/lib/finance/category";
import {
  defaultSpendingRange,
  getSpendingByCategory,
  type SpendingRange,
} from "../src/lib/finance/spending-by-category";
import { createTransaction } from "../src/lib/finance/transaction";

/**
 * Kategori bazlı harcama dağılımı iş kuralları — gerçek DB'ye karşı, HTTP olmadan (Issue #65).
 *
 * Yetkilendirme burada test EDİLMEZ (bkz. `security/spending-by-category-security.spec.ts`).
 * Buradaki konu: yalnızca giderin sayılması, para birimi ayrımı, pay/ofset aritmetiği, tarih
 * aralığı sınırları ve tenant scope'u.
 *
 * `dashboard-summary.spec.ts` ile aynı duruş: veri GERÇEK servislerle üretilir ve zaman
 * sabitlenir.
 */

/** Haziran 2026'nın tamamı. */
const RANGE: SpendingRange = {
  from: new Date("2026-06-01T00:00:00.000Z"),
  to: new Date("2026-06-30T00:00:00.000Z"),
};

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

test.afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

async function seedTenant(): Promise<string> {
  const tenant = await prisma.tenant.create({
    data: { name: "Dagilim Testi", slug: `spend-${randomUUID()}` },
    select: { id: true },
  });
  createdTenantIds.push(tenant.id);
  return tenant.id;
}

async function seedActor(): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `spend-actor-${randomUUID()}@example.com` },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  return user.id;
}

async function seedAccount(tenantId: string, actorId: string, currency: string): Promise<string> {
  const result = await createAccount(tenantId, actorId, {
    name: `Hesap ${randomUUID()}`,
    type: "BANK",
    currency,
  });
  expect(result.ok, "hesap oluşturulamadı").toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.account.id;
}

async function seedCategory(
  tenantId: string,
  actorId: string,
  name: string,
  type: "INCOME" | "EXPENSE" = "EXPENSE",
): Promise<string> {
  const result = await createCategory(tenantId, actorId, { name, type });
  expect(result.ok, "kategori oluşturulamadı").toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.category.id;
}

async function seedTransaction(
  tenantId: string,
  actorId: string,
  accountId: string,
  type: "INCOME" | "EXPENSE",
  amount: string,
  occurredAt: string,
  categoryId?: string,
): Promise<void> {
  const result = await createTransaction(tenantId, actorId, {
    accountId,
    type,
    amount,
    occurredAt,
    ...(categoryId ? { categoryId } : {}),
  });
  expect(result.ok, `işlem oluşturulamadı: ${result.ok ? "" : result.error}`).toBe(true);
}

function currencyOf(
  spending: Awaited<ReturnType<typeof getSpendingByCategory>>,
  currency: string,
) {
  return spending.currencies.find((entry) => entry.currency === currency);
}

test.describe("getSpendingByCategory() — kapsam", () => {
  test("veri yokken boş dizi döner ve aralık geri bildirilir", async () => {
    const tenantId = await seedTenant();

    const spending = await getSpendingByCategory(tenantId, RANGE);

    expect(spending.currencies).toEqual([]);
    // İstemci ne sorduğunu geri görebilmeli — aralık uçları DAHİLDİR.
    expect(spending.range).toEqual({ from: "2026-06-01", to: "2026-06-30" });
  });

  test("GELİR işlemleri dağılıma GİRMEZ", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");
    const incomeCategory = await seedCategory(tenantId, actorId, "Maas", "INCOME");

    await seedTransaction(tenantId, actorId, accountId, "INCOME", "5000", "2026-06-10", incomeCategory);

    // "Harcamanın %40'ı kira" cümlesinin anlamlı olması için payda YALNIZCA gider olmalı.
    expect((await getSpendingByCategory(tenantId, RANGE)).currencies).toEqual([]);
  });

  test("KONTROL GRUBU: aynı hesapta bir GİDER eklenince dağılım oluşuyor", async () => {
    // Duyarlılık kanıtı: yukarıdaki "gelir girmez" iddiası, fonksiyon her koşulda boş dönseydi
    // de geçerdi.
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");

    await seedTransaction(tenantId, actorId, accountId, "INCOME", "5000", "2026-06-10");
    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "100", "2026-06-10");

    const spending = await getSpendingByCategory(tenantId, RANGE);
    expect(spending.currencies).toHaveLength(1);
    // Gelir toplama HİÇ karışmamalı: toplam yalnızca giderdir.
    expect(spending.currencies[0].total).toBe("100");
  });
});

test.describe("getSpendingByCategory() — pay ve ofset", () => {
  test("tek kategori halkanın tamamını kaplar", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");
    const kira = await seedCategory(tenantId, actorId, "Kira");

    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "1200", "2026-06-05", kira);

    const entry = currencyOf(await getSpendingByCategory(tenantId, RANGE), "TRY");

    expect(entry?.total).toBe("1200");
    expect(entry?.slices).toEqual([
      {
        categoryId: kira,
        name: "Kira",
        amount: "1200",
        sharePercent: "100.00",
        offsetPercent: "0.00",
      },
    ]);
  });

  test("dilimler tutara göre AZALAN sıradadır ve ofsetler kümülatiftir", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");
    const kira = await seedCategory(tenantId, actorId, "Kira");
    const market = await seedCategory(tenantId, actorId, "Market");

    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "250", "2026-06-05", market);
    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "750", "2026-06-06", kira);
    // Aynı kategoriye ikinci bir kayıt: tek dilimde TOPLANMALI.
    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "250", "2026-06-07", market);

    const entry = currencyOf(await getSpendingByCategory(tenantId, RANGE), "TRY");

    expect(entry?.total).toBe("1250");
    expect(entry?.slices).toEqual([
      { categoryId: kira, name: "Kira", amount: "750", sharePercent: "60.00", offsetPercent: "0.00" },
      {
        categoryId: market,
        name: "Market",
        amount: "500",
        sharePercent: "40.00",
        // İkinci dilim, birincinin bittiği yerden başlar.
        offsetPercent: "60.00",
      },
    ]);
  });

  test("yuvarlanan paylarda ofset TAM değerlerden hesaplanır (hata birikmez)", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");
    const a = await seedCategory(tenantId, actorId, "AAA");
    const b = await seedCategory(tenantId, actorId, "BBB");
    const c = await seedCategory(tenantId, actorId, "CCC");

    // Üçe bölünen bir toplam: her pay 33.33... — yuvarlanmış payları toplayarak ofset üretmek
    // son dilimi 99.99'da başlatır ve halkada gözle görülür bir kayma bırakırdı.
    for (const categoryId of [a, b, c]) {
      await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "1", "2026-06-05", categoryId);
    }

    const entry = currencyOf(await getSpendingByCategory(tenantId, RANGE), "TRY");

    expect(entry?.slices.map((slice) => slice.sharePercent)).toEqual([
      "33.33",
      "33.33",
      "33.33",
    ]);
    expect(entry?.slices.map((slice) => slice.offsetPercent)).toEqual([
      "0.00",
      "33.33",
      // 2/3 = 66.666… → 66.67. Yuvarlanmış payların toplamı olsaydı 66.66 çıkardı.
      "66.67",
    ]);
    // Eşit tutarlarda sıra ADA göre kesinleşir (aksi halde sonuç sorgudan sorguya değişirdi).
    expect(entry?.slices.map((slice) => slice.name)).toEqual(["AAA", "BBB", "CCC"]);
  });

  test("kuruşlu tutarlar Decimal hassasiyetini korur", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");
    const kategori = await seedCategory(tenantId, actorId, "Fatura");

    // `number` ile 0.1 + 0.2 = 0.30000000000000004 olurdu.
    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "0.1", "2026-06-05", kategori);
    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "0.2", "2026-06-06", kategori);

    const entry = currencyOf(await getSpendingByCategory(tenantId, RANGE), "TRY");
    expect(entry?.total).toBe("0.3");
    expect(entry?.slices[0].amount).toBe("0.3");
  });
});

test.describe("getSpendingByCategory() — kategorisiz", () => {
  test("kategorisi olmayan harcamalar tek kovada toplanır ve SONA düşer", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");
    const kira = await seedCategory(tenantId, actorId, "Kira");

    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "100", "2026-06-05");
    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "100", "2026-06-06");
    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "100", "2026-06-07", kira);

    const entry = currencyOf(await getSpendingByCategory(tenantId, RANGE), "TRY");

    // Kategorisiz 200 ile en büyük olsa da adı yoktur; sıralama önce TUTARA bakar, bu yüzden
    // başta olmalı. (Eşitlikte sona düşme kuralı ayrı testte.)
    expect(entry?.slices[0]).toEqual({
      categoryId: null,
      name: null,
      amount: "200",
      sharePercent: "66.67",
      offsetPercent: "0.00",
    });
    expect(entry?.slices[1].name).toBe("Kira");
  });

  test("tutarlar eşitken kategorisiz dilim SONA düşer", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");
    const kira = await seedCategory(tenantId, actorId, "Kira");

    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "100", "2026-06-05");
    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "100", "2026-06-06", kira);

    const entry = currencyOf(await getSpendingByCategory(tenantId, RANGE), "TRY");
    expect(entry?.slices.map((slice) => slice.name)).toEqual(["Kira", null]);
  });

  test("kategori SİLİNİNCE harcaması kaybolmaz, kategorisiz kovasına düşer", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");
    const gecici = await seedCategory(tenantId, actorId, "Gecici");

    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "500", "2026-06-05", gecici);

    const deleted = await deleteCategory(tenantId, gecici, actorId);
    expect(deleted.ok).toBe(true);

    const entry = currencyOf(await getSpendingByCategory(tenantId, RANGE), "TRY");

    // Şemadaki `onDelete: SetNull` (#53): kategori bir ETİKETTİR, paranın kendisi değil.
    // Silinmesi harcamayı yok etmemeli — toplam korunmalı.
    expect(entry?.total).toBe("500");
    expect(entry?.slices).toEqual([
      { categoryId: null, name: null, amount: "500", sharePercent: "100.00", offsetPercent: "0.00" },
    ]);
  });
});

test.describe("getSpendingByCategory() — para birimleri", () => {
  test("farklı para birimleri ASLA tek dağılımda toplanmaz", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const tryAccount = await seedAccount(tenantId, actorId, "TRY");
    const usdAccount = await seedAccount(tenantId, actorId, "USD");
    const kira = await seedCategory(tenantId, actorId, "Kira");

    await seedTransaction(tenantId, actorId, tryAccount, "EXPENSE", "1000", "2026-06-05", kira);
    await seedTransaction(tenantId, actorId, usdAccount, "EXPENSE", "50", "2026-06-05", kira);

    const spending = await getSpendingByCategory(tenantId, RANGE);

    // İki ayrı blok. TEK bir "1050" toplamı ÜRETİLMEMELİ — kur dönüşümü yok.
    expect(spending.currencies.map((entry) => entry.currency)).toEqual(["TRY", "USD"]);
    expect(currencyOf(spending, "TRY")?.total).toBe("1000");
    expect(currencyOf(spending, "USD")?.total).toBe("50");
    // Aynı kategori iki para biriminde de %100'dür: pay DAİMA kendi para biriminin toplamına
    // göredir.
    expect(currencyOf(spending, "TRY")?.slices[0].sharePercent).toBe("100.00");
    expect(currencyOf(spending, "USD")?.slices[0].sharePercent).toBe("100.00");
  });

  test("aynı para birimindeki iki hesap tek dağılımda birleşir", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const first = await seedAccount(tenantId, actorId, "TRY");
    const second = await seedAccount(tenantId, actorId, "TRY");
    const kira = await seedCategory(tenantId, actorId, "Kira");

    await seedTransaction(tenantId, actorId, first, "EXPENSE", "300", "2026-06-05", kira);
    await seedTransaction(tenantId, actorId, second, "EXPENSE", "700", "2026-06-05", kira);

    expect(currencyOf(await getSpendingByCategory(tenantId, RANGE), "TRY")?.total).toBe("1000");
  });
});

test.describe("getSpendingByCategory() — tarih aralığı", () => {
  test("her iki uç da DAHİLDİR; bitiş gününün saatli kaydı da sayılır", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");

    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "1", "2026-06-01T00:00:00.000Z");
    // `lte: to` yazılsaydı bu kayıt DIŞARIDA kalırdı — kullanıcının gördüğü listeyle dağılım
    // sessizce ayrışırdı (ortak `nextDay()` kuralı).
    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "2", "2026-06-30T23:59:59.999Z");

    expect(currencyOf(await getSpendingByCategory(tenantId, RANGE), "TRY")?.total).toBe("3");
  });

  test("aralığın DIŞINDAKİ kayıtlar sayılmaz", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");

    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "999", "2026-05-31T23:59:59.999Z");
    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "888", "2026-07-01T00:00:00.000Z");
    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "5", "2026-06-15");

    expect(currencyOf(await getSpendingByCategory(tenantId, RANGE), "TRY")?.total).toBe("5");
  });

  test("tek günlük aralık çalışır (from === to)", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedAccount(tenantId, actorId, "TRY");

    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "7", "2026-06-15T18:30:00.000Z");
    await seedTransaction(tenantId, actorId, accountId, "EXPENSE", "9", "2026-06-16T00:00:00.000Z");

    const single = {
      from: new Date("2026-06-15T00:00:00.000Z"),
      to: new Date("2026-06-15T00:00:00.000Z"),
    };
    expect(currencyOf(await getSpendingByCategory(tenantId, single), "TRY")?.total).toBe("7");
  });
});

test.describe("defaultSpendingRange()", () => {
  test("içinde bulunulan ayın TAMAMINI verir (UTC)", async () => {
    // Panelin hemen üstündeki özet "bu ay" diyor; iki bölümün farklı dönem göstermesi aynı
    // ekranda birbirini yalanlayan iki sayı üretirdi.
    expect(defaultSpendingRange(new Date("2026-06-15T12:00:00.000Z"))).toEqual({
      from: new Date("2026-06-01T00:00:00.000Z"),
      to: new Date("2026-06-30T00:00:00.000Z"),
    });
  });

  test("ay uzunluğu ve artık yıl elle yazılmaz", async () => {
    expect(defaultSpendingRange(new Date("2026-02-10T00:00:00.000Z")).to).toEqual(
      new Date("2026-02-28T00:00:00.000Z"),
    );
    // 2028 artık yıl.
    expect(defaultSpendingRange(new Date("2028-02-10T00:00:00.000Z")).to).toEqual(
      new Date("2028-02-29T00:00:00.000Z"),
    );
    // Aralık: yıl sınırı doğru devretmeli.
    expect(defaultSpendingRange(new Date("2026-12-05T00:00:00.000Z"))).toEqual({
      from: new Date("2026-12-01T00:00:00.000Z"),
      to: new Date("2026-12-31T00:00:00.000Z"),
    });
  });
});

test.describe("getSpendingByCategory() — tenant izolasyonu", () => {
  test("başka tenant'ın harcaması dağılıma SIZMAZ", async () => {
    const actorId = await seedActor();
    const mine = await seedTenant();
    const theirs = await seedTenant();

    const myAccount = await seedAccount(mine, actorId, "TRY");
    const myCategory = await seedCategory(mine, actorId, "Kira");
    await seedTransaction(mine, actorId, myAccount, "EXPENSE", "10", "2026-06-05", myCategory);

    const theirAccount = await seedAccount(theirs, actorId, "USD");
    const theirCategory = await seedCategory(theirs, actorId, "Komsu Gideri");
    await seedTransaction(theirs, actorId, theirAccount, "EXPENSE", "777777", "2026-06-05", theirCategory);

    const spending = await getSpendingByCategory(mine, RANGE);

    expect(spending.currencies).toHaveLength(1);
    expect(spending.currencies[0].currency).toBe("TRY");
    expect(spending.currencies[0].total).toBe("10");
    // Komşunun kategori ADI da sızmamalı: dilim adları kategori tablosundan okunuyor.
    const names = spending.currencies.flatMap((entry) => entry.slices.map((slice) => slice.name));
    expect(names).toEqual(["Kira"]);
  });

  test("KONTROL GRUBU: aynı veri kendi tenant'ında GÖRÜNÜYOR", async () => {
    const actorId = await seedActor();
    const theirs = await seedTenant();

    const theirAccount = await seedAccount(theirs, actorId, "USD");
    const theirCategory = await seedCategory(theirs, actorId, "Komsu Gideri");
    await seedTransaction(theirs, actorId, theirAccount, "EXPENSE", "777777", "2026-06-05", theirCategory);

    const spending = await getSpendingByCategory(theirs, RANGE);
    expect(spending.currencies[0].total).toBe("777777");
    expect(spending.currencies[0].slices[0].name).toBe("Komsu Gideri");
  });
});
