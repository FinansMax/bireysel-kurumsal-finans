import { randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import { getSetCookieValues, signInWithCredentials } from "../e2e/support/auth";
import { uniqueTestClientIp } from "../e2e/support/rate-limit";
import {
  extractTokenFromVerifyUrl,
  readVerificationOutboxEntry,
} from "../e2e/support/verification-outbox";

/**
 * E-posta doğrulama — gerçek HTTP akışı (Issue #190).
 *
 * En kritik iki iddia: (1) doğrulanmamış hesap para/ekip verisine dokunamaz, (2) endpoint'ler
 * "bu e-posta kayıtlı mı / doğrulanmış mı" sorusunun oracle'ı DEĞİLDİR.
 */

const createdEmails: string[] = [];

test.afterAll(async () => {
  if (createdEmails.length > 0) {
    await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
  }
  await prisma.$disconnect();
});

const PASSWORD = "S3curePassw0rd!";

async function signUpAndSignIn(request: APIRequestContext) {
  const email = `verify-sec-${randomUUID()}@example.com`;
  createdEmails.push(email);

  const created = await request.post("/api/auth/signup", {
    data: { email, password: PASSWORD },
    headers: { "x-forwarded-for": uniqueTestClientIp() },
  });
  expect(created.status()).toBe(201);

  const signedIn = await signInWithCredentials(request, email, PASSWORD);
  const cookie = getSetCookieValues(signedIn)
    .find((value) => value.startsWith("authjs.session-token="))
    ?.split(";")[0];
  if (!cookie) throw new Error("session cookie yok");

  return { email, cookie };
}

test.describe("Doğrulanmamış hesap sınırları", () => {
  test("tenant OLUŞTURAMAZ — 403 ve anlaşılır mesaj", async ({ request }) => {
    const { cookie } = await signUpAndSignIn(request);

    const response = await request.post("/api/tenants", {
      headers: { cookie, "x-forwarded-for": uniqueTestClientIp() },
      data: { name: "Doğrulanmamış Deneme" },
    });

    // 403, 401 DEĞİL: kimlik doğrulanmış, yetki eksik.
    expect(response.status()).toBe(403);
    const body = await response.json();
    expect(String(body.error).toLowerCase()).toContain("verify");

    // KONTROL GRUBU: hiçbir tenant oluşmadı.
    expect(await prisma.tenant.count({ where: { name: "Doğrulanmamış Deneme" } })).toBe(0);
  });

  test("davet KABUL EDEMEZ — 403 ve token TÜKETİLMEZ", async ({ request }) => {
    const { cookie } = await signUpAndSignIn(request);

    const response = await request.post("/api/invitations/accept", {
      headers: { cookie, "x-forwarded-for": uniqueTestClientIp() },
      data: { token: "some-token" },
    });

    expect(response.status()).toBe(403);
  });

  test("KONTROL GRUBU: doğrulandıktan SONRA tenant oluşturabiliyor", async ({ request }) => {
    /**
     * Bu test olmadan yukarıdaki 403'ler "tenant oluşturma zaten bozuk"tan da kaynaklanabilirdi.
     */
    const { email, cookie } = await signUpAndSignIn(request);

    const entry = readVerificationOutboxEntry(email);
    expect(entry, "kayıt sonrası doğrulama e-postası gitmeliydi").not.toBeNull();

    const verifyResponse = await request.post("/api/auth/verify-email", {
      headers: { "x-forwarded-for": uniqueTestClientIp() },
      data: { token: extractTokenFromVerifyUrl(entry!.verifyUrl) },
    });
    expect(verifyResponse.status()).toBe(200);

    const slug = `verified-${randomUUID()}`;
    const created = await request.post("/api/tenants", {
      headers: { cookie, "x-forwarded-for": uniqueTestClientIp() },
      data: { name: "Doğrulanmış Alan", slug },
    });
    expect(created.status()).toBe(201);

    await prisma.tenant.deleteMany({ where: { slug } });
  });
});

test.describe("Enumeration ve token güvenliği", () => {
  test("resend-verification kayıtlı/kayıtsız e-posta için AYNI yanıtı verir", async ({
    request,
  }) => {
    const { email } = await signUpAndSignIn(request);

    const known = await request.post("/api/auth/resend-verification", {
      headers: { "x-forwarded-for": uniqueTestClientIp() },
      data: { email },
    });
    const unknown = await request.post("/api/auth/resend-verification", {
      headers: { "x-forwarded-for": uniqueTestClientIp() },
      data: { email: `nobody-${randomUUID()}@example.com` },
    });

    expect(known.status()).toBe(unknown.status());
    expect(await known.text()).toBe(await unknown.text());
  });

  test("geçersiz token yanıtı NEDENİ ayrıştırmaz", async ({ request }) => {
    const bodies: string[] = [];
    for (const token of ["nonexistent", "", "a".repeat(64)]) {
      const response = await request.post("/api/auth/verify-email", {
        headers: { "x-forwarded-for": uniqueTestClientIp() },
        data: { token },
      });
      expect(response.status()).toBe(400);
      bodies.push(await response.text());
    }
    expect(new Set(bodies).size).toBe(1);
  });

  test("raw token yanıtta veya kullanıcı kaydında GÖRÜNMEZ", async ({ request }) => {
    const { email } = await signUpAndSignIn(request);
    const entry = readVerificationOutboxEntry(email);
    const rawToken = extractTokenFromVerifyUrl(entry!.verifyUrl);

    // DB'de yalnızca hash var.
    const stored = await prisma.emailVerificationToken.findMany({
      where: { user: { email } },
      select: { tokenHash: true },
    });
    expect(stored.length).toBeGreaterThan(0);
    for (const row of stored) {
      expect(row.tokenHash).not.toBe(rawToken);
    }

    // Başarılı doğrulama yanıtı token'ı yankılamaz.
    const response = await request.post("/api/auth/verify-email", {
      headers: { "x-forwarded-for": uniqueTestClientIp() },
      data: { token: rawToken },
    });
    expect(response.status()).toBe(200);
    expect(await response.text()).not.toContain(rawToken);
  });

  test("verify-email GET ile çağrılamaz (invariant #4)", async ({ request }) => {
    // GET olsaydı e-posta istemcisinin link ön-getirmesi token'ı tüketebilirdi.
    const response = await request.get("/api/auth/verify-email");
    expect(response.status()).toBe(405);
  });
});
