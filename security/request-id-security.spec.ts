import { expect, test } from "@playwright/test";

/**
 * İstek kimliği başlığı — gerçek HTTP akışı (Issue #183).
 *
 * Kabul kriteri: "Her API yanıtında `x-request-id` var." Bir birim testi proxy'nin
 * ÇALIŞTIĞINI kanıtlayamaz (matcher yanlışsa hiç tetiklenmez); bu yüzden gerçek sunucuya karşı
 * ölçülür.
 */

test.describe("x-request-id — her yanıtta var", () => {
  test("public bir API yanıtında bulunur", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect(response.headers()["x-request-id"]).toBeTruthy();
  });

  test("kimlik doğrulaması BAŞARISIZ olan yanıtta da bulunur", async ({ request }) => {
    // Hata yanıtları, destek talebine en çok konu olanlardır — id özellikle orada gerekli.
    const response = await request.get("/api/auth/me");
    expect(response.status()).toBe(401);
    expect(response.headers()["x-request-id"]).toBeTruthy();
  });

  test("sayfa yanıtlarında da bulunur", async ({ request }) => {
    const response = await request.get("/login");
    expect(response.headers()["x-request-id"]).toBeTruthy();
  });

  test("gelen geçerli id KORUNUR (proxy zinciriyle bağ kurulabilir)", async ({ request }) => {
    const response = await request.get("/api/health", {
      headers: { "x-request-id": "upstream-abc123" },
    });
    expect(response.headers()["x-request-id"]).toBe("upstream-abc123");
  });

  test("LOG INJECTION taşıyan id yok sayılır, yerine yenisi üretilir", async ({ request }) => {
    /**
     * Bu değer log satırlarına yazılıyor; doğrulamasız kabul etmek sahte log kaydı üretmeye
     * izin verirdi. Sunucu, uydurma değeri OLDUĞU GİBİ yansıtmamalı.
     */
    const hostile = "evil id with spaces";
    const response = await request.get("/api/health", {
      headers: { "x-request-id": hostile },
    });

    const returned = response.headers()["x-request-id"];
    expect(returned).toBeTruthy();
    expect(returned).not.toBe(hostile);
  });

  test("her istek FARKLI bir id alır", async ({ request }) => {
    const first = (await request.get("/api/health")).headers()["x-request-id"];
    const second = (await request.get("/api/health")).headers()["x-request-id"];
    expect(first).not.toBe(second);
  });
});
