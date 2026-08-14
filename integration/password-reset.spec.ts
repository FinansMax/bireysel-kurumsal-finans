import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { authenticateUser } from "../src/lib/auth/authenticate";
import {
  generateRawToken,
  hashToken,
  requestPasswordReset,
  resetPassword,
} from "../src/lib/auth/password-reset";
import { registerUser } from "../src/lib/auth/signup";
import { prisma } from "../src/lib/prisma";

test.afterAll(async () => {
  await prisma.$disconnect();
});

const OLD_PASSWORD = "OldPassw0rd!";

async function createTestUser() {
  const email = `pwreset-${randomUUID()}@example.com`;
  const result = await registerUser({ email, password: OLD_PASSWORD });
  if (!result.ok) {
    throw new Error("test setup failed: registerUser");
  }
  return { email, userId: result.user.id };
}

/** requestPasswordReset()'i çağırıp gönderilen resetUrl'i (gerçek e-posta olmadan) yakalar. */
async function requestResetAndCaptureUrl(email: string): Promise<string> {
  let capturedUrl = "";
  await requestPasswordReset(email, {
    emailSender: {
      async sendPasswordResetEmail({ resetUrl }) {
        capturedUrl = resetUrl;
      },
    },
  });
  return capturedUrl;
}

function extractToken(resetUrl: string): string {
  const token = new URL(resetUrl).searchParams.get("token");
  if (!token) throw new Error("resetUrl'de token yok");
  return token;
}

// Integration testleri dosya sistemine (test outbox) dokunmadan hermetik kalsın diye,
// gerçek e-posta içeriğini önemsemeyen çağrılarda varsayılan `consoleEmailSender` yerine
// bu no-op sender kullanılır.
const noOpEmailSender = { async sendPasswordResetEmail() {} };

test.describe("requestPasswordReset()", () => {
  test("kayıtlı e-posta için bir PasswordResetToken oluşturuluyor", async () => {
    const { email, userId } = await createTestUser();
    try {
      await requestPasswordReset(email, { emailSender: noOpEmailSender });

      const tokens = await prisma.passwordResetToken.findMany({ where: { userId } });
      expect(tokens).toHaveLength(1);
      expect(tokens[0].usedAt).toBeNull();
      expect(tokens[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
    } finally {
      await prisma.user.delete({ where: { id: userId } });
    }
  });

  test("kayıtlı olmayan e-posta için hiçbir token oluşturulmuyor, hata fırlatılmıyor", async () => {
    const before = await prisma.passwordResetToken.count();

    await expect(
      requestPasswordReset(`unknown-${randomUUID()}@example.com`),
    ).resolves.toBeUndefined();

    const after = await prisma.passwordResetToken.count();
    expect(after).toBe(before);
  });

  test("raw token DB'de plaintext saklanmıyor (sadece SHA-256 hash'i)", async () => {
    const { email, userId } = await createTestUser();
    try {
      const resetUrl = await requestResetAndCaptureUrl(email);
      const rawToken = extractToken(resetUrl);

      const stored = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId } });

      expect(stored.tokenHash).not.toBe(rawToken);
      expect(stored.tokenHash).toBe(hashToken(rawToken));
      expect(JSON.stringify(stored)).not.toContain(rawToken);
    } finally {
      await prisma.user.delete({ where: { id: userId } });
    }
  });

  test("yeni bir istek, kullanıcının önceki kullanılmamış token'ını geçersiz kılıyor", async () => {
    const { email, userId } = await createTestUser();
    try {
      await requestPasswordReset(email, { emailSender: noOpEmailSender });
      const first = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId } });

      await requestPasswordReset(email, { emailSender: noOpEmailSender });

      const firstAfter = await prisma.passwordResetToken.findUniqueOrThrow({
        where: { id: first.id },
      });
      expect(firstAfter.usedAt).not.toBeNull();
    } finally {
      await prisma.user.delete({ where: { id: userId } });
    }
  });
});

test.describe("resetPassword()", () => {
  test("doğru token ile şifre güncelleniyor: hash'leniyor, eski şifre artık doğrulanmıyor, yeni şifre doğrulanıyor", async () => {
    const { email, userId } = await createTestUser();
    try {
      const resetUrl = await requestResetAndCaptureUrl(email);
      const rawToken = extractToken(resetUrl);

      const result = await resetPassword(rawToken, "BrandNewPassw0rd!");
      expect(result.ok).toBe(true);

      const updatedUser = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(updatedUser.passwordHash).not.toBeNull();
      expect(updatedUser.passwordHash).not.toContain(OLD_PASSWORD);
      expect(updatedUser.passwordHash).not.toContain("BrandNewPassw0rd!");

      // Issue #26 — session revocation: başarılı reset, credentialsChangedAt'i set eder ki
      // reset öncesi üretilmiş JWT session'ları (bkz. src/lib/auth/session-revocation.ts)
      // bir sonraki istekte geçersiz sayılsın.
      expect(updatedUser.credentialsChangedAt).not.toBeNull();
      expect(updatedUser.credentialsChangedAt!.getTime()).toBeGreaterThan(Date.now() - 5000);
      expect(updatedUser.credentialsChangedAt!.getTime()).toBeLessThanOrEqual(Date.now());

      const oldAuth = await authenticateUser({ email, password: OLD_PASSWORD });
      expect(oldAuth).toBeNull();

      const newAuth = await authenticateUser({ email, password: "BrandNewPassw0rd!" });
      expect(newAuth).not.toBeNull();
      expect(newAuth?.id).toBe(userId);
    } finally {
      await prisma.user.delete({ where: { id: userId } });
    }
  });

  test("yanlış (rastgele) token reddediliyor", async () => {
    const result = await resetPassword(generateRawToken(), "SomePassw0rd!");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toBe("Invalid or expired token");
  });

  test("geçersiz (rastgele) token: gerçek bir kullanıcı için credentialsChangedAt DEĞİŞMEZ (Issue #26)", async () => {
    const { userId } = await createTestUser();
    try {
      const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(before.credentialsChangedAt).toBeNull();

      const result = await resetPassword(generateRawToken(), "SomePassw0rd!");
      expect(result.ok).toBe(false);

      const after = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(after.credentialsChangedAt).toBeNull();
    } finally {
      await prisma.user.delete({ where: { id: userId } });
    }
  });

  test("süresi dolmuş token reddediliyor", async () => {
    const { userId } = await createTestUser();
    try {
      const rawToken = generateRawToken();
      await prisma.passwordResetToken.create({
        data: {
          userId,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() - 1000),
        },
      });

      const result = await resetPassword(rawToken, "SomePassw0rd!");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(result.error).toBe("Invalid or expired token");

      // Süresi dolmuş token, DB'de "kullanılmamış" (usedAt: null) kalmaya devam eder;
      // reddedilme sebebi expiry'dir, tüketim değil.
      const stored = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId } });
      expect(stored.usedAt).toBeNull();

      // Issue #26: reddedilen (expired) bir reset, credentialsChangedAt'i DEĞİŞTİRMEZ.
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(user.credentialsChangedAt).toBeNull();
    } finally {
      await prisma.user.delete({ where: { id: userId } });
    }
  });

  test("token tek kullanımlık: ikinci kullanım reddediliyor", async () => {
    const { email, userId } = await createTestUser();
    try {
      const resetUrl = await requestResetAndCaptureUrl(email);
      const rawToken = extractToken(resetUrl);

      const first = await resetPassword(rawToken, "FirstNewPassw0rd!");
      expect(first.ok).toBe(true);

      const afterFirst = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(afterFirst.credentialsChangedAt).not.toBeNull();

      const second = await resetPassword(rawToken, "SecondNewPassw0rd!");
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error).toBe("Invalid or expired token");

      // Şifre ilk (kazanan) denemedeki değerde kalmalı.
      const newAuth = await authenticateUser({ email, password: "FirstNewPassw0rd!" });
      expect(newAuth).not.toBeNull();

      // Issue #26: reddedilen ikinci (used-token) deneme, credentialsChangedAt'i TEKRAR
      // güncellemez — ilk başarılı reset'teki değerde sabit kalır.
      const afterSecond = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(afterSecond.credentialsChangedAt?.getTime()).toBe(afterFirst.credentialsChangedAt?.getTime());
    } finally {
      await prisma.user.delete({ where: { id: userId } });
    }
  });

  test("zayıf yeni şifre reddediliyor ve token TÜKETİLMİYOR", async () => {
    const { userId, email } = await createTestUser();
    try {
      const resetUrl = await requestResetAndCaptureUrl(email);
      const rawToken = extractToken(resetUrl);

      const result = await resetPassword(rawToken, "weak");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(result.error).toContain("Password must be");

      const stored = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId } });
      expect(stored.usedAt).toBeNull();

      // Token hâlâ geçerli olduğu için güçlü bir şifreyle tekrar denenebilmeli.
      const retry = await resetPassword(rawToken, "NowStrongPassw0rd!");
      expect(retry.ok).toBe(true);
    } finally {
      await prisma.user.delete({ where: { id: userId } });
    }
  });
});
