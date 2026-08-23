import { randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

import { generateRawToken, hashToken } from "../src/lib/auth/password-reset";
import { prisma } from "../src/lib/prisma";

import { clearOutboxEntry, extractTokenFromResetUrl, readOutboxEntry } from "../e2e/support/outbox";
import { uniqueTestClientIp } from "../e2e/support/rate-limit";

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function signUp(request: APIRequestContext, email: string, password: string) {
  const response = await request.post("/api/auth/signup", {
    data: { email, password },
    headers: { "x-forwarded-for": uniqueTestClientIp() },
  });
  expect(response.status()).toBe(201);
}

/**
 * Her çağrı kendi sahte istemci IP'sini kullanır (bkz. `e2e/support/rate-limit.ts`) — bu dosya
 * (özellikle timing testi) tek bir test içinde bile onlarca forgot-password çağrısı yapıyor;
 * Issue #27'nin forgot-password rate limitine (5/15dk) tüm bu çağrılar TEK bir bucket'tan
 * çarpmasın diye her çağrı bağımsız bir sahte IP kullanır (gerçek dünyada da farklı
 * istemcilerin farklı IP'lerden geleceği varsayımıyla tutarlı).
 */
async function forgotPassword(request: APIRequestContext, email: string) {
  return request.post("/api/auth/forgot-password", {
    data: { email },
    headers: { "x-forwarded-for": uniqueTestClientIp() },
  });
}

async function getTokenViaOutbox(request: APIRequestContext, email: string): Promise<string> {
  await forgotPassword(request, email);
  const entry = readOutboxEntry(email);
  if (!entry) throw new Error("outbox entry bulunamadı");
  return extractTokenFromResetUrl(entry.resetUrl);
}

test.describe("Password reset security — token entropy ve hash'leme", () => {
  test("token yeterli entropiyle üretiliyor (256 bit, hex, çakışmasız)", async () => {
    const tokens = Array.from({ length: 200 }, () => generateRawToken());

    for (const token of tokens) {
      expect(token).toMatch(/^[0-9a-f]{64}$/); // 32 byte = 256 bit = 64 hex karakter
    }

    const unique = new Set(tokens);
    expect(unique.size).toBe(tokens.length);
  });

  test("raw reset token DB'de hiçbir yerde saklanmıyor (sadece SHA-256 hash'i)", async ({
    request,
  }) => {
    const email = `sec-pwreset-raw-${randomUUID()}@example.com`;
    await signUp(request, email, "OldPassw0rd!");

    try {
      const token = await getTokenViaOutbox(request, email);
      const stored = await prisma.passwordResetToken.findFirstOrThrow({
        where: { tokenHash: hashToken(token) },
      });

      expect(JSON.stringify(stored)).not.toContain(token);
      expect(stored.tokenHash).toBe(hashToken(token));
    } finally {
      clearOutboxEntry(email);
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  test("raw reset token forgot-password API response'unda YOK (sadece test outbox dosyasında)", async ({
    request,
  }) => {
    const email = `sec-pwreset-response-${randomUUID()}@example.com`;
    await signUp(request, email, "OldPassw0rd!");

    try {
      const response = await forgotPassword(request, email);
      const rawText = await response.text();

      expect(rawText).not.toContain("token");
      expect(rawText).not.toContain("resetUrl");

      const body = JSON.parse(rawText);
      expect(Object.keys(body)).toEqual(["message"]);
    } finally {
      clearOutboxEntry(email);
      await prisma.user.deleteMany({ where: { email } });
    }
  });
});

test.describe("Password reset security — forgot-password user enumeration", () => {
  test("kayıtlı/kayıtsız e-posta status + body açısından ayırt edilemiyor", async ({ request }) => {
    const knownEmail = `sec-enum-known-${randomUUID()}@example.com`;
    await signUp(request, knownEmail, "OldPassw0rd!");

    try {
      const known = await forgotPassword(request, knownEmail);
      const unknown = await forgotPassword(request, `sec-enum-unknown-${randomUUID()}@example.com`);

      expect(known.status()).toBe(200);
      expect(unknown.status()).toBe(200);
      expect(await known.json()).toEqual(await unknown.json());
    } finally {
      clearOutboxEntry(knownEmail);
      await prisma.user.deleteMany({ where: { email: knownEmail } });
    }
  });

  test("timing kaynaklı enumeration riski değerlendirmesi (kaba, CI gürültüsüne dayanıklı üst sınır)", async ({
    request,
  }) => {
    // NOT: Bilinen kısıtlama — bilinen e-posta yolu ekstra bir DB transaction'ı (2 yazma) +
    // "e-posta gönderimi" (dosya I/O) içerir; bilinmeyen e-posta yolu sadece tek bir okuma
    // yapar. Sign-in akışının aksine (bkz. authenticate.ts) bu fark CPU-bound bir dummy
    // hesaplamayla TAM olarak kapatılmamıştır (token üretimi/hash'lemesi her iki yolda da
    // yapılır, ama DB YAZMA maliyeti eşitlenmemiştir). Bu test, kaba bir üst sınırla sadece
    // ciddi/patolojik bir regresyonu (ör. 10x+ fark) yakalamak için var; hassas bir timing
    // oracle testi DEĞİLDİR. Kalan risk final raporda ayrı bir security işi olarak not edildi.
    const email = `sec-timing-pwreset-${randomUUID()}@example.com`;
    await signUp(request, email, "OldPassw0rd!");

    try {
      const ITERATIONS = 5;
      let knownTotalMs = 0;
      let unknownTotalMs = 0;

      await forgotPassword(request, email); // ısınma isteği

      for (let i = 0; i < ITERATIONS; i++) {
        const knownStart = Date.now();
        await forgotPassword(request, email);
        knownTotalMs += Date.now() - knownStart;

        const unknownStart = Date.now();
        await forgotPassword(request, `sec-timing-unknown-${randomUUID()}@example.com`);
        unknownTotalMs += Date.now() - unknownStart;
      }

      const knownAvg = knownTotalMs / ITERATIONS;
      const unknownAvg = unknownTotalMs / ITERATIONS;
      const ratio = Math.max(knownAvg, unknownAvg) / Math.max(1, Math.min(knownAvg, unknownAvg));

      expect(ratio).toBeLessThan(10);
    } finally {
      clearOutboxEntry(email);
      await prisma.user.deleteMany({ where: { email } });
    }
  });
});

test.describe("Password reset security — token doğrulama", () => {
  test("geçersiz token güvenli, genel bir hata döner (Prisma/stack trace sızmaz)", async ({
    request,
  }) => {
    const response = await request.post("/api/auth/reset-password", {
      headers: { "x-forwarded-for": uniqueTestClientIp() },
      data: { token: "not-a-real-token", password: "SomePassw0rd!" },
    });
    expect(response.status()).toBe(400);

    const rawText = await response.text();
    expect(rawText.toLowerCase()).not.toContain("prisma");
    expect(rawText.toLowerCase()).not.toContain("stack");
    expect(rawText.toLowerCase()).not.toContain("at ");

    const body = JSON.parse(rawText);
    expect(body).toEqual({ error: "Invalid or expired token" });
  });

  test("brute-force denemeleri (çok sayıda rastgele token) tutarlı şekilde reddediliyor", async ({
    request,
  }) => {
    const attempts = await Promise.all(
      Array.from({ length: 25 }, () =>
        request.post("/api/auth/reset-password", {
          headers: { "x-forwarded-for": uniqueTestClientIp() },
          data: { token: generateRawToken(), password: "SomePassw0rd!" },
        }),
      ),
    );

    for (const response of attempts) {
      expect(response.status()).toBe(400);
    }
  });

  test("süresi dolmuş token reddediliyor", async ({ request }) => {
    const email = `sec-expired-${randomUUID()}@example.com`;
    await signUp(request, email, "OldPassw0rd!");

    try {
      const token = await getTokenViaOutbox(request, email);
      await prisma.passwordResetToken.updateMany({
        where: { tokenHash: hashToken(token) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const response = await request.post("/api/auth/reset-password", {
        headers: { "x-forwarded-for": uniqueTestClientIp() },
        data: { token, password: "SomePassw0rd!" },
      });
      expect(response.status()).toBe(400);
    } finally {
      clearOutboxEntry(email);
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  test("consumed (kullanılmış) token tekrar kullanılamıyor", async ({ request }) => {
    const email = `sec-consumed-${randomUUID()}@example.com`;
    await signUp(request, email, "OldPassw0rd!");

    try {
      const token = await getTokenViaOutbox(request, email);

      const first = await request.post("/api/auth/reset-password", {
        headers: { "x-forwarded-for": uniqueTestClientIp() },
        data: { token, password: "FirstPassw0rd!" },
      });
      expect(first.status()).toBe(200);

      const second = await request.post("/api/auth/reset-password", {
        headers: { "x-forwarded-for": uniqueTestClientIp() },
        data: { token, password: "SecondPassw0rd!" },
      });
      expect(second.status()).toBe(400);
    } finally {
      clearOutboxEntry(email);
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  test("başarılı reset response'unda password/passwordHash/tokenHash yok", async ({ request }) => {
    const email = `sec-noleak-${randomUUID()}@example.com`;
    await signUp(request, email, "OldPassw0rd!");

    try {
      const token = await getTokenViaOutbox(request, email);
      const response = await request.post("/api/auth/reset-password", {
        headers: { "x-forwarded-for": uniqueTestClientIp() },
        data: { token, password: "NewPassw0rd!" },
      });
      expect(response.status()).toBe(200);

      const rawText = await response.text();
      expect(rawText).not.toContain("NewPassw0rd!");
      expect(rawText.toLowerCase()).not.toContain("passwordhash");
      expect(rawText.toLowerCase()).not.toContain("tokenhash");
      expect(rawText).not.toContain(token);
    } finally {
      clearOutboxEntry(email);
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  test("concurrent (eşzamanlı) aynı token tüketimi: sadece bir istek kazanır (race condition korunuyor)", async ({
    request,
  }) => {
    const email = `sec-race-${randomUUID()}@example.com`;
    await signUp(request, email, "OldPassw0rd!");

    try {
      const token = await getTokenViaOutbox(request, email);

      const [responseA, responseB] = await Promise.all([
        request.post("/api/auth/reset-password", { data: { token, password: "RaceWinnerA1!" }, headers: { "x-forwarded-for": uniqueTestClientIp() } }),
        request.post("/api/auth/reset-password", { data: { token, password: "RaceWinnerB1!" }, headers: { "x-forwarded-for": uniqueTestClientIp() } }),
      ]);

      const statuses = [responseA.status(), responseB.status()].sort();
      // Tam olarak biri 200 (kazandı), diğeri 400 (token zaten tüketildi) olmalı.
      expect(statuses).toEqual([200, 400]);

      // DB'de token yalnızca bir kez "kullanılmış" olarak işaretlenmiş olmalı.
      const stored = await prisma.passwordResetToken.findFirstOrThrow({
        where: { tokenHash: hashToken(token) },
      });
      expect(stored.usedAt).not.toBeNull();
    } finally {
      clearOutboxEntry(email);
      await prisma.user.deleteMany({ where: { email } });
    }
  });
});
