import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { expect, test } from "@playwright/test";

import { registerUser } from "../src/lib/auth/signup";
import {
  encodeActiveTenantCookie,
  resolveActiveTenant,
  setActiveTenantCookie,
} from "../src/lib/tenants/active-tenant";
import { listTenantsForUser } from "../src/lib/tenants/user-tenants";
import { prisma } from "../src/lib/prisma";

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function createUser() {
  const email = `active-tenant-${randomUUID()}@example.com`;
  const result = await registerUser({ email, password: "S3curePassw0rd!" });
  if (!result.ok) throw new Error("test setup failed: registerUser");
  return result.user.id;
}

async function createTenant() {
  return prisma.tenant.create({ data: { name: "Test Co", slug: `test-co-${randomUUID()}` } });
}

async function addMember(userId: string, tenantId: string, role: "OWNER" | "ADMIN" | "MEMBER" = "MEMBER") {
  return prisma.membership.create({ data: { userId, tenantId, role } });
}

async function cleanup(userIds: string[], tenantIds: string[]) {
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

test.describe("listTenantsForUser()", () => {
  test("kullanıcı sadece kendi üyesi olduğu tenant'ları görür", async () => {
    const userId = await createUser();
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    await addMember(userId, tenantA.id, "OWNER");

    // Başka bir kullanıcı + tenant: sızmamalı.
    const otherUserId = await createUser();
    await addMember(otherUserId, tenantB.id, "OWNER");

    try {
      const tenants = await listTenantsForUser(userId);
      expect(tenants).toHaveLength(1);
      expect(tenants[0].id).toBe(tenantA.id);
      expect(tenants[0].role).toBe("OWNER");
      expect(tenants.some((t) => t.id === tenantB.id)).toBe(false);
    } finally {
      await cleanup([userId, otherUserId], [tenantA.id, tenantB.id]);
    }
  });

  test("hiç üyeliği olmayan kullanıcı için boş liste döner", async () => {
    const userId = await createUser();
    try {
      const tenants = await listTenantsForUser(userId);
      expect(tenants).toEqual([]);
    } finally {
      await cleanup([userId], []);
    }
  });
});

test.describe("resolveActiveTenant()", () => {
  test("geçerli cookie + gerçek membership ile context doğru çözülüyor", async () => {
    const userId = await createUser();
    const tenant = await createTenant();
    await addMember(userId, tenant.id, "ADMIN");

    try {
      const cookie = await encodeActiveTenantCookie(tenant.id);
      const result = await resolveActiveTenant(userId, cookie);

      expect(result).not.toBeNull();
      expect(result?.tenant.id).toBe(tenant.id);
      expect(result?.role).toBe("ADMIN");
    } finally {
      await cleanup([userId], [tenant.id]);
    }
  });

  test("cookie yoksa null döner", async () => {
    const userId = await createUser();
    try {
      await expect(resolveActiveTenant(userId, null)).resolves.toBeNull();
      await expect(resolveActiveTenant(userId, undefined)).resolves.toBeNull();
    } finally {
      await cleanup([userId], []);
    }
  });

  test("kurcalanmış/geçersiz cookie null döner, hata fırlatmaz", async () => {
    const userId = await createUser();
    try {
      await expect(resolveActiveTenant(userId, "not-a-valid-token")).resolves.toBeNull();
    } finally {
      await cleanup([userId], []);
    }
  });

  test("membership silindikten sonra eski (stale) cookie artık geçerli kabul edilmiyor", async () => {
    const userId = await createUser();
    const tenant = await createTenant();
    const membership = await addMember(userId, tenant.id, "MEMBER");

    try {
      const cookie = await encodeActiveTenantCookie(tenant.id);

      const before = await resolveActiveTenant(userId, cookie);
      expect(before).not.toBeNull();

      await prisma.membership.delete({ where: { id: membership.id } });

      const after = await resolveActiveTenant(userId, cookie);
      expect(after).toBeNull();
    } finally {
      await cleanup([userId], [tenant.id]);
    }
  });

  test("üyesi olunmayan bir tenant için üretilmiş cookie kabul edilmiyor (enjeksiyon/enumeration koruması)", async () => {
    const userId = await createUser();
    const ownTenant = await createTenant();
    const otherTenant = await createTenant();
    await addMember(userId, ownTenant.id, "OWNER");
    // userId, otherTenant'a hiç üye değil.

    try {
      const cookieForOtherTenant = await encodeActiveTenantCookie(otherTenant.id);
      const result = await resolveActiveTenant(userId, cookieForOtherTenant);
      expect(result).toBeNull();
    } finally {
      await cleanup([userId], [ownTenant.id, otherTenant.id]);
    }
  });

  test("iki tenant arasında geçiş: cookie değiştiğinde context doğru tenant'a güncelleniyor", async () => {
    const userId = await createUser();
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    await addMember(userId, tenantA.id, "OWNER");
    await addMember(userId, tenantB.id, "MEMBER");

    try {
      const cookieA = await encodeActiveTenantCookie(tenantA.id);
      const resultA = await resolveActiveTenant(userId, cookieA);
      expect(resultA?.tenant.id).toBe(tenantA.id);
      expect(resultA?.role).toBe("OWNER");

      const cookieB = await encodeActiveTenantCookie(tenantB.id);
      const resultB = await resolveActiveTenant(userId, cookieB);
      expect(resultB?.tenant.id).toBe(tenantB.id);
      expect(resultB?.role).toBe("MEMBER");
    } finally {
      await cleanup([userId], [tenantA.id, tenantB.id]);
    }
  });
});

test.describe("setActiveTenantCookie() — Secure flag (Issue #16)", () => {
  // NOT: Auth.js'in kendi session cookie'sinin (`authjs.session-token`) Secure flag'i
  // kütüphane içinde `useSecureCookies = url.protocol === "https:"` ile OTOMATİK belirlenir
  // (bkz. @auth/core/lib/utils/cookie.js + init.js) — bizim kodumuzun kontrolünde DEĞİLDİR ve
  // bu iç implementasyon detayına bağımlı, kırılgan bir test yazmak yerine (issue #16'nın
  // kendi uyarısı) burada SADECE bizim sahip olduğumuz `setActiveTenantCookie()`'nin (bkz.
  // src/lib/tenants/active-tenant.ts) production invariant'ı doğrulanır: gerçek bir HTTPS
  // sunucusu ayağa kaldırmadan (yeni dependency/altyapı eklemeden), `NODE_ENV` kontrollü
  // şekilde geçici olarak "production" yapılıp Secure flag'in set edildiği kanıtlanır.
  // Next.js'in global tip tanımı `NODE_ENV`'i `readonly` yapar (bkz. next/types/global.d.ts);
  // burada BİLEREK sadece bu testin süresince, mutable bir view üzerinden geçici olarak
  // override edilir ve `afterEach`'te orijinaline geri döndürülür.
  const mutableEnv = process.env as Record<string, string | undefined>;
  const originalNodeEnv = mutableEnv.NODE_ENV;

  test.afterEach(() => {
    mutableEnv.NODE_ENV = originalNodeEnv;
  });

  test("test ortamında (production değil) Secure flag set EDİLMİYOR", async () => {
    expect(process.env.NODE_ENV).not.toBe("production");

    const response = NextResponse.json({});
    await setActiveTenantCookie(response, `tenant-${randomUUID()}`);

    const setCookieHeader = response.headers.get("set-cookie") ?? "";
    expect(setCookieHeader.toLowerCase()).not.toContain("secure");
  });

  test("NODE_ENV=production altında Secure flag set EDİLİYOR", async () => {
    mutableEnv.NODE_ENV = "production";

    const response = NextResponse.json({});
    await setActiveTenantCookie(response, `tenant-${randomUUID()}`);

    const setCookieHeader = response.headers.get("set-cookie") ?? "";
    expect(setCookieHeader.toLowerCase()).toContain("secure");
    expect(setCookieHeader.toLowerCase()).toContain("httponly");
    expect(setCookieHeader.toLowerCase()).toContain("samesite=lax");
  });
});
