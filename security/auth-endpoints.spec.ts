import { expect, test } from "@playwright/test";

import { createSessionCookieHeader } from "./support/session";

test.describe("Authentication security — /api/auth/me", () => {
  test("kimliği doğrulanmamış istek 401 alır", async ({ request }) => {
    const response = await request.get("/api/auth/me");
    expect(response.status()).toBe(401);

    const body = await response.json();
    expect(body).toEqual({ error: "Unauthorized" });
  });

  test("geçersiz/sahte session cookie kabul edilmiyor (requireUser reddeder)", async ({
    request,
  }) => {
    const response = await request.get("/api/auth/me", {
      headers: { cookie: "authjs.session-token=not-a-valid-signed-jwt" },
    });

    expect(response.status()).toBe(401);
  });

  test("geçerli imzalı session ile authenticated istek başarılı olur ve passwordHash gibi hassas alanları expose etmez", async ({
    request,
  }) => {
    const cookie = await createSessionCookieHeader({
      sub: "security-test-user-id",
      email: "security-test@example.com",
      name: "Security Test",
    });

    const response = await request.get("/api/auth/me", {
      headers: { cookie },
    });

    expect(response.status()).toBe(200);

    const rawText = await response.text();
    expect(rawText).not.toContain("passwordHash");

    const body = JSON.parse(rawText);
    expect(body.user).toMatchObject({
      id: "security-test-user-id",
      email: "security-test@example.com",
    });
    expect(body.user).not.toHaveProperty("passwordHash");
  });
});

test.describe("Authentication security — Auth.js route handler", () => {
  test("/api/auth/providers credentials provider'ı listeler ve AUTH_SECRET değerini expose etmez", async ({
    request,
  }) => {
    const response = await request.get("/api/auth/providers");
    expect(response.status()).toBe(200);

    const rawText = await response.text();

    const authSecret = process.env.AUTH_SECRET;
    if (authSecret) {
      expect(rawText).not.toContain(authSecret);
    }

    const body = JSON.parse(rawText);
    expect(body).toHaveProperty("credentials");
    expect(body.credentials).toMatchObject({ id: "credentials", type: "credentials" });
  });
});
