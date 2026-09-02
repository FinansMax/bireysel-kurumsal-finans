import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  hashVerificationToken,
  isEmailVerified,
  sendEmailVerification,
  verifyEmail,
} from "../src/lib/auth/email-verification";
import { registerUser } from "../src/lib/auth/signup";
import { prisma } from "../src/lib/prisma";

/**
 * E-posta doğrulama akışı (Issue #190).
 *
 * NEDEN BU TESTLER VAR: `User.emailVerified` şemada vardı ama hiçbir yerde yazılmıyordu.
 * Kullanıcı yanlış yazdığı bir e-postayla kayıt olabiliyor, şifre sıfırlama o hesaba sonsuza
 * dek erişilemez hale geliyordu. Token deseni `PasswordResetToken` ile birebir aynı olduğu
 * için (invariant #6) buradaki testler o desenin bu akışta da BOZULMADIĞINI sabitler.
 */

const createdUserIds: string[] = [];

test.afterAll(async () => {
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

const noOpSender = {
  async sendPasswordResetEmail() {},
  async sendEmailVerificationEmail() {},
};

async function createUser(): Promise<{ id: string; email: string }> {
  const email = `verify-${randomUUID()}@example.com`;
  const result = await registerUser({ email, password: "S3curePassw0rd!" });
  if (!result.ok) throw new Error("test setup failed");
  createdUserIds.push(result.user.id);
  return { id: result.user.id, email };
}

/** Gönderilen doğrulama URL'sini yakalar (gerçek e-posta olmadan). */
async function requestAndCaptureToken(email: string): Promise<string> {
  let captured = "";
  await sendEmailVerification(email, {
    emailSender: {
      async sendPasswordResetEmail() {},
      async sendEmailVerificationEmail({ verifyUrl }) {
        captured = verifyUrl;
      },
    },
  });
  return new URL(captured).searchParams.get("token") ?? "";
}

test.describe("sendEmailVerification()", () => {
  test("kayıtlı ve doğrulanmamış kullanıcı için token oluşturur", async () => {
    const user = await createUser();
    const token = await requestAndCaptureToken(user.email);

    expect(token).toHaveLength(64); // randomBytes(32) → 64 hex karakter

    const rows = await prisma.emailVerificationToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);

    // RAW TOKEN DB'DE SAKLANMAZ (invariant #6) — yalnızca SHA-256 hash'i.
    expect(rows[0].tokenHash).toBe(hashVerificationToken(token));
    expect(rows[0].tokenHash).not.toBe(token);
  });

  test("var olmayan e-posta için sessizce hiçbir şey yapmaz (enumeration yok)", async () => {
    const before = await prisma.emailVerificationToken.count();
    await sendEmailVerification(`nobody-${randomUUID()}@example.com`, { emailSender: noOpSender });
    expect(await prisma.emailVerificationToken.count()).toBe(before);
  });

  test("ZATEN doğrulanmış hesap için token üretmez", async () => {
    // "Bu hesap zaten doğrulanmış" demek, hesabın varlığını VE durumunu sızdırırdı.
    const user = await createUser();
    await prisma.user.update({ where: { id: user.id }, data: { emailVerified: new Date() } });

    await sendEmailVerification(user.email, { emailSender: noOpSender });
    expect(await prisma.emailVerificationToken.count({ where: { userId: user.id } })).toBe(0);
  });

  test("yeni talep ESKİ kullanılmamış token'ları iptal eder", async () => {
    // Kullanıcı "tekrar gönder"e üç kez basarsa üç geçerli link dolaşımda kalmamalı.
    const user = await createUser();
    const first = await requestAndCaptureToken(user.email);
    const second = await requestAndCaptureToken(user.email);

    expect(await verifyEmail(first)).toEqual({
      ok: false,
      status: 400,
      error: "Invalid or expired token",
    });
    expect(await verifyEmail(second)).toEqual({ ok: true });
  });
});

test.describe("verifyEmail()", () => {
  test("geçerli token emailVerified'ı doldurur", async () => {
    const user = await createUser();
    expect(await isEmailVerified(user.id)).toBe(false);

    const token = await requestAndCaptureToken(user.email);
    expect(await verifyEmail(token)).toEqual({ ok: true });

    expect(await isEmailVerified(user.id)).toBe(true);
  });

  test("token TEK KULLANIMLIK", async () => {
    const user = await createUser();
    const token = await requestAndCaptureToken(user.email);

    expect(await verifyEmail(token)).toEqual({ ok: true });
    expect((await verifyEmail(token)).ok).toBe(false);
  });

  test("EŞZAMANLI iki kullanımdan yalnızca biri kazanır", async () => {
    /**
     * Tüketim tek atomik `updateMany` ile yapılıyor (invariant #6). "Önce oku, sonra yaz"
     * deseni olsaydı iki istek de başarılı olabilirdi.
     */
    const user = await createUser();
    const token = await requestAndCaptureToken(user.email);

    const results = await Promise.all([verifyEmail(token), verifyEmail(token)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  test("süresi dolmuş token reddedilir", async () => {
    const user = await createUser();
    const token = await requestAndCaptureToken(user.email);

    await prisma.emailVerificationToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect((await verifyEmail(token)).ok).toBe(false);
    expect(await isEmailVerified(user.id)).toBe(false);
  });

  test("hata nedeni AYRIŞTIRILMAZ — hepsi aynı mesaj (invariant #7)", async () => {
    const user = await createUser();
    const usedToken = await requestAndCaptureToken(user.email);
    await verifyEmail(usedToken);

    const expiredUser = await createUser();
    const expiredToken = await requestAndCaptureToken(expiredUser.email);
    await prisma.emailVerificationToken.updateMany({
      where: { userId: expiredUser.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const messages = [
      await verifyEmail("nonexistent-token"),
      await verifyEmail(usedToken),
      await verifyEmail(expiredToken),
      await verifyEmail(""),
      await verifyEmail(null),
    ].map((r) => (r.ok ? "OK" : r.error));

    // Bulunamadı / kullanıldı / süresi doldu / boş / tip hatası — hepsi AYNI.
    expect(new Set(messages).size).toBe(1);
  });

  test("BAŞKA kullanıcının token'ı yalnızca KENDİ hesabını doğrular", async () => {
    /**
     * Hedef kullanıcı token KAYDINDAN okunur, çağıran oturumdan değil. Yani elinde başkasının
     * token'ı olan biri kendi hesabını doğrulayamaz.
     */
    const victim = await createUser();
    const attacker = await createUser();
    const victimToken = await requestAndCaptureToken(victim.email);

    expect(await verifyEmail(victimToken)).toEqual({ ok: true });

    expect(await isEmailVerified(victim.id)).toBe(true);
    expect(await isEmailVerified(attacker.id)).toBe(false);
  });
});
