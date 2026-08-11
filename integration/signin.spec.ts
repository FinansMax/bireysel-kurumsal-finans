import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { authenticateUser } from "../src/lib/auth/authenticate";
import { registerUser } from "../src/lib/auth/signup";
import { prisma } from "../src/lib/prisma";

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe("authenticateUser()", () => {
  test("doğru email + şifre ile kullanıcı doğrulanıyor", async () => {
    const email = `signin-${randomUUID()}@example.com`;
    const password = "S3curePassw0rd!";
    const signup = await registerUser({ email, password });
    expect(signup.ok).toBe(true);
    if (!signup.ok) return;

    try {
      const user = await authenticateUser({ email, password });
      expect(user).not.toBeNull();
      expect(user?.id).toBe(signup.user.id);
      expect(user?.email).toBe(email);
    } finally {
      await prisma.user.delete({ where: { id: signup.user.id } });
    }
  });

  test("yanlış şifre reddediliyor (null döner)", async () => {
    const email = `signin-wrong-${randomUUID()}@example.com`;
    const signup = await registerUser({ email, password: "S3curePassw0rd!" });
    expect(signup.ok).toBe(true);
    if (!signup.ok) return;

    try {
      const user = await authenticateUser({ email, password: "WrongPassword!" });
      expect(user).toBeNull();
    } finally {
      await prisma.user.delete({ where: { id: signup.user.id } });
    }
  });

  test("bilinmeyen e-posta reddediliyor (null döner)", async () => {
    const user = await authenticateUser({
      email: `unknown-${randomUUID()}@example.com`,
      password: "WhateverPassword!",
    });
    expect(user).toBeNull();
  });

  test("email büyük/küçük harf ve boşluk farkına rağmen giriş yapılabiliyor (normalization)", async () => {
    const suffix = randomUUID();
    const email = `case-signin-${suffix}@example.com`;
    const signup = await registerUser({ email, password: "S3curePassw0rd!" });
    expect(signup.ok).toBe(true);
    if (!signup.ok) return;

    try {
      const user = await authenticateUser({
        email: `  Case-Signin-${suffix}@Example.COM  `,
        password: "S3curePassw0rd!",
      });
      expect(user).not.toBeNull();
      expect(user?.email).toBe(email);
    } finally {
      await prisma.user.delete({ where: { id: signup.user.id } });
    }
  });

  test("boş/eksik credential'lar reddediliyor", async () => {
    const user = await authenticateUser({ email: undefined, password: undefined });
    expect(user).toBeNull();
  });

  test("dönen kullanıcı objesi passwordHash veya password alanı içermiyor", async () => {
    const email = `signin-shape-${randomUUID()}@example.com`;
    const password = "S3curePassw0rd!";
    const signup = await registerUser({ email, password });
    expect(signup.ok).toBe(true);
    if (!signup.ok) return;

    try {
      const user = await authenticateUser({ email, password });
      expect(user).not.toBeNull();
      expect(user).not.toHaveProperty("passwordHash");
      expect(user).not.toHaveProperty("password");
      expect(Object.keys(user ?? {}).sort()).toEqual(["email", "id", "name"]);
    } finally {
      await prisma.user.delete({ where: { id: signup.user.id } });
    }
  });
});
