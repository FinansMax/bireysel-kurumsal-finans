import { randomUUID } from "node:crypto";

import { MembershipRole } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { uniqueTestClientIp } from "../e2e/support/rate-limit";
import { MAX_IMPORT_BYTES } from "../src/lib/import/transactions-csv";
import { prisma } from "../src/lib/prisma";

import {
  combineCookieHeaders,
  createActiveTenantCookieHeader,
  createSessionCookieHeader,
} from "./support/session";

/**
 * İşlem içe aktarma endpoint'inin saldırgan bakışıyla testleri (Issue #83).
 *
 * BU ENDPOINT'E ÖZGÜ RİSK: tek istek yüzlerce işlem yazar ve bakiyeleri kaydırır. Yetkisiz bir
 * içe aktarma, tek tek işlem kaydetmenin toplu ve hızlı hâlidir — bu yüzden her negatif testin
 * kanıtı "hiçbir işlem yazılmadı VE bakiye değişmedi"dir.
 *
 * Her istek kendi sahte IP'siyle gider: içe aktarma rate limit'i (10/10dk) IP başınadır ve
 * testler birbirinin bucket'ını tüketmemeli.
 */

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

test.afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
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
  const email = `sec-import-${randomUUID()}@example.com`;
  const user = await prisma.user.create({ data: { email }, select: { id: true } });
  createdUserIds.push(user.id);
  await prisma.membership.create({ data: { userId: user.id, tenantId, role } });

  const cookie = combineCookieHeaders(
    await createSessionCookieHeader({ sub: user.id, email }),
    await createActiveTenantCookieHeader(tenantId),
  );
  return { userId: user.id, cookie };
}

async function createAccount(tenantId: string, balance = "100") {
  return prisma.account.create({
    data: { tenantId, name: `Hesap ${randomUUID()}`, type: "CASH", currency: "TRY", balance },
    select: { id: true },
  });
}

function importPath(tenantId: string): string {
  return `/api/tenants/${tenantId}/transactions/import`;
}

function csvFor(accountId: string): string {
  return `type,amount,occurred_at,account_id\nINCOME,50,2026-03-01,${accountId}\n`;
}

function headers(cookie?: string, contentType = "text/csv"): Record<string, string> {
  return {
    "content-type": contentType,
    "x-forwarded-for": uniqueTestClientIp(),
    ...(cookie ? { cookie } : {}),
  };
}

async function expectUntouched(tenantId: string, accountId: string, balance = "100") {
  expect(await prisma.transaction.count({ where: { tenantId } })).toBe(0);
  const account = await prisma.account.findFirstOrThrow({
    where: { id: accountId, tenantId },
    select: { balance: true },
  });
  expect(account.balance.toString()).toBe(balance);
}

test.describe("Transaction import — kimlik ve yetki", () => {
  test("unauthenticated istek 401, hiçbir şey yazılmıyor", async ({ request }) => {
    const tenant = await createTenant("ImpNoAuth");
    const account = await createAccount(tenant.id);

    const response = await request.post(importPath(tenant.id), {
      headers: headers(),
      data: csvFor(account.id),
    });
    expect(response.status()).toBe(401);
    await expectUntouched(tenant.id, account.id);
  });

  test("MEMBER içe aktaramıyor (403) — tek kayıtta olduğu gibi", async ({ request }) => {
    const tenant = await createTenant("ImpMember");
    const member = await createUserWithMembership(MembershipRole.MEMBER, tenant.id);
    const account = await createAccount(tenant.id);

    const response = await request.post(importPath(tenant.id), {
      headers: headers(member.cookie),
      data: csvFor(account.id),
    });
    expect(response.status()).toBe(403);
    await expectUntouched(tenant.id, account.id);
  });

  test("KONTROL GRUBU: OWNER aynı isteği yapabiliyor ve bakiye kayıyor", async ({ request }) => {
    const tenant = await createTenant("ImpOwner");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const account = await createAccount(tenant.id);

    const response = await request.post(importPath(tenant.id), {
      headers: headers(owner.cookie),
      data: csvFor(account.id),
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ imported: 1, errors: [] });
    expect(await prisma.transaction.count({ where: { tenantId: tenant.id } })).toBe(1);
    const after = await prisma.account.findFirstOrThrow({
      where: { id: account.id, tenantId: tenant.id },
      select: { balance: true },
    });
    expect(after.balance.toString()).toBe("150");
  });
});

test.describe("Transaction import — tenant izolasyonu", () => {
  test("URL'deki tenantId aktif tenant'tan farklıysa 403", async ({ request }) => {
    const mine = await createTenant("ImpMine");
    const theirs = await createTenant("ImpTheirs");
    const owner = await createUserWithMembership(MembershipRole.OWNER, mine.id);
    const theirAccount = await createAccount(theirs.id);

    const response = await request.post(importPath(theirs.id), {
      headers: headers(owner.cookie),
      data: csvFor(theirAccount.id),
    });
    expect(response.status()).toBe(403);
    await expectUntouched(theirs.id, theirAccount.id);
  });

  test("kendi tenant URL'iyle komşunun hesabına yazılamıyor; yanıt olmayan id ile AYNI", async ({
    request,
  }) => {
    const mine = await createTenant("ImpMine2");
    const theirs = await createTenant("ImpTheirs2");
    const owner = await createUserWithMembership(MembershipRole.OWNER, mine.id);
    const theirAccount = await createAccount(theirs.id);

    const foreign = await request.post(importPath(mine.id), {
      headers: headers(owner.cookie),
      data: csvFor(theirAccount.id),
    });
    const missing = await request.post(importPath(mine.id), {
      headers: headers(owner.cookie),
      data: csvFor(`yok-${randomUUID()}`),
    });

    expect(foreign.status()).toBe(400);
    expect(await foreign.json()).toEqual(await missing.json());
    await expectUntouched(theirs.id, theirAccount.id);
  });
});

test.describe("Transaction import — girdi sınırları", () => {
  test("Content-Type text/csv değilse 415", async ({ request }) => {
    const tenant = await createTenant("ImpType");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const account = await createAccount(tenant.id);

    const response = await request.post(importPath(tenant.id), {
      headers: headers(owner.cookie, "application/json"),
      data: JSON.stringify({ csv: csvFor(account.id) }),
    });
    expect(response.status()).toBe(415);
    await expectUntouched(tenant.id, account.id);
  });

  test("boyut sınırını aşan gövde 413 — hiçbir satır yazılmıyor", async ({ request }) => {
    const tenant = await createTenant("ImpSize");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);
    const account = await createAccount(tenant.id);

    const padding = `,${"x".repeat(MAX_IMPORT_BYTES)}`;
    const response = await request.post(importPath(tenant.id), {
      headers: headers(owner.cookie),
      data: `type,amount,occurred_at,account_id,description\nINCOME,50,2026-03-01,${account.id}${padding}\n`,
    });
    expect(response.status()).toBe(413);
    await expectUntouched(tenant.id, account.id);
  });

  test("hata yanıtı iç durum sızdırmıyor (stack/Prisma yok)", async ({ request }) => {
    const tenant = await createTenant("ImpLeak");
    const owner = await createUserWithMembership(MembershipRole.OWNER, tenant.id);

    const response = await request.post(importPath(tenant.id), {
      headers: headers(owner.cookie),
      data: 'type,amount\n"bozuk',
    });
    expect(response.status()).toBe(400);
    const text = await response.text();
    expect(text).not.toMatch(/prisma|stack|at \w+ \(/i);
  });
});
