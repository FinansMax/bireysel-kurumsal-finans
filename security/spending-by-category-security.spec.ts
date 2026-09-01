import { randomUUID } from "node:crypto";

import { MembershipRole } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import {
  combineCookieHeaders,
  createActiveTenantCookieHeader,
  createSessionCookieHeader,
} from "./support/session";

/**
 * Kategori bazlı harcama dağılımı API'sinin saldırgan bakışıyla testleri (Issue #65).
 *
 * `dashboard-security.spec.ts` ile aynı konular; BU ENDPOINT'E ÖZGÜ EK YÜZEY: yanıt yalnızca
 * tutarları değil KATEGORİ ADLARINI da taşır. Bir tenant'ın gider kategorilerinin adları
 * ("Avukat", "Tazminat", "Danismanlik") tek başına ticari bilgidir — tutarlar sızmasa bile
 * adların sızması bir ihlaldir.
 *
 * İş kuralları (pay/ofset aritmetiği, tarih sınırları) `integration/`
 * `spending-by-category.spec.ts`'tedir.
 */

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

test.afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

function spendingPath(tenantId: string, query = ""): string {
  return `/api/tenants/${tenantId}/dashboard/spending-by-category${query}`;
}

async function createTenant(label: string) {
  const tenant = await prisma.tenant.create({
    data: { name: label, slug: `${label.toLowerCase()}-${randomUUID()}` },
    select: { id: true },
  });
  createdTenantIds.push(tenant.id);
  return tenant;
}

async function createUserWithMembership(role: MembershipRole, tenantId: string) {
  const email = `sec-spending-${randomUUID()}@example.com`;
  const user = await prisma.user.create({ data: { email }, select: { id: true } });
  createdUserIds.push(user.id);

  await prisma.membership.create({ data: { userId: user.id, tenantId, role } });

  const cookie = combineCookieHeaders(
    await createSessionCookieHeader({ sub: user.id, email }),
    await createActiveTenantCookieHeader(tenantId),
  );

  return { userId: user.id, cookie };
}

/** Bugünün tarihini taşıyan bir gider koyar — varsayılan aralık (bu ay) onu daima kapsar. */
async function seedSpending(
  tenantId: string,
  currency: string,
  amount: string,
  categoryName: string,
) {
  const account = await prisma.account.create({
    data: { tenantId, name: `Hesap ${randomUUID()}`, type: "BANK", currency, balance: "0" },
    select: { id: true },
  });
  const category = await prisma.category.create({
    data: { tenantId, name: categoryName, type: "EXPENSE" },
    select: { id: true },
  });
  await prisma.transaction.create({
    data: {
      tenantId,
      accountId: account.id,
      categoryId: category.id,
      type: "EXPENSE",
      amount,
      occurredAt: new Date(),
    },
  });

  return account.id;
}

test.describe("Spending by category — authentication zorunluluğu", () => {
  test("unauthenticated istek 401 alır; tutar da kategori adı da dönmez", async ({ request }) => {
    const tenant = await createTenant("NoAuthSpend");
    await seedSpending(tenant.id, "TRY", "123456.78", "GizliKategori");

    const response = await request.get(spendingPath(tenant.id));

    expect(response.status()).toBe(401);
    const body = await response.text();
    expect(body).not.toContain("123456.78");
    expect(body).not.toContain("GizliKategori");
  });

  test("oturum var ama aktif tenant cookie'si yoksa 400", async ({ request }) => {
    const tenant = await createTenant("NoActiveSpend");
    await seedSpending(tenant.id, "TRY", "555.55", "GizliKategori");

    const email = `sec-spending-${randomUUID()}@example.com`;
    const user = await prisma.user.create({ data: { email }, select: { id: true } });
    createdUserIds.push(user.id);
    await prisma.membership.create({
      data: { userId: user.id, tenantId: tenant.id, role: MembershipRole.OWNER },
    });

    const response = await request.get(spendingPath(tenant.id), {
      headers: { cookie: await createSessionCookieHeader({ sub: user.id, email }) },
    });

    expect(response.status()).toBe(400);
    expect(await response.text()).not.toContain("GizliKategori");
  });
});

test.describe("Spending by category — tenant izolasyonu / IDOR", () => {
  test("URL'deki tenantId aktif tenant'tan farklıysa 403", async ({ request }) => {
    const mine = await createTenant("MineSpend");
    const theirs = await createTenant("TheirsSpend");
    await seedSpending(theirs.id, "USD", "987654.32", "KomsuKategorisi");

    const { cookie } = await createUserWithMembership(MembershipRole.OWNER, mine.id);
    const response = await request.get(spendingPath(theirs.id), { headers: { cookie } });

    expect(response.status()).toBe(403);
    const body = await response.text();
    expect(body).not.toContain("987654.32");
    expect(body).not.toContain("KomsuKategorisi");
  });

  test("dağılım YALNIZCA kendi tenant'ının tutar ve kategori adlarını içerir", async ({
    request,
  }) => {
    const mine = await createTenant("OnlyMineSpend");
    const theirs = await createTenant("NeighbourSpend");

    await seedSpending(mine.id, "TRY", "10", "BenimKategorim");
    await seedSpending(theirs.id, "USD", "999999", "KomsuKategorisi");

    const { cookie } = await createUserWithMembership(MembershipRole.OWNER, mine.id);
    const response = await request.get(spendingPath(mine.id), { headers: { cookie } });
    expect(response.status()).toBe(200);

    const { spending } = (await response.json()) as {
      spending: {
        currencies: Array<{
          currency: string;
          total: string;
          slices: Array<{ name: string | null; amount: string }>;
        }>;
      };
    };

    expect(spending.currencies).toHaveLength(1);
    expect(spending.currencies[0].currency).toBe("TRY");
    expect(spending.currencies[0].total).toBe("10");

    // Ham gövde üzerinden de bakılır: tipli okuma, yeni bir alanın sızdırdığını göremez.
    const raw = JSON.stringify(spending);
    expect(raw).not.toContain("KomsuKategorisi");
    expect(raw).not.toContain("999999");
    expect(raw).not.toContain("USD");
  });

  test("KONTROL GRUBU: aynı veri kendi sahibine 200 ile GÖRÜNÜYOR", async ({ request }) => {
    const theirs = await createTenant("ControlSpend");
    await seedSpending(theirs.id, "USD", "999999", "KomsuKategorisi");

    const { cookie } = await createUserWithMembership(MembershipRole.OWNER, theirs.id);
    const response = await request.get(spendingPath(theirs.id), { headers: { cookie } });

    expect(response.status()).toBe(200);
    const raw = JSON.stringify(await response.json());
    expect(raw).toContain("KomsuKategorisi");
    expect(raw).toContain("999999");
  });
});

test.describe("Spending by category — dönem parametreleri", () => {
  test("geçersiz tarih biçimi 400 alır ve dağılım DÖNMEZ", async ({ request }) => {
    const tenant = await createTenant("BadDateSpend");
    await seedSpending(tenant.id, "TRY", "42", "Kategori");
    const { cookie } = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    for (const query of ["?from=15.03.2026", "?to=2026-13-01", "?from=2026-02-31"]) {
      const response = await request.get(spendingPath(tenant.id, query), { headers: { cookie } });
      // Geçersiz filtre SESSİZCE yok sayılmaz: tam dönemi göstermek, kullanıcıya sorduğundan
      // başka bir dönemi doğruymuş gibi göstermek olurdu (#56'nın kararı).
      expect(response.status(), `beklenen 400: ${query}`).toBe(400);
      expect(await response.text()).not.toContain('"42"');
    }
  });

  test("ters aralık 400 alır (boş dağılım DEĞİL)", async ({ request }) => {
    const tenant = await createTenant("ReverseSpend");
    const { cookie } = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    const response = await request.get(
      spendingPath(tenant.id, "?from=2026-04-01&to=2026-03-01"),
      { headers: { cookie } },
    );

    expect(response.status()).toBe(400);
  });

  test("tek uçlu istek varsayılanla ters aralık üretirse de 400 alır", async ({ request }) => {
    const tenant = await createTenant("PartialReverseSpend");
    const { cookie } = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    // `to` verilmedi → varsayılan "bu ayın sonu". Uzak gelecekteki bir `from` ile birleşince
    // aralık terse döner; ayrıştırıcı bunu göremez (yalnızca ikisi de verildiğinde bakar),
    // bu yüzden route birleştirmeden SONRA da kontrol eder.
    const response = await request.get(spendingPath(tenant.id, "?from=2099-01-01"), {
      headers: { cookie },
    });

    expect(response.status()).toBe(400);
  });

  test("tekrarlanan parametre 400 alır (ilk değer sessizce seçilmez)", async ({ request }) => {
    const tenant = await createTenant("RepeatedSpend");
    const { cookie } = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    const response = await request.get(
      spendingPath(tenant.id, "?from=2026-01-01&from=2026-02-01"),
      { headers: { cookie } },
    );

    expect(response.status()).toBe(400);
  });

  test("aralık verilmezse bu ay kullanılır ve yanıt ne sorulduğunu geri söyler", async ({
    request,
  }) => {
    const tenant = await createTenant("DefaultSpend");
    await seedSpending(tenant.id, "TRY", "77", "Kategori");
    const { cookie } = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    const response = await request.get(spendingPath(tenant.id), { headers: { cookie } });
    expect(response.status()).toBe(200);

    const { spending } = (await response.json()) as {
      spending: { range: { from: string; to: string }; currencies: Array<{ total: string }> };
    };

    // Ayın ilk günü; bitiş aynı ay içinde ve başlangıçtan sonra.
    expect(spending.range.from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(spending.range.to.slice(0, 7)).toBe(spending.range.from.slice(0, 7));
    expect(spending.range.to > spending.range.from).toBe(true);
    // Bugünün gideri varsayılan aralığa girer.
    expect(spending.currencies[0].total).toBe("77");
  });

  test("bu endpoint'e ait olmayan filtreler sessizce yok sayılır (400 üretmez)", async ({
    request,
  }) => {
    const tenant = await createTenant("ExtraParamSpend");
    await seedSpending(tenant.id, "TRY", "5", "Kategori");
    const { cookie } = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    // `q`/`accountId`/`after` işlem listesine özgüdür; ortak ayrıştırıcıya bu endpoint'te hiç
    // sorulmaz. Buradaki iddia, ortak ayrıştırıcı kullanmanın yan etki YARATMADIĞIdır.
    const response = await request.get(
      spendingPath(tenant.id, "?q=" + "x".repeat(500) + "&accountId=!!&after=bozuk"),
      { headers: { cookie } },
    );

    expect(response.status()).toBe(200);
  });
});

test.describe("Spending by category — yetki ve sözleşme", () => {
  test("MEMBER dağılımı GÖREBİLİR", async ({ request }) => {
    const tenant = await createTenant("MemberSpend");
    await seedSpending(tenant.id, "TRY", "42.5", "Kategori");

    const { cookie } = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);
    const response = await request.get(spendingPath(tenant.id), { headers: { cookie } });

    expect(response.status()).toBe(200);
  });

  test("tutarlar STRING taşınır, oranlar iki ondalıklı string'tir", async ({ request }) => {
    const tenant = await createTenant("ContractSpend");
    await seedSpending(tenant.id, "TRY", "12345678901.2345", "Kategori");

    const { cookie } = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const response = await request.get(spendingPath(tenant.id), { headers: { cookie } });
    expect(response.status()).toBe(200);

    const { spending } = (await response.json()) as {
      spending: {
        currencies: Array<{
          total: unknown;
          slices: Array<{ amount: unknown; sharePercent: unknown; offsetPercent: unknown }>;
        }>;
      };
    };

    const entry = spending.currencies[0];
    expect(typeof entry.total).toBe("string");
    expect(entry.total).toBe("12345678901.2345");
    for (const slice of entry.slices) {
      expect(typeof slice.amount).toBe("string");
      expect(slice.sharePercent).toMatch(/^\d{1,3}\.\d{2}$/);
      expect(slice.offsetPercent).toMatch(/^\d{1,3}\.\d{2}$/);
    }
  });

  test("GET yan etkisizdir: çağrı hiçbir kaydı değiştirmez", async ({ request }) => {
    const tenant = await createTenant("SideEffectSpend");
    const accountId = await seedSpending(tenant.id, "TRY", "100", "Kategori");

    const before = await prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      select: { balance: true, updatedAt: true },
    });

    const { cookie } = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    expect((await request.get(spendingPath(tenant.id), { headers: { cookie } })).status()).toBe(200);

    const after = await prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      select: { balance: true, updatedAt: true },
    });

    expect(after.balance.toString()).toBe(before.balance.toString());
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(await prisma.auditLog.count({ where: { tenantId: tenant.id } })).toBe(0);
  });
});
