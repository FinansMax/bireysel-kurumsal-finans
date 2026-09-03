import { expect, test } from "@playwright/test";

/**
 * Health endpoint'lerinin bilgi sızdırmaması (Issue #184, invariant #7).
 *
 * NEDEN BU TESTLER VAR: `/api/health/ready` KİMLİK DOĞRULAMASI İSTEMEZ — izleme sistemleri
 * (uptime robot, k8s probe, load balancer) kimlik taşıyamaz. Yani bu endpoint internete açık
 * olabilir ve döndürdüğü her şey herkese açıktır. "Hangi kontrol düştü"nün ötesine geçen tek
 * bir alan (sürüm, host adı, bağlantı dizesi, SQL, stack trace) doğrudan bir keşif hediyesidir.
 */

test.describe("/api/health/ready — yanıt içeriği", () => {
  test("kimlik doğrulaması olmadan erişilebilir ve sağlıklı durumda 200 döner", async ({
    request,
  }) => {
    // Cookie GÖNDERİLMİYOR: izleme sistemi oturum açamaz.
    const response = await request.get("/api/health/ready");

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      checks: { database: "ok", migrations: "ok" },
    });
  });

  test("yanıt gövdesi bağlantı bilgisi / stack trace / iç durum İÇERMEZ", async ({ request }) => {
    const response = await request.get("/api/health/ready");
    const rawText = await response.text();
    const lowered = rawText.toLowerCase();

    // Bağlantı ve altyapı ipuçları
    for (const forbidden of ["postgres", "postgresql://", "prisma", "5432", "localhost", "@"]) {
      expect(lowered, `yanıtta "${forbidden}" olmamalı`).not.toContain(forbidden);
    }

    // Stack trace / hata ayrıntısı izleri
    for (const forbidden of ["at ", "error:", ".ts:", "node_modules", "stack"]) {
      expect(lowered, `yanıtta "${forbidden}" olmamalı`).not.toContain(forbidden);
    }

    // Sürüm/ortam ifşası
    for (const forbidden of ["version", "node_env", "next", "env"]) {
      expect(lowered, `yanıtta "${forbidden}" olmamalı`).not.toContain(forbidden);
    }
  });

  test("yanıtın alan kümesi SABİT — yeni alan eklenirse bu test kırılır", async ({ request }) => {
    const body = (await (await request.get("/api/health/ready")).json()) as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual(["checks", "status"]);
    expect(Object.keys(body.checks as Record<string, unknown>).sort()).toEqual([
      "database",
      "migrations",
    ]);
  });

  test("endpoint oturum cookie'si SET ETMEZ", async ({ request }) => {
    // Kimliksiz bir endpoint'in oturum kurması anlamsız olurdu; regresyon bariyeri.
    const response = await request.get("/api/health/ready");
    const setCookie = response.headers()["set-cookie"];
    expect(setCookie).toBeUndefined();
  });
});

test.describe("/api/health — mevcut sığ kontrol korundu", () => {
  test("hâlâ 200 ve status:ok dönüyor", async ({ request }) => {
    /**
     * Issue #184 sığ kontrolün DAVRANIŞINI KORUMASINI şart koşuyor: load balancer onu kullanır
     * ve readiness eklenirken kırılmamalıdır.
     */
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);

    const body = (await response.json()) as { status: string; timestamp: string };
    expect(body.status).toBe("ok");
    expect(typeof body.timestamp).toBe("string");
  });

  test("sığ kontrol DB'ye bakmaz — readiness ile aynı şey DEĞİLDİR", async ({ request }) => {
    /**
     * İkisinin ayrı olması bu issue'nun tasarım kararı: liveness ("süreç ayakta mı") ve
     * readiness ("istek karşılayabilir mi") farklı sorulardır. Sığ kontrol `checks` alanı
     * taşımaz; taşısaydı iki endpoint'in farkı silinirdi.
     */
    const body = (await (await request.get("/api/health")).json()) as Record<string, unknown>;
    expect(body.checks).toBeUndefined();
  });
});
