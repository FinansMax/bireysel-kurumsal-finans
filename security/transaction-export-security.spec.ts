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
 * İşlem dışa aktarma API'sinin saldırgan bakışıyla testleri (Issue #81).
 *
 * `transaction-security.spec.ts` İLE AYNI DURUŞ ama BU UCA ÖZGÜ RİSK: bir dosya indirmesi,
 * tek bir kaydı değil FİLTREYE UYAN TÜM işlemleri tek seferde dışarı verir — bir IDOR burada
 * "bir satırı okumak" değil "tüm bir tenant'ın finansal geçmişini toplu sızdırmak" demektir.
 *
 * İş mantığı ve filtreleme `integration/transaction-export.spec.ts`tedir.
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
  const email = `sec-tx-export-${randomUUID()}@example.com`;
  const user = await prisma.user.create({ data: { email }, select: { id: true } });
  await prisma.membership.create({ data: { userId: user.id, tenantId, role } });

  const cookie = combineCookieHeaders(
    await createSessionCookieHeader({ sub: user.id, email }),
    await createActiveTenantCookieHeader(tenantId),
  );

  return { userId: user.id, cookie };
}

async function createAccountRow(tenantId: string, name = "Kasa") {
  return prisma.account.create({
    data: { tenantId, name, type: "CASH", currency: "TRY", balance: "0" },
    select: { id: true },
  });
}

async function createTransactionRow(tenantId: string, accountId: string, description: string) {
  return prisma.transaction.create({
    data: { tenantId, accountId, type: "INCOME", amount: "100", description },
  });
}

function exportPath(tenantId: string, query = "format=csv"): string {
  return `/api/tenants/${tenantId}/transactions/export?${query}`;
}

test.describe("Transaction Export API — authentication zorunluluğu", () => {
  test("unauthenticated istek 401 alır", async ({ request }) => {
    const tenant = await createTenant("NoAuthExport");
    try {
      const response = await request.get(exportPath(tenant.id));
      expect(response.status()).toBe(401);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
    }
  });
});

test.describe("Transaction Export API — rol bazlı erişim", () => {
  test("MEMBER de dışa aktarabiliyor (görüntüleme izni herkeste)", async ({ request }) => {
    // `VIEW_TRANSACTIONS` matriste OWNER/ADMIN/MEMBER'ın hepsinde var — export bir okuma
    // işlemidir, yönetim değil.
    const tenant = await createTenant("MemberExport");
    const account = await createAccountRow(tenant.id);
    await createTransactionRow(tenant.id, account.id, "Uye export");
    const member = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);

    try {
      const response = await request.get(exportPath(tenant.id), {
        headers: { cookie: member.cookie },
      });
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("text/csv");

      const body = await response.text();
      expect(body).toContain("Uye export");
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: member.userId } });
    }
  });
});

test.describe("Transaction Export API — tenant izolasyonu / IDOR", () => {
  test("URL'deki tenantId aktif tenant'tan farklıysa 403 ve komşu veri SIZMAZ", async ({
    request,
  }) => {
    const mine = await createTenant("MineExport");
    const theirs = await createTenant("TheirsExport");
    const theirsAccount = await createAccountRow(theirs.id);
    await createTransactionRow(theirs.id, theirsAccount.id, "Gizli Komsu Verisi");
    const owner = await createUserWithMembership(MembershipRole.OWNER, mine.id);

    try {
      const response = await request.get(exportPath(theirs.id), {
        headers: { cookie: owner.cookie },
      });
      expect(response.status()).toBe(403);

      const body = await response.text();
      expect(body).not.toContain("Gizli Komsu Verisi");
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [mine.id, theirs.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("kendi tenant'ının exportu KOMŞUNUN kaydını İÇERMİYOR", async ({ request }) => {
    const mine = await createTenant("IsolatedExportMine");
    const theirs = await createTenant("IsolatedExportTheirs");
    const mineAccount = await createAccountRow(mine.id);
    const theirsAccount = await createAccountRow(theirs.id);
    await createTransactionRow(mine.id, mineAccount.id, "Benim Kaydim");
    await createTransactionRow(theirs.id, theirsAccount.id, "Komsu Kaydi");
    const owner = await createUserWithMembership(MembershipRole.OWNER, mine.id);

    try {
      const response = await request.get(exportPath(mine.id), {
        headers: { cookie: owner.cookie },
      });
      expect(response.status()).toBe(200);

      const body = await response.text();
      expect(body).toContain("Benim Kaydim");
      expect(body).not.toContain("Komsu Kaydi");
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [mine.id, theirs.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });
});

test.describe("Transaction Export API — girdi doğrulama ve sözleşme", () => {
  test("format=xlsx AÇIKÇA reddedilir (sessizce csv'ye düşülmez)", async ({ request }) => {
    const tenant = await createTenant("XlsxExport");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    try {
      const response = await request.get(exportPath(tenant.id, "format=xlsx"), {
        headers: { cookie: owner.cookie },
      });
      expect(response.status()).toBe(400);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("geçersiz tarih filtresi 400 alır (Issue #56 ile aynı sözleşme)", async ({ request }) => {
    const tenant = await createTenant("BadFilterExport");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    try {
      const response = await request.get(exportPath(tenant.id, "format=csv&from=not-a-date"), {
        headers: { cookie: owner.cookie },
      });
      expect(response.status()).toBe(400);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("body'deki spoof edilmiş tenantId query'si YOK SAYILIR (scope context'ten gelir)", async ({
    request,
  }) => {
    const mine = await createTenant("SpoofExportMine");
    const theirs = await createTenant("SpoofExportTheirs");
    const owner = await createUserWithMembership(MembershipRole.OWNER, mine.id);

    try {
      // Export bir GET'tir, gövdesi yoktur; "spoof" denemesi burada URL segmentidir ve zaten
      // yukarıdaki IDOR testinde reddedildiği kanıtlanmıştır. Bu test tamamlayıcıdır:
      // `tenantId` sorgu parametresi (varsa) yok sayılır, yalnızca URL segmenti + context sayılır.
      const response = await request.get(
        exportPath(mine.id, `format=csv&tenantId=${theirs.id}`),
        { headers: { cookie: owner.cookie } },
      );
      expect(response.status()).toBe(200);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [mine.id, theirs.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });
});
