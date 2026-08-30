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

test.describe("Transaction API — filtreler (Issue #56)", () => {
  async function seedRow(
    tenantId: string,
    accountId: string,
    description: string,
    occurredAt: string,
  ) {
    return prisma.transaction.create({
      data: { tenantId, accountId, type: "EXPENSE", amount: "10", description, occurredAt },
      select: { id: true },
    });
  }

  test("filtreler tenant scope'unu BAYPAS ETMİYOR (yabancı kayıt hiçbir filtreyle sızmıyor)", async ({
    request,
  }) => {
    const tenant = await createTenant("TxFilterOwn");
    const foreignTenant = await createTenant("TxFilterForeign");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const ownAccount = await createAccountRow(tenant.id);
    const foreignAccount = await createAccountRow(foreignTenant.id);

    await seedRow(tenant.id, ownAccount.id, "Benim kiram", "2026-01-10T00:00:00.000Z");
    // Yabancı kayıt BİLEREK aynı açıklama ve aynı tarihte: filtre eşleşmesi tenant
    // filtresini düşürüyorsa buradan sızar.
    await seedRow(foreignTenant.id, foreignAccount.id, "Benim kiram", "2026-01-10T00:00:00.000Z");

    try {
      const queries = [
        "?q=Benim kiram",
        "?from=2026-01-01",
        "?to=2026-12-31",
        "?from=2026-01-01&to=2026-12-31&q=kiram",
        `?accountId=${foreignAccount.id}`,
      ];

      for (const query of queries) {
        const response = await request.get(`/api/tenants/${tenant.id}/transactions${query}`, {
          headers: { cookie: owner.cookie },
        });
        expect(response.status(), `sorgu: ${query}`).toBe(200);

        const body = await response.text();
        expect(body, `sorgu: ${query}`).not.toContain(foreignTenant.id);
        expect(body, `sorgu: ${query}`).not.toContain(foreignAccount.id);
      }

      // Yabancı hesap id'siyle filtreleme hata değil, BOŞ sonuç verir: arama zaten tenant
      // içinde yapıldığı için o id hiçbir satırla eşleşmez.
      const foreignFiltered = await request.get(
        `/api/tenants/${tenant.id}/transactions?accountId=${foreignAccount.id}`,
        { headers: { cookie: owner.cookie } },
      );
      expect(((await foreignFiltered.json()) as { transactions: unknown[] }).transactions).toEqual(
        [],
      );

      // Duyarlılık kanıtı: kendi kaydı aynı filtreyle GÖRÜNÜYOR — yukarıdaki boşluklar
      // filtrenin çalışmamasından değil, izolasyondan geliyor.
      const own = await request.get(`/api/tenants/${tenant.id}/transactions?q=kiram`, {
        headers: { cookie: owner.cookie },
      });
      expect(((await own.json()) as { transactions: unknown[] }).transactions).toHaveLength(1);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [tenant.id, foreignTenant.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("geçersiz filtre SESSİZCE YOK SAYILMIYOR (400) — liste genişlemiyor", async ({
    request,
  }) => {
    const tenant = await createTenant("TxBadFilter");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const account = await createAccountRow(tenant.id);
    await seedRow(tenant.id, account.id, "Gorunmemeli", "2026-01-10T00:00:00.000Z");

    try {
      const invalid = [
        "?from=dun",
        "?from=15.03.2026",
        // Takvimde olmayan gün: JavaScript bunu sessizce 3 Mart'a taşır, doğrulama engeller.
        "?from=2026-02-31",
        "?to=2026-13-01",
        // Tarih-saat kabul edilmez: aralık filtresi gün hassasiyetindedir.
        "?from=2026-01-01T10:00:00Z",
        // Ters aralık: daima boş sonuç verirdi; sorun veride değil filtrededir.
        "?from=2026-04-01&to=2026-03-01",
        `?q=${"A".repeat(101)}`,
        // Tekrarlanan parametre: ilk değeri sessizce seçmek, kullanıcının istemediği bir
        // listeyi doğruymuş gibi göstermek olurdu.
        "?q=a&q=b",
        "?accountId=a&accountId=b",
      ];

      for (const query of invalid) {
        const response = await request.get(`/api/tenants/${tenant.id}/transactions${query}`, {
          headers: { cookie: owner.cookie },
        });
        expect(response.status(), `sorgu: ${query}`).toBe(400);
        expect(
          Object.keys((await response.json()) as Record<string, unknown>),
          `sorgu: ${query}`,
        ).toEqual(["error"]);
      }

      // Duyarlılık kanıtı: aynı endpoint geçerli filtreyle 200 ve kaydı döndürüyor.
      const valid = await request.get(
        `/api/tenants/${tenant.id}/transactions?from=2026-01-01&to=2026-01-31`,
        { headers: { cookie: owner.cookie } },
      );
      expect(valid.status()).toBe(200);
      expect(((await valid.json()) as { transactions: unknown[] }).transactions).toHaveLength(1);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("boş filtre değerleri 'filtre yok' demektir (400 değil)", async ({ request }) => {
    const tenant = await createTenant("TxEmptyFilter");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const account = await createAccountRow(tenant.id);
    await seedRow(tenant.id, account.id, "Gorunmeli", "2026-01-10T00:00:00.000Z");

    try {
      // Form boş alanları böyle gönderir; bunu hata saymak arayüzü kullanılmaz yapardı.
      const response = await request.get(
        `/api/tenants/${tenant.id}/transactions?from=&to=&accountId=&categoryId=&q=`,
        { headers: { cookie: owner.cookie } },
      );
      expect(response.status()).toBe(200);
      expect(((await response.json()) as { transactions: unknown[] }).transactions).toHaveLength(1);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("MEMBER de filtreleyebiliyor (filtreleme bir OKUMA işlemidir)", async ({ request }) => {
    const tenant = await createTenant("TxFilterMember");
    const member = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);
    const account = await createAccountRow(tenant.id);
    await seedRow(tenant.id, account.id, "Ortak kira", "2026-01-10T00:00:00.000Z");

    try {
      const response = await request.get(`/api/tenants/${tenant.id}/transactions?q=kira`, {
        headers: { cookie: member.cookie },
      });
      expect(response.status()).toBe(200);
      expect(((await response.json()) as { transactions: unknown[] }).transactions).toHaveLength(1);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: member.userId } });
    }
  });

  test("filtreleme GET'tir ve yan etkisizdir (kayıt sayısı ve bakiye değişmiyor)", async ({
    request,
  }) => {
    const tenant = await createTenant("TxFilterSideEffect");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const account = await createAccountRow(tenant.id);
    await seedRow(tenant.id, account.id, "Sabit", "2026-01-10T00:00:00.000Z");

    try {
      const before = await prisma.transaction.count({ where: { tenantId: tenant.id } });
      await request.get(`/api/tenants/${tenant.id}/transactions?q=Sabit&from=2026-01-01`, {
        headers: { cookie: owner.cookie },
      });
      expect(await prisma.transaction.count({ where: { tenantId: tenant.id } })).toBe(before);
      // Bakiye seed edilen satırdan etkilenmez: satır Prisma ile doğrudan yazıldı.
      expect(await balanceOf(account.id)).toBe("1000.0000");
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });
});

/**
 * Sayfalama imlecinin saldırgan bakışı (Issue #135).
 *
 * İmleç base64'tür ve base64 ŞİFRELEME DEĞİLDİR — kurcalanabilir. Buradaki soru "kurcalanabilir
 * mi" değil, "kurcalanınca ne oluyor": imleç yalnızca sıralamada nereden devam edileceğini
 * söyler; hangi tenant'ın okunacağını `requirePermission()` context'i söyler. Bu testler o
 * ayrımın gerçekten kodda olduğunu, yorumda kalmadığını kanıtlar.
 */
test.describe("Transaction API — sayfalama (Issue #135)", () => {
  /** İmleç, servisle AYNI biçimde kurulur; testin kendi kodlaması sözleşmeden sapmasın. */
  function encodeCursor(occurredAt: Date, createdAt: Date, id: string): string {
    return Buffer.from(
      [occurredAt.toISOString(), createdAt.toISOString(), id].join("|"),
      "utf8",
    ).toString("base64url");
  }

  async function seedRows(tenantId: string, accountId: string, count: number, label: string) {
    await prisma.transaction.createMany({
      data: Array.from({ length: count }, (_, index) => ({
        tenantId,
        accountId,
        type: "EXPENSE" as const,
        amount: "10",
        description: `${label}-${String(index).padStart(3, "0")}`,
        occurredAt: new Date(Date.UTC(2026, 0, 1 + index)),
      })),
    });
  }

  test("YABANCI kaydın imleci başka tenant'ın verisini AÇMIYOR", async ({ request }) => {
    const tenant = await createTenant("TxPageOwn");
    const foreignTenant = await createTenant("TxPageForeign");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const ownAccount = await createAccountRow(tenant.id);
    const foreignAccount = await createAccountRow(foreignTenant.id);

    await seedRows(tenant.id, ownAccount.id, 3, "benim");
    await seedRows(foreignTenant.id, foreignAccount.id, 3, "yabanci");

    try {
      // Saldırganın elindeki en güçlü malzeme: yabancı tenant'ın GERÇEK bir satırından
      // kurulmuş, biçimsel olarak kusursuz bir imleç.
      const foreignRow = await prisma.transaction.findFirstOrThrow({
        where: { tenantId: foreignTenant.id },
        select: { id: true, occurredAt: true, createdAt: true },
      });
      const forged = encodeCursor(foreignRow.occurredAt, foreignRow.createdAt, foreignRow.id);

      const response = await request.get(
        `/api/tenants/${tenant.id}/transactions?after=${encodeURIComponent(forged)}`,
        { headers: { cookie: owner.cookie } },
      );

      // İstek REDDEDİLMEZ (imleç geçerli biçimdedir) ama hiçbir yabancı veri dönmez: imleç
      // pencereyi kaydırır, scope'a dokunmaz.
      expect(response.status()).toBe(200);
      const body = await response.text();
      expect(body).not.toContain(foreignTenant.id);
      expect(body).not.toContain(foreignAccount.id);
      expect(body).not.toContain("yabanci-");

      // Duyarlılık kanıtı: imleçsiz aynı istek KENDİ kayıtlarını gösteriyor — yukarıdaki
      // boşluk, listenin hiç çalışmamasından değil izolasyondan geliyor.
      const own = await request.get(`/api/tenants/${tenant.id}/transactions`, {
        headers: { cookie: owner.cookie },
      });
      expect(((await own.json()) as { transactions: unknown[] }).transactions).toHaveLength(3);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [tenant.id, foreignTenant.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("BOZUK imleç 400 döner: sessizce ilk sayfaya DÜŞMEZ", async ({ request }) => {
    const tenant = await createTenant("TxPageBroken");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const account = await createAccountRow(tenant.id);
    await seedRows(tenant.id, account.id, 3, "kayit");

    try {
      for (const broken of ["not-base64!!", "Zm9v", "a|b|c"]) {
        const response = await request.get(
          `/api/tenants/${tenant.id}/transactions?after=${encodeURIComponent(broken)}`,
          { headers: { cookie: owner.cookie } },
        );
        // Geçersiz imleci yok sayıp ilk sayfayı döndürmek, kullanıcıya "sonraki sayfa" dediği
        // hâlde aynı sayfayı göstermek ve onu listenin sonu sandırmak olurdu (#56'nın geçersiz
        // filtre kararıyla aynı gerekçe).
        expect(response.status(), `imleç: ${broken}`).toBe(400);
        // Hata metni iç durumu anlatmaz: hangi alanın neden bozuk olduğu ayrıştırılmaz.
        const body = await response.text();
        expect(body).not.toContain("occurredAt");
        expect(body).not.toContain("base64");
      }

      // Duyarlılık: aynı endpoint imleçsiz 200 dönüyor.
      const ok = await request.get(`/api/tenants/${tenant.id}/transactions`, {
        headers: { cookie: owner.cookie },
      });
      expect(ok.status()).toBe(200);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("tekrarlanan ?after HATADIR (ilk değer sessizce seçilmiyor)", async ({ request }) => {
    const tenant = await createTenant("TxPageRepeat");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const account = await createAccountRow(tenant.id);
    await seedRows(tenant.id, account.id, 2, "kayit");

    try {
      const row = await prisma.transaction.findFirstOrThrow({
        where: { tenantId: tenant.id },
        select: { id: true, occurredAt: true, createdAt: true },
      });
      const valid = encodeURIComponent(encodeCursor(row.occurredAt, row.createdAt, row.id));

      const response = await request.get(
        `/api/tenants/${tenant.id}/transactions?after=${valid}&after=${valid}`,
        { headers: { cookie: owner.cookie } },
      );
      expect(response.status()).toBe(400);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("sayfa boyutu istemciden BÜYÜTÜLEMİYOR (?limit yok sayılır)", async ({ request }) => {
    const tenant = await createTenant("TxPageLimit");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const account = await createAccountRow(tenant.id);
    await seedRows(tenant.id, account.id, 60, "kayit");

    try {
      // Sayfa boyutu bir sabittir; `?limit=` diye bir parametre YOKTUR. Bu test, birinin onu
      // "zararsız" diye eklemesi hâlinde kırmızıya döner — sınırsız sayfa boyutu, tek bir
      // istekle tüm tabloyu çektirmenin yoludur.
      for (const query of ["?limit=1000", "?pageSize=1000", "?take=1000"]) {
        const response = await request.get(
          `/api/tenants/${tenant.id}/transactions${query}`,
          { headers: { cookie: owner.cookie } },
        );
        expect(response.status(), `sorgu: ${query}`).toBe(200);
        const body = (await response.json()) as { transactions: unknown[] };
        expect(body.transactions.length, `sorgu: ${query}`).toBeLessThanOrEqual(50);
      }
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("MEMBER da sayfalayabiliyor ama yalnızca kendi tenant'ını (yetki değişmiyor)", async ({
    request,
  }) => {
    const tenant = await createTenant("TxPageMember");
    const member = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);
    const account = await createAccountRow(tenant.id);
    await seedRows(tenant.id, account.id, 55, "kayit");

    try {
      const first = await request.get(`/api/tenants/${tenant.id}/transactions`, {
        headers: { cookie: member.cookie },
      });
      expect(first.status()).toBe(200);
      const firstBody = (await first.json()) as { transactions: unknown[]; nextCursor: string };
      expect(firstBody.transactions).toHaveLength(50);
      expect(firstBody.nextCursor).not.toBeNull();

      // Sayfalama bir OKUMA yeteneğidir; MEMBER'ın `VIEW_TRANSACTIONS` izni vardır ve imleç bu
      // izni ne genişletir ne daraltır.
      const second = await request.get(
        `/api/tenants/${tenant.id}/transactions?after=${encodeURIComponent(firstBody.nextCursor)}`,
        { headers: { cookie: member.cookie } },
      );
      expect(second.status()).toBe(200);
      expect(((await second.json()) as { transactions: unknown[] }).transactions).toHaveLength(5);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: member.userId } });
    }
  });
});
