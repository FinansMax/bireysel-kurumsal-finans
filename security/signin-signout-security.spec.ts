import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { getSetCookieValues, signInWithCredentials, signOut } from "../e2e/support/auth";
import { prisma } from "../src/lib/prisma";

import { createSessionCookieHeader } from "./support/session";

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe("Sign-in security — invalid credentials", () => {
  test("yanlış şifre ve bilinmeyen e-posta AYNI genel hatayı veriyor (detay sızdırmıyor)", async ({
    request,
  }) => {
    const email = `sec-signin-${randomUUID()}@example.com`;
    await request.post("/api/auth/signup", { data: { email, password: "S3curePassw0rd!" } });

    try {
      const wrongPasswordResponse = await signInWithCredentials(request, email, "WrongPassword!");
      const unknownEmailResponse = await signInWithCredentials(
        request,
        `nobody-${randomUUID()}@example.com`,
        "WhateverPassword!",
      );

      expect(wrongPasswordResponse.status()).toBe(unknownEmailResponse.status());
      expect(wrongPasswordResponse.headers()["location"]).toBe(
        unknownEmailResponse.headers()["location"],
      );
      expect(wrongPasswordResponse.headers()["location"]).toContain("error=CredentialsSignin");
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  test("user enumeration engeli: bilinmeyen e-posta ile yanlış şifre yanıt süreleri yakın (timing oracle yok)", async ({
    request,
  }) => {
    // Not: Bu bir mikro-benchmark değil, kaba bir sağlık kontrolüdür. CI ortamındaki
    // gürültüye dayanıklı olması için bilinçli olarak geniş bir tolerans kullanılır.
    // Amaç: "bilinmeyen e-posta" isteğinin scrypt maliyetini tamamen atlayıp çok daha
    // hızlı dönmediğini (bkz. src/lib/auth/authenticate.ts DUMMY_PASSWORD_HASH) doğrulamak.
    const email = `sec-timing-${randomUUID()}@example.com`;
    await request.post("/api/auth/signup", { data: { email, password: "S3curePassw0rd!" } });

    try {
      const ITERATIONS = 6;
      let knownTotalMs = 0;
      let unknownTotalMs = 0;

      // Isınma isteği (ilk isteğin soğuk başlatma maliyetini ölçümün dışında tutmak için).
      await signInWithCredentials(request, email, "WrongPassword!");

      for (let i = 0; i < ITERATIONS; i++) {
        const knownStart = Date.now();
        await signInWithCredentials(request, email, "WrongPassword!");
        knownTotalMs += Date.now() - knownStart;

        const unknownStart = Date.now();
        await signInWithCredentials(request, `nobody-${randomUUID()}@example.com`, "WrongPassword!");
        unknownTotalMs += Date.now() - unknownStart;
      }

      const knownAvg = knownTotalMs / ITERATIONS;
      const unknownAvg = unknownTotalMs / ITERATIONS;
      const ratio = Math.max(knownAvg, unknownAvg) / Math.max(1, Math.min(knownAvg, unknownAvg));

      // Mitigasyon yokken (dummy hash olmadan) bilinmeyen e-posta isteği scrypt'i hiç
      // çalıştırmadığı için gözlemlenen fark tipik olarak 5-10x'tir; burada kullanılan
      // 4x eşiği, gerçek bir regresyonu yakalayacak kadar sıkı, CI gürültüsüne dayanacak
      // kadar gevşektir.
      expect(ratio).toBeLessThan(4);
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });
});

test.describe("Sign-in security — password / passwordHash exposure", () => {
  test("gerçek sign-in sonrası /api/auth/me response'unda plaintext şifre veya passwordHash yok", async ({
    request,
  }) => {
    const email = `sec-expose-${randomUUID()}@example.com`;
    const password = "S3curePassw0rd!";
    await request.post("/api/auth/signup", { data: { email, password } });

    try {
      await signInWithCredentials(request, email, password);

      const meResponse = await request.get("/api/auth/me");
      expect(meResponse.status()).toBe(200);

      const rawText = await meResponse.text();
      expect(rawText).not.toContain(password);
      expect(rawText).not.toContain("passwordHash");

      const body = JSON.parse(rawText);
      expect(body.user).not.toHaveProperty("password");
      expect(body.user).not.toHaveProperty("passwordHash");
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });
});

test.describe("Sign-in security — session / JWT güvenliği", () => {
  test("session cookie httpOnly ve sameSite=lax olarak set ediliyor", async ({ request }) => {
    const email = `sec-cookie-${randomUUID()}@example.com`;
    const password = "S3curePassw0rd!";
    await request.post("/api/auth/signup", { data: { email, password } });

    try {
      const signInResponse = await signInWithCredentials(request, email, password);
      const sessionCookie = getSetCookieValues(signInResponse).find((cookie) =>
        cookie.startsWith("authjs.session-token="),
      );

      expect(sessionCookie).toBeTruthy();
      expect(sessionCookie?.toLowerCase()).toContain("httponly");
      expect(sessionCookie?.toLowerCase()).toContain("samesite=lax");
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  test("session cookie ~8 saat sonra sona eriyor (Auth.js'in 30 günlük varsayılanı değil)", async ({
    request,
  }) => {
    const email = `sec-maxage-${randomUUID()}@example.com`;
    const password = "S3curePassw0rd!";
    await request.post("/api/auth/signup", { data: { email, password } });

    try {
      const beforeSignIn = Date.now();
      const signInResponse = await signInWithCredentials(request, email, password);
      const sessionCookie = getSetCookieValues(signInResponse).find((cookie) =>
        cookie.startsWith("authjs.session-token="),
      );

      const expiresMatch = sessionCookie?.match(/Expires=([^;]+)/i);
      expect(expiresMatch).toBeTruthy();

      const expiresAt = new Date(expiresMatch![1]).getTime();
      const maxAgeSeconds = (expiresAt - beforeSignIn) / 1000;

      // Beklenen: 8 saat (28800sn). İstek/response gecikmesi ve saniye yuvarlamalarına karşı
      // ±5 dakikalık bir tolerans bırakılıyor; asıl amaç 30 günlük (2.592.000sn) varsayılanın
      // ARTIK kullanılmadığını kanıtlamak.
      expect(maxAgeSeconds).toBeGreaterThan(60 * 60 * 8 - 300);
      expect(maxAgeSeconds).toBeLessThan(60 * 60 * 8 + 300);
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  test("sahte (rastgele) session cookie reddediliyor", async ({ request }) => {
    const response = await request.get("/api/auth/me", {
      headers: { cookie: "authjs.session-token=not-a-valid-signed-jwt" },
    });
    expect(response.status()).toBe(401);
  });

  test("geçerli imzalı bir session cookie değiştirilirse (tampered) reddediliyor", async ({
    request,
  }) => {
    const validCookie = await createSessionCookieHeader({
      sub: "tamper-test-user-id",
      email: "tamper-test@example.com",
    });

    // Geçerli, imzalı JWE'nin ortasından bir karakteri değiştirerek "tampered" bir
    // token üretiyoruz. Auth.js'in şifreleme/imza doğrulaması bunu reddetmelidir.
    // (İlk "=" işaretine göre bölünür; JWE değeri "=" içermez ama garanti altına alınır.)
    const separatorIndex = validCookie.indexOf("=");
    const cookieName = validCookie.slice(0, separatorIndex);
    const cookieValue = validCookie.slice(separatorIndex + 1);
    const midpoint = Math.floor(cookieValue.length / 2);
    const originalChar = cookieValue[midpoint];
    const replacementChar = originalChar === "a" ? "b" : "a";
    const tamperedValue =
      cookieValue.slice(0, midpoint) + replacementChar + cookieValue.slice(midpoint + 1);

    const response = await request.get("/api/auth/me", {
      headers: { cookie: `${cookieName}=${tamperedValue}` },
    });

    expect(response.status()).toBe(401);
  });
});

test.describe("Sign-in security — sign-out ve JWT mimari sınırlaması", () => {
  test("sign-out sonrası /api/auth/me GÜNCEL cookie jar ile 401 dönüyor", async ({ request }) => {
    const email = `sec-signout-${randomUUID()}@example.com`;
    const password = "S3curePassw0rd!";
    await request.post("/api/auth/signup", { data: { email, password } });

    try {
      await signInWithCredentials(request, email, password);
      await signOut(request);

      const meResponse = await request.get("/api/auth/me");
      expect(meResponse.status()).toBe(401);
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  test("BİLİNEN MİMARİ SINIRLAMA: sign-out öncesi yakalanmış bir JWT, sign-out sonrasında elle replay edilirse hâlâ kabul ediliyor", async ({
    request,
  }) => {
    // Bu uygulama stateless JWT session stratejisi kullanır (bkz. src/lib/auth/config.ts).
    // Sign-out, Auth.js'in `/api/auth/signout` endpoint'i üzerinden SADECE İSTEMCİNİN
    // session cookie'sini temizler (Set-Cookie: ...; Max-Age=0). Sunucu tarafında bir
    // session store / revocation listesi YOKTUR; bu yüzden sign-out'tan ÖNCE yakalanmış
    // (çalınmış) bir JWT, `exp` süresine kadar kriptografik olarak geçerli kalmaya devam
    // eder ve elle "replay" edilirse hâlâ kabul edilir. Bu, database-backed session'ların
    // aksine stateless JWT mimarisinin bilinen bir mimari kısıtıdır (bkz. final rapor).
    //
    // Bu test bir "hata" değil, mevcut mimarinin gerçek/gözlemlenen davranışını belgeler.
    const email = `sec-replay-${randomUUID()}@example.com`;
    const password = "S3curePassw0rd!";
    await request.post("/api/auth/signup", { data: { email, password } });

    try {
      const signInResponse = await signInWithCredentials(request, email, password);
      const capturedSessionCookie = getSetCookieValues(signInResponse)
        .find((cookie) => cookie.startsWith("authjs.session-token="))
        ?.split(";")[0];

      expect(capturedSessionCookie).toBeTruthy();

      await signOut(request);

      // Aynı context'in GÜNCEL (temizlenmiş) cookie jar'ı ile artık 401 alınıyor...
      const meWithCurrentJar = await request.get("/api/auth/me");
      expect(meWithCurrentJar.status()).toBe(401);

      // ...ama sign-out ÖNCESİNDE yakalanan token'ı elle tekrar gönderirsek:
      const meWithReplayedToken = await request.get("/api/auth/me", {
        headers: { cookie: capturedSessionCookie! },
      });
      expect(meWithReplayedToken.status()).toBe(200);
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });
});
