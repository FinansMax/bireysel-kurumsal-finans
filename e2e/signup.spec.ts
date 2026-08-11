import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe("POST /api/auth/signup", () => {
  test("geçerli istek 201 ile kullanıcı oluşturuyor", async ({ request }) => {
    const email = `e2e-signup-${randomUUID()}@example.com`;

    const response = await request.post("/api/auth/signup", {
      data: { email, password: "S3curePassw0rd!" },
    });

    try {
      expect(response.status()).toBe(201);

      const body = await response.json();
      expect(body.user.email).toBe(email);
      expect(body.user).not.toHaveProperty("passwordHash");
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  test("aynı e-posta ile ikinci istek 409 alır", async ({ request }) => {
    const email = `e2e-dup-${randomUUID()}@example.com`;

    const firstResponse = await request.post("/api/auth/signup", {
      data: { email, password: "S3curePassw0rd!" },
    });
    expect(firstResponse.status()).toBe(201);

    try {
      const secondResponse = await request.post("/api/auth/signup", {
        data: { email, password: "AnotherPassw0rd!" },
      });
      expect(secondResponse.status()).toBe(409);

      const body = await secondResponse.json();
      expect(body.error).toBeTruthy();
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  test("geçersiz e-posta formatı 400 alır", async ({ request }) => {
    const response = await request.post("/api/auth/signup", {
      data: { email: "not-an-email", password: "S3curePassw0rd!" },
    });
    expect(response.status()).toBe(400);
  });

  test("zayıf şifre 400 alır", async ({ request }) => {
    const response = await request.post("/api/auth/signup", {
      data: { email: `e2e-weak-${randomUUID()}@example.com`, password: "short" },
    });
    expect(response.status()).toBe(400);
  });

  test("geçersiz JSON body 400 alır", async ({ request }) => {
    const response = await request.post("/api/auth/signup", {
      headers: { "content-type": "application/json" },
      data: "not-json-{{{",
    });
    expect(response.status()).toBe(400);
  });
});
