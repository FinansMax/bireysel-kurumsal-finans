import { expect, test } from "@playwright/test";

test("kimliği doğrulanmamış istek /api/auth/me üzerinde 401 alır", async ({ request }) => {
  const response = await request.get("/api/auth/me");
  expect(response.status()).toBe(401);

  const body = await response.json();
  expect(body.error).toBeTruthy();
});

test("Auth.js route handler'ı kurulu ve istekleri karşılıyor", async ({ request }) => {
  const response = await request.get("/api/auth/providers");
  expect(response.status()).toBe(200);

  const body = await response.json();
  expect(body).toHaveProperty("credentials");
});
