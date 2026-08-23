import { expect, test } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

/**
 * Temel güvenlik header'ları (`next.config.ts`) gerçek HTTP yanıtlarında var mı?
 *
 * Bu header'lar mevcut korumaların yerine geçmez (authorization backend'de, CSRF `SameSite`
 * + CORS ile) — tarayıcı tarafındaki saldırı yüzeyini daraltır. Test, birinin config'i
 * sadeleştirirken bunları sessizce düşürmesini engeller.
 */

test.afterAll(async () => {
  await prisma.$disconnect();
});

const EXPECTED_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
};

// Hem bir API route'u hem de bir sayfa: header'lar tüm yollara uygulanmalı.
const PATHS = ["/api/health", "/"];

for (const path of PATHS) {
  test.describe(`Güvenlik header'ları — ${path}`, () => {
    test("beklenen header'ların tamamı mevcut", async ({ request }) => {
      const response = await request.get(path);
      const headers = response.headers();

      for (const [key, value] of Object.entries(EXPECTED_HEADERS)) {
        expect(headers[key], `${key} header'ı eksik veya yanlış`).toBe(value);
      }
    });

    test("CSP clickjacking ve base/form hijacking'i engelliyor", async ({ request }) => {
      const csp = (await request.get(path)).headers()["content-security-policy"] ?? "";

      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("form-action 'self'");
      expect(csp).toContain("object-src 'none'");
    });

    test("Permissions-Policy kullanılmayan güçlü API'leri kapatıyor", async ({ request }) => {
      const policy = (await request.get(path)).headers()["permissions-policy"] ?? "";

      for (const feature of ["camera=()", "microphone=()", "geolocation=()"]) {
        expect(policy).toContain(feature);
      }
    });

    test("X-Powered-By header'ı sızmıyor", async ({ request }) => {
      const headers = (await request.get(path)).headers();
      expect(headers["x-powered-by"]).toBeUndefined();
    });
  });
}

test.describe("Güvenlik header'ları — hata yanıtlarında da uygulanıyor", () => {
  test("401 yanıtı da güvenlik header'larını taşıyor", async ({ request }) => {
    // Kontrol grubu: bu istek gerçekten 401 almalı — yani header'lar "mutlu yol"a özel değil.
    const response = await request.get("/api/auth/me");
    expect(response.status()).toBe(401);

    const headers = response.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
  });
});
