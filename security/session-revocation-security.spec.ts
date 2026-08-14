import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import { getSetCookieValues, signInWithCredentials } from "../e2e/support/auth";
import { clearOutboxEntry, extractTokenFromResetUrl, readOutboxEntry } from "../e2e/support/outbox";

/**
 * Issue #26 — session revocation, uçtan uca HTTP akışı.
 *
 * Bu dosya YENİ bir production security özelliği eklemez; sadece gerçek sign-in/forgot-password/
 * reset-password/`/api/auth/me` akışlarını (mevcut mock/backdoor İÇERMEYEN gerçek HTTP
 * endpoint'leri) kullanarak, şifre reset edildiğinde reset ÖNCESİ session cookie'sinin artık
 * kabul edilmediğini, reset SONRASI yeni bir login'in normal çalıştığını ve bu davranışın
 * başka kullanıcıların session'larını ETKİLEMEDİĞİNİ doğrular.
 */

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function getSessionCookie(request: import("@playwright/test").APIRequestContext, email: string, password: string) {
  const signInResponse = await signInWithCredentials(request, email, password);
  const sessionCookie = getSetCookieValues(signInResponse)
    .find((cookie) => cookie.startsWith("authjs.session-token="))
    ?.split(";")[0];
  if (!sessionCookie) throw new Error("sign-in response'unda session cookie yok");
  return sessionCookie;
}

/**
 * JWT `iat` Unix SANİYE hassasiyetindedir (bkz. `src/lib/auth/session-revocation.ts`); aynı
 * saniye içinde üretilen bir "eski" ve bir "yeni" login, tasarım gereği (yanlış pozitif
 * revocation'ı önlemek için) AYIRT EDİLEMEZ — bkz. `isSessionRevoked()`'in "aynı saniye ise
 * asla revoke etme" invariant'ı. Bu, bir flakiness değil, BİLİNÇLİ bir güvenlik/kullanılabilirlik
 * tercihidir. Bu fonksiyon, gerçek bir "eski login" ile ondan sonra gelen gerçek bir
 * "reset + yeni login" arasında en az bir tam saniyelik gerçek ayrım sağlar — böylece test,
 * `iat`'in kendi granülaritesiyle uyumlu, deterministik bir şekilde iki farklı saniyeye denk
 * gelir. `waitForTimeout()`/UI flakiness workaround'ı DEĞİLDİR: saf `setTimeout`, `page`
 * fixture'ı hiç kullanılmaz (bu dosya sadece `request` fixture'ı kullanır) ve süre, test
 * edilen invariant'ın kendi (saniye) hassasiyetiyle birebir gerekçelendirilmiştir.
 */
async function waitForNextIatSecond(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 1100));
}

async function resetPasswordViaHttp(
  request: import("@playwright/test").APIRequestContext,
  email: string,
  newPassword: string,
) {
  const forgotResponse = await request.post("/api/auth/forgot-password", { data: { email } });
  expect(forgotResponse.status()).toBe(200);

  const entry = readOutboxEntry(email);
  if (!entry) throw new Error("outbox entry bulunamadı");
  const rawToken = extractTokenFromResetUrl(entry.resetUrl);

  const resetResponse = await request.post("/api/auth/reset-password", {
    data: { token: rawToken, password: newPassword },
  });
  expect(resetResponse.status()).toBe(200);
}

test.describe("Session revocation — password reset sonrası eski session geçersiz olur", () => {
  test("login → password reset → eski cookie 401, yeni şifre ile yeni login → yeni cookie 200", async ({
    request,
  }) => {
    const email = `sec-revoke-${randomUUID()}@example.com`;
    const oldPassword = "OldPassw0rd!";
    const newPassword = "BrandNewPassw0rd!";

    const signupResponse = await request.post("/api/auth/signup", {
      data: { email, password: oldPassword },
    });
    expect(signupResponse.status()).toBe(201);

    try {
      // 1) Login olur, önceki (reset öncesi) session cookie'sini yakalar.
      const oldCookie = await getSessionCookie(request, email, oldPassword);

      // Sanity check: reset'ten ÖNCE bu cookie ile /api/auth/me başarılı.
      const meBeforeReset = await request.get("/api/auth/me", { headers: { cookie: oldCookie } });
      expect(meBeforeReset.status()).toBe(200);

      // `iat` saniye hassasiyetinde olduğu için (bkz. yukarıdaki dokümantasyon) reset'in
      // "eski" login'den farklı bir saniyeye denk geldiğinden emin olunur.
      await waitForNextIatSecond();

      // 2) Aynı kullanıcının şifresi gerçek forgot-password/reset-password akışıyla resetlenir.
      await resetPasswordViaHttp(request, email, newPassword);

      // 3) Reset ÖNCESİNDEKİ session cookie'si artık kabul edilmiyor.
      const meWithOldCookie = await request.get("/api/auth/me", { headers: { cookie: oldCookie } });
      expect(meWithOldCookie.status()).toBe(401);

      // 4) Yeni şifre ile tekrar login başarılı olur (yeni bir JWT/cookie üretilir).
      const newSignInResponse = await signInWithCredentials(request, email, newPassword);
      const newCookie = getSetCookieValues(newSignInResponse)
        .find((cookie) => cookie.startsWith("authjs.session-token="))
        ?.split(";")[0];
      expect(newCookie).toBeTruthy();

      // 5) Yeni (reset SONRASI üretilmiş) session cookie'si ile erişim başarılı.
      const meWithNewCookie = await request.get("/api/auth/me", { headers: { cookie: newCookie! } });
      expect(meWithNewCookie.status()).toBe(200);
      const body = await meWithNewCookie.json();
      expect(body.user.email).toBe(email);
    } finally {
      clearOutboxEntry(email);
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  test("eski şifre ile tekrar login artık başarısız olur", async ({ request }) => {
    const email = `sec-revoke-oldpw-${randomUUID()}@example.com`;
    const oldPassword = "OldPassw0rd!";
    const newPassword = "BrandNewPassw0rd!";

    await request.post("/api/auth/signup", { data: { email, password: oldPassword } });

    try {
      await resetPasswordViaHttp(request, email, newPassword);

      const response = await signInWithCredentials(request, email, oldPassword);
      expect(response.headers()["location"]).toContain("error=CredentialsSignin");
    } finally {
      clearOutboxEntry(email);
      await prisma.user.deleteMany({ where: { email } });
    }
  });
});

test.describe("Session revocation — kullanıcılar arası izolasyon", () => {
  test("User A'nın password reset'i User B'nin (credential değiştirmeyen) session'ını ETKİLEMEZ", async ({
    request,
  }) => {
    const emailA = `sec-revoke-a-${randomUUID()}@example.com`;
    const emailB = `sec-revoke-b-${randomUUID()}@example.com`;
    const passwordA = "PasswordA1!";
    const passwordB = "PasswordB1!";

    await request.post("/api/auth/signup", { data: { email: emailA, password: passwordA } });
    await request.post("/api/auth/signup", { data: { email: emailB, password: passwordB } });

    try {
      const cookieA = await getSessionCookie(request, emailA, passwordA);
      const cookieB = await getSessionCookie(request, emailB, passwordB);

      // bkz. waitForNextIatSecond() dokümantasyonu — iat saniye hassasiyeti nedeniyle gerekli.
      await waitForNextIatSecond();

      // Sadece User A'nın şifresi resetlenir.
      await resetPasswordViaHttp(request, emailA, "NewPasswordA1!");

      // User A'nın ESKİ cookie'si artık geçersiz.
      const meA = await request.get("/api/auth/me", { headers: { cookie: cookieA } });
      expect(meA.status()).toBe(401);

      // User B'nin session'ı — credential'ları hiç değişmedi — HÂLÂ geçerli.
      const meB = await request.get("/api/auth/me", { headers: { cookie: cookieB } });
      expect(meB.status()).toBe(200);
      const bodyB = await meB.json();
      expect(bodyB.user.email).toBe(emailB);
    } finally {
      clearOutboxEntry(emailA);
      await prisma.user.deleteMany({ where: { email: { in: [emailA, emailB] } } });
    }
  });
});

test.describe("Session revocation — migration güvenliği (mevcut kullanıcılar)", () => {
  test("credentialsChangedAt = null olan (hiç reset yapmamış) kullanıcının session'ı normal çalışır", async ({
    request,
  }) => {
    const email = `sec-revoke-untouched-${randomUUID()}@example.com`;
    const password = "S3curePassw0rd!";
    await request.post("/api/auth/signup", { data: { email, password } });

    try {
      const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(stored.credentialsChangedAt).toBeNull();

      const cookie = await getSessionCookie(request, email, password);
      const response = await request.get("/api/auth/me", { headers: { cookie } });
      expect(response.status()).toBe(200);
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });
});
