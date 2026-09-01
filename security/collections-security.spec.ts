import { randomUUID } from "node:crypto";
import { MembershipRole, PaymentMethod } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { prisma } from "../src/lib/prisma";
import {
  combineCookieHeaders,
  createActiveTenantCookieHeader,
  createSessionCookieHeader,
} from "./support/session";

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function createTenant(label: string, crmEnabled = true) {
  return prisma.tenant.create({
    data: {
      name: label,
      slug: `${label.toLowerCase()}-${randomUUID()}`,
      tenantModules: {
        createMany: {
          data: [
            { moduleKey: "crm", enabled: crmEnabled },
            { moduleKey: "collections", enabled: true },
          ],
        },
      },
    },
    select: { id: true },
  });
}

async function createUserWithMembership(role: MembershipRole, tenantId: string) {
  const email = `sec-collections-${randomUUID()}@example.com`;
  const user = await prisma.user.create({ data: { email }, select: { id: true } });
  await prisma.membership.create({ data: { userId: user.id, tenantId, role } });

  const cookie = combineCookieHeaders(
    await createSessionCookieHeader({ sub: user.id, email }),
    await createActiveTenantCookieHeader(tenantId),
  );

  return { userId: user.id, cookie };
}

async function seedDeal(tenantId: string) {
  return prisma.deal.create({
    data: { tenantId, title: `Sec Deal ${randomUUID()}`, status: "OPEN" },
    select: { id: true },
  });
}

test.describe("Tahsilat ve Ödeme Planı Güvenlik Testleri", () => {
  test("Kimliksiz istekler 401 Unauthorized dönmelidir", async ({ request }) => {
    const tenant = await createTenant("SecUnauth");
    const response = await request.post(`/api/tenants/${tenant.id}/collections/plans`, {
      data: {
        dealId: "random-id",
        totalAmount: "100.00",
        currency: "TRY",
        method: PaymentMethod.CASH,
        installmentCount: 1,
        firstDueDate: new Date().toISOString(),
      },
    });

    expect(response.status()).toBe(401);
  });

  test("MEMBER plan kuramaz (403), ancak var olan planı görebilir (200)", async ({ request }) => {
    const tenant = await createTenant("SecMember");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const member = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);
    const deal = await seedDeal(tenant.id);

    // 1. MEMBER plan kurmaya çalışır -> 403
    const memberCreateRes = await request.post(`/api/tenants/${tenant.id}/collections/plans`, {
      headers: { cookie: member.cookie },
      data: {
        dealId: deal.id,
        totalAmount: "500.00",
        currency: "TRY",
        method: PaymentMethod.CARD,
        installmentCount: 2,
        firstDueDate: new Date().toISOString(),
      },
    });
    expect(memberCreateRes.status()).toBe(403);

    // 2. OWNER plan kurar -> 201
    const ownerCreateRes = await request.post(`/api/tenants/${tenant.id}/collections/plans`, {
      headers: { cookie: owner.cookie },
      data: {
        dealId: deal.id,
        totalAmount: "500.00",
        currency: "TRY",
        method: PaymentMethod.CARD,
        installmentCount: 2,
        firstDueDate: new Date().toISOString(),
        installments: [{ sequence: 99, amount: "1.00" }],
      },
    });
    expect(ownerCreateRes.status()).toBe(201);
    const createdPlan = await ownerCreateRes.json();
    expect(createdPlan.installments).toHaveLength(2);
    expect(createdPlan.installments[0].sequence).toBe(1);
    expect(createdPlan.installments.some((installment: { sequence: number }) => installment.sequence === 99)).toBe(false);

    // 3. MEMBER planı okuyabilir -> 200
    const memberGetRes = await request.get(`/api/tenants/${tenant.id}/collections/plans/${createdPlan.id}`, {
      headers: { cookie: member.cookie },
    });
    expect(memberGetRes.status()).toBe(200);
  });

  test("Cross-Tenant İzolasyonu: Tenant B kullanıcısı Tenant A'nın planına erişemez (404/403)", async ({ request }) => {
    const tenantA = await createTenant("SecTenantA");
    const tenantB = await createTenant("SecTenantB");

    const ownerA = await createUserWithMembership(MembershipRole.OWNER, tenantA.id);
    const ownerB = await createUserWithMembership(MembershipRole.OWNER, tenantB.id);

    const dealA = await seedDeal(tenantA.id);

    const planRes = await request.post(`/api/tenants/${tenantA.id}/collections/plans`, {
      headers: { cookie: ownerA.cookie },
      data: {
        dealId: dealA.id,
        totalAmount: "1000.00",
        currency: "TRY",
        method: PaymentMethod.TRANSFER,
        installmentCount: 2,
        firstDueDate: new Date().toISOString(),
      },
    });
    expect(planRes.status()).toBe(201);
    const planA = await planRes.json();

    // Tenant B kullanıcısı Tenant A'nın planını getirmeye çalışır
    const crossRes = await request.get(`/api/tenants/${tenantA.id}/collections/plans/${planA.id}`, {
      headers: { cookie: ownerB.cookie },
    });

    expect(crossRes.status()).toBe(403);
  });

  test("crm modülü devre dışıyken collections endpoint'leri 404 döner", async ({ request }) => {
    // Kontrol grubu: crm modülü açık olan tenant'ta normal çalışır.
    // Deney: crm modülünü TenantModule kaydıyla explicit olarak kapattığımızda
    // collections endpoint'inin 404 döndüğü doğrulanır — sistem yüzeyi gizleme kararı.
    const tenant = await createTenant("SecModuleDisabled", false);
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    // collections, crm'e bağımlı; crm kapalıyken collections da kapalı sayılır → 404.
    const res = await request.post(`/api/tenants/${tenant.id}/collections/plans`, {
      headers: { cookie: owner.cookie },
      data: {
        dealId: "irrelevant-id",
        totalAmount: "100.00",
        currency: "TRY",
        method: "CASH",
        installmentCount: 1,
        firstDueDate: new Date().toISOString(),
      },
    });

    expect(res.status()).toBe(404);
  });
});
