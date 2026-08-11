import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { registerUser } from "../src/lib/auth/signup";
import { verifyPassword } from "../src/lib/auth/password";
import { prisma } from "../src/lib/prisma";

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe("registerUser()", () => {
  test("geçerli e-posta + şifre ile kullanıcı oluşturuluyor ve şifre hash'leniyor", async () => {
    const email = `signup-${randomUUID()}@example.com`;

    const result = await registerUser({ email, password: "S3curePassw0rd!" });

    try {
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.user.email).toBe(email);
      expect(result.user).not.toHaveProperty("passwordHash");

      const stored = await prisma.user.findUniqueOrThrow({ where: { id: result.user.id } });
      expect(stored.passwordHash).not.toBeNull();
      expect(stored.passwordHash).not.toBe("S3curePassw0rd!");
      await expect(verifyPassword("S3curePassw0rd!", stored.passwordHash!)).resolves.toBe(true);
    } finally {
      if (result.ok) {
        await prisma.user.delete({ where: { id: result.user.id } });
      }
    }
  });

  test("e-posta trim + lowercase edilerek normalize ediliyor", async () => {
    const suffix = randomUUID();
    const rawEmail = `  Signup-${suffix}@Example.com  `;

    const result = await registerUser({ email: rawEmail, password: "S3curePassw0rd!" });

    try {
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.user.email).toBe(`signup-${suffix}@example.com`);
    } finally {
      if (result.ok) {
        await prisma.user.delete({ where: { id: result.user.id } });
      }
    }
  });

  test("var olan e-posta ile tekrar kayıt denemesi 409 ile reddediliyor", async () => {
    const email = `dup-${randomUUID()}@example.com`;

    const first = await registerUser({ email, password: "S3curePassw0rd!" });
    expect(first.ok).toBe(true);

    try {
      const second = await registerUser({ email, password: "AnotherPassw0rd!" });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.status).toBe(409);
      expect(second.error).toBeTruthy();
    } finally {
      if (first.ok) {
        await prisma.user.delete({ where: { id: first.user.id } });
      }
    }
  });

  test("aynı e-posta farklı büyük/küçük harfle tekrar kayıt denemesi de reddediliyor", async () => {
    const suffix = randomUUID();
    const email = `case-${suffix}@example.com`;

    const first = await registerUser({ email, password: "S3curePassw0rd!" });
    expect(first.ok).toBe(true);

    try {
      const second = await registerUser({
        email: `Case-${suffix}@Example.com`,
        password: "AnotherPassw0rd!",
      });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.status).toBe(409);
    } finally {
      if (first.ok) {
        await prisma.user.delete({ where: { id: first.user.id } });
      }
    }
  });

  test("geçersiz e-posta formatı 400 ile reddediliyor", async () => {
    const result = await registerUser({ email: "not-an-email", password: "S3curePassw0rd!" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  test("zayıf (çok kısa) şifre 400 ile reddediliyor", async () => {
    const result = await registerUser({
      email: `weak-${randomUUID()}@example.com`,
      password: "short",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  test("email veya password eksikse 400 ile reddediliyor", async () => {
    const result = await registerUser({ email: undefined, password: undefined });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });
});
