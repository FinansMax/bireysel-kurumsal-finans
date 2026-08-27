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
 * `Transaction` API'sinin saldırgan bakışıyla testleri (Issue #53).
 *
 * Konu: kimlik doğrulama zorunluluğu, rol bazlı yetki, tenant izolasyonu / IDOR, client input
 * spoofing ve hata yanıtlarının bilgi sızdırmaması. İş kuralları (doğrulama, bakiye aritmetiği,
 * eşzamanlılık) `integration/transaction.spec.ts`'tedir.
 *
 * BU MODELE ÖZGÜ SALDIRI YÜZEYİ: işlem, gövdedeki `accountId` ile BAŞKA BİR KAYDIN bakiyesini
 * değiştirir. Yani buradaki IDOR yalnızca "yabancı veriyi okuma/yazma" değil, "yabancı bir
 * hesabın parasını oynatma" denemesidir; her testte ilgili bakiyenin DEĞİŞMEDİĞİ de kontrol
 * edilir.
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
  const email = `sec-transaction-${randomUUID()}@example.com`;
  const user = await prisma.user.create({ data: { email }, select: { id: true } });
  await prisma.membership.create({ data: { userId: user.id, tenantId, role } });

  const cookie = combineCookieHeaders(
    await createSessionCookieHeader({ sub: user.id, email }),
    await createActiveTenantCookieHeader(tenantId),
  );

  return { userId: user.id, cookie };
}

async function createAccountRow(tenantId: string, balance = "1000") {
  return prisma.account.create({
    data: { tenantId, name: `Hesap ${randomUUID()}`, type: "CASH", currency: "TRY", balance },
    select: { id: true },
  });
}

async function createTransactionRow(tenantId: string, accountId: string, amount = "100") {
  return prisma.transaction.create({
    data: { tenantId, accountId, type: "EXPENSE", amount, description: "Yabanci islem" },
    select: { id: true, amount: true },
  });
}

async function balanceOf(accountId: string): Promise<string> {
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: accountId },
    select: { balance: true },
  });
  return account.balance.toFixed(4);
}

test.describe("Transaction API — authentication zorunluluğu", () => {
  test("unauthenticated istekler 401 alır, hiçbir şey oluşmaz ve bakiye değişmez", async ({
    request,
  }) => {
    const tenant = await createTenant("TxNoAuth");
    const account = await createAccountRow(tenant.id);

    try {
      const list = await request.get(`/api/tenants/${tenant.id}/transactions`);
      expect(list.status()).toBe(401);

      const create = await request.post(`/api/tenants/${tenant.id}/transactions`, {
        data: { accountId: account.id, type: "EXPENSE", amount: "500" },
      });
      expect(create.status()).toBe(401);

      expect(await prisma.transaction.count({ where: { tenantId: tenant.id } })).toBe(0);
      expect(await balanceOf(account.id)).toBe("1000.0000");
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
    }
  });

  test("uydurma session cookie'si kabul edilmiyor", async ({ request }) => {
    const tenant = await createTenant("TxFakeCookie");

    try {
      const response = await request.get(`/api/tenants/${tenant.id}/transactions`, {
        headers: { cookie: "authjs.session-token=uydurma-deger" },
      });
      expect(response.status()).toBe(401);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
    }
  });
});

test.describe("Transaction API — rol bazlı yetki", () => {
  test("MEMBER işlemleri GÖRÜR ama kaydedemez/düzeltemez/silemez (403)", async ({ request }) => {
    const tenant = await createTenant("TxRoleCheck");
    const member = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);
    const account = await createAccountRow(tenant.id);
    const transaction = await createTransactionRow(tenant.id, account.id);

    try {
      // Görüntüleme: izin matrisi MEMBER'a VIEW_TRANSACTIONS verir (kayıtları okumak günlük iş).
      const list = await request.get(`/api/tenants/${tenant.id}/transactions`, {
        headers: { cookie: member.cookie },
      });
      expect(list.status()).toBe(200);
      expect(((await list.json()) as { transactions: unknown[] }).transactions).toHaveLength(1);

      // Yönetim: MANAGE_TRANSACTIONS yok → 403. Bir işlem kaydetmek bakiyeyi değiştirmektir.
      const create = await request.post(`/api/tenants/${tenant.id}/transactions`, {
        headers: { cookie: member.cookie },
        data: { accountId: account.id, type: "EXPENSE", amount: "500" },
      });
      expect(create.status()).toBe(403);

      const patch = await request.patch(
        `/api/tenants/${tenant.id}/transactions/${transaction.id}`,
        { headers: { cookie: member.cookie }, data: { amount: "999" } },
      );
      expect(patch.status()).toBe(403);

      const remove = await request.delete(
        `/api/tenants/${tenant.id}/transactions/${transaction.id}`,
        { headers: { cookie: member.cookie } },
      );
      expect(remove.status()).toBe(403);

      // Kontrol grubu: ne kayıt ne de bakiye değişmiş olmalı.
      const rows = await prisma.transaction.findMany({ where: { tenantId: tenant.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].amount.toFixed(4)).toBe("100.0000");
      expect(await balanceOf(account.id)).toBe("1000.0000");
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: member.userId } });
    }
  });

  test("ADMIN işlem yönetebiliyor (duyarlılık kanıtı: 403'ler role bağlı, endpoint'e değil)", async ({
    request,
  }) => {
    const tenant = await createTenant("TxAdminOk");
    const admin = await createUserWithMembership(MembershipRole.ADMIN, tenant.id);
    const account = await createAccountRow(tenant.id);

    try {
      const create = await request.post(`/api/tenants/${tenant.id}/transactions`, {
        headers: { cookie: admin.cookie },
        data: { accountId: account.id, type: "EXPENSE", amount: "250" },
      });
      expect(create.status()).toBe(201);
      expect(await balanceOf(account.id)).toBe("750.0000");
    } finally {
      await prisma.tenant.deleteMany({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: admin.userId } });
    }
  });
});

test.describe("Transaction API — tenant izolasyonu / IDOR", () => {
  test("gövdedeki YABANCI accountId ile başka tenant'ın bakiyesi oynatılamaz (404)", async ({
    request,
  }) => {
    const tenant = await createTenant("TxOwn");
    const foreignTenant = await createTenant("TxForeign");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const foreignAccount = await createAccountRow(foreignTenant.id, "5000");

    try {
      // Bu issue'nun en kritik saldırısı: kendi oturumuyla, BAŞKA tenant'ın hesabına gider
      // yazdırma denemesi. Hesap araması `tenantScoped()` ile yapıldığı için eşleşme olmaz.
      const response = await request.post(`/api/tenants/${tenant.id}/transactions`, {
        headers: { cookie: owner.cookie },
        data: { accountId: foreignAccount.id, type: "EXPENSE", amount: "5000" },
      });
      expect(response.status()).toBe(404);

      expect(await balanceOf(foreignAccount.id)).toBe("5000.0000");
      expect(await prisma.transaction.count({ where: { tenantId: tenant.id } })).toBe(0);
      expect(await prisma.transaction.count({ where: { tenantId: foreignTenant.id } })).toBe(0);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [tenant.id, foreignTenant.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("mevcut bir işlem, PATCH ile yabancı bir hesaba TAŞINAMAZ (404)", async ({ request }) => {
    const tenant = await createTenant("TxMoveOwn");
    const foreignTenant = await createTenant("TxMoveForeign");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const ownAccount = await createAccountRow(tenant.id, "1000");
    const foreignAccount = await createAccountRow(foreignTenant.id, "1000");
    const transaction = await createTransactionRow(tenant.id, ownAccount.id);

    try {
      const response = await request.patch(
        `/api/tenants/${tenant.id}/transactions/${transaction.id}`,
        { headers: { cookie: owner.cookie }, data: { accountId: foreignAccount.id } },
      );
      expect(response.status()).toBe(404);

      const row = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
      expect(row.accountId).toBe(ownAccount.id);
      expect(await balanceOf(foreignAccount.id)).toBe("1000.0000");
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [tenant.id, foreignTenant.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("başka tenant'ın işlemi, kendi tenant'ının URL'i altında bile güncellenemez (404)", async ({
    request,
  }) => {
    const tenant = await createTenant("TxIdorOwn");
    const foreignTenant = await createTenant("TxIdorForeign");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const foreignAccount = await createAccountRow(foreignTenant.id);
    const foreignTransaction = await createTransactionRow(foreignTenant.id, foreignAccount.id);

    try {
      const response = await request.patch(
        `/api/tenants/${tenant.id}/transactions/${foreignTransaction.id}`,
        { headers: { cookie: owner.cookie }, data: { amount: "999999" } },
      );
      expect(response.status()).toBe(404);

      const unchanged = await prisma.transaction.findUniqueOrThrow({
        where: { id: foreignTransaction.id },
      });
      expect(unchanged.amount.toFixed(4)).toBe("100.0000");
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [tenant.id, foreignTenant.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("cross-tenant geçerli id ile hiç var olmayan id AYNI yanıtı veriyor (enumeration engeli)", async ({
    request,
  }) => {
    const tenant = await createTenant("TxEnum");
    const foreignTenant = await createTenant("TxEnumForeign");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const foreignAccount = await createAccountRow(foreignTenant.id);
    const foreignTransaction = await createTransactionRow(foreignTenant.id, foreignAccount.id);

    try {
      const crossTenant = await request.delete(
        `/api/tenants/${tenant.id}/transactions/${foreignTransaction.id}`,
        { headers: { cookie: owner.cookie } },
      );
      const nonExistent = await request.delete(
        `/api/tenants/${tenant.id}/transactions/tx-${randomUUID()}`,
        { headers: { cookie: owner.cookie } },
      );

      expect(crossTenant.status()).toBe(nonExistent.status());
      expect(await crossTenant.json()).toEqual(await nonExistent.json());

      expect(await prisma.transaction.count({ where: { id: foreignTransaction.id } })).toBe(1);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [tenant.id, foreignTenant.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("liste yalnızca kendi tenant'ının işlemlerini döndürüyor", async ({ request }) => {
    const tenant = await createTenant("TxListOwn");
    const foreignTenant = await createTenant("TxListForeign");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const ownAccount = await createAccountRow(tenant.id);
    const foreignAccount = await createAccountRow(foreignTenant.id);

    await prisma.transaction.create({
      data: {
        tenantId: tenant.id,
        accountId: ownAccount.id,
        type: "INCOME",
        amount: "1",
        description: "Benim islemim",
      },
    });
    await prisma.transaction.create({
      data: {
        tenantId: foreignTenant.id,
        accountId: foreignAccount.id,
        type: "INCOME",
        amount: "1",
        description: "Yabanci islemim",
      },
    });

    try {
      const response = await request.get(`/api/tenants/${tenant.id}/transactions`, {
        headers: { cookie: owner.cookie },
      });
      expect(response.status()).toBe(200);

      const { transactions } = (await response.json()) as {
        transactions: Array<{ description: string }>;
      };
      expect(transactions).toHaveLength(1);
      expect(transactions[0].description).toBe("Benim islemim");

      const body = JSON.stringify(transactions);
      expect(body).not.toContain("Yabanci islemim");
      expect(body).not.toContain(foreignTenant.id);
      expect(body).not.toContain(foreignAccount.id);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [tenant.id, foreignTenant.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("aktif tenant URL'deki tenantId'den farklıysa 403 (üyesi olsa bile)", async ({ request }) => {
    const activeTenant = await createTenant("TxActive");
    const otherTenant = await createTenant("TxOther");
    const owner = await createUserWithMembership(MembershipRole.OWNER, activeTenant.id);
    // Kullanıcı diğer tenant'ta da OWNER: engel izin matrisinden değil, aktif tenant
    // tutarlılık kontrolünden gelmeli.
    await prisma.membership.create({
      data: { userId: owner.userId, tenantId: otherTenant.id, role: MembershipRole.OWNER },
    });
    await createAccountRow(otherTenant.id);

    try {
      const response = await request.get(`/api/tenants/${otherTenant.id}/transactions`, {
        headers: { cookie: owner.cookie },
      });
      expect(response.status()).toBe(403);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [activeTenant.id, otherTenant.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });
});

test.describe("Transaction API — client input spoofing", () => {
  test("body'deki tenantId/id alanları YOK SAYILIYOR", async ({ request }) => {
    const tenant = await createTenant("TxSpoof");
    const foreignTenant = await createTenant("TxSpoofForeign");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const account = await createAccountRow(tenant.id);

    try {
      const response = await request.post(`/api/tenants/${tenant.id}/transactions`, {
        headers: { cookie: owner.cookie },
        data: {
          accountId: account.id,
          type: "EXPENSE",
          amount: "10",
          // Saldırganın kaydı başka bir tenant'a yazdırma denemesi.
          tenantId: foreignTenant.id,
          id: "attacker-controlled-id",
        },
      });
      expect(response.status()).toBe(201);

      const { transaction } = (await response.json()) as { transaction: { id: string } };
      expect(transaction.id).not.toBe("attacker-controlled-id");

      const row = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
      expect(row.tenantId).toBe(tenant.id);
      expect(await prisma.transaction.count({ where: { tenantId: foreignTenant.id } })).toBe(0);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [tenant.id, foreignTenant.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("PATCH ile tenantId taşınamıyor (body'deki tenantId etkisiz)", async ({ request }) => {
    const tenant = await createTenant("TxPatchSpoof");
    const foreignTenant = await createTenant("TxPatchSpoofForeign");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const account = await createAccountRow(tenant.id);
    const transaction = await createTransactionRow(tenant.id, account.id);

    try {
      const response = await request.patch(
        `/api/tenants/${tenant.id}/transactions/${transaction.id}`,
        {
          headers: { cookie: owner.cookie },
          data: { description: "Guncel", tenantId: foreignTenant.id },
        },
      );
      expect(response.status()).toBe(200);

      const row = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
      expect(row.tenantId).toBe(tenant.id);
      expect(row.description).toBe("Guncel");
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [tenant.id, foreignTenant.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("negatif tutar HTTP katmanında da reddediliyor (400) ve bakiye değişmiyor", async ({
    request,
  }) => {
    const tenant = await createTenant("TxNegative");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const account = await createAccountRow(tenant.id, "1000");

    try {
      // Negatif bir EXPENSE, gider gibi görünüp bakiyeyi ARTIRAN bir kayıt olurdu.
      const response = await request.post(`/api/tenants/${tenant.id}/transactions`, {
        headers: { cookie: owner.cookie },
        data: { accountId: account.id, type: "EXPENSE", amount: "-1000" },
      });
      expect(response.status()).toBe(400);

      expect(await balanceOf(account.id)).toBe("1000.0000");

      // Duyarlılık kanıtı: aynı endpoint pozitif tutarla 201 döner.
      const valid = await request.post(`/api/tenants/${tenant.id}/transactions`, {
        headers: { cookie: owner.cookie },
        data: { accountId: account.id, type: "EXPENSE", amount: "1000" },
      });
      expect(valid.status()).toBe(201);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("tutar JSON number olarak gönderilemiyor (400) — kayan nokta yasağı HTTP'de de geçerli", async ({
    request,
  }) => {
    const tenant = await createTenant("TxNumberAmount");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const account = await createAccountRow(tenant.id);

    try {
      const response = await request.post(`/api/tenants/${tenant.id}/transactions`, {
        headers: { cookie: owner.cookie },
        data: { accountId: account.id, type: "EXPENSE", amount: 10.1 },
      });
      expect(response.status()).toBe(400);
      expect(await prisma.transaction.count({ where: { tenantId: tenant.id } })).toBe(0);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("hata yanıtları iç durum sızdırmıyor (stack trace / Prisma detayı yok)", async ({
    request,
  }) => {
    const tenant = await createTenant("TxErrShape");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const account = await createAccountRow(tenant.id);

    try {
      const response = await request.post(`/api/tenants/${tenant.id}/transactions`, {
        headers: { cookie: owner.cookie },
        data: { accountId: account.id, type: "EXPENSE", amount: "abc" },
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

  test("yabancı hesap 404'ü, o hesabın var olduğunu sızdırmıyor", async ({ request }) => {
    const tenant = await createTenant("TxLeak");
    const foreignTenant = await createTenant("TxLeakForeign");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const foreignAccount = await createAccountRow(foreignTenant.id);

    try {
      const response = await request.post(`/api/tenants/${tenant.id}/transactions`, {
        headers: { cookie: owner.cookie },
        data: { accountId: foreignAccount.id, type: "EXPENSE", amount: "1" },
      });
      expect(response.status()).toBe(404);

      const text = await response.text();
      expect(text).not.toContain(foreignTenant.id);
      expect(Object.keys((await response.json()) as Record<string, unknown>)).toEqual(["error"]);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [tenant.id, foreignTenant.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });
});
