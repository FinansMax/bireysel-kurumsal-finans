import { randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

import { hashToken } from "../src/lib/auth/password-reset";
import { prisma } from "../src/lib/prisma";

import { signInWithCredentials } from "./support/auth";
import { clearOutboxEntry, extractTokenFromResetUrl, readOutboxEntry } from "./support/outbox";

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function signUp(request: APIRequestContext, email: string, password: string) {
  const response = await request.post("/api/auth/signup", { data: { email, password } });
  expect(response.status()).toBe(201);
}

async function forgotPassword(request: APIRequestContext, email: string) {
  return request.post("/api/auth/forgot-password", { data: { email } });
}

test.describe("Forgot password", () => {
  test("kayıtlı e-posta için forgot-password isteği 200 döner ve reset linki gönderilir", async ({
    request,
  }) => {
    const email = `e2e-forgot-${randomUUID()}@example.com`;
    await signUp(request, email, "OldPassw0rd!");

    try {
      const response = await forgotPassword(request, email);
      expect(response.status()).toBe(200);

      const body = await response.json();
      expect(body.message).toBeTruthy();

      const entry = readOutboxEntry(email);
      expect(entry).not.toBeNull();
      expect(entry!.resetUrl).toContain("token=");
    } finally {
      clearOutboxEntry(email);
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  test("user enumeration engeli: kayıtlı ve kayıtsız e-posta AYNI status + AYNI body döner", async ({
    request,
  }) => {
    const knownEmail = `e2e-forgot-known-${randomUUID()}@example.com`;
    const unknownEmail = `e2e-forgot-unknown-${randomUUID()}@example.com`;
    await signUp(request, knownEmail, "OldPassw0rd!");

    try {
      const knownResponse = await forgotPassword(request, knownEmail);
      const unknownResponse = await forgotPassword(request, unknownEmail);

      expect(knownResponse.status()).toBe(unknownResponse.status());
      expect(await knownResponse.json()).toEqual(await unknownResponse.json());
    } finally {
      clearOutboxEntry(knownEmail);
      await prisma.user.deleteMany({ where: { email: knownEmail } });
    }
  });
});

test.describe("Reset password", () => {
  test("geçerli token ile reset edilebiliyor; sonrasında yeni şifre ile sign-in çalışır, eski şifre çalışmaz", async ({
    request,
  }) => {
    const email = `e2e-reset-${randomUUID()}@example.com`;
    await signUp(request, email, "OldPassw0rd!");

    try {
      await forgotPassword(request, email);
      const entry = readOutboxEntry(email);
      expect(entry).not.toBeNull();
      const token = extractTokenFromResetUrl(entry!.resetUrl);

      const resetResponse = await request.post("/api/auth/reset-password", {
        data: { token, password: "BrandNewPassw0rd!" },
      });
      expect(resetResponse.status()).toBe(200);

      const oldSignIn = await signInWithCredentials(request, email, "OldPassw0rd!");
      expect(oldSignIn.headers()["location"]).toContain("error=CredentialsSignin");

      const newSignIn = await signInWithCredentials(request, email, "BrandNewPassw0rd!");
      expect(newSignIn.status()).toBe(302);
      expect(newSignIn.headers()["location"]).not.toContain("error=");
    } finally {
      clearOutboxEntry(email);
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  test("token reuse (aynı token ile ikinci reset denemesi) reddediliyor", async ({ request }) => {
    const email = `e2e-reuse-${randomUUID()}@example.com`;
    await signUp(request, email, "OldPassw0rd!");

    try {
      await forgotPassword(request, email);
      const entry = readOutboxEntry(email);
      const token = extractTokenFromResetUrl(entry!.resetUrl);

      const first = await request.post("/api/auth/reset-password", {
        data: { token, password: "FirstNewPassw0rd!" },
      });
      expect(first.status()).toBe(200);

      const second = await request.post("/api/auth/reset-password", {
        data: { token, password: "SecondNewPassw0rd!" },
      });
      expect(second.status()).toBe(400);
    } finally {
      clearOutboxEntry(email);
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  test("geçersiz (rastgele) token reddediliyor", async ({ request }) => {
    const response = await request.post("/api/auth/reset-password", {
      data: { token: "a".repeat(64), password: "SomePassw0rd!" },
    });
    expect(response.status()).toBe(400);
  });

  test("süresi dolmuş token reddediliyor", async ({ request }) => {
    const email = `e2e-expired-${randomUUID()}@example.com`;
    await signUp(request, email, "OldPassw0rd!");

    try {
      await forgotPassword(request, email);
      const entry = readOutboxEntry(email);
      const token = extractTokenFromResetUrl(entry!.resetUrl);

      // Gerçek 30 dakika beklemek yerine token'ı DB'de geçmişe alıyoruz.
      await prisma.passwordResetToken.updateMany({
        where: { tokenHash: hashToken(token) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const response = await request.post("/api/auth/reset-password", {
        data: { token, password: "SomePassw0rd!" },
      });
      expect(response.status()).toBe(400);
    } finally {
      clearOutboxEntry(email);
      await prisma.user.deleteMany({ where: { email } });
    }
  });
});
