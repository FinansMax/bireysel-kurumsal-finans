import { expect, test } from "@playwright/test";

test("ana sayfa açılıyor", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Bireysel ve Kurumsal Finans SaaS Platformu" }),
  ).toBeVisible();
});

test("health endpoint çalışıyor", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBeTruthy();

  const body = await response.json();
  expect(body.status).toBe("ok");
});
