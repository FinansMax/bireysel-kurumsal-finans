import { randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import { getSetCookieValues, signInWithCredentials } from "../e2e/support/auth";
import { uniqueTestClientIp } from "../e2e/support/rate-limit";
import { RATE_LIMIT_POLICIES } from "../src/lib/rate-limit/policies";

/**
 * Issue #186 — "tüm oturumları kapat", gerçek HTTP akışı.
 *
 * NEDEN BU DOSYA VAR: stateless JWT'de sign-out yalnızca istemcinin cookie'sini siler; çalınmış
 * bir token 8 saat geçerli kalmaya devam ederdi. Bu endpoint'in TEK işi o token'ı gerçekten
 * geçersiz kılmak. "Yazma yapıldı" iddiası yeterli değildir — kanıt, ESKİ cookie'nin artık
 * kabul edilmemesidir; bu dosya onu ölçer.
 */

const createdEmails: string[] = [];

test.afterAll(async () => {
  if (createdEmails.length > 0) {
    await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
  }
  await prisma.$disconnect();
});

function signUp(request: APIRequestContext, email: string, password: string) {
  createdEmails.push(email);
  return request.post("/api/auth/signup", {
    data: { email, password },
    headers: { "x-forwarded-for": uniqueTestClientIp() },
  });
}

async function getSessionCookie(request: APIRequestContext, email: string, password: string) {
  const signInResponse = await signInWithCredentials(request, email, password);
  const cookie = getSetCookieValues(signInResponse)
    .find((value) => value.startsWith("authjs.session-token="))
    ?.split(";")[0];
  if (!cookie) throw new Error("sign-in response'unda session cookie yok");
  return cookie;
}

/**
 * JWT `iat` SANİYE hassasiyetindedir ve `isSessionRevoked()` aynı saniyeye denk gelen token'ı
 * bilinçli olarak revoke ETMEZ (yanlış pozitifi önleyen "grace window" — bkz.
 * `src/lib/auth/session-revocation.ts`). Bu bekleme bir flakiness workaround'ı DEĞİL, test
 * edilen invariant'ın kendi granülaritesiyle gerekçelendirilmiş bir ayrımdır; aynı yardımcı
 * `security/session-revocation-security.spec.ts`'te de var.
 */
async function waitForNextIatSecond(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 1100));
}

async function setupSignedInUser(request: APIRequestContext) {
  const email = `revoke-sec-${randomUUID()}@example.com`;
  const password = "S3curePassw0rd!";
  expect((await signUp(request, email, password)).status()).toBe(201);
  const cookie = await getSessionCookie(request, email, password);
  return { email, password, cookie };
}

function revoke(request: APIRequestContext, cookie: string, ip = uniqueTestClientIp()) {
  return request.post("/api/auth/revoke-sessions", {
    headers: { cookie, "x-forwarded-for": ip },
  });
}

test.describe("POST /api/auth/revoke-sessions — yetkilendirme", () => {
  test("kimliksiz istek 401 döner ve hiçbir şey yazmaz", async ({ request }) => {
    const response = await request.post("/api/auth/revoke-sessions", {
      headers: { "x-forwarded-for": uniqueTestClientIp() },
    });
    expect(response.status()).toBe(401);
  });

  test("gövdedeki userId YOK SAYILIR — başkasının oturumu kapatılamaz", async ({ request }) => {
    /**
     * En kritik saldırı: bu endpoint bir "istediğim kullanıcıyı sistemden at" aracına
     * dönüşmemeli. Hedef YALNIZCA trusted session'dan gelir (invariant #2).
     */
    const attacker = await setupSignedInUser(request);
    const victim = await setupSignedInUser(request);

    const victimBefore = await prisma.user.findUnique({
      where: { email: victim.email },
      select: { sessionsRevokedAt: true },
    });
    expect(victimBefore?.sessionsRevokedAt).toBeNull();

    const response = await request.post("/api/auth/revoke-sessions", {
      headers: { cookie: attacker.cookie, "x-forwarded-for": uniqueTestClientIp() },
      data: { userId: victim.email, email: victim.email },
    });
    expect(response.status()).toBe(200);

    // Kurbanın oturumları ETKİLENMEDİ; saldırgan yalnızca kendi oturumunu kapattı.
    const victimAfter = await prisma.user.findUnique({
      where: { email: victim.email },
      select: { sessionsRevokedAt: true },
    });
    expect(victimAfter?.sessionsRevokedAt).toBeNull();

    const attackerAfter = await prisma.user.findUnique({
      where: { email: attacker.email },
      select: { sessionsRevokedAt: true },
    });
    expect(attackerAfter?.sessionsRevokedAt).toBeInstanceOf(Date);
  });

  test("GET ile çağrılamaz (state değiştiren işlem POST'tur — invariant #4)", async ({
    request,
  }) => {
    /**
     * Bir GET olsaydı `SameSite=Lax` top-level cross-site GET'leri engellemediği için herhangi
     * bir sitedeki `<img src>` kullanıcıyı tüm cihazlarından atabilirdi.
     */
    const { cookie } = await setupSignedInUser(request);
    const response = await request.get("/api/auth/revoke-sessions", { headers: { cookie } });
    expect(response.status()).toBe(405);
  });
});

test.describe("POST /api/auth/revoke-sessions — revocation gerçekten çalışıyor", () => {
  test("revoke ÖNCESİ alınmış cookie ile /api/auth/me 401 döner", async ({ request }) => {
    const { cookie } = await setupSignedInUser(request);

    // KONTROL GRUBU: cookie revoke'tan ÖNCE gerçekten çalışıyor. Bu olmadan aşağıdaki 401,
    // "cookie zaten geçersizdi"den de kaynaklanabilirdi (docs/testing.md #2).
    const before = await request.get("/api/auth/me", { headers: { cookie } });
    expect(before.status()).toBe(200);

    await waitForNextIatSecond();
    expect((await revoke(request, cookie)).status()).toBe(200);

    const after = await request.get("/api/auth/me", { headers: { cookie } });
    expect(after.status()).toBe(401);
  });

  test("GET /api/auth/session ile BYPASS edilemez", async ({ request }) => {
    /**
     * #26'daki aynı tuzak: Auth.js'in session action'ı token'ı her istekte YENİDEN İMZALAR.
     * Kontrol `session` callback'inde olsaydı, çalınmış bir cookie tek bir
     * `GET /api/auth/session` ile tazelenip tekrar geçerli hale gelirdi. Kontrol `jwt`
     * callback'inde olduğu için bu yol da kapalıdır — yeni alan eklendikten sonra da öyle
     * kalmalı.
     */
    const { cookie } = await setupSignedInUser(request);
    await waitForNextIatSecond();
    expect((await revoke(request, cookie)).status()).toBe(200);

    const sessionResponse = await request.get("/api/auth/session", { headers: { cookie } });
    const body = await sessionResponse.json();

    // Gövde boş/null olmalı: revoke edilmiş cookie kullanıcının e-postasını okumaya devam edemez.
    expect(body?.user).toBeFalsy();

    // Ve tazelenmiş bir cookie ile bile /api/auth/me hâlâ 401.
    const refreshed = getSetCookieValues(sessionResponse)
      .find((value) => value.startsWith("authjs.session-token="))
      ?.split(";")[0];
    const meResponse = await request.get("/api/auth/me", {
      headers: { cookie: refreshed ?? cookie },
    });
    expect(meResponse.status()).toBe(401);
  });

  test("revoke SONRASI yeni giriş normal çalışır", async ({ request }) => {
    // İptal kalıcı bir kilit DEĞİLDİR; kullanıcı tekrar girebilmelidir.
    const { email, password, cookie } = await setupSignedInUser(request);
    await waitForNextIatSecond();
    expect((await revoke(request, cookie)).status()).toBe(200);

    await waitForNextIatSecond();
    const freshCookie = await getSessionCookie(request, email, password);
    const response = await request.get("/api/auth/me", { headers: { cookie: freshCookie } });
    expect(response.status()).toBe(200);
  });

  test("başka kullanıcının oturumu ETKİLENMEZ", async ({ request }) => {
    const revoker = await setupSignedInUser(request);
    const bystander = await setupSignedInUser(request);

    await waitForNextIatSecond();
    expect((await revoke(request, revoker.cookie)).status()).toBe(200);

    const bystanderResponse = await request.get("/api/auth/me", {
      headers: { cookie: bystander.cookie },
    });
    expect(bystanderResponse.status()).toBe(200);
  });
});

test.describe("POST /api/auth/revoke-sessions — rate limit ve yanıt güvenliği", () => {
  test("limit aşılınca 429 döner ve yanıt internal veri İÇERMEZ", async ({ request }) => {
    const { cookie } = await setupSignedInUser(request);
    const ip = uniqueTestClientIp();

    const statuses: number[] = [];
    for (let i = 0; i < RATE_LIMIT_POLICIES.REVOKE_SESSIONS.limit + 1; i++) {
      statuses.push((await revoke(request, cookie, ip)).status());
    }

    expect(statuses).toContain(429);

    const blocked = await revoke(request, cookie, ip);
    expect(blocked.status()).toBe(429);

    const rawText = await blocked.text();
    // 429 yanıtı IP, bucket key, kullanıcı kimliği veya deneme sayısı İÇERMEZ (invariant #7).
    for (const forbidden of [ip, "auth:revoke-sessions", "bucket", "attempt"]) {
      expect(rawText, `yanıtta "${forbidden}" olmamalı`).not.toContain(forbidden);
    }
    expect(blocked.headers()["retry-after"]).toBeDefined();
  });

  test("başarı yanıtı hassas alan içermez", async ({ request }) => {
    const { cookie } = await setupSignedInUser(request);
    const response = await revoke(request, cookie);
    const rawText = await response.text();

    for (const forbidden of ["passwordHash", "tokenHash", "sessionsRevokedAt", "@example.com"]) {
      expect(rawText.toLowerCase(), `yanıtta "${forbidden}" olmamalı`).not.toContain(
        forbidden.toLowerCase(),
      );
    }
  });
});

test.describe("Şifre değişimi revocation'ı REGRESYONA uğramadı", () => {
  test("sessionsRevokedAt eklendikten sonra da credentialsChangedAt tek başına revoke ediyor", async ({
    request,
  }) => {
    /**
     * Yeni alan eklenirken en olası gerileme: karşılaştırmanın yalnızca `sessionsRevokedAt`'e
     * bakar hale gelmesi. O durumda şifre değiştiren bir kullanıcının eski token'ı geçerli
     * kalırdı — #26'nın tamamen kaybı.
     */
    const { email, password, cookie } = await setupSignedInUser(request);

    const before = await request.get("/api/auth/me", { headers: { cookie } });
    expect(before.status()).toBe(200);

    await waitForNextIatSecond();

    const changeResponse = await request.post("/api/auth/change-password", {
      headers: { cookie, "x-forwarded-for": uniqueTestClientIp() },
      data: { currentPassword: password, newPassword: "N3wS3curePass!" },
    });
    expect(changeResponse.status()).toBe(200);

    const after = await request.get("/api/auth/me", { headers: { cookie } });
    expect(after.status()).toBe(401);

    // Ve `sessionsRevokedAt` bu akışta YAZILMADI: iki olay ayrı kalmalı.
    const row = await prisma.user.findUnique({
      where: { email },
      select: { sessionsRevokedAt: true, credentialsChangedAt: true },
    });
    expect(row?.sessionsRevokedAt).toBeNull();
    expect(row?.credentialsChangedAt).toBeInstanceOf(Date);
  });
});
