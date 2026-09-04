import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

/**
 * Issue #185 — yedekleme politikasının ve script'in korunması.
 *
 * NEDEN TEST: bu issue'nun çıktısı büyük ölçüde belge ve bir shell script'idir; ikisi de
 * derleyicinin göremediği yerlerdir. Buradaki testler, sessizce bozulabilecek ÜÇ şeyi
 * bağlar: (1) RPO/RTO sayılarının yazılı kalması, (2) script'in yedeksizliğe yol açan
 * girdileri REDDETMESİ, (3) dökümün pooler üzerinden alınmasının engellenmesi.
 */
const ROOT = join(__dirname, "..");
const SCRIPT = join(ROOT, "scripts", "backup-dump.sh");

function read(...parts: string[]): string {
  return readFileSync(join(ROOT, ...parts), "utf8");
}

/** Script'i verilen ortamla çalıştırır ve çıkış kodu + stderr döner (throw etmez). */
function runScript(env: Record<string, string>): { code: number; output: string } {
  try {
    const stdout = execFileSync("bash", [SCRIPT], {
      env: { ...process.env, ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output: stdout };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

test.describe("Yedekleme hedefleri yazılı", () => {
  test("RPO ve RTO README'de ve runbook'ta duruyor", () => {
    // Bu iki sayı silinirse yedekleme tasarımının dayanağı kalmaz; issue'nun kabul
    // kriterlerinden biri doğrudan "RPO ve RTO yazılı ve erişilebilir" der.
    const readme = read("README.md");
    expect(readme).toContain("RPO");
    expect(readme).toContain("RTO");

    const runbook = read("docs", "runbook-restore.md");
    expect(runbook).toContain("RPO");
    expect(runbook).toContain("RTO");
  });

  test("saklama süreleri ve verinin yeri belgelenmiş", () => {
    const retention = read("docs", "data-retention.md");
    expect(retention).toContain("Neon");
    expect(retention).toContain("pg_dump");
    // KVKK hazırlığı: "hesabımı sil" akışının BULUNMADIĞI açıkça yazılı olmalı — bu,
    // saklama tablosunun yorumlanmasını değiştiren bir bilgidir.
    expect(retention.toLowerCase()).toContain("hesap silme");
  });
});

test.describe("backup-dump.sh — sessiz yedeksizliğe karşı", () => {
  test("BACKUP_DATABASE_URL yoksa ÇALIŞMAZ", () => {
    // Eksik değişkenle "başarılı" çıkmak, yedek alındığı sanılan bir sistem üretirdi.
    const { code, output } = runScript({
      BACKUP_DATABASE_URL: "",
      BACKUP_S3_BUCKET: "bucket",
    });
    expect(code).not.toBe(0);
    expect(output).toContain("BACKUP_DATABASE_URL");
  });

  test("BACKUP_S3_BUCKET yoksa ÇALIŞMAZ", () => {
    const { code, output } = runScript({
      BACKUP_DATABASE_URL: "postgresql://u:p@db.example:5432/x",
      BACKUP_S3_BUCKET: "",
    });
    expect(code).not.toBe(0);
    expect(output).toContain("BACKUP_S3_BUCKET");
  });

  test("POOLER adresi verilirse REDDEDER", () => {
    // pg_dump uzun süren tek bir oturum açar; PgBouncer transaction modunda tutarlı bir
    // snapshot alınamaz ve döküm HATA VERMEDEN tutarsız çıkabilir. Bu, yakalanması en zor
    // yedekleme arızasıdır — bu yüzden girdide durduruluyor.
    const { code, output } = runScript({
      BACKUP_DATABASE_URL: "postgresql://u:p@ep-abc-pooler.eu-central-1.aws.neon.tech/db",
      BACKUP_S3_BUCKET: "bucket",
    });
    expect(code).not.toBe(0);
    expect(output).toContain("POOLER");
  });

  test("KONTROL GRUBU: doğrudan adres bu kontrolü GEÇER", () => {
    // Duyarlılık kanıtı: yukarıdaki üç test, script her koşulda çöktüğü için de geçebilirdi.
    // Burada script pooler kontrolünü aşıp gerçek işe (pg_dump) ulaşmalıdır — o adım bu
    // ortamda ya pg_dump bulunmadığı ya da adres çözülemediği için başarısız olur — ama her
    // iki durumda da script pooler kontrolünü GEÇMİŞ ve 1. adıma ulaşmış olur.
    const { output } = runScript({
      BACKUP_DATABASE_URL: "postgresql://u:p@ep-abc.invalid:5432/db?connect_timeout=2",
      BACKUP_S3_BUCKET: "bucket",
    });
    expect(output).not.toContain("POOLER");
    expect(output).toContain("[1/4]");
  });
});

test.describe("Dökümün doğrulanması script'te duruyor", () => {
  test("yükleme öncesi pg_restore --list ve _prisma_migrations kontrolü var", () => {
    // Bir yedekleme işinin en tehlikeli hâli, başarılı görünüp okunamayan bir dosya
    // üretmesidir. Bu iki kontrol kaldırılırsa arıza ancak olay anında fark edilir.
    const script = readFileSync(SCRIPT, "utf8");
    expect(script).toContain("pg_restore --list");
    expect(script).toContain("_prisma_migrations");
  });
});
