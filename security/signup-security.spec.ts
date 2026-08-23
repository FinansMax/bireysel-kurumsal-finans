import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import { uniqueTestClientIp } from "../e2e/support/rate-limit";

test.afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * Her çağrı kendi sahte istemci IP'sini kullanır (bkz. `e2e/support/rate-limit.ts`) — Issue #27
 * ile signup endpoint'ine eklenen IP-bazlı rate limit'in, bu dosyadaki birden fazla signup
 * çağrısını birbirine karıştırıp yanlışlıkla 429 döndürmesini engeller.
 */
function signUp(request: import("@playwright/test").APIRequestContext, email: string, password: string) {
  return request.post("/api/auth/signup", {
    data: { email, password },
    headers: { "x-forwarded-for": uniqueTestClientIp() },
  });
}

test.describe("Signup security — password handling", () => {
  test("başarılı kayıt response'unda plaintext şifre veya passwordHash hiç geçmiyor", async ({
    request,
  }) => {
    const email = `sec-signup-${randomUUID()}@example.com`;
    const password = "S3curePassw0rd!";

    const response = await signUp(request, email, password);

    try {
      expect(response.status()).toBe(201);

      const rawText = await response.text();
      expect(rawText).not.toContain(password);
      expect(rawText).not.toContain("passwordHash");

      const body = JSON.parse(rawText);
      expect(body.user).not.toHaveProperty("passwordHash");
      expect(body.user).not.toHaveProperty("password");
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  test("şifre DB'de hash'lenmiş olarak saklanıyor, plaintext değil", async ({ request }) => {
    const email = `sec-hash-${randomUUID()}@example.com`;
    const password = "AnotherS3cure!Pass";

    const response = await signUp(request, email, password);

    try {
      expect(response.status()).toBe(201);

      const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(stored.passwordHash).not.toBeNull();
      expect(stored.passwordHash).not.toBe(password);
      // hashPassword formatı: `${saltHex}:${derivedKeyHex}` — plaintext asla bu formatta olamaz.
      expect(stored.passwordHash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });
});

test.describe("Signup security — duplicate email / input validation", () => {
  /**
   * DİKKAT — buradaki `409`, signup'ın bir e-postanın kayıtlı olup olmadığını AÇIKÇA
   * sızdırdığı anlamına gelir (user enumeration). Bu, gözden kaçmış bir güvenlik açığı DEĞİL,
   * gözden geçirilmiş ve BİLİNÇLİ olarak kabul edilmiş bir sözleşmedir (Issue #106) — gerekçesi
   * README'nin "Kayıt (sign-up)" bölümünde yazılıdır. Özetle: sign-in ve forgot-password'de
   * bilgiyi sızdırmak gereksiz olduğu için oralarda yanıtlar eşitlenmiştir; signup'ta ise
   * "hesabın zaten var" bilgisi akışın işleyişi için gereklidir ve bunu gizlemenin doğru yolu
   * (genel yanıt + e-posta ile bildirim) ÇALIŞAN bir e-posta sağlayıcısı gerektirir — bu repo'da
   * henüz yoktur.
   *
   * Bu yüzden bu beklentiyi "enumeration'ı kapatalım" diye generic bir yanıta çevirmeden ÖNCE
   * Issue #106'yı ve README'deki gerekçeyi okuyun; karar, e-posta sağlayıcısı entegre
   * edildiğinde yeniden değerlendirilmelidir.
   */
  test("duplicate e-posta 409 ile reddedilir ve DB'de tek kayıt kalır", async ({ request }) => {
    const email = `sec-dup-${randomUUID()}@example.com`;

    const first = await signUp(request, email, "S3curePassw0rd!");
    expect(first.status()).toBe(201);

    try {
      const second = await signUp(request, email, "DifferentPassw0rd!");
      expect(second.status()).toBe(409);

      const count = await prisma.user.count({ where: { email } });
      expect(count).toBe(1);
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  test("geçersiz input (bozuk e-posta) hiçbir kullanıcı oluşturmuyor", async ({ request }) => {
    const email = "invalid-email-format";

    const response = await signUp(request, email, "S3curePassw0rd!");

    expect(response.status()).toBe(400);
    const count = await prisma.user.count({ where: { email } });
    expect(count).toBe(0);
  });

  test("zayıf şifre hiçbir kullanıcı oluşturmuyor", async ({ request }) => {
    const email = `sec-weak-${randomUUID()}@example.com`;

    const response = await signUp(request, email, "1234567");

    expect(response.status()).toBe(400);
    const count = await prisma.user.count({ where: { email } });
    expect(count).toBe(0);
  });

  test("hata response'ları DB/stack trace detayı sızdırmıyor", async ({ request }) => {
    const response = await signUp(request, "not-an-email", "S3curePassw0rd!");

    expect(response.status()).toBe(400);
    const rawText = await response.text();
    expect(rawText.toLowerCase()).not.toContain("prisma");
    expect(rawText.toLowerCase()).not.toContain("stack");
    expect(rawText.toLowerCase()).not.toContain("at ");
  });
});
