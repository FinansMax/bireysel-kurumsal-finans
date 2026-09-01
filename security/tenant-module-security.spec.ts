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
 * Modül API'sinin saldırgan bakışıyla testleri (Issue #151).
 *
 * BU ENDPOINT'E ÖZGÜ RİSK: bir modülü açmak tenant'ın ÜRÜN YÜZEYİNİ değiştirir — yeni ekranlar,
 * yeni izinler, yeni veri. Yetkisiz bir açma, hiçbir finansal kaydı bozmadan tenant'ın
 * yapılandırmasını değiştirir; bu yüzden yönetim izni matriste OWNER-only'dir ve burada
 * ADMIN'in de reddedildiği ayrıca doğrulanır.
 *
 * İş kuralları (bağımlılıklar, katalog) `integration/tenant-module.spec.ts`tedir.
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
  const email = `sec-module-${randomUUID()}@example.com`;
  const user = await prisma.user.create({ data: { email }, select: { id: true } });
  await prisma.membership.create({ data: { userId: user.id, tenantId, role } });

  const cookie = combineCookieHeaders(
    await createSessionCookieHeader({ sub: user.id, email }),
    await createActiveTenantCookieHeader(tenantId),
  );

  return { userId: user.id, cookie };
}

function listPath(tenantId: string): string {
  return `/api/tenants/${tenantId}/modules`;
}

function itemPath(tenantId: string, moduleKey: string): string {
  return `/api/tenants/${tenantId}/modules/${moduleKey}`;
}

test.describe("Modules API — authentication zorunluluğu", () => {
  test("unauthenticated istekler 401 alır ve hiçbir modül açılmaz", async ({ request }) => {
    const tenant = await createTenant("NoAuthModule");

    try {
      const list = await request.get(listPath(tenant.id));
      expect(list.status()).toBe(401);

      const patched = await request.patch(itemPath(tenant.id, "crm"), {
        data: { enabled: true },
      });
      expect(patched.status()).toBe(401);

      expect(await prisma.tenantModule.count({ where: { tenantId: tenant.id } })).toBe(0);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
    }
  });
});

test.describe("Modules API — rol bazlı yetki", () => {
  test("MEMBER ve ADMIN listeyi GÖRÜR ama modül AÇAMAZ (403)", async ({ request }) => {
    const tenant = await createTenant("RoleModule");
    const member = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);
    const admin = await createUserWithMembership(MembershipRole.ADMIN, tenant.id);

    try {
      // Görüntüleme her role açıktır: menüyü kurabilmek için hangi modüllerin açık olduğunu
      // bilmek gerekir ve bu bilgi bir sır değildir.
      for (const actor of [member, admin]) {
        const list = await request.get(listPath(tenant.id), {
          headers: { cookie: actor.cookie },
        });
        expect(list.status()).toBe(200);
      }

      // Yönetim OWNER-only'dir. ADMIN'in de reddedilmesi, matristeki genel
      // "OWNER+ADMIN yönetir" kalıbının BİLİNÇLİ istisnasıdır.
      for (const actor of [member, admin]) {
        const patched = await request.patch(itemPath(tenant.id, "crm"), {
          headers: { cookie: actor.cookie },
          data: { enabled: true },
        });
        expect(patched.status()).toBe(403);
      }

      expect(await prisma.tenantModule.count({ where: { tenantId: tenant.id } })).toBe(0);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.deleteMany({ where: { id: { in: [member.userId, admin.userId] } } });
    }
  });

  test("KONTROL GRUBU: OWNER aynı isteği yapabiliyor", async ({ request }) => {
    // Duyarlılık kanıtı: yukarıdaki 403'ler endpoint hep 403 dönseydi de geçerdi.
    const tenant = await createTenant("OwnerModule");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    try {
      const patched = await request.patch(itemPath(tenant.id, "crm"), {
        headers: { cookie: owner.cookie },
        data: { enabled: true },
      });
      expect(patched.status()).toBe(200);

      const { module } = (await patched.json()) as { module: { key: string; enabled: boolean } };
      expect(module).toMatchObject({ key: "crm", enabled: true });
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });
});

test.describe("Modules API — tenant izolasyonu / IDOR", () => {
  test("URL'deki tenantId aktif tenant'tan farklıysa 403 ve komşu ETKİLENMEZ", async ({
    request,
  }) => {
    const mine = await createTenant("MineModule");
    const theirs = await createTenant("TheirsModule");
    const owner = await createUserWithMembership(MembershipRole.OWNER, mine.id);

    try {
      const list = await request.get(listPath(theirs.id), { headers: { cookie: owner.cookie } });
      expect(list.status()).toBe(403);

      const patched = await request.patch(itemPath(theirs.id, "crm"), {
        headers: { cookie: owner.cookie },
        data: { enabled: true },
      });
      expect(patched.status()).toBe(403);

      // Komşunun ürün yüzeyi değişmemeli.
      expect(await prisma.tenantModule.count({ where: { tenantId: theirs.id } })).toBe(0);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [mine.id, theirs.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("bir tenant'ta açılan modül DİĞERİNİN yanıtında kapalı görünüyor", async ({ request }) => {
    const mine = await createTenant("IsolatedModuleA");
    const theirs = await createTenant("IsolatedModuleB");
    const mineOwner = await createUserWithMembership(MembershipRole.OWNER, mine.id);
    const theirsOwner = await createUserWithMembership(MembershipRole.OWNER, theirs.id);

    try {
      const enabled = await request.patch(itemPath(theirs.id, "crm"), {
        headers: { cookie: theirsOwner.cookie },
        data: { enabled: true },
      });
      expect(enabled.status()).toBe(200);

      const list = await request.get(listPath(mine.id), {
        headers: { cookie: mineOwner.cookie },
      });
      expect(list.status()).toBe(200);

      const { modules } = (await list.json()) as {
        modules: Array<{ key: string; enabled: boolean }>;
      };
      // Komşunun hangi modülleri kullandığı da bir bilgidir; sızmamalı.
      expect(modules.every((entry) => entry.enabled === false)).toBe(true);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [mine.id, theirs.id] } } });
      await prisma.user.deleteMany({
        where: { id: { in: [mineOwner.userId, theirsOwner.userId] } },
      });
    }
  });
});

test.describe("Modules API — girdi doğrulama ve sözleşme", () => {
  test("katalogda olmayan modül anahtarı 400 alır ve satır oluşmaz", async ({ request }) => {
    const tenant = await createTenant("BadKeyModule");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    try {
      for (const key of ["CRM", "uydurma", "toString", "..%2F..%2Fetc"]) {
        const response = await request.patch(itemPath(tenant.id, key), {
          headers: { cookie: owner.cookie },
          data: { enabled: true },
        });
        expect(response.status(), `beklenen 400: ${key}`).toBe(400);
      }

      expect(await prisma.tenantModule.count({ where: { tenantId: tenant.id } })).toBe(0);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("`enabled` boolean değilse 400 (string 'true' kabul edilmez)", async ({ request }) => {
    const tenant = await createTenant("BadFlagModule");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    try {
      for (const enabled of ["true", 1, null]) {
        const response = await request.patch(itemPath(tenant.id, "crm"), {
          headers: { cookie: owner.cookie },
          data: { enabled },
        });
        expect(response.status(), `beklenen 400: ${JSON.stringify(enabled)}`).toBe(400);
      }

      expect(await prisma.tenantModule.count({ where: { tenantId: tenant.id } })).toBe(0);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("bağımlılık ihlali 409 döner ve bağımlı modül SESSİZCE açılmaz", async ({ request }) => {
    const tenant = await createTenant("DependencyModule");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    try {
      const response = await request.patch(itemPath(tenant.id, "collections"), {
        headers: { cookie: owner.cookie },
        data: { enabled: true },
      });
      expect(response.status()).toBe(409);

      // Bağımlılığı otomatik açmak, tenant'ın ürün yüzeyini kullanıcının istemediği bir
      // şekilde genişletirdi.
      expect(await prisma.tenantModule.count({ where: { tenantId: tenant.id } })).toBe(0);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("body'deki tenantId/moduleKey alanları YOK SAYILIYOR", async ({ request }) => {
    const mine = await createTenant("SpoofModule");
    const theirs = await createTenant("SpoofTargetModule");
    const owner = await createUserWithMembership(MembershipRole.OWNER, mine.id);

    try {
      const response = await request.patch(itemPath(mine.id, "crm"), {
        headers: { cookie: owner.cookie },
        // Gövdeden gelen hiçbir değer scope ya da hedef belirlemez: tenant context'ten,
        // modül anahtarı URL segmentinden gelir.
        data: { enabled: true, tenantId: theirs.id, moduleKey: "collections" },
      });
      expect(response.status()).toBe(200);

      expect(await prisma.tenantModule.count({ where: { tenantId: theirs.id } })).toBe(0);
      const rows = await prisma.tenantModule.findMany({ where: { tenantId: mine.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].moduleKey).toBe("crm");
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [mine.id, theirs.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("GET yan etkisizdir: liste çağrısı satır OLUŞTURMAZ", async ({ request }) => {
    const tenant = await createTenant("SideEffectModule");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    try {
      const response = await request.get(listPath(tenant.id), {
        headers: { cookie: owner.cookie },
      });
      expect(response.status()).toBe(200);

      const { modules } = (await response.json()) as { modules: Array<{ enabled: boolean }> };
      expect(modules.length).toBeGreaterThanOrEqual(2);

      // "Eksik satırları tembel kur" gibi bir davranış, `GET`i yan etkili yapardı
      // (invariant #4) ve CSRF korumasının dayandığı varsayımı bozardı.
      expect(await prisma.tenantModule.count({ where: { tenantId: tenant.id } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { tenantId: tenant.id } })).toBe(0);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });
});
