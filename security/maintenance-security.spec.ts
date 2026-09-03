import { expect, test } from "@playwright/test";

import { uniqueTestClientIp } from "../e2e/support/rate-limit";

/**
 * Bakım endpoint'i güvenliği (Issue #188).
 *
 * NEDEN BU TESTLER VAR: `POST /api/maintenance/audit-retention` oturum İSTEMEZ — onu bir
 * kullanıcı değil, platformun zamanlanmış işi çağırır. Yani endpoint internete açık olabilir ve
 * tek koruması paylaşılan anahtardır. Anahtarsız bir çağrının veri silebilmesi, ya da
 * endpoint'in varlığını/yapılandırma durumunu sızdırması kabul edilemez.
 *
 * Testler `MAINTENANCE_SECRET` YOKKEN koşar (CI'da ve lokalde tanımlı değildir) — yani
 * "özellik kapalı" davranışını doğrular. Anahtar tanımlıyken doğru anahtarın 200 aldığı,
 * yapılandırmayı gerektirdiği için manuel doğrulamaya bırakılmıştır (PR'da yazılı).
 */

const ENDPOINT = "/api/maintenance/audit-retention";

function headers(extra: Record<string, string> = {}) {
  return { "x-forwarded-for": uniqueTestClientIp(), ...extra };
}

test.describe("POST /api/maintenance/audit-retention — erişim", () => {
  test("anahtarsız çağrı 404 döner", async ({ request }) => {
    const response = await request.post(ENDPOINT, { headers: headers() });
    expect(response.status()).toBe(404);
  });

  test("YANLIŞ anahtar da 404 döner — 401/403 DEĞİL", async ({ request }) => {
    /**
     * Anahtar yapılandırılmamışsa da yanlışsa da AYNI yanıt döner: kimliksiz bir çağıran, bu
     * adreste bir bakım endpoint'i olup olmadığını ve yapılandırılmış olup olmadığını ayırt
     * edemez (invariant #7 — enumeration).
     */
    const response = await request.post(ENDPOINT, {
      headers: headers({ authorization: "Bearer definitely-wrong" }),
    });
    expect(response.status()).toBe(404);
  });

  test("Bearer olmayan Authorization biçimleri de 404", async ({ request }) => {
    for (const value of ["Basic abc", "wrong", "Bearer", ""]) {
      const response = await request.post(ENDPOINT, {
        headers: headers({ authorization: value }),
      });
      expect(response.status(), `başlık: ${value}`).toBe(404);
    }
  });

  test("GET ile çağrılamaz — state değiştiren işlem POST'tur (invariant #4)", async ({
    request,
  }) => {
    // Bir GET olsaydı, herhangi bir sayfadaki <img src> bakım görevini tetikleyebilirdi ve
    // bu endpoint oturuma dayanmadığı için CSRF'in normal savunması burada geçerli değil.
    const response = await request.get(ENDPOINT);
    expect(response.status()).toBe(405);
  });
});

test.describe("POST /api/maintenance/audit-retention — bilgi sızıntısı", () => {
  test("yanıt gövdesi iç durum sızdırmaz", async ({ request }) => {
    const response = await request.post(ENDPOINT, { headers: headers() });
    const raw = (await response.text()).toLowerCase();

    for (const forbidden of [
      "prisma",
      "postgres",
      "secret",
      "maintenance_secret",
      "audit-archive",
      ".ts:",
      "node_modules",
    ]) {
      expect(raw, `yanıtta "${forbidden}" olmamalı`).not.toContain(forbidden);
    }
  });

  test("yanıt oturum cookie'si SET ETMEZ", async ({ request }) => {
    const response = await request.post(ENDPOINT, { headers: headers() });
    expect(response.headers()["set-cookie"]).toBeUndefined();
  });
});
