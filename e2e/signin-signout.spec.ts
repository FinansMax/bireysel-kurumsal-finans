import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import { getSetCookieValues, signInWithCredentials, signOut } from "./support/auth";

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe("Sign-in / sign-out akışı", () => {
  test("doğru kimlik bilgileriyle giriş yapılabiliyor, session gerçekten oluşuyor ve /api/auth/me authenticated erişim veriyor", async ({
    request,
  }) => {
    const email = `e2e-signin-${randomUUID()}@example.com`;
    const password = "S3curePassw0rd!";

    const signupResponse = await request.post("/api/auth/signup", { data: { email, password } });
    expect(signupResponse.status()).toBe(201);

    try {
      const signInResponse = await signInWithCredentials(request, email, password);
      expect(signInResponse.status()).toBe(302);
      expect(signInResponse.headers()["location"]).not.toContain("error=");

      const setCookies = getSetCookieValues(signInResponse);
      expect(setCookies.some((cookie) => cookie.startsWith("authjs.session-token="))).toBe(true);

      const meResponse = await request.get("/api/auth/me");
      expect(meResponse.status()).toBe(200);

      const body = await meResponse.json();
      expect(body.user.email).toBe(email);
      expect(body.user).not.toHaveProperty("passwordHash");
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  test("yanlış şifre ile giriş reddediliyor ve session oluşturulmuyor", async ({ request }) => {
    const email = `e2e-wrongpass-${randomUUID()}@example.com`;
    const password = "S3curePassw0rd!";

    await request.post("/api/auth/signup", { data: { email, password } });

    try {
      const signInResponse = await signInWithCredentials(request, email, "WrongPassword!");
      expect(signInResponse.status()).toBe(302);
      expect(signInResponse.headers()["location"]).toContain("error=CredentialsSignin");

      const meResponse = await request.get("/api/auth/me");
      expect(meResponse.status()).toBe(401);
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  test("bilinmeyen e-posta ile giriş reddediliyor", async ({ request }) => {
    const signInResponse = await signInWithCredentials(
      request,
      `e2e-unknown-${randomUUID()}@example.com`,
      "WhateverPassword!",
    );
    expect(signInResponse.status()).toBe(302);
    expect(signInResponse.headers()["location"]).toContain("error=CredentialsSignin");
  });

  test("sign-out sonrası session geçersiz kılınıyor ve /api/auth/me tekrar 401 dönüyor", async ({
    request,
  }) => {
    const email = `e2e-signout-${randomUUID()}@example.com`;
    const password = "S3curePassw0rd!";

    await request.post("/api/auth/signup", { data: { email, password } });

    try {
      await signInWithCredentials(request, email, password);

      const meBefore = await request.get("/api/auth/me");
      expect(meBefore.status()).toBe(200);

      const signOutResponse = await signOut(request);
      expect(signOutResponse.status()).toBe(302);

      const setCookies = getSetCookieValues(signOutResponse);
      expect(
        setCookies.some(
          (cookie) => cookie.startsWith("authjs.session-token=;") || /Max-Age=0/i.test(cookie),
        ),
      ).toBe(true);

      const meAfter = await request.get("/api/auth/me");
      expect(meAfter.status()).toBe(401);
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });
});
