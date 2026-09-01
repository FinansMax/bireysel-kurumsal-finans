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
 * Dönemsel gelir-gider raporu API'sinin saldırgan bakışıyla testleri (Issue #67).
 *
 * BU ENDPOINT'İN YÜZEYİ EN GENİŞİDİR: tek yanıtta tutarlar, KATEGORİ ADLARI ve HESAP ADLARI
 * birlikte açılır. Bir tenant'ın banka hesabı adları ve gider kalemleri, tutarlar sızmasa bile
 * tek başına ticari bilgidir.
 *
 * İş kuralları `integration/income-expense-report.spec.ts`'tedir.
 */

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

test.afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

function reportPath(tenantId: string, query = ""): string {
  return `/api/tenants/${tenantId}/reports/income-expense${query}`;
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
  const email = `sec-report-${randomUUID()}@example.com`;
  const user = await prisma.user.create({ data: { email }, select: { id: true } });
  createdUserIds.push(user.id);

  await prisma.membership.create({ data: { userId: user.id, tenantId, role } });

  const cookie = combineCookieHeaders(
    await createSessionCookieHeader({ sub: user.id, email }),
    await createActiveTenantCookieHeader(tenantId),
  );

  return { userId: user.id, cookie };
}

/** Bugünün tarihiyle bir gelir kaydı — varsayılan aralık (bu ay) onu daima kapsar. */
async function seedActivity(
  tenantId: string,
  currency: string,
  amount: string,
  accountName: string,
  categoryName: string,
) {
  const account = await prisma.account.create({
    data: { tenantId, name: accountName, type: "BANK", currency, balance: "0" },
    select: { id: true },
  });
  const category = await prisma.category.create({
    data: { tenantId, name: categoryName, type: "INCOME" },
    select: { id: true },
  });
  await prisma.transaction.create({
    data: {
      tenantId,
      accountId: account.id,
      categoryId: category.id,
      type: "INCOME",
      amount,
      occurredAt: new Date(),
    },
  });

  return account.id;
}

test.describe("Income-expense report — authentication zorunluluğu", () => {
  test("unauthenticated istek 401 alır; tutar, hesap adı ve kategori adı dönmez", async ({
    request,
  }) => {
    const tenant = await createTenant("NoAuthReport");
    await seedActivity(tenant.id, "TRY", "123456.78", "GizliHesap", "GizliKategori");

    const response = await request.get(reportPath(tenant.id));

    expect(response.status()).toBe(401);
    const body = await response.text();
    expect(body).not.toContain("123456.78");
    expect(body).not.toContain("GizliHesap");
    expect(body).not.toContain("GizliKategori");
  });

  test("oturum var ama aktif tenant cookie'si yoksa 400", async ({ request }) => {
    const tenant = await createTenant("NoActiveReport");
    await seedActivity(tenant.id, "TRY", "555.55", "GizliHesap", "GizliKategori");

    const email = `sec-report-${randomUUID()}@example.com`;
    const user = await prisma.user.create({ data: { email }, select: { id: true } });
    createdUserIds.push(user.id);
    await prisma.membership.create({
      data: { userId: user.id, tenantId: tenant.id, role: MembershipRole.OWNER },
    });

    const response = await request.get(reportPath(tenant.id), {
      headers: { cookie: await createSessionCookieHeader({ sub: user.id, email }) },
    });

    expect(response.status()).toBe(400);
    expect(await response.text()).not.toContain("GizliHesap");
  });
});

test.describe("Income-expense report — tenant izolasyonu / IDOR", () => {
  test("URL'deki tenantId aktif tenant'tan farklıysa 403", async ({ request }) => {
    const mine = await createTenant("MineReport");
    const theirs = await createTenant("TheirsReport");
    await seedActivity(theirs.id, "USD", "987654.32", "KomsuHesap", "KomsuKategori");

    const { cookie } = await createUserWithMembership(MembershipRole.OWNER, mine.id);
    const response = await request.get(reportPath(theirs.id), { headers: { cookie } });

    expect(response.status()).toBe(403);
    const body = await response.text();
    expect(body).not.toContain("987654.32");
    expect(body).not.toContain("KomsuHesap");
    expect(body).not.toContain("KomsuKategori");
  });

  test("rapor YALNIZCA kendi tenant'ının verisini içerir", async ({ request }) => {
    const mine = await createTenant("OnlyMineReport");
    const theirs = await createTenant("NeighbourReport");

    await seedActivity(mine.id, "TRY", "10", "BenimHesabim", "BenimKategorim");
    await seedActivity(theirs.id, "USD", "999999", "KomsuHesap", "KomsuKategori");

    const { cookie } = await createUserWithMembership(MembershipRole.OWNER, mine.id);
    const response = await request.get(reportPath(mine.id), { headers: { cookie } });
    expect(response.status()).toBe(200);

    const { report } = (await response.json()) as {
      report: { currencies: Array<{ currency: string; income: string }> };
    };

    expect(report.currencies).toHaveLength(1);
    expect(report.currencies[0].currency).toBe("TRY");
    expect(report.currencies[0].income).toBe("10");

    // Ham gövde üzerinden de: tipli okuma, yeni bir alanın sızdırdığını göremez.
    const raw = JSON.stringify(report);
    expect(raw).not.toContain("Komsu");
    expect(raw).not.toContain("999999");
    expect(raw).not.toContain("USD");
  });

  test("KONTROL GRUBU: aynı veri kendi sahibine 200 ile GÖRÜNÜYOR", async ({ request }) => {
    const theirs = await createTenant("ControlReport");
    await seedActivity(theirs.id, "USD", "999999", "KomsuHesap", "KomsuKategori");

    const { cookie } = await createUserWithMembership(MembershipRole.OWNER, theirs.id);
    const response = await request.get(reportPath(theirs.id), { headers: { cookie } });

    expect(response.status()).toBe(200);
    const raw = JSON.stringify(await response.json());
    expect(raw).toContain("KomsuHesap");
    expect(raw).toContain("KomsuKategori");
    expect(raw).toContain("999999");
  });
});

test.describe("Income-expense report — dönem parametreleri", () => {
  test("geçersiz tarih biçimi 400 alır", async ({ request }) => {
    const tenant = await createTenant("BadDateReport");
    await seedActivity(tenant.id, "TRY", "42", "Hesap", "Kategori");
    const { cookie } = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    for (const query of ["?from=15.03.2026", "?to=2026-13-01", "?from=2026-02-31"]) {
      const response = await request.get(reportPath(tenant.id, query), { headers: { cookie } });
      expect(response.status(), `beklenen 400: ${query}`).toBe(400);
    }
  });

  test("ters aralık ve tekrarlanan parametre 400 alır", async ({ request }) => {
    const tenant = await createTenant("BadRangeReport");
    const { cookie } = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    const reversed = await request.get(reportPath(tenant.id, "?from=2026-04-01&to=2026-03-01"), {
      headers: { cookie },
    });
    expect(reversed.status()).toBe(400);

    // Tek uçlu istek varsayılanla birleşince de ters aralık üretebilir; kontrol
    // birleştirmeden SONRA da yapılır (ortak `resolveDateRange`).
    const partial = await request.get(reportPath(tenant.id, "?from=2099-01-01"), {
      headers: { cookie },
    });
    expect(partial.status()).toBe(400);

    const repeated = await request.get(reportPath(tenant.id, "?to=2026-01-01&to=2026-02-01"), {
      headers: { cookie },
    });
    expect(repeated.status()).toBe(400);
  });

  test("aralık verilmezse bu ay kullanılır ve yanıt ne sorulduğunu geri söyler", async ({
    request,
  }) => {
    const tenant = await createTenant("DefaultReport");
    await seedActivity(tenant.id, "TRY", "77", "Hesap", "Kategori");
    const { cookie } = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    const response = await request.get(reportPath(tenant.id), { headers: { cookie } });
    expect(response.status()).toBe(200);

    const { report } = (await response.json()) as {
      report: { range: { from: string; to: string }; currencies: Array<{ income: string }> };
    };

    expect(report.range.from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(report.range.to.slice(0, 7)).toBe(report.range.from.slice(0, 7));
    expect(report.currencies[0].income).toBe("77");
  });
});

test.describe("Income-expense report — yetki ve sözleşme", () => {
  test("MEMBER raporu GÖREBİLİR", async ({ request }) => {
    const tenant = await createTenant("MemberReport");
    await seedActivity(tenant.id, "TRY", "42.5", "Hesap", "Kategori");

    const { cookie } = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);
    const response = await request.get(reportPath(tenant.id), { headers: { cookie } });

    expect(response.status()).toBe(200);
  });

  test("tutarlar STRING, adetler NUMBER, oranlar iki ondalıklı string", async ({ request }) => {
    const tenant = await createTenant("ContractReport");
    await seedActivity(tenant.id, "TRY", "12345678901.2345", "Hesap", "Kategori");

    const { cookie } = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const response = await request.get(reportPath(tenant.id), { headers: { cookie } });
    expect(response.status()).toBe(200);

    const { report } = (await response.json()) as {
      report: {
        currencies: Array<{
          income: unknown;
          expense: unknown;
          net: unknown;
          transactionCount: unknown;
          incomeByCategory: Array<{ amount: unknown; sharePercent: unknown }>;
          byAccount: Array<{ income: unknown; transactionCount: unknown }>;
        }>;
      };
    };

    const entry = report.currencies[0];
    expect(typeof entry.income).toBe("string");
    expect(entry.income).toBe("12345678901.2345");
    expect(typeof entry.expense).toBe("string");
    expect(typeof entry.net).toBe("string");
    // Adet PARA DEĞİLDİR: sayı olarak taşınır.
    expect(typeof entry.transactionCount).toBe("number");

    for (const row of entry.incomeByCategory) {
      expect(typeof row.amount).toBe("string");
      expect(row.sharePercent).toMatch(/^\d{1,3}\.\d{2}$/);
    }
    for (const row of entry.byAccount) {
      expect(typeof row.income).toBe("string");
      expect(typeof row.transactionCount).toBe("number");
    }
  });

  test("GET yan etkisizdir: çağrı hiçbir kaydı değiştirmez", async ({ request }) => {
    const tenant = await createTenant("SideEffectReport");
    const accountId = await seedActivity(tenant.id, "TRY", "100", "Hesap", "Kategori");

    const before = await prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      select: { balance: true, updatedAt: true },
    });

    const { cookie } = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    expect((await request.get(reportPath(tenant.id), { headers: { cookie } })).status()).toBe(200);

    const after = await prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      select: { balance: true, updatedAt: true },
    });

    expect(after.balance.toString()).toBe(before.balance.toString());
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(await prisma.auditLog.count({ where: { tenantId: tenant.id } })).toBe(0);
  });
});
