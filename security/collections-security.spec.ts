import { randomUUID } from "node:crypto";
import { MembershipRole, PaymentMethod } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { prisma } from "../src/lib/prisma";
import {
  combineCookieHeaders,
  createActiveTenantCookieHeader,
  createSessionCookieHeader,
} from "./support/session";

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

test.afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

async function createTenant(
  label: string,
  modules: { crm?: boolean; collections?: boolean } = {},
) {
  const { crm = true, collections = true } = modules;
  const tenant = await prisma.tenant.create({
    data: {
      name: label,
      slug: `${label.toLowerCase()}-${randomUUID()}`,
      modules: {
        createMany: {
          data: [
            { moduleKey: "crm", enabled: crm },
            { moduleKey: "collections", enabled: collections },
          ],
        },
      },
    },
    select: { id: true },
  });
  createdTenantIds.push(tenant.id);
  return tenant;
}

async function createUserWithMembership(role: MembershipRole, tenantId: string) {
  const email = `sec-collections-${randomUUID()}@example.com`;
  const user = await prisma.user.create({ data: { email }, select: { id: true } });
  createdUserIds.push(user.id);
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

    const scopedRes = await request.get(`/api/tenants/${tenantB.id}/collections/plans/${planA.id}`, {
      headers: { cookie: ownerB.cookie },
    });
    expect(scopedRes.status()).toBe(404);
  });

  test("collections modülü kapalıyken endpoint'ler 404 döner (403 DEĞİL)", async ({ request }) => {
    // Kapalı modül o tenant için VAR OLMAYAN bir yüzeydir; 403 "bu özellik var ama sen
    // açmamışsın" bilgisini sızdırırdı (invariant #7 — cross-tenant kayıtlarla aynı duruş).
    //
    // BAĞIMLILIK CASCADE'İ BURADA TEST EDİLMEZ ve bu bilinçlidir: #151'in kararına göre
    // `collections` → `crm` bağımlılığı AÇMA anında (`setModuleEnabled`) zorlanır, okuma
    // anında değil. Bu testler tenant satırlarını doğrudan yazdığı için o kapıdan geçmez;
    // dolayısıyla test yalnızca guard'ın kendi kararını doğrular. "Bağımlılık okuma anında da
    // zorlanmalı mı?" sorusu #151/#152'ye aittir.
    const disabled = await createTenant("SecModuleDisabled", { collections: false });
    const disabledOwner = await createUserWithMembership(MembershipRole.OWNER, disabled.id);

    const planBody = {
      dealId: "irrelevant-id",
      totalAmount: "100.00",
      currency: "TRY",
      method: "CASH",
      installmentCount: 1,
      firstDueDate: new Date().toISOString(),
    };

    const res = await request.post(`/api/tenants/${disabled.id}/collections/plans`, {
      headers: { cookie: disabledOwner.cookie },
      data: planBody,
    });
    expect(res.status()).toBe(404);

    // KONTROL GRUBU: aynı istek, aynı rol, modül AÇIK. 404 gelmemeli — aksi halde yukarıdaki
    // beklenti "modül kapalı olduğu için" değil, isteğin başka bir nedenle başarısız
    // olmasından ötürü yeşil kalırdı (dealId geçersiz olduğu için burada 404 değil 400/404
    // ayrımı önemlidir: servis "İlişkili süreç bulunamadı" için de 404 döner, bu yüzden
    // kontrol grubu geçerli bir deal ile kurulur).
    const enabled = await createTenant("SecModuleEnabled");
    const enabledOwner = await createUserWithMembership(MembershipRole.OWNER, enabled.id);
    const deal = await seedDeal(enabled.id);

    const controlRes = await request.post(`/api/tenants/${enabled.id}/collections/plans`, {
      headers: { cookie: enabledOwner.cookie },
      data: { ...planBody, dealId: deal.id },
    });
    expect(controlRes.status()).toBe(201);
  });
});
