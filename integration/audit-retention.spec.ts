import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { AUDIT_RETENTION_DAYS, pruneAuditLogs } from "../src/lib/audit/retention";
import { prisma } from "../src/lib/prisma";

/**
 * AuditLog saklama ve arşivleme (Issue #188).
 *
 * NEDEN BU TESTLER VAR: `AuditLog` her state değiştiren işlemde bir satır yazıyor ve hiçbir
 * zaman silinmiyordu. Bakım görevi tekrar tekrar çalışacağı için IDEMPOTENT olmak zorunda —
 * ikinci çalıştırmanın da silmesi, arşivde yinelenen dosyalar ve boşuna I/O üretirdi. Arşivin
 * silinen satırlarla BİREBİR eşleşmesi ise verinin gerçekten korunduğunun tek kanıtıdır.
 */

const archiveDirs: string[] = [];
const createdIds: string[] = [];

test.afterAll(async () => {
  if (createdIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { id: { in: createdIds } } });
  }
  for (const dir of archiveDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  await prisma.$disconnect();
});

function tempArchiveDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "audit-archive-"));
  archiveDirs.push(dir);
  return dir;
}

/** Belirli bir yaşta audit satırı üretir. `action` benzersizdir; testler birbirini görmez. */
async function seedLogs(action: string, count: number, ageDays: number): Promise<string[]> {
  const createdAt = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
  const ids: string[] = [];

  for (let i = 0; i < count; i++) {
    const row = await prisma.auditLog.create({
      data: { action, targetType: "USER", targetId: `t-${i}`, createdAt },
      select: { id: true },
    });
    ids.push(row.id);
    createdIds.push(row.id);
  }
  return ids;
}

function readArchivedRows(dir: string): Array<Record<string, unknown>> {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .flatMap((f) =>
      readFileSync(path.join(dir, f), "utf-8")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    );
}

test.describe("pruneAuditLogs() — saklama süresi", () => {
  test("süresi DOLMAMIŞ kayıtlara dokunmaz", async () => {
    const action = `KEEP_${randomUUID()}`;
    const ids = await seedLogs(action, 3, AUDIT_RETENTION_DAYS - 10);
    const dir = tempArchiveDir();

    await pruneAuditLogs({ archiveDir: dir });

    expect(await prisma.auditLog.count({ where: { id: { in: ids } } })).toBe(3);
  });

  test("süresi DOLMUŞ kayıtlar arşivlenir ve silinir", async () => {
    const action = `PRUNE_${randomUUID()}`;
    const ids = await seedLogs(action, 3, AUDIT_RETENTION_DAYS + 10);
    const dir = tempArchiveDir();

    const result = await pruneAuditLogs({ archiveDir: dir });

    expect(result.deletedCount).toBeGreaterThanOrEqual(3);
    expect(await prisma.auditLog.count({ where: { id: { in: ids } } })).toBe(0);

    // ARŞİV, SİLİNEN SATIRLARLA BİREBİR EŞLEŞİR — verinin korunduğunun tek kanıtı.
    const archived = readArchivedRows(dir);
    const archivedIds = new Set(archived.map((row) => row.id));
    for (const id of ids) {
      expect(archivedIds.has(id), `arşivde eksik: ${id}`).toBe(true);
    }

    // Alanlar da taşınmış olmalı, yalnızca id değil.
    const sample = archived.find((row) => row.action === action);
    expect(sample).toBeDefined();
    expect(sample!.targetType).toBe("USER");
    expect(sample!.createdAt).toBeTruthy();
  });

  test("tenantId/actorUserId NULL olan kayıtlar da politikaya tabidir", async () => {
    // Tenant'ı veya kullanıcısı silinmiş kayıtlar (onDelete: SetNull) aksi halde sonsuza
    // kadar birikirdi.
    const action = `ORPHAN_${randomUUID()}`;
    const ids = await seedLogs(action, 2, AUDIT_RETENTION_DAYS + 5);
    const dir = tempArchiveDir();

    await pruneAuditLogs({ archiveDir: dir });

    expect(await prisma.auditLog.count({ where: { id: { in: ids } } })).toBe(0);
  });
});

test.describe("pruneAuditLogs() — idempotent", () => {
  test("İKİNCİ çalıştırma hiçbir şey silmez", async () => {
    const action = `IDEM_${randomUUID()}`;
    await seedLogs(action, 3, AUDIT_RETENTION_DAYS + 10);

    const firstDir = tempArchiveDir();
    const first = await pruneAuditLogs({ archiveDir: firstDir });
    expect(first.deletedCount).toBeGreaterThanOrEqual(3);

    const secondDir = tempArchiveDir();
    const second = await pruneAuditLogs({ archiveDir: secondDir });

    // Cutoff mutlak bir tarihtir; görev güvenle tekrarlanabilir.
    expect(second.deletedCount).toBe(0);
    expect(second.batches).toBe(0);
    expect(second.archiveFiles).toHaveLength(0);
    // Boş çalıştırma dosya bile üretmez.
    expect(readdirSync(secondDir).filter((f) => f.endsWith(".jsonl"))).toHaveLength(0);
  });
});

test.describe("pruneAuditLogs() — partiler", () => {
  test("parti boyutu aşılınca iş BÖLÜNEREK tamamlanır", async () => {
    /**
     * Tek dev `DELETE` atılmaz: milyonlarca satırlık tek bir ifade tabloyu uzun süre kilitler
     * ve WAL'ı şişirir. Bu test, işin gerçekten partilere bölündüğünü kanıtlar.
     */
    const action = `BATCH_${randomUUID()}`;
    const ids = await seedLogs(action, 5, AUDIT_RETENTION_DAYS + 10);
    const dir = tempArchiveDir();

    const result = await pruneAuditLogs({ archiveDir: dir, batchSize: 2 });

    expect(result.batches).toBeGreaterThanOrEqual(3);
    expect(result.archiveFiles.length).toBe(result.batches);
    expect(await prisma.auditLog.count({ where: { id: { in: ids } } })).toBe(0);
  });

  test("maxBatches sınırına takılınca hasMore=true döner ve iş yarıda kalmaz", async () => {
    const action = `LIMIT_${randomUUID()}`;
    const ids = await seedLogs(action, 6, AUDIT_RETENTION_DAYS + 10);
    const dir = tempArchiveDir();

    const first = await pruneAuditLogs({ archiveDir: dir, batchSize: 2, maxBatches: 2 });

    // İlk çalıştırma sınıra takıldı: 4 satır gitti, kalan var.
    expect(first.hasMore).toBe(true);
    expect(first.deletedCount).toBe(4);

    // İkinci çalıştırma KALDIĞI YERDEN devam eder.
    const second = await pruneAuditLogs({ archiveDir: tempArchiveDir(), batchSize: 2 });
    expect(second.deletedCount).toBeGreaterThanOrEqual(2);
    expect(await prisma.auditLog.count({ where: { id: { in: ids } } })).toBe(0);
  });
});

test.describe("pruneAuditLogs() — arşiv dosyası", () => {
  test("yarım .tmp dosyası bırakılmaz (atomik rename)", async () => {
    const action = `ATOMIC_${randomUUID()}`;
    await seedLogs(action, 2, AUDIT_RETENTION_DAYS + 10);
    const dir = tempArchiveDir();

    await pruneAuditLogs({ archiveDir: dir });

    // `.tmp` sonra `rename` atomiktir; geride yarım dosya kalmamalı.
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toHaveLength(0);
    expect(readdirSync(dir).filter((f) => f.endsWith(".jsonl")).length).toBeGreaterThan(0);
  });

  test("silme işlemi audit log'a YAZMAZ (kendi kendini besleyen döngü yok)", async () => {
    /**
     * Silme kendi `AuditLog` satırını üretseydi tablo hiçbir zaman tam boşalmaz ve görev
     * kendi çıktısını temizlemeye çalışırdı.
     */
    const action = `NOLOOP_${randomUUID()}`;
    await seedLogs(action, 2, AUDIT_RETENTION_DAYS + 10);
    const dir = tempArchiveDir();

    const before = await prisma.auditLog.count();
    const result = await pruneAuditLogs({ archiveDir: dir });
    const after = await prisma.auditLog.count();

    // Tam olarak silinen kadar azalmalı; bir tane bile eklenmemeli.
    expect(after).toBe(before - result.deletedCount);
  });

  test("arşiv dizini yoksa oluşturulur", async () => {
    const action = `MKDIR_${randomUUID()}`;
    await seedLogs(action, 1, AUDIT_RETENTION_DAYS + 10);
    const dir = path.join(tempArchiveDir(), "nested", "deep");

    await pruneAuditLogs({ archiveDir: dir });

    expect(existsSync(dir)).toBe(true);
  });
});
