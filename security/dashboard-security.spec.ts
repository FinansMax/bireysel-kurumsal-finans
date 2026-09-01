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
 * Panel özeti API'sinin saldırgan bakışıyla testleri (Issue #62).
 *
 * Konu: kimlik doğrulama zorunluluğu, tenant izolasyonu / IDOR ve yanıtın SÖZLEŞMESİ (para
 * string olarak taşınır). İş kuralları (aritmetik, ay sınırları) `integration/`
 * `dashboard-summary.spec.ts`'tedir.
 *
 * BU ENDPOINT'E ÖZGÜ RİSK: tek bir yanıtta çalışma alanının BÜTÜN finansal büyüklüğü açılır —
 * bakiyeler, aylık ciro, kayıt sayıları. Diğer finans endpoint'lerinde sızıntı "bir kaydı
 * görmek"tir; burada "şirketin tamamını görmek"tir.
 */

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

test.afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

function summaryPath(tenantId: string): string {
  return `/api/tenants/${tenantId}/dashboard/summary`;
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
  const email = `sec-dashboard-${randomUUID()}@example.com`;
  const user = await prisma.user.create({ data: { email }, select: { id: true } });
  createdUserIds.push(user.id);

  await prisma.membership.create({ data: { userId: user.id, tenantId, role } });

  const cookie = combineCookieHeaders(
    await createSessionCookieHeader({ sub: user.id, email }),
    await createActiveTenantCookieHeader(tenantId),
  );

  return { userId: user.id, cookie };
}

/** Tenant'a görünür büyüklükte finansal veri koyar — sızıntı olursa gözden kaçmasın. */
async function seedFinancials(tenantId: string, currency: string, amount: string) {
  const account = await prisma.account.create({
    data: { tenantId, name: `Hesap ${randomUUID()}`, type: "BANK", currency, balance: amount },
    select: { id: true },
  });
  await prisma.category.create({
    data: { tenantId, name: `Kategori ${randomUUID()}`, type: "INCOME" },
  });
  await prisma.transaction.create({
    data: { tenantId, accountId: account.id, type: "INCOME", amount, occurredAt: new Date() },
  });
  return account.id;
}

test.describe("Dashboard summary — authentication zorunluluğu", () => {
  test("unauthenticated istek 401 alır ve hiçbir finansal veri dönmez", async ({ request }) => {
    const tenant = await createTenant("NoAuthDash");
    await seedFinancials(tenant.id, "TRY", "123456.78");

    const response = await request.get(summaryPath(tenant.id));

    expect(response.status()).toBe(401);
    // Gövde, hata mesajı dışında hiçbir alan içermemeli: 401 bir veri kanalı değildir.
    expect(await response.text()).not.toContain("123456.78");
  });

  test("oturum var ama aktif tenant cookie'si yoksa 400 — veri yine dönmez", async ({
    request,
  }) => {
    const tenant = await createTenant("NoActiveDash");
    await seedFinancials(tenant.id, "TRY", "555.55");

    const email = `sec-dashboard-${randomUUID()}@example.com`;
    const user = await prisma.user.create({ data: { email }, select: { id: true } });
    createdUserIds.push(user.id);
    await prisma.membership.create({
      data: { userId: user.id, tenantId: tenant.id, role: MembershipRole.OWNER },
    });

    const response = await request.get(summaryPath(tenant.id), {
      headers: { cookie: await createSessionCookieHeader({ sub: user.id, email }) },
    });

    expect(response.status()).toBe(400);
    expect(await response.text()).not.toContain("555.55");
  });
});

test.describe("Dashboard summary — tenant izolasyonu / IDOR", () => {
  test("URL'deki tenantId aktif tenant'tan farklıysa 403", async ({ request }) => {
    const mine = await createTenant("MineDash");
    const theirs = await createTenant("TheirsDash");
    await seedFinancials(theirs.id, "USD", "987654.32");

    const { cookie } = await createUserWithMembership(MembershipRole.OWNER, mine.id);

    // Klasik IDOR denemesi: cookie kendi tenant'ımın, URL komşununki.
    const response = await request.get(summaryPath(theirs.id), { headers: { cookie } });

    expect(response.status()).toBe(403);
    expect(await response.text()).not.toContain("987654.32");
  });

  test("üyesi olmadığı tenant'ı aktif göstermek özeti AÇMAZ", async ({ request }) => {
    const theirs = await createTenant("StrangerDash");
    await seedFinancials(theirs.id, "USD", "444444.44");

    // Kullanıcı BAŞKA bir tenant'ın üyesi; komşunun id'siyle imzalı bir aktif-tenant cookie'si
    // üretiyor. Cookie imzalıdır ama üyelik her istekte DB'den doğrulanır.
    const home = await createTenant("HomeDash");
    const email = `sec-dashboard-${randomUUID()}@example.com`;
    const user = await prisma.user.create({ data: { email }, select: { id: true } });
    createdUserIds.push(user.id);
    await prisma.membership.create({
      data: { userId: user.id, tenantId: home.id, role: MembershipRole.OWNER },
    });

    const cookie = combineCookieHeaders(
      await createSessionCookieHeader({ sub: user.id, email }),
      await createActiveTenantCookieHeader(theirs.id),
    );

    const response = await request.get(summaryPath(theirs.id), { headers: { cookie } });

    // Üyelik yok → aktif tenant çözülemez → 400 (mevcut `requireActiveTenant()` semantiği).
    expect(response.status()).toBe(400);
    expect(await response.text()).not.toContain("444444.44");
  });

  test("özet YALNIZCA kendi tenant'ının rakamlarını içerir", async ({ request }) => {
    const mine = await createTenant("OnlyMineDash");
    const theirs = await createTenant("NeighbourDash");

    await seedFinancials(mine.id, "TRY", "10");
    await seedFinancials(theirs.id, "USD", "999999");
    await seedFinancials(theirs.id, "GBP", "888888");

    const { cookie } = await createUserWithMembership(MembershipRole.OWNER, mine.id);
    const response = await request.get(summaryPath(mine.id), { headers: { cookie } });
    expect(response.status()).toBe(200);

    const { summary } = (await response.json()) as {
      summary: {
        counts: { accounts: number; transactions: number; categories: number };
        balancesByCurrency: Array<{ currency: string; balance: string }>;
      };
    };

    expect(summary.counts).toEqual({ accounts: 1, transactions: 1, categories: 1 });
    expect(summary.balancesByCurrency).toEqual([{ currency: "TRY", balance: "10", accountCount: 1 }]);
    // Komşunun para birimleri hiçbir yerde geçmemeli — ham gövde üzerinden de bakılır, çünkü
    // tipli okuma yeni bir alanın sızdırdığını göremez.
    const raw = JSON.stringify(summary);
    expect(raw).not.toContain("999999");
    expect(raw).not.toContain("888888");
    expect(raw).not.toContain("USD");
    expect(raw).not.toContain("GBP");
  });

  test("KONTROL GRUBU: aynı veri kendi sahibine 200 ile GÖRÜNÜYOR", async ({ request }) => {
    // Duyarlılık kanıtı: yukarıdaki testin "sızmıyor" iddiası, endpoint her koşulda boş
    // dönseydi de geçerdi.
    const theirs = await createTenant("ControlDash");
    await seedFinancials(theirs.id, "USD", "999999");

    const { cookie } = await createUserWithMembership(MembershipRole.OWNER, theirs.id);
    const response = await request.get(summaryPath(theirs.id), { headers: { cookie } });

    expect(response.status()).toBe(200);
    expect(JSON.stringify(await response.json())).toContain("999999");
  });

  test("biçimsel olarak geçersiz tenant id 400 alır (ucuz shape kontrolü en üstte)", async ({
    request,
  }) => {
    const mine = await createTenant("BadIdDash");
    const { cookie } = await createUserWithMembership(MembershipRole.OWNER, mine.id);

    // `isValidId()` yalnızca BİÇİMİ (boş değil, ≤191 karakter) kontrol eder — var olup
    // olmadığını değil. Uydurulmuş ama biçimsel olarak geçerli bir id 403 alır (yukarıdaki
    // IDOR testi); burada sınanan, guard'a hiç gitmeden reddedilen aşırı uzun id.
    const response = await request.get(summaryPath("x".repeat(200)), { headers: { cookie } });

    expect(response.status()).toBe(400);
  });
});

test.describe("Dashboard summary — yetki ve sözleşme", () => {
  test("MEMBER özeti GÖREBİLİR (görüntüleme izinleri matriste MEMBER'da da var)", async ({
    request,
  }) => {
    const tenant = await createTenant("MemberDash");
    await seedFinancials(tenant.id, "TRY", "42.5");

    const { cookie } = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);
    const response = await request.get(summaryPath(tenant.id), { headers: { cookie } });

    // Bu bir "gevşeklik" değil, matrisin bilinçli kararı: finansal kayıtları OKUMAK ekibin
    // günlük işidir (bkz. `src/lib/authz/permissions.ts`). Değişirse burası kırmızıya döner.
    expect(response.status()).toBe(200);
  });

  test("para değerleri JSON'da STRING taşınır — number değil", async ({ request }) => {
    const tenant = await createTenant("ContractDash");
    // `number` olsaydı 0.1 + 0.2 tuzağına düşen bir istemci üretirdik; sözleşme string olmalı.
    await seedFinancials(tenant.id, "TRY", "12345678901.2345");

    const { cookie } = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const response = await request.get(summaryPath(tenant.id), { headers: { cookie } });
    expect(response.status()).toBe(200);

    const { summary } = (await response.json()) as {
      summary: {
        balancesByCurrency: Array<{ balance: unknown }>;
        currentMonth: { flows: Array<{ income: unknown; expense: unknown; net: unknown }> };
        trend: { series: Array<{ max: unknown; points: Array<{ income: unknown }> }> };
      };
    };

    expect(typeof summary.balancesByCurrency[0].balance).toBe("string");
    expect(summary.balancesByCurrency[0].balance).toBe("12345678901.2345");

    for (const flow of summary.currentMonth.flows) {
      expect(typeof flow.income).toBe("string");
      expect(typeof flow.expense).toBe("string");
      expect(typeof flow.net).toBe("string");
    }
    for (const series of summary.trend.series) {
      expect(typeof series.max).toBe("string");
      for (const point of series.points) {
        expect(typeof point.income).toBe("string");
      }
    }
  });

  test("GET yan etkisizdir: çağrı hiçbir kaydı değiştirmez", async ({ request }) => {
    const tenant = await createTenant("SideEffectDash");
    const accountId = await seedFinancials(tenant.id, "TRY", "100");

    const before = await prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      select: { balance: true, updatedAt: true },
    });

    const { cookie } = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    expect((await request.get(summaryPath(tenant.id), { headers: { cookie } })).status()).toBe(200);

    const after = await prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      select: { balance: true, updatedAt: true },
    });

    // CSRF koruması `SameSite=Lax` üzerine kuruludur ve Lax, cross-site GET'i ENGELLEMEZ
    // (invariant #4). Yan etkili tek bir GET, o korumayı bu endpoint için tamamen kaldırırdı.
    expect(after.balance.toString()).toBe(before.balance.toString());
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(await prisma.auditLog.count({ where: { tenantId: tenant.id } })).toBe(0);
  });
});
