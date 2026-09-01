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
 * `DebtCredit` API'sinin saldırgan bakışıyla testleri (Issue #70).
 *
 * Konu: kimlik doğrulama zorunluluğu, rol bazlı yetki (MEMBER görür ama yönetemez), tenant
 * izolasyonu / IDOR, client input spoofing ve para sözleşmesi. İş kuralları
 * `integration/debt-credit.spec.ts`tedir.
 *
 * BU MODELE ÖZGÜ RİSK: yetkisiz bir "kapandı" işareti, ödenmemiş bir borcu ödenmiş gösterir.
 * Hiçbir bakiye değişmediği için bu, hesap ekranlarında hiçbir iz bırakmaz — yalnızca bu
 * kaydın kendisinde görünür.
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
  const email = `sec-debt-${randomUUID()}@example.com`;
  const user = await prisma.user.create({ data: { email }, select: { id: true } });
  await prisma.membership.create({ data: { userId: user.id, tenantId, role } });

  const cookie = combineCookieHeaders(
    await createSessionCookieHeader({ sub: user.id, email }),
    await createActiveTenantCookieHeader(tenantId),
  );

  return { userId: user.id, cookie };
}

async function createRecord(tenantId: string, overrides: Record<string, unknown> = {}) {
  return prisma.debtCredit.create({
    data: {
      tenantId,
      type: "DEBT",
      counterparty: `Karsi ${randomUUID()}`,
      amount: "1000",
      currency: "TRY",
      ...overrides,
    },
    select: { id: true, counterparty: true, status: true },
  });
}

function listPath(tenantId: string): string {
  return `/api/tenants/${tenantId}/debt-credits`;
}

function itemPath(tenantId: string, id: string): string {
  return `/api/tenants/${tenantId}/debt-credits/${id}`;
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    type: "DEBT",
    counterparty: `Karsi ${randomUUID()}`,
    amount: "1500.50",
    currency: "TRY",
    ...overrides,
  };
}

test.describe("DebtCredit API — authentication zorunluluğu", () => {
  test("unauthenticated istekler 401 alır ve hiçbir şey oluşmaz/değişmez", async ({ request }) => {
    const tenant = await createTenant("NoAuthDebt");
    const record = await createRecord(tenant.id, { counterparty: "GizliKarsiTaraf" });

    try {
      const list = await request.get(listPath(tenant.id));
      expect(list.status()).toBe(401);
      expect(await list.text()).not.toContain("GizliKarsiTaraf");

      const created = await request.post(listPath(tenant.id), { data: validBody() });
      expect(created.status()).toBe(401);

      const patched = await request.patch(itemPath(tenant.id, record.id), {
        data: { status: "SETTLED" },
      });
      expect(patched.status()).toBe(401);

      const deleted = await request.delete(itemPath(tenant.id, record.id));
      expect(deleted.status()).toBe(401);

      // Tek kayıt duruyor ve hâlâ açık.
      expect(await prisma.debtCredit.count({ where: { tenantId: tenant.id } })).toBe(1);
      const row = await prisma.debtCredit.findUniqueOrThrow({ where: { id: record.id } });
      expect(row.status).toBe("OPEN");
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
    }
  });
});

test.describe("DebtCredit API — rol bazlı yetki", () => {
  test("MEMBER listeyi GÖRÜR ama oluşturamaz/güncelleyemez/silemez", async ({ request }) => {
    const tenant = await createTenant("MemberDebt");
    const member = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);
    const record = await createRecord(tenant.id);

    try {
      // Görmek ekibin günlük işidir.
      const list = await request.get(listPath(tenant.id), { headers: { cookie: member.cookie } });
      expect(list.status()).toBe(200);

      // Yönetmek değildir. Özellikle "kapandı" işareti, ödenmemiş bir borcu ödenmiş
      // göstermenin en kolay yoludur.
      const created = await request.post(listPath(tenant.id), {
        headers: { cookie: member.cookie },
        data: validBody(),
      });
      expect(created.status()).toBe(403);

      const patched = await request.patch(itemPath(tenant.id, record.id), {
        headers: { cookie: member.cookie },
        data: { status: "SETTLED" },
      });
      expect(patched.status()).toBe(403);

      const deleted = await request.delete(itemPath(tenant.id, record.id), {
        headers: { cookie: member.cookie },
      });
      expect(deleted.status()).toBe(403);

      expect(await prisma.debtCredit.count({ where: { tenantId: tenant.id } })).toBe(1);
      const row = await prisma.debtCredit.findUniqueOrThrow({ where: { id: record.id } });
      expect(row.status).toBe("OPEN");
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: member.userId } });
    }
  });

  test("KONTROL GRUBU: aynı istekleri OWNER yapabiliyor", async ({ request }) => {
    // Duyarlılık kanıtı: yukarıdaki 403'ler endpoint hep 403 dönseydi de geçerdi.
    const tenant = await createTenant("OwnerDebt");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    try {
      const created = await request.post(listPath(tenant.id), {
        headers: { cookie: owner.cookie },
        data: validBody(),
      });
      expect(created.status()).toBe(201);

      const { debtCredit } = (await created.json()) as { debtCredit: { id: string } };

      const patched = await request.patch(itemPath(tenant.id, debtCredit.id), {
        headers: { cookie: owner.cookie },
        data: { status: "SETTLED" },
      });
      expect(patched.status()).toBe(200);

      const deleted = await request.delete(itemPath(tenant.id, debtCredit.id), {
        headers: { cookie: owner.cookie },
      });
      expect(deleted.status()).toBe(204);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });
});

test.describe("DebtCredit API — tenant izolasyonu / IDOR", () => {
  test("URL'deki tenantId aktif tenant'tan farklıysa 403", async ({ request }) => {
    const mine = await createTenant("MineDebt");
    const theirs = await createTenant("TheirsDebt");
    const theirRecord = await createRecord(theirs.id, { counterparty: "KomsuKarsiTaraf" });
    const owner = await createUserWithMembership(MembershipRole.OWNER, mine.id);

    try {
      const list = await request.get(listPath(theirs.id), { headers: { cookie: owner.cookie } });
      expect(list.status()).toBe(403);
      expect(await list.text()).not.toContain("KomsuKarsiTaraf");

      const patched = await request.patch(itemPath(theirs.id, theirRecord.id), {
        headers: { cookie: owner.cookie },
        data: { status: "SETTLED" },
      });
      expect(patched.status()).toBe(403);

      const row = await prisma.debtCredit.findUniqueOrThrow({ where: { id: theirRecord.id } });
      expect(row.status).toBe("OPEN");
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [mine.id, theirs.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("kendi tenant'ının URL'iyle KOMŞUNUN kaydına dokunulamıyor (404)", async ({ request }) => {
    const mine = await createTenant("MineDebt2");
    const theirs = await createTenant("TheirsDebt2");
    const theirRecord = await createRecord(theirs.id, { counterparty: "Komsu" });
    const owner = await createUserWithMembership(MembershipRole.OWNER, mine.id);

    try {
      // Klasik IDOR: cookie ve URL kendi tenant'ım, kayıt id'si komşunun.
      const patched = await request.patch(itemPath(mine.id, theirRecord.id), {
        headers: { cookie: owner.cookie },
        data: { amount: "1" },
      });
      expect(patched.status()).toBe(404);

      const deleted = await request.delete(itemPath(mine.id, theirRecord.id), {
        headers: { cookie: owner.cookie },
      });
      expect(deleted.status()).toBe(404);

      const row = await prisma.debtCredit.findUniqueOrThrow({ where: { id: theirRecord.id } });
      expect(row.amount.toString()).toBe("1000");
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [mine.id, theirs.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("listede yalnızca kendi tenant'ının kayıtları var (sızıntı yok)", async ({ request }) => {
    const mine = await createTenant("OnlyMineDebt");
    const theirs = await createTenant("NeighbourDebt");
    await createRecord(mine.id, { counterparty: "BenimKarsiTarafim" });
    await createRecord(theirs.id, { counterparty: "KomsuKarsiTaraf", amount: "999999" });
    const owner = await createUserWithMembership(MembershipRole.OWNER, mine.id);

    try {
      const response = await request.get(listPath(mine.id), {
        headers: { cookie: owner.cookie },
      });
      expect(response.status()).toBe(200);

      const raw = JSON.stringify(await response.json());
      expect(raw).toContain("BenimKarsiTarafim");
      // Karşı taraf ADI da sızmamalı: kime borçlu olunduğu tek başına ticari bilgidir.
      expect(raw).not.toContain("KomsuKarsiTaraf");
      expect(raw).not.toContain("999999");
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [mine.id, theirs.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });
});

test.describe("DebtCredit API — client input spoofing ve sözleşme", () => {
  test("body'deki tenantId/id/createdAt alanları YOK SAYILIYOR", async ({ request }) => {
    const mine = await createTenant("SpoofDebt");
    const theirs = await createTenant("SpoofTargetDebt");
    const owner = await createUserWithMembership(MembershipRole.OWNER, mine.id);

    try {
      const response = await request.post(listPath(mine.id), {
        headers: { cookie: owner.cookie },
        data: validBody({
          tenantId: theirs.id,
          id: "kurcalanmis-id",
          createdAt: "1999-01-01T00:00:00.000Z",
        }),
      });
      expect(response.status()).toBe(201);

      const { debtCredit } = (await response.json()) as { debtCredit: { id: string } };
      expect(debtCredit.id).not.toBe("kurcalanmis-id");

      // Kayıt KENDİ tenant'ımda oluşmalı; komşuya tek satır bile geçmemeli.
      const row = await prisma.debtCredit.findUniqueOrThrow({ where: { id: debtCredit.id } });
      expect(row.tenantId).toBe(mine.id);
      expect(row.createdAt.getUTCFullYear()).toBeGreaterThan(2000);
      expect(await prisma.debtCredit.count({ where: { tenantId: theirs.id } })).toBe(0);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [mine.id, theirs.id] } } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("tutar `number` olarak gönderilemiyor (para invariant'ı HTTP sınırında da geçerli)", async ({
    request,
  }) => {
    const tenant = await createTenant("NumberDebt");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    try {
      const response = await request.post(listPath(tenant.id), {
        headers: { cookie: owner.cookie },
        data: validBody({ amount: 1500.5 }),
      });

      expect(response.status()).toBe(400);
      expect(await prisma.debtCredit.count({ where: { tenantId: tenant.id } })).toBe(0);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("para JSON'da string olarak dönüyor (number değil)", async ({ request }) => {
    const tenant = await createTenant("ShapeDebt");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    try {
      const response = await request.post(listPath(tenant.id), {
        headers: { cookie: owner.cookie },
        data: validBody({ amount: "1234.5600" }),
      });
      expect(response.status()).toBe(201);

      const { debtCredit } = (await response.json()) as {
        debtCredit: { amount: unknown; status: unknown };
      };
      expect(typeof debtCredit.amount).toBe("string");
      expect(debtCredit.amount).toBe("1234.56");
      expect(debtCredit.status).toBe("OPEN");
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });

  test("hata yanıtları iç durum sızdırmıyor (stack trace / Prisma detayı yok)", async ({
    request,
  }) => {
    const tenant = await createTenant("ErrorDebt");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    try {
      const response = await request.post(listPath(tenant.id), {
        headers: { cookie: owner.cookie },
        data: validBody({ amount: "-5" }),
      });
      expect(response.status()).toBe(400);

      // Desen `account-security.spec.ts` ile AYNI: yalın bir `"at "` araması, meşru bir hata
      // mesajındaki "at most 4 decimal places" ifadesine takılırdı — yığın çerçevesi
      // `at <fn> (<dosya>.ts:` biçimindedir ve aranan odur.
      const body = await response.text();
      expect(body).not.toMatch(/prisma|PrismaClient|at .*\(.*\.ts:|stack/i);
      // Yanıt gövdesinde `error` DIŞINDA alan olmamalı: 400 bir veri kanalı değildir.
      expect(Object.keys((await response.json()) as Record<string, unknown>)).toEqual(["error"]);
    } finally {
      await prisma.tenant.delete({ where: { id: tenant.id } });
      await prisma.user.delete({ where: { id: owner.userId } });
    }
  });
});
