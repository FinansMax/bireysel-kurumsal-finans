import { randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

import { registerUser } from "../src/lib/auth/signup";
import { prisma } from "../src/lib/prisma";
import { RATE_LIMIT_POLICIES } from "../src/lib/rate-limit/policies";

import { uniqueTestClientIp } from "../e2e/support/rate-limit";
import { createSessionCookieHeader } from "./support/session";

/**
 * Issue #27 — auth/tenant-creation rate limiting, gerçek HTTP endpoint'leri üzerinden.
 *
 * ÖNEMLİ: Bu dosya PRODUCTION rate-limit policy'lerini (bkz. `src/lib/rate-limit/policies.ts`)
 * test kolaylığı için DEĞİŞTİRMEZ — testler gerçek limitlere (signup 5/10dk, signin 10/5dk,
 * forgot-password 5/15dk, tenant-create 10/10dk) karşı çalışır. Her test, DİĞER testlerden
 * izole kalmak için kendi sahte istemci IP'sini (`x-forwarded-for`, bkz.
 * `e2e/support/rate-limit.ts`) kullanır ve bunu limiti KASITLI olarak aşmak için o tek test
 * içinde tekrar tekrar kullanır — bu, rate limiter'ı bypass etmek DEĞİL, tam tersine onu
 * doğrudan test etmektir.
 */

test.afterAll(async () => {
  await prisma.$disconnect();
});

function signUpWithIp(request: APIRequestContext, email: string, password: string, ip: string) {
  return request.post("/api/auth/signup", { data: { email, password }, headers: { "x-forwarded-for": ip } });
}

function forgotPasswordWithIp(request: APIRequestContext, email: string, ip: string) {
  return request.post("/api/auth/forgot-password", { data: { email }, headers: { "x-forwarded-for": ip } });
}

async function signInWithIp(request: APIRequestContext, email: string, password: string, ip: string) {
  const csrfResponse = await request.get("/api/auth/csrf");
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };
  return request.post("/api/auth/callback/credentials", {
    form: { email, password, csrfToken, json: "true" },
    maxRedirects: 0,
    headers: { "x-forwarded-for": ip },
  });
}

function createTenantWithIp(request: APIRequestContext, cookie: string, name: string, ip: string) {
  return request.post("/api/tenants", { headers: { cookie, "x-forwarded-for": ip }, data: { name } });
}

test.describe("Rate limiting — signup", () => {
  test("limit içindeki istekler (5/10dk) normal çalışır", async ({ request }) => {
    const ip = uniqueTestClientIp();
    const emails: string[] = [];

    try {
      for (let i = 0; i < 5; i++) {
        const email = `rl-signup-ok-${i}-${randomUUID()}@example.com`;
        emails.push(email);
        const response = await signUpWithIp(request, email, "S3curePassw0rd!", ip);
        expect(response.status()).toBe(201);
      }
    } finally {
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
    }
  });

  test("limit aşımı → 429, kullanıcı OLUŞTURULMAZ", async ({ request }) => {
    const ip = uniqueTestClientIp();
    const emails: string[] = [];

    try {
      for (let i = 0; i < 5; i++) {
        const email = `rl-signup-fill-${i}-${randomUUID()}@example.com`;
        emails.push(email);
        const response = await signUpWithIp(request, email, "S3curePassw0rd!", ip);
        expect(response.status()).toBe(201);
      }

      const overLimitEmail = `rl-signup-blocked-${randomUUID()}@example.com`;
      const blocked = await signUpWithIp(request, overLimitEmail, "S3curePassw0rd!", ip);
      expect(blocked.status()).toBe(429);

      const body = await blocked.json();
      expect(body).toEqual({ error: "Too many requests. Please try again later." });

      const created = await prisma.user.findUnique({ where: { email: overLimitEmail } });
      expect(created).toBeNull();
    } finally {
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
    }
  });
});

test.describe("Rate limiting — signin", () => {
  test("limit aşımı (10/5dk) → 429", async ({ request }) => {
    const ip = uniqueTestClientIp();
    const email = `rl-signin-${randomUUID()}@example.com`;
    await signUpWithIp(request, email, "S3curePassw0rd!", uniqueTestClientIp());

    try {
      for (let i = 0; i < 10; i++) {
        const response = await signInWithIp(request, email, "WrongPassword!", ip);
        // Limit dolmadığı sürece Auth.js'in normal CredentialsSignin redirect'i.
        expect(response.status()).toBe(302);
      }

      // Doğru şifre gönderilse bile — limit dolduğu için — bucket policy gereği 429 döner.
      const blocked = await signInWithIp(request, email, "S3curePassw0rd!", ip);
      expect(blocked.status()).toBe(429);

      const body = await blocked.json();
      expect(body).toEqual({ error: "Too many requests. Please try again later." });
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });
});

test.describe("Rate limiting — forgot-password", () => {
  test("limit aşımı (5/15dk) → 429", async ({ request }) => {
    const ip = uniqueTestClientIp();
    const email = `rl-forgot-${randomUUID()}@example.com`;

    for (let i = 0; i < 5; i++) {
      const response = await forgotPasswordWithIp(request, email, ip);
      expect(response.status()).toBe(200);
    }

    const blocked = await forgotPasswordWithIp(request, email, ip);
    expect(blocked.status()).toBe(429);

    const body = await blocked.json();
    expect(body).toEqual({ error: "Too many requests. Please try again later." });
  });

  test("user enumeration korumasını bozmaz: limit İÇİNDEYKEN kayıtlı/kayıtsız email AYNI status+body döner", async ({
    request,
  }) => {
    const ip = uniqueTestClientIp();
    const registeredEmail = `rl-forgot-known-${randomUUID()}@example.com`;
    await signUpWithIp(request, registeredEmail, "S3curePassw0rd!", uniqueTestClientIp());

    try {
      const knownResponse = await forgotPasswordWithIp(request, registeredEmail, ip);
      const unknownResponse = await forgotPasswordWithIp(
        request,
        `rl-forgot-unknown-${randomUUID()}@example.com`,
        ip,
      );

      expect(knownResponse.status()).toBe(unknownResponse.status());
      expect(await knownResponse.json()).toEqual(await unknownResponse.json());
    } finally {
      await prisma.user.deleteMany({ where: { email: registeredEmail } });
    }
  });

  test("limit AŞILDIĞINDA da kayıtlı/kayıtsız email arasında fark yaratmaz (429 body aynı)", async ({
    request,
  }) => {
    const ip = uniqueTestClientIp();
    const registeredEmail = `rl-forgot-429-known-${randomUUID()}@example.com`;
    await signUpWithIp(request, registeredEmail, "S3curePassw0rd!", uniqueTestClientIp());

    try {
      for (let i = 0; i < 5; i++) {
        await forgotPasswordWithIp(request, `warmup-${i}-${randomUUID()}@example.com`, ip);
      }

      const knownBlocked = await forgotPasswordWithIp(request, registeredEmail, ip);
      const unknownBlocked = await forgotPasswordWithIp(
        request,
        `rl-forgot-429-unknown-${randomUUID()}@example.com`,
        ip,
      );

      expect(knownBlocked.status()).toBe(429);
      expect(unknownBlocked.status()).toBe(429);
      expect(await knownBlocked.json()).toEqual(await unknownBlocked.json());
    } finally {
      await prisma.user.deleteMany({ where: { email: registeredEmail } });
    }
  });
});

test.describe("Rate limiting — tenant creation", () => {
  test("limit aşımı (10/10dk) → 429, tenant/membership OLUŞTURULMAZ", async ({ request }) => {
    const ip = uniqueTestClientIp();
    const signup = await registerUser({
      email: `rl-tenant-${randomUUID()}@example.com`,
      password: "S3curePassw0rd!",
    });
    if (!signup.ok) throw new Error("test setup failed");
    const cookie = await createSessionCookieHeader({ sub: signup.user.id, email: signup.user.email });

    const tenantIds: string[] = [];

    try {
      for (let i = 0; i < 10; i++) {
        const response = await createTenantWithIp(request, cookie, `RL Tenant ${i} ${randomUUID()}`, ip);
        expect(response.status()).toBe(201);
        const { tenant } = await response.json();
        tenantIds.push(tenant.id);
      }

      const tenantCountBefore = await prisma.tenant.count({ where: { id: { in: tenantIds } } });
      expect(tenantCountBefore).toBe(10);

      const blocked = await createTenantWithIp(request, cookie, `RL Tenant Blocked ${randomUUID()}`, ip);
      expect(blocked.status()).toBe(429);

      const body = await blocked.json();
      expect(body).toEqual({ error: "Too many requests. Please try again later." });

      const membershipCount = await prisma.membership.count({ where: { userId: signup.user.id } });
      expect(membershipCount).toBe(10); // 11. (bloklanan) denemeden OWNER membership'i oluşmadı.
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
      await prisma.user.delete({ where: { id: signup.user.id } });
    }
  });
});

test.describe("Rate limiting — bucket isolation", () => {
  test("IP A'nın limiti IP B'yi etkilemiyor", async ({ request }) => {
    const ipA = uniqueTestClientIp();
    const ipB = uniqueTestClientIp();
    const emails: string[] = [];

    try {
      for (let i = 0; i < 5; i++) {
        const email = `rl-ipiso-a-${i}-${randomUUID()}@example.com`;
        emails.push(email);
        await signUpWithIp(request, email, "S3curePassw0rd!", ipA);
      }
      const aBlocked = await signUpWithIp(request, `rl-ipiso-a-blocked-${randomUUID()}@example.com`, "S3curePassw0rd!", ipA);
      expect(aBlocked.status()).toBe(429);

      const bEmail = `rl-ipiso-b-${randomUUID()}@example.com`;
      emails.push(bEmail);
      const bResponse = await signUpWithIp(request, bEmail, "S3curePassw0rd!", ipB);
      expect(bResponse.status()).toBe(201);
    } finally {
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
    }
  });

  test("aynı IP'deki farklı endpoint bucket'ları birbirinden bağımsız (signup limiti dolsa da signin etkilenmez)", async ({
    request,
  }) => {
    const ip = uniqueTestClientIp();
    const email = `rl-endpoint-iso-${randomUUID()}@example.com`;
    await signUpWithIp(request, email, "S3curePassw0rd!", uniqueTestClientIp());

    try {
      // Bu IP'nin SIGNUP bucket'ını doldur.
      for (let i = 0; i < 5; i++) {
        await signUpWithIp(request, `rl-endpoint-iso-fill-${i}-${randomUUID()}@example.com`, "S3curePassw0rd!", ip);
      }
      const signupBlocked = await signUpWithIp(request, `rl-endpoint-iso-over-${randomUUID()}@example.com`, "S3curePassw0rd!", ip);
      expect(signupBlocked.status()).toBe(429);

      // AYNI IP ile SIGNIN — ayrı bir bucket olduğu için hâlâ normal çalışmalı (429 DEĞİL).
      const signInResponse = await signInWithIp(request, email, "WrongPassword!", ip);
      expect(signInResponse.status()).toBe(302);
      expect(signInResponse.status()).not.toBe(429);
    } finally {
      await prisma.user.deleteMany({
        where: { email: { in: [email] } },
      });
      await prisma.user.deleteMany({ where: { email: { contains: "rl-endpoint-iso-fill" } } });
    }
  });
});

test.describe("Rate limiting — missing IP", () => {
  /**
   * Bu test, dosyadaki DİĞER testlerin aksine kendi izole bucket'ını kullanamaz: test edilen
   * şeyin TA KENDİSİ, IP'siz isteklerin ortak `unknown` bucket'ına düşmesidir (bkz.
   * `request-key.ts`). O bucket process-local dev server'da testler arasında SIFIRLANMAZ ve
   * 10 dakikalık signup penceresi boyunca dolu kalır — bu yüzden test "bucket taze başlıyor"
   * varsayımı YAPMAZ (aksi halde aynı sunucuya karşı ikinci bir çalıştırmada 201 yerine 429
   * görüp flaky olurdu).
   *
   * Bunun yerine bucket'ın başlangıç durumundan BAĞIMSIZ olan asıl güvenlik özelliği
   * doğrulanır: IP'siz istekler limitten MUAF değildir — `limit + 1` deneme sonunda mutlaka
   * 429 görülür, 429'dan sonra tekrar 201'e dönülmez (bypass yok) ve bloklanan hiçbir istek
   * kullanıcı oluşturmaz.
   */
  test("x-forwarded-for eksikse limiter bypass EDİLMEZ — tüm 'unknown' istekler ortak bucket'ı paylaşır", async ({
    request,
  }) => {
    const emails: string[] = [];
    const statuses: number[] = [];

    try {
      // Bucket başlangıçta boş olsa bile (5 x 201) limit + 1 deneme mutlaka bir 429 üretir.
      for (let i = 0; i < RATE_LIMIT_POLICIES.SIGNUP.limit + 1; i++) {
        const email = `rl-noip-${i}-${randomUUID()}@example.com`;
        emails.push(email);
        // KASITLI olarak x-forwarded-for HİÇ set edilmiyor.
        const response = await request.post("/api/auth/signup", { data: { email, password: "S3curePassw0rd!" } });
        statuses.push(response.status());

        // Bloklanan hiçbir deneme kullanıcı oluşturmamalı.
        if (response.status() === 429) {
          expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
        } else {
          expect(response.status()).toBe(201);
        }
      }

      // IP'siz istekler limitten MUAF değil: en az bir 429 görülmeli.
      expect(statuses).toContain(429);

      // Bir kez bloklandıktan sonra IP'siz bir istek tekrar geçemez (pencere içinde bypass yok).
      const firstBlockedIndex = statuses.indexOf(429);
      expect(statuses.slice(firstBlockedIndex).every((status) => status === 429)).toBe(true);
    } finally {
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
    }
  });
});

test.describe("Rate limiting — 429 response güvenliği", () => {
  test("429 response IP/bucket-key/user-id/attempt-count gibi internal veri İÇERMEZ", async ({ request }) => {
    const ip = uniqueTestClientIp();
    const emails: string[] = [];

    try {
      for (let i = 0; i < 5; i++) {
        const email = `rl-secresp-${i}-${randomUUID()}@example.com`;
        emails.push(email);
        await signUpWithIp(request, email, "S3curePassw0rd!", ip);
      }

      const blocked = await signUpWithIp(request, `rl-secresp-blocked-${randomUUID()}@example.com`, "S3curePassw0rd!", ip);
      expect(blocked.status()).toBe(429);

      const rawText = await blocked.text();
      expect(rawText).not.toContain(ip);
      expect(rawText.toLowerCase()).not.toContain("bucket");
      expect(rawText.toLowerCase()).not.toContain("key");
      expect(rawText.toLowerCase()).not.toContain("attempt");
      expect(rawText.toLowerCase()).not.toContain("prisma");
      expect(rawText.toLowerCase()).not.toContain("stack");

      const body = JSON.parse(rawText);
      expect(Object.keys(body)).toEqual(["error"]);
    } finally {
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
    }
  });

  test("429 response Retry-After header'ı içerir ve makul bir aralıktadır", async ({ request }) => {
    const ip = uniqueTestClientIp();
    const emails: string[] = [];

    try {
      for (let i = 0; i < 5; i++) {
        const email = `rl-retryafter-${i}-${randomUUID()}@example.com`;
        emails.push(email);
        await signUpWithIp(request, email, "S3curePassw0rd!", ip);
      }

      const blocked = await signUpWithIp(request, `rl-retryafter-blocked-${randomUUID()}@example.com`, "S3curePassw0rd!", ip);
      expect(blocked.status()).toBe(429);

      const retryAfter = blocked.headers()["retry-after"];
      expect(retryAfter).toBeTruthy();
      const retryAfterSeconds = Number(retryAfter);
      expect(retryAfterSeconds).toBeGreaterThan(0);
      // Signup policy'si 10 dakikalık bir pencere kullanır (bkz. policies.ts) — Retry-After bu
      // pencereyi aşmamalı.
      expect(retryAfterSeconds).toBeLessThanOrEqual(10 * 60);
    } finally {
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
    }
  });
});

test.describe("Rate limiting — reset-password", () => {
  /**
   * `reset-password`, kimlik doğrulaması gerektirmeyen credential-değiştirme endpoint'leri
   * arasında rate limit'i EN SON eklenen endpoint'ti. Token 256 bit olduğu için brute-force
   * birincil tehdit değildir; korunan şey, her istekte DB'ye yazan bu endpoint'in sınırsız
   * çağrılabilmesidir.
   */
  test("limit aşımı (10/15dk) → 429 ve hiçbir şifre değişmez", async ({ request }) => {
    const ip = uniqueTestClientIp();
    const email = `rl-reset-${randomUUID()}@example.com`;
    const originalPassword = "S3curePassw0rd!";
    await signUpWithIp(request, email, originalPassword, uniqueTestClientIp());

    try {
      // Geçersiz token'larla limiti doldur (her biri 400 döner ama kotayı tüketir).
      for (let i = 0; i < RATE_LIMIT_POLICIES.RESET_PASSWORD.limit; i++) {
        const response = await request.post("/api/auth/reset-password", {
          headers: { "x-forwarded-for": ip },
          data: { token: "a".repeat(64), password: "SomeOtherPassw0rd!" },
        });
        expect(response.status()).toBe(400);
      }

      const blocked = await request.post("/api/auth/reset-password", {
        headers: { "x-forwarded-for": ip },
        data: { token: "a".repeat(64), password: "SomeOtherPassw0rd!" },
      });
      expect(blocked.status()).toBe(429);
      expect(await blocked.json()).toEqual({ error: "Too many requests. Please try again later." });

      // Kullanıcının şifresi hâlâ orijinal şifresidir (hiçbir side-effect tetiklenmedi).
      const signIn = await signInWithIp(request, email, originalPassword, uniqueTestClientIp());
      expect(signIn.status()).toBe(302);
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  test("farklı IP'ler birbirinin reset-password kotasını tüketmez", async ({ request }) => {
    const ipA = uniqueTestClientIp();

    for (let i = 0; i < RATE_LIMIT_POLICIES.RESET_PASSWORD.limit; i++) {
      await request.post("/api/auth/reset-password", {
        headers: { "x-forwarded-for": ipA },
        data: { token: "b".repeat(64), password: "SomeOtherPassw0rd!" },
      });
    }
    const blockedA = await request.post("/api/auth/reset-password", {
      headers: { "x-forwarded-for": ipA },
      data: { token: "b".repeat(64), password: "SomeOtherPassw0rd!" },
    });
    expect(blockedA.status()).toBe(429);

    const responseB = await request.post("/api/auth/reset-password", {
      headers: { "x-forwarded-for": uniqueTestClientIp() },
      data: { token: "b".repeat(64), password: "SomeOtherPassw0rd!" },
    });
    expect(responseB.status()).toBe(400); // rate limit DEĞİL, normal "geçersiz token"
  });
});
