import { readdirSync } from "node:fs";
import path from "node:path";

import { prisma } from "@/lib/prisma";

/**
 * Readiness (derin sağlık) kontrolü — Issue #184.
 *
 * NEDEN VAR: `GET /api/health` sabit bir `{ status: "ok" }` dönüyordu. Veritabanı düşmüş,
 * migration uygulanmamış veya bağlantı havuzu tükenmiş olsa bile "ok" diyordu — yani load
 * balancer ve uptime izleme, gerçekte bozuk olan bir instance'a trafik göndermeye devam
 * ediyordu. "Süreç ayakta mı" (liveness) ile "istek karşılayabilir mi" (readiness) ayrı
 * sorulardır; bu modül ikincisini yanıtlar.
 *
 * BU MODÜL HTTP BİLMEZ (`docs/architecture.md` → katmanlar): route sadece sonucu 200/503'e
 * çevirir. Böylece integration testlerinde sunucu ayağa kaldırmadan doğrudan çağrılabilir.
 */

/** Tek bir kontrolün sonucu. Ayrıntı YOK — bkz. `ReadinessResult` üzerindeki not. */
export type CheckStatus = "ok" | "fail";

export type ReadinessResult = {
  status: CheckStatus;
  checks: {
    database: CheckStatus;
    migrations: CheckStatus;
  };
};

/**
 * Toplam zaman aşımı.
 *
 * NEDEN: askıda kalan bir health check, hiç olmamasından KÖTÜDÜR. Bağlantı havuzu tükendiğinde
 * `SELECT 1` dakikalarca bekleyebilir; bu sırada izleme sistemi "yanıt bekliyorum" der ve
 * instance'ı ne sağlıklı ne sağlıksız sayar — trafik akmaya devam eder. Süre dolduğunda
 * kontrol BAŞARISIZ sayılır (fail-closed): yanıt vermeyen bir DB, sağlıklı bir DB değildir.
 */
const DEFAULT_TIMEOUT_MS = 2_000;

export type ReadinessOptions = {
  /**
   * Veritabanı yoklaması. Varsayılan gerçek `SELECT 1`'dir.
   *
   * NEDEN ENJEKTE EDİLEBİLİR: "DB düştüğünde 503 dönüyor" iddiasını test etmenin başka yolu
   * yok — testte gerçek PostgreSQL'i kapatamayız ve `docs/conventions.md` yeni bir
   * `PrismaClient` oluşturmayı yasaklar. Aynı enjeksiyon deseni `requestPasswordReset`'in
   * `emailSender` seçeneğinde de var; yeni bir konvansiyon değildir.
   */
  probeDatabase?: () => Promise<void>;
  /** Migration dosyalarının bulunduğu dizin. Varsayılan: `<cwd>/prisma/migrations`. */
  migrationsDir?: string;
  timeoutMs?: number;
};

/**
 * `SELECT 1` — erişilebilirlik ve gecikme yoklaması.
 *
 * HAM SQL BURADA ZORUNLUDUR ve `docs/conventions.md`'nin izin verdiği istisnadır: bir Prisma
 * modeline karşılık gelmeyen bir şeyi (bağlantının kendisini) yokluyoruz. Parametreli
 * tagged-template formu kullanılır; `...Unsafe` varyantları asla.
 *
 * Bir MODEL üzerinden `count()` yapmak reddedildi: o sorgu tabloya, index'e ve satır sayısına
 * bağlıdır; ölçmek istediğimiz şey ise yalnızca bağlantının canlılığı.
 */
async function defaultProbeDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

type MigrationRow = {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

/** Diskteki migration dizinlerinin adları. */
function readMigrationNamesFromDisk(migrationsDir: string): string[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/**
 * Migration durumu kontrolü.
 *
 * İKİ AYRI ARIZA SINIFI VAR ve ikisi de "ok" demeyi engeller:
 *
 * 1. **Yarım kalmış/geri alınmış migration** (`finished_at IS NULL` veya
 *    `rolled_back_at IS NOT NULL`): şema belirsiz bir durumdadır. Uygulama açılır ama
 *    sorguları rastgele kolonlarda patlar.
 * 2. **Uygulanmamış migration**: diskte olup DB'de kaydı olmayan bir migration. Bu, "yeni kod
 *    eski şemaya deploy edildi" durumudur — en sık görülen ve en sessiz bozulma biçimi.
 *
 * İkinci kontrol diski okur. Dizin okunamıyorsa (ör. migration klasörü deployment'a
 * kopyalanmamışsa) kontrol BAŞARISIZ sayılır, "sorun yok" değil: bilmiyor olmak, iyi haber
 * değildir.
 */
async function checkMigrations(migrationsDir: string): Promise<CheckStatus> {
  const rows = await prisma.$queryRaw<MigrationRow[]>`
    SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"
  `;

  const broken = rows.some((row) => row.finished_at === null || row.rolled_back_at !== null);
  if (broken) {
    return "fail";
  }

  let onDisk: string[];
  try {
    onDisk = readMigrationNamesFromDisk(migrationsDir);
  } catch {
    return "fail";
  }

  const applied = new Set(rows.map((row) => row.migration_name));
  const pending = onDisk.filter((name) => !applied.has(name));

  return pending.length === 0 ? "ok" : "fail";
}

/** Verilen süre içinde bitmezse reddeden sarmalayıcı. */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("readiness check timed out")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("readiness check failed"));
      },
    );
  });
}

/**
 * Tüm readiness kontrollerini çalıştırır.
 *
 * THROW ETMEZ: her arıza bir `"fail"`e çevrilir. Bu, servis sözleşmesindeki result-union
 * kuralının health check karşılığıdır — bir health endpoint'inin 500 vermesi, izleme
 * sisteminin "endpoint bozuk" ile "uygulama bozuk" durumlarını ayırt etmesini zorlaştırır.
 */
export async function checkReadiness(options: ReadinessOptions = {}): Promise<ReadinessResult> {
  const probeDatabase = options.probeDatabase ?? defaultProbeDatabase;
  const migrationsDir = options.migrationsDir ?? path.join(process.cwd(), "prisma", "migrations");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /**
   * Kontroller closure değişkenlerini MUTASYONA UĞRATMAK yerine bir değer olarak DÖNER.
   *
   * Neden: `let database: CheckStatus = "fail"` deyip iç içe bir async fonksiyonda atamak,
   * TypeScript'in akış analizinde değişkeni `"fail"` literal'ine daraltıyor ve sonraki
   * `database === "ok"` karşılaştırması TS2367 ("bu karşılaştırma kasıtsız görünüyor") ile
   * derlenmiyor. Değer döndürmek hem derleyiciyi hem okuyucuyu memnun eder.
   */
  const runChecks = async (): Promise<ReadinessResult["checks"]> => {
    await probeDatabase();

    // Buraya gelindiyse bağlantı canlı. Migration sorgusu ayrıca patlarsa bu, DB'nin ölü
    // olduğu anlamına GELMEZ — o yüzden `database` "ok" kalır, yalnızca `migrations` düşer.
    try {
      return { database: "ok", migrations: await checkMigrations(migrationsDir) };
    } catch (error) {
      console.error("[health] migration check failed", {
        error: error instanceof Error ? error.message : "unknown error",
      });
      return { database: "ok", migrations: "fail" };
    }
  };

  // Varsayılan fail-closed: yoklama hiç tamamlanamazsa "bilmiyoruz" değil "sağlıksız" deriz.
  let checks: ReadinessResult["checks"] = { database: "fail", migrations: "fail" };

  try {
    checks = await withTimeout(runChecks(), timeoutMs);
  } catch (error) {
    // İç durum client'a DÖNMEZ (invariant #7); sunucuda loglanır.
    console.error("[health] readiness check failed", {
      error: error instanceof Error ? error.message : "unknown error",
    });
  }

  const status: CheckStatus =
    checks.database === "ok" && checks.migrations === "ok" ? "ok" : "fail";
  return { status, checks };
}
