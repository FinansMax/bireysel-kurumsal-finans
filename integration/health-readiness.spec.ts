import path from "node:path";

import { expect, test } from "@playwright/test";

import { checkReadiness } from "../src/lib/health/readiness";
import { prisma } from "../src/lib/prisma";

/**
 * Readiness kontrolü (Issue #184).
 *
 * NEDEN BU TESTLER VAR: `/api/health` sabit `{ status: "ok" }` dönüyordu — DB düşse, migration
 * uygulanmasa bile. Yani izleme sistemi bozuk bir instance'a trafik göndermeye devam ediyordu.
 * Buradaki testler kontrolün GERÇEKTEN bir şey ölçtüğünü sabitler: her arıza sınıfı için ayrı
 * bir test ve her birinin yanında "sağlıklıyken ok diyor" kontrol grubu.
 */

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe("checkReadiness() — sağlıklı durum", () => {
  test("DB ayakta ve migration'lar uygulanmışken 'ok' döner", async () => {
    // KONTROL GRUBU: aşağıdaki "fail" iddialarının hepsi, fonksiyonun her koşulda "fail"
    // demesinden de kaynaklanabilirdi. Bu test onu dışlar.
    const result = await checkReadiness();

    expect(result).toEqual({
      status: "ok",
      checks: { database: "ok", migrations: "ok" },
    });
  });

  test("yanıt SADECE status ve iki kontrolü içerir (bilgi sızdırmaz)", async () => {
    const result = await checkReadiness();

    // Şeklin kendisi bir güvenlik iddiasıdır: ileride buraya sürüm, host, bağlantı dizesi
    // veya hata metni eklenirse test kırmızıya döner (invariant #7).
    expect(Object.keys(result).sort()).toEqual(["checks", "status"]);
    expect(Object.keys(result.checks).sort()).toEqual(["database", "migrations"]);
  });
});

test.describe("checkReadiness() — veritabanı arızası", () => {
  test("DB yoklaması patlarsa status ve database 'fail' olur", async () => {
    const result = await checkReadiness({
      probeDatabase: async () => {
        throw new Error("connection refused");
      },
    });

    expect(result.status).toBe("fail");
    expect(result.checks.database).toBe("fail");
    // DB'ye ulaşılamadıysa migration durumu da BİLİNMİYOR demektir; "ok" demek yanlış olurdu.
    expect(result.checks.migrations).toBe("fail");
  });

  test("yoklama askıda kalırsa zaman aşımıyla 'fail' olur (askıda KALMAZ)", async () => {
    /**
     * Askıda kalan bir health check hiç olmamasından kötüdür: izleme sistemi instance'ı ne
     * sağlıklı ne sağlıksız sayar ve trafik akmaya devam eder. Bu test, sürenin gerçekten
     * uygulandığını ve fonksiyonun DÖNDÜĞÜNÜ kanıtlar.
     */
    const start = Date.now();
    const result = await checkReadiness({
      probeDatabase: () => new Promise<void>(() => {}), // asla çözülmez
      timeoutMs: 150,
    });
    const elapsed = Date.now() - start;

    expect(result.status).toBe("fail");
    expect(result.checks.database).toBe("fail");
    // Süre gerçekten kesildi: sonsuza kadar beklemedik.
    expect(elapsed).toBeLessThan(2_000);
  });

  test("hata mesajı yanıta SIZMAZ", async () => {
    const secret = "postgresql://user:hunter2@db.internal:5432/prod";
    const result = await checkReadiness({
      probeDatabase: async () => {
        throw new Error(`connection failed: ${secret}`);
      },
    });

    // Hata sunucuda loglanır, client'a yalnızca "fail" döner.
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(JSON.stringify(result)).not.toContain("postgresql://");
  });
});

test.describe("checkReadiness() — migration arızası", () => {
  test("uygulanmamış migration varsa 'fail' olur (DB ayakta olsa bile)", async () => {
    /**
     * "Yeni kod eski şemaya deploy edildi" durumunun ta kendisi — en sık görülen ve en sessiz
     * bozulma biçimi.
     *
     * Simülasyon: `migrationsDir` olarak `src/lib` verilir. Bu dizinin alt klasörleri
     * (`auth`, `authz`, `tenants`, ...) geçerli birer "migration adı" gibi okunur ama
     * `_prisma_migrations` tablosunda karşılıkları YOKTUR — yani tam olarak "diskte var,
     * DB'de yok" durumu. DB'ye hiç dokunmadan (paylaşılan test veritabanını bozmadan) gerçek
     * kod yolunu çalıştırır.
     */
    const result = await checkReadiness({
      migrationsDir: path.join(process.cwd(), "src", "lib"),
    });

    expect(result.status).toBe("fail");
    expect(result.checks.migrations).toBe("fail");
    // DB'nin kendisi sağlıklı: arıza gerçekten migration kontrolünden geliyor.
    expect(result.checks.database).toBe("ok");
  });

  test("migration dizini okunamıyorsa 'fail' olur ('sorun yok' DEĞİL)", async () => {
    // Bilmiyor olmak iyi haber değildir: klasör deployment'a kopyalanmadıysa kontrol
    // sessizce "ok" dememelidir.
    const result = await checkReadiness({
      migrationsDir: path.join(process.cwd(), "boyle-bir-dizin-yok-184"),
    });

    expect(result.status).toBe("fail");
    expect(result.checks.migrations).toBe("fail");
    expect(result.checks.database).toBe("ok");
  });
});
