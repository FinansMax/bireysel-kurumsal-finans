import { expect, test } from "@playwright/test";

/**
 * `/` artık public bir açılış sayfasıdır (eskiden "Proje altyapısı başarıyla çalışıyor."
 * yazan bir geliştirme ekranıydı). Bu dosya yalnızca "sayfa ayakta mı" sorusunu sorar;
 * açılış sayfasının içeriği ve oturuma göre davranışı `landing.spec.ts`'tedir.
 */
test("ana sayfa açılıyor", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Finansınızı tek bir yerden yönetin.", level: 1 }),
  ).toBeVisible();
});

test("health endpoint çalışıyor", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");

  const body = await response.json();
  expect(body.status).toBe("ok");
  expect(typeof body.timestamp).toBe("string");
  expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
});

test("bilinmeyen route 404 dönüyor", async ({ request }) => {
  const response = await request.get("/bu-route-mevcut-degil");
  expect(response.status()).toBe(404);
});
