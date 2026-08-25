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
 * `Category` API'sinin saldırgan bakışıyla testleri (Issue #49).
 *
 * Konu: kimlik doğrulama zorunluluğu, rol bazlı yetki (MEMBER görür ama yönetemez), tenant
 * izolasyonu / IDOR, client input spoofing ve hata yanıtlarının bilgi sızdırmaması. İş
 * kuralları (doğrulama, tür+isim benzersizliği) `integration/category.spec.ts`'tedir.
 */

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function createTenant(label: string) {
  return prisma.tenant.create({
    data: { name: label, slug: `${label.toLowerCase()}-${randomUUID()}` },
    select: { id: true },
  });
}

async function createUserWithMembership(role: MembershipRole, tenantId: string) {
  const email = `sec-category-${randomUUID()}@example.com`;
  const user = await prisma.user.create({ data: { email }, select: { id: true } });
  await prisma.membership.create({ data: { userId: user.id, tenantId, role } });

  const cookie = combineCookieHeaders(
    await createSessionCookieHeader({ sub: user.id, email }),
    await createActiveTenantCookieHeader(tenantId),
  );

  return { userId: user.id, cookie };
}

async function createCategoryRow(tenantId: string, name = `Kategori ${randomUUID()}`) {
  return prisma.category.create({
    data: { tenantId, name, type: "EXPENSE" },
    select: { id: true, name: true },
  });
}

test.describe("Category API — authentication zorunluluğu", () => {
  test("unauthenticated istekler 401 alır ve hiçbir şey oluşmaz", async ({ request }) => {
    const tenant = await createTenant("CatNoAuth");

    try {
      const list = await request.get(`/api/tenants/${tenant.id}/categories`);
      expect(list.status()).toBe(401);

      const create = await request.post(`/api/tenants/${tenant.id}/categories`, {
        data: { name: "Gizli", type: "EXPENSE" },
      });
      expect(create.status()).toBe(401);

      expect(await prisma.category.count({ where: { tenantId: tenant.id } })).toBe(0);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
    }
  });

  test("uydurma session cookie'si kabul edilmiyor", async ({ request }) => {
    const tenant = await createTenant("CatFakeCookie");

    try {
      const response = await request.get(`/api/tenants/${tenant.id}/categories`, {
        headers: { cookie: "authjs.session-token=uydurma-deger" },
      });
      expect(response.status()).toBe(401);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
    }
  });
});

test.describe("Category API — rol bazlı yetki", () => {
  test("MEMBER kategorileri GÖRÜR ama oluşturamaz/güncelleyemez/silemez (403)", async ({
    request,
  }) => {
    const tenant = await createTenant("CatRoleCheck");
    const member = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);
    const category = await createCategoryRow(tenant.id, "Market");

    try {
      // Görüntüleme: izin matrisi MEMBER'a VIEW_CATEGORIES verir (işlem kaydederken seçecek).
      const list = await request.get(`/api/tenants/${tenant.id}/categories`, {
        headers: { cookie: member.cookie },
      });
      expect(list.status()).toBe(200);
      expect(((await list.json()) as { categories: unknown[] }).categories).toHaveLength(1);

      // Yönetim: MANAGE_CATEGORIES yok → 403.
      const create = await request.post(`/api/tenants/${tenant.id}/categories`, {
        headers: { cookie: member.cookie },
        data: { name: "Yeni", type: "INCOME" },
      });
      expect(create.status()).toBe(403);

      const patch = await request.patch(`/api/tenants/${tenant.id}/categories/${category.id}`, {
        headers: { cookie: member.cookie },
        data: { name: "Ele Gecti" },
      });
      expect(patch.status()).toBe(403);

      const remove = await request.delete(`/api/tenants/${tenant.id}/categories/${category.id}`, {
        headers: { cookie: member.cookie },
      });
      expect(remove.status()).toBe(403);

      // Kontrol grubu: hiçbir yazma gerçekleşmemiş olmalı.
      const rows = await prisma.category.findMany({ where: { tenantId: tenant.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("Market");
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: member.userId } });
    }
  });

  test("ADMIN kategori yönetebiliyor (duyarlılık kanıtı: 403'ler role bağlı, endpoint'e değil)", async ({
    request,
  }) => {
    const tenant = await createTenant("CatAdminOk");
    const admin = await createUserWithMembership(MembershipRole.ADMIN, tenant.id);

    try {
      const create = await request.post(`/api/tenants/${tenant.id}/categories`, {
        headers: { cookie: admin.cookie },
        data: { name: "Admin Kategorisi", type: "INCOME" },
      });
      expect(create.status()).toBe(201);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: admin.userId } });
    }
  });
});

test.describe("Category API — tenant izolasyonu / IDOR", () => {
  test("başka tenant'ın kategorisi, kendi tenant'ının URL'i altında bile güncellenemez (404)", async ({
    request,
  }) => {
    const tenant = await createTenant("CatOwn");
    const foreignTenant = await createTenant("CatForeign");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const foreignCategory = await createCategoryRow(foreignTenant.id, "Yabanci Kategori");

    try {
      const response = await request.patch(
        `/api/tenants/${tenant.id}/categories/${foreignCategory.id}`,
        { headers: { cookie: owner.cookie }, data: { name: "Ele Gecti" } },
      );
      expect(response.status()).toBe(404);

      const unchanged = await prisma.category.findUniqueOrThrow({
        where: { id: foreignCategory.id },
      });
      expect(unchanged.name).toBe("Yabanci Kategori");
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [tenant.id, foreignTenant.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("cross-tenant geçerli id ile hiç var olmayan id AYNI yanıtı veriyor (enumeration engeli)", async ({
    request,
  }) => {
    const tenant = await createTenant("CatEnum");
    const foreignTenant = await createTenant("CatEnumForeign");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const foreignCategory = await createCategoryRow(foreignTenant.id);

    try {
      const crossTenant = await request.delete(
        `/api/tenants/${tenant.id}/categories/${foreignCategory.id}`,
        { headers: { cookie: owner.cookie } },
      );
      const nonExistent = await request.delete(
        `/api/tenants/${tenant.id}/categories/cat-${randomUUID()}`,
        { headers: { cookie: owner.cookie } },
      );

      expect(crossTenant.status()).toBe(nonExistent.status());
      expect(await crossTenant.json()).toEqual(await nonExistent.json());

      expect(await prisma.category.count({ where: { id: foreignCategory.id } })).toBe(1);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [tenant.id, foreignTenant.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("aktif tenant URL'deki tenantId'den farklıysa 403 (üyesi olsa bile)", async ({ request }) => {
    const activeTenant = await createTenant("CatActive");
    const otherTenant = await createTenant("CatOther");
    const owner = await createUserWithMembership(MembershipRole.OWNER, activeTenant.id);
    // Kullanıcı diğer tenant'ta da OWNER: engel izin matrisinden değil, aktif tenant
    // tutarlılık kontrolünden gelmeli.
    await prisma.membership.create({
      data: { userId: owner.userId, tenantId: otherTenant.id, role: MembershipRole.OWNER },
    });
    await createCategoryRow(otherTenant.id);

    try {
      const response = await request.get(`/api/tenants/${otherTenant.id}/categories`, {
        headers: { cookie: owner.cookie },
      });
      expect(response.status()).toBe(403);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [activeTenant.id, otherTenant.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("tür filtresi tenant scope'unu baypas etmiyor (?type ile de sızıntı yok)", async ({
    request,
  }) => {
    const tenant = await createTenant("CatListOwn");
    const foreignTenant = await createTenant("CatListForeign");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    await createCategoryRow(tenant.id, "Benim Kategorim");
    await prisma.category.create({
      data: { tenantId: foreignTenant.id, name: "Yabanci Kategorim", type: "EXPENSE" },
    });

    try {
      const response = await request.get(`/api/tenants/${tenant.id}/categories?type=EXPENSE`, {
        headers: { cookie: owner.cookie },
      });
      expect(response.status()).toBe(200);

      const { categories } = (await response.json()) as { categories: Array<{ name: string }> };
      expect(categories).toHaveLength(1);
      expect(categories[0].name).toBe("Benim Kategorim");

      const body = JSON.stringify(categories);
      expect(body).not.toContain("Yabanci Kategorim");
      expect(body).not.toContain(foreignTenant.id);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [tenant.id, foreignTenant.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });
});

test.describe("Category API — client input spoofing", () => {
  test("body'deki tenantId/id alanları YOK SAYILIYOR", async ({ request }) => {
    const tenant = await createTenant("CatSpoof");
    const foreignTenant = await createTenant("CatSpoofForeign");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    try {
      const response = await request.post(`/api/tenants/${tenant.id}/categories`, {
        headers: { cookie: owner.cookie },
        data: {
          name: "Spoof Kategorisi",
          type: "EXPENSE",
          // Saldırganın kaydı başka bir tenant'a yazdırma denemesi.
          tenantId: foreignTenant.id,
          id: "attacker-controlled-id",
        },
      });
      expect(response.status()).toBe(201);

      const { category } = (await response.json()) as { category: { id: string } };
      expect(category.id).not.toBe("attacker-controlled-id");

      const row = await prisma.category.findUniqueOrThrow({ where: { id: category.id } });
      expect(row.tenantId).toBe(tenant.id);
      expect(await prisma.category.count({ where: { tenantId: foreignTenant.id } })).toBe(0);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [tenant.id, foreignTenant.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("geçersiz ?type sessizce yok sayılmıyor (400)", async ({ request }) => {
    const tenant = await createTenant("CatBadFilter");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    await createCategoryRow(tenant.id);

    try {
      // Sessizce yok saymak, filtre uygulandığını sanan istemciye TÜM listeyi döndürürdü.
      const response = await request.get(`/api/tenants/${tenant.id}/categories?type=TRANSFER`, {
        headers: { cookie: owner.cookie },
      });
      expect(response.status()).toBe(400);

      // Duyarlılık kanıtı: geçerli değerle aynı endpoint 200 döner.
      const valid = await request.get(`/api/tenants/${tenant.id}/categories?type=EXPENSE`, {
        headers: { cookie: owner.cookie },
      });
      expect(valid.status()).toBe(200);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("hata yanıtları iç durum sızdırmıyor (stack trace / Prisma detayı yok)", async ({
    request,
  }) => {
    const tenant = await createTenant("CatErrShape");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    try {
      const response = await request.post(`/api/tenants/${tenant.id}/categories`, {
        headers: { cookie: owner.cookie },
        data: { name: "A", type: "EXPENSE" },
      });
      expect(response.status()).toBe(400);

      const text = await response.text();
      expect(text).not.toMatch(/prisma|PrismaClient|at .*\(.*\.ts:|stack/i);
      expect(Object.keys((await response.json()) as Record<string, unknown>)).toEqual(["error"]);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("çakışma yanıtı (409) hangi kaydın var olduğunu sızdırmıyor", async ({ request }) => {
    const tenant = await createTenant("CatConflict");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const existing = await createCategoryRow(tenant.id, "Market");

    try {
      const response = await request.post(`/api/tenants/${tenant.id}/categories`, {
        headers: { cookie: owner.cookie },
        data: { name: "Market", type: "EXPENSE" },
      });
      expect(response.status()).toBe(409);

      // Yanıt "bu isim zaten var" der; ÇAKIŞAN KAYDIN id'sini vermez.
      const text = await response.text();
      expect(text).not.toContain(existing.id);
      expect(Object.keys((await response.json()) as Record<string, unknown>)).toEqual(["error"]);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });
});
