import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { hashPassword, verifyPassword } from "../src/lib/auth/password";
import { prisma } from "../src/lib/prisma";

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe("User modeli auth alanları", () => {
  test("passwordHash ve emailVerified alanları olmadan kullanıcı oluşturulabiliyor (nullable)", async () => {
    const suffix = randomUUID();
    const user = await prisma.user.create({
      data: { email: `no-auth-fields-${suffix}@example.com` },
    });

    try {
      expect(user.passwordHash).toBeNull();
      expect(user.emailVerified).toBeNull();
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("hash'lenmiş şifre User.passwordHash içinde saklanıp doğrulanabiliyor", async () => {
    const suffix = randomUUID();
    const passwordHash = await hashPassword("s3cure-passw0rd!");

    const user = await prisma.user.create({
      data: { email: `with-password-${suffix}@example.com`, passwordHash },
    });

    try {
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored.passwordHash).toBe(passwordHash);
      await expect(verifyPassword("s3cure-passw0rd!", stored.passwordHash!)).resolves.toBe(true);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("emailVerified alanı bir tarih olarak set edilip okunabiliyor", async () => {
    const suffix = randomUUID();
    const verifiedAt = new Date();

    const user = await prisma.user.create({
      data: { email: `verified-${suffix}@example.com`, emailVerified: verifiedAt },
    });

    try {
      expect(user.emailVerified?.getTime()).toBe(verifiedAt.getTime());
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
