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
 * Denetim kaydı LİSTELEME API'si — saldırgan bakışı (Issue #78).
 *
 * `audit-log-security.spec.ts` ile karıştırılmamalı: o dosya kaydın YAZILMASINI test eder
 * (#15/#16 — hangi olayda satır oluşur, plaintext şifre sızar mı). Buradaki konu OKUMA yolu:
 * kim listeyi görebilir, komşunun satırları sızar mı, imleç kurcalanabilir mi.
 *
 * Denetim kaydı, bir tenant'ın İÇ HAREKETLERİNİ anlatır: kim ne zaman kimi çıkardı, hangi hesap
 * silindi, hangi rol yükseltildi. Sızması, komşu tenant hakkında başka hiçbir endpoint'in
 * vermediği bir istihbarat verirdi.
 */

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

test.afterAll(async () => {
  if (createdTenantIds.length > 0) {
    await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

async function createTenant(label: string) {
  const tenant = await prisma.tenant.create({
    data: { name: label, slug: `${label.toLowerCase()}-${randomUUID()}` },
    select: { id: true },
  });
  createdTenantIds.push(tenant.id);
  return tenant;
}

async function createUserWithMembership(role: MembershipRole, tenantId: string) {
  const email = `sec-audit-list-${randomUUID()}@example.com`;
  const user = await prisma.user.create({ data: { email }, select: { id: true } });
  createdUserIds.push(user.id);
  await prisma.membership.create({ data: { userId: user.id, tenantId, role } });

  const cookie = combineCookieHeaders(
    await createSessionCookieHeader({ sub: user.id, email }),
    await createActiveTenantCookieHeader(tenantId),
  );

  return { userId: user.id, email, cookie };
}

async function seedEntry(tenantId: string, action: string) {
  return prisma.auditLog.create({
    data: { tenantId, action, targetType: "TENANT", targetId: tenantId },
    select: { id: true },
  });
}

test.describe("Audit log API — authentication ve yetki", () => {
  test("kimliksiz istek 401 alır ve hiçbir kayıt sızmaz", async ({ request }) => {
    const tenant = await createTenant("SecAuditAnon");
    await seedEntry(tenant.id, "SECRET_EVENT");

    const response = await request.get(`/api/tenants/${tenant.id}/audit-log`);

    expect(response.status()).toBe(401);
    expect(await response.text()).not.toContain("SECRET_EVENT");
  });

  test("MEMBER 403 alır (denetim kaydı bir yönetim görünürlüğüdür)", async ({ request }) => {
    const tenant = await createTenant("SecAuditMember");
    const member = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);
    await seedEntry(tenant.id, "MEMBER_MUST_NOT_SEE");

    const response = await request.get(`/api/tenants/${tenant.id}/audit-log`, {
      headers: { cookie: member.cookie },
    });

    expect(response.status()).toBe(403);
    expect(await response.text()).not.toContain("MEMBER_MUST_NOT_SEE");
  });

  test("DUYARLILIK: aynı istek ADMIN ile 200 döner — 403 role bağlı, endpoint'e değil", async ({
    request,
  }) => {
    // Bu kontrol grubu olmadan, endpoint'i HERKESE kapatan bir regresyon da yukarıdaki testi
    // geçerdi. `VIEW_AUDIT_LOG` matriste OWNER ve ADMIN'dedir (permissions.ts).
    const tenant = await createTenant("SecAuditAdmin");
    const admin = await createUserWithMembership(MembershipRole.ADMIN, tenant.id);
    await seedEntry(tenant.id, "ADMIN_CAN_SEE");

    const response = await request.get(`/api/tenants/${tenant.id}/audit-log`, {
      headers: { cookie: admin.cookie },
    });

    expect(response.status()).toBe(200);
    const body = (await response.json()) as { entries: Array<{ action: string }> };
    expect(body.entries.map((entry) => entry.action)).toContain("ADMIN_CAN_SEE");
  });
});

test.describe("Audit log API — tenant izolasyonu", () => {
  test("URL'deki tenantId aktif tenant'tan farklıysa 403 ve komşunun kaydı sızmaz", async ({
    request,
  }) => {
    const tenantA = await createTenant("SecAuditA");
    const tenantB = await createTenant("SecAuditB");
    const ownerB = await createUserWithMembership(MembershipRole.OWNER, tenantB.id);
    await seedEntry(tenantA.id, "NEIGHBOUR_SECRET");

    const response = await request.get(`/api/tenants/${tenantA.id}/audit-log`, {
      headers: { cookie: ownerB.cookie },
    });

    expect(response.status()).toBe(403);
    expect(await response.text()).not.toContain("NEIGHBOUR_SECRET");
  });

  test("KENDİ tenant'ının URL'i altında bile komşunun kayıtları görünmüyor", async ({
    request,
  }) => {
    // Asıl sorgu-seviyesi izolasyon testi budur: yukarıdaki 403 guard'dan geliyor ve
    // `tenantScoped()` tamamen silinse bile yeşil kalırdı.
    const tenantA = await createTenant("SecAuditScopeA");
    const tenantB = await createTenant("SecAuditScopeB");
    const ownerB = await createUserWithMembership(MembershipRole.OWNER, tenantB.id);

    await seedEntry(tenantA.id, "ONLY_IN_A");
    await seedEntry(tenantB.id, "ONLY_IN_B");

    const response = await request.get(`/api/tenants/${tenantB.id}/audit-log`, {
      headers: { cookie: ownerB.cookie },
    });

    expect(response.status()).toBe(200);
    const actions = ((await response.json()) as { entries: Array<{ action: string }> }).entries.map(
      (entry) => entry.action,
    );

    expect(actions).toContain("ONLY_IN_B");
    expect(actions).not.toContain("ONLY_IN_A");
  });

  test("KURCALANMIŞ imleç başka tenant'ın verisini AÇMIYOR", async ({ request }) => {
    // İmleç opaktır ama şifreli değildir ve olması da gerekmez: "hangi tenant" sorusunun cevabı
    // imleçte değil, `requirePermission()` context'indedir.
    const tenantA = await createTenant("SecAuditCursorA");
    const tenantB = await createTenant("SecAuditCursorB");
    const ownerB = await createUserWithMembership(MembershipRole.OWNER, tenantB.id);

    const entryA = await seedEntry(tenantA.id, "CURSOR_TARGET_A");
    await seedEntry(tenantB.id, "CURSOR_OWN_B");

    // A'nın satırından üretilmiş, biçimi GEÇERLİ bir imleç.
    const forged = Buffer.from(
      `${new Date(Date.now() + 60_000).toISOString()}|${entryA.id}`,
      "utf8",
    ).toString("base64url");

    const response = await request.get(
      `/api/tenants/${tenantB.id}/audit-log?after=${encodeURIComponent(forged)}`,
      { headers: { cookie: ownerB.cookie } },
    );

    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("CURSOR_TARGET_A");
    expect(text).toContain("CURSOR_OWN_B");
  });

  test("BOZUK imleç 400 döner: sessizce ilk sayfaya DÜŞMEZ", async ({ request }) => {
    const tenant = await createTenant("SecAuditBadCursor");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    await seedEntry(tenant.id, "SHOULD_NOT_APPEAR");

    const response = await request.get(`/api/tenants/${tenant.id}/audit-log?after=bozuk`, {
      headers: { cookie: owner.cookie },
    });

    expect(response.status()).toBe(400);
    expect(await response.text()).not.toContain("SHOULD_NOT_APPEAR");
  });
});

test.describe("Audit log API — yan etki ve sızıntı", () => {
  test("GET yan etkisizdir: listeyi okumak yeni bir kayıt ÜRETMEZ", async ({ request }) => {
    // Her okuma bir satır üretseydi liste kendi kendini besleyen bir gürültü kaynağına dönerdi
    // — ve GET'in yan etkisiz olması aynı zamanda CSRF duruşunun dayandığı invariant'tır (#4).
    const tenant = await createTenant("SecAuditNoWrite");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    await seedEntry(tenant.id, "BASELINE");

    const before = await prisma.auditLog.count({ where: { tenantId: tenant.id } });
    const response = await request.get(`/api/tenants/${tenant.id}/audit-log`, {
      headers: { cookie: owner.cookie },
    });
    expect(response.status()).toBe(200);
    const after = await prisma.auditLog.count({ where: { tenantId: tenant.id } });

    expect(after).toBe(before);
  });

  test("yanıt hassas kullanıcı alanı taşımıyor", async ({ request }) => {
    const tenant = await createTenant("SecAuditFields");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    await prisma.auditLog.create({
      data: { tenantId: tenant.id, actorUserId: owner.userId, action: "WITH_ACTOR" },
    });

    const response = await request.get(`/api/tenants/${tenant.id}/audit-log`, {
      headers: { cookie: owner.cookie },
    });
    const text = await response.text();

    expect(response.status()).toBe(200);
    // Aktörün e-postası BİLEREK dönüyor (kaydın anlamı için gerekli); dönmemesi gerekenler:
    for (const forbidden of ["passwordHash", "credentialsChangedAt", "sessionsRevokedAt"]) {
      expect(text).not.toContain(forbidden);
    }
    expect(text).toContain(owner.email);
  });

  test("şekli geçersiz tenantId 400 alır — kimlik kontrolüne bile gitmeden", async ({
    request,
  }) => {
    // `isValidId()` bir BİÇİM doğrulaması değil, ucuz bir ŞEKİL kontrolüdür (boş değil,
    // <= 191 karakter). Var olmayan ama şekli geçerli bir id 400 DEĞİL 401/403 alır: "bu id
    // var mı" sorusunun cevabı kimliği doğrulanmamış bir isteğe verilmez (enumeration engeli).
    const tooLong = "x".repeat(200);

    const response = await request.get(`/api/tenants/${tooLong}/audit-log`);
    expect(response.status()).toBe(400);

    // KONTROL GRUBU: şekli geçerli ama var olmayan bir id, 400 değil 401 alır — yani 400
    // gerçekten şekil kontrolünden geliyor, "bulunamadı"dan değil.
    const wellFormed = await request.get("/api/tenants/cmtnehmbe00isadzkw1rxa388/audit-log");
    expect(wellFormed.status()).toBe(401);
  });
});
