import { randomUUID } from "node:crypto";

import { MembershipRole } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { prisma } from "../src/lib/prisma";
import { processPendingExports, requestTenantDataExport } from "../src/lib/export/tenant-export-service";

import { uniqueTestClientIp } from "../e2e/support/rate-limit";
import { createActiveTenantCookieHeader, combineCookieHeaders, createSessionCookieHeader } from "./support/session";

/**
 * Issue #194 — dışa aktarma, saldırgan bakışıyla ve gerçek HTTP üzerinden.
 */

const EXPORT_DIR = `.data/test-exports-sec-${randomUUID()}`;

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function createMember(role: MembershipRole): Promise<{ userId: string; tenantId: string; email: string }> {
  const suffix = randomUUID();
  const user = await prisma.user.create({ data: { email: `exp-sec-${suffix}@example.com` } });
  const tenant = await prisma.tenant.create({
    data: { name: "Export Sec", slug: `exp-sec-${suffix}` },
  });
  await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, role } });

  return { userId: user.id, tenantId: tenant.id, email: user.email };
}

async function cookiesFor(userId: string, email: string, tenantId: string): Promise<string> {
  return combineCookieHeaders(
    await createSessionCookieHeader({ sub: userId, email }),
    await createActiveTenantCookieHeader(tenantId),
  );
}

test.describe("Yetkilendirme", () => {
  test("OWNER dışa aktarabiliyor (202)", async ({ request }) => {
    const owner = await createMember(MembershipRole.OWNER);

    try {
      const response = await request.post(`/api/tenants/${owner.tenantId}/export`, {
        headers: {
          cookie: await cookiesFor(owner.userId, owner.email, owner.tenantId),
          "x-forwarded-for": uniqueTestClientIp(),
        },
      });

      expect(response.status()).toBe(202);
      const body = (await response.json()) as { downloadToken: string };
      expect(body.downloadToken).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await prisma.tenant.delete({ where: { id: owner.tenantId } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  for (const role of [MembershipRole.ADMIN, MembershipRole.MEMBER]) {
    test(`${role} dışa AKTARAMIYOR (403) ve hiç kayıt oluşmuyor`, async ({ request }) => {
      // Dışa aktarma tenant'ın TÜM verisini tek dosyada dışarı çıkarır; bu bir SAHİPLİK
      // kararıdır ve ADMIN'in operasyonel yetkisi bunu kapsamaz.
      const member = await createMember(role);

      try {
        const response = await request.post(`/api/tenants/${member.tenantId}/export`, {
          headers: {
            cookie: await cookiesFor(member.userId, member.email, member.tenantId),
            "x-forwarded-for": uniqueTestClientIp(),
          },
        });

        expect(response.status()).toBe(403);
        expect(await prisma.tenantDataExport.count({ where: { tenantId: member.tenantId } })).toBe(0);
      } finally {
        await prisma.tenant.delete({ where: { id: member.tenantId } });
        await prisma.user.delete({ where: { id: member.userId } });
      }
    });
  }

  test("kimliksiz istek 401", async ({ request }) => {
    const owner = await createMember(MembershipRole.OWNER);

    try {
      const response = await request.post(`/api/tenants/${owner.tenantId}/export`, {
        headers: { "x-forwarded-for": uniqueTestClientIp() },
      });

      expect(response.status()).toBe(401);
    } finally {
      await prisma.tenant.delete({ where: { id: owner.tenantId } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("BAŞKA tenant'ın verisi kendi oturumuyla istenemiyor", async ({ request }) => {
    // Invariant #2: URL'deki tenantId güvenilir kaynak DEĞİLDİR.
    const mine = await createMember(MembershipRole.OWNER);
    const other = await createMember(MembershipRole.OWNER);

    try {
      const response = await request.post(`/api/tenants/${other.tenantId}/export`, {
        headers: {
          cookie: await cookiesFor(mine.userId, mine.email, mine.tenantId),
          "x-forwarded-for": uniqueTestClientIp(),
        },
      });

      expect([400, 403, 404]).toContain(response.status());
      expect(await prisma.tenantDataExport.count({ where: { tenantId: other.tenantId } })).toBe(0);
    } finally {
      for (const fixture of [mine, other]) {
        await prisma.tenant.delete({ where: { id: fixture.tenantId } });
        await prisma.user.delete({ where: { id: fixture.userId } });
      }
    }
  });
});

test.describe("GET yan etkisizdir (invariant #4)", () => {
  test("dışa aktarma ve indirme uçları GET kabul ETMİYOR", async ({ request }) => {
    // İndirmenin POST olması bilinçlidir: token tüketimi bir YAN ETKİDİR ve bir GET'e
    // konulamaz. Gerekçe route dosyasında ve README'de yazılı.
    const owner = await createMember(MembershipRole.OWNER);

    try {
      const cookie = await cookiesFor(owner.userId, owner.email, owner.tenantId);

      for (const path of [
        `/api/tenants/${owner.tenantId}/export`,
        "/api/exports/download",
        "/api/maintenance/data-exports",
      ]) {
        const response = await request.get(path, { headers: { cookie } });
        expect(response.status(), path).toBe(405);
      }
    } finally {
      await prisma.tenant.delete({ where: { id: owner.tenantId } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });
});

test.describe("İndirme token'ı", () => {
  test("geçerli token ZIP döndürüyor, İKİNCİ çağrı 404", async ({ request }) => {
    const owner = await createMember(MembershipRole.OWNER);

    try {
      const requested = await requestTenantDataExport(owner.tenantId, owner.userId);
      if (!requested.ok) throw new Error("talep olusmadi");
      await processPendingExports({ exportDir: EXPORT_DIR });

      const first = await request.post("/api/exports/download", {
        data: { token: requested.downloadToken },
        headers: { "x-forwarded-for": uniqueTestClientIp() },
      });

      expect(first.status()).toBe(200);
      expect(first.headers()["content-type"]).toBe("application/zip");
      expect(first.headers()["cache-control"]).toContain("no-store");
      expect((await first.body()).subarray(0, 2).toString("utf8"), "ZIP imzasi yok").toBe("PK");

      const second = await request.post("/api/exports/download", {
        data: { token: requested.downloadToken },
        headers: { "x-forwarded-for": uniqueTestClientIp() },
      });
      expect(second.status()).toBe(404);
    } finally {
      await prisma.tenant.delete({ where: { id: owner.tenantId } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("bilinmeyen token 404 ve gövde bilgi sızdırmıyor", async ({ request }) => {
    const response = await request.post("/api/exports/download", {
      data: { token: "b".repeat(64) },
      headers: { "x-forwarded-for": uniqueTestClientIp() },
    });

    expect(response.status()).toBe(404);
    const text = await response.text();
    expect(text.toLowerCase()).not.toContain("expired");
    expect(text.toLowerCase()).not.toContain("downloaded");
  });

  test("bakım ucu anahtarsız 404 ve hiçbir işi işlemiyor", async ({ request }) => {
    const owner = await createMember(MembershipRole.OWNER);

    try {
      const requested = await requestTenantDataExport(owner.tenantId, owner.userId);
      if (!requested.ok) throw new Error("talep olusmadi");

      const response = await request.post("/api/maintenance/data-exports", {
        headers: { "x-forwarded-for": uniqueTestClientIp() },
      });

      expect(response.status()).toBe(404);
      const row = await prisma.tenantDataExport.findUniqueOrThrow({
        where: { id: requested.exportId },
      });
      expect(row.status).toBe("PENDING");
    } finally {
      await prisma.tenant.delete({ where: { id: owner.tenantId } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });
});
