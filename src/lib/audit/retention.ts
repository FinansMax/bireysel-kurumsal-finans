import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * AuditLog saklama ve arşivleme (Issue #188).
 *
 * NEDEN VAR: `AuditLog` her state değiştiren işlemde bir satır yazıyor ve hiçbir zaman
 * silinmiyordu. Bir yıl içinde veritabanının en büyük tablosu o olurdu; `@@index([createdAt])`,
 * `@@index([action])` gibi index'ler de onunla birlikte büyürdü. Ayrıca "kişisel veriyi ne
 * kadar süre tutuyorsunuz?" sorusunun bir cevabı yoktu.
 *
 * BU MODÜL HTTP BİLMEZ (`docs/architecture.md` → katmanlar): route yalnızca tetikler ve sonucu
 * yanıta çevirir. Böylece integration testlerinde sunucu ayağa kaldırmadan çağrılabilir.
 */

/**
 * Sıcak saklama süresi: 12 ay.
 *
 * NEDEN 12 AY: audit log'un iki tüketicisi var. (1) Güvenlik incelemesi — "hesabım ele
 * geçirildi mi" araştırması pratikte haftalar, en fazla aylar geriye bakar. (2) Uyuşmazlık
 * çözümü — finansal bir üründe bir işlemin kim tarafından değiştirildiği sorusu bir mali yıl
 * boyunca sorulabilir. 12 ay ikisini de karşılar ve tam bir mali dönemi kapsar.
 *
 * DAHA KISA (ör. 90 gün) REDDEDİLDİ: yıl sonu kapanışında geçmiş bir çeyreğin kayıtları
 * kaybolurdu. DAHA UZUN (ör. 7 yıl) REDDEDİLDİ: yasal saklama yükümlülüğü audit log'a değil
 * FİNANSAL KAYITLARA (Transaction, Invoice) aittir; audit log onların yerine geçmez. Kişisel
 * veriyi gereğinden uzun tutmak da bir yükümlülüktür, avantaj değil.
 *
 * Süresi dolan kayıtlar SİLİNMEDEN ÖNCE ARŞİVLENİR — yani "12 ay" verinin ömrü değil, sıcak
 * veritabanında kalma süresidir.
 */
export const AUDIT_RETENTION_DAYS = 365;

/**
 * Parti boyutu.
 *
 * TEK DEV `DELETE` ATILMAZ: milyonlarca satırlık tek bir ifade, tabloyu uzun süre kilitler,
 * WAL'ı şişirir ve replikasyon gecikmesi üretir — bakım işi üretimi durdurur hale gelirdi.
 * Sabit boyutlu partiler her biri kısa süren, tek tek geri alınabilir işlemlerdir.
 */
const DEFAULT_BATCH_SIZE = 10_000;

/**
 * Tek çalıştırmada işlenecek azami parti sayısı.
 *
 * NEDEN SINIR VAR: ilk çalıştırma yılların birikmiş kaydını bulabilir. Sınırsız bir döngü,
 * zamanlanmış işin platform zaman aşımına takılmasına ve HER SEFERİNDE aynı yerde ölmesine yol
 * açardı. Sınır sayesinde iş bölünerek ilerler; `hasMore` bir sonraki çalıştırmanın gerekli
 * olduğunu söyler.
 */
const DEFAULT_MAX_BATCHES = 10;

/** Arşivin yazılacağı varsayılan dizin. `.gitignore`'dadır. */
const DEFAULT_ARCHIVE_DIR = ".audit-archive";

export type PruneAuditLogsOptions = {
  /** "Şimdi" — testlerin cutoff'u deterministik kurabilmesi için. */
  now?: Date;
  retentionDays?: number;
  batchSize?: number;
  maxBatches?: number;
  archiveDir?: string;
};

export type PruneAuditLogsResult = {
  cutoff: Date;
  deletedCount: number;
  batches: number;
  archiveFiles: string[];
  /** `true` = sınıra takıldı, silinecek kayıt kaldı. Görev tekrar çalıştırılmalı. */
  hasMore: boolean;
};

/** Arşive yazılan satırın şekli — DB satırının birebir kopyası. */
const ARCHIVE_SELECT = {
  id: true,
  actorUserId: true,
  tenantId: true,
  action: true,
  targetType: true,
  targetId: true,
  metadata: true,
  createdAt: true,
} satisfies Prisma.AuditLogSelect;

type ArchivedRow = Prisma.AuditLogGetPayload<{ select: typeof ARCHIVE_SELECT }>;

/**
 * Bir partiyi arşiv dosyasına yazar ve dosya yolunu döner.
 *
 * FORMAT JSONL (satır başına bir JSON nesnesi): tek bir dev JSON dizisinin aksine akış halinde
 * okunabilir ve dosyanın sonuna eklenerek büyütülebilir; milyonlarca satırlık bir arşivi
 * belleğe almadan işlemek mümkün olur.
 *
 * ÖNCE `.tmp`, SONRA `rename`: `rename` aynı dosya sistemi içinde atomiktir. Doğrudan hedefe
 * yazarken süreç ölürse geride YARIM bir arşiv dosyası kalır ve o dosya "silinen satırların
 * tam kaydı" sanılırdı. Yarım `.tmp` dosyası ise açıkça yarımdır.
 */
function writeArchiveBatch(archiveDir: string, runId: string, batchIndex: number, rows: ArchivedRow[]): string {
  mkdirSync(archiveDir, { recursive: true });

  const fileName = `audit-${runId}-${String(batchIndex).padStart(3, "0")}.jsonl`;
  const finalPath = path.join(archiveDir, fileName);
  const tempPath = `${finalPath}.tmp`;

  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  writeFileSync(tempPath, body.length > 0 ? `${body}\n` : "", "utf-8");
  renameSync(tempPath, finalPath);

  return finalPath;
}

/**
 * Süresi dolmuş audit kayıtlarını arşivler ve siler.
 *
 * İDEMPOTENT: ikinci çalıştırma hiçbir şey bulamaz ve hiçbir şey silmez. Cutoff mutlak bir
 * tarihtir (satır sayısına veya önceki çalıştırmaya bağlı değildir), bu yüzden görev güvenle
 * tekrarlanabilir ve yarıda kesilirse kaldığı yerden devam eder.
 *
 * SIRA KRİTİK — ÖNCE ARŞİV, SONRA SİLME. Süreç ikisinin arasında ölürse satırlar hâlâ
 * veritabanındadır ve bir sonraki çalıştırma onları YENİDEN arşivler: sonuç, arşivde yinelenen
 * kayıtlardır. Ters sıra (önce sil, sonra arşivle) ise VERİ KAYBI üretirdi. Yinelenen arşiv
 * kaydı geri dönülebilir bir sorundur; kaybolan denetim kaydı değildir.
 *
 * AUDIT LOG'A YAZMAZ (Issue #188 gereği): silme işleminin kendisi bir `AuditLog` satırı
 * üretseydi, tablo hiçbir zaman tam olarak boşalmaz ve görev kendi kendini besleyen bir döngüye
 * girerdi. Sonuç yalnızca sunucu loguna yazılır.
 *
 * `tenantId`/`actorUserId` NULL olan kayıtlar da politikaya TABİDİR: tenant'ı veya kullanıcısı
 * silinmiş kayıtlar (`onDelete: SetNull`) aksi halde sonsuza kadar birikirdi.
 */
export async function pruneAuditLogs(
  options: PruneAuditLogsOptions = {},
): Promise<PruneAuditLogsResult> {
  const now = options.now ?? new Date();
  const retentionDays = options.retentionDays ?? AUDIT_RETENTION_DAYS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatches = options.maxBatches ?? DEFAULT_MAX_BATCHES;
  const archiveDir = options.archiveDir ?? path.join(process.cwd(), DEFAULT_ARCHIVE_DIR);

  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  // Çalıştırma kimliği dosya adlarını benzersiz kılar; aynı gün iki kez çalışsa bile önceki
  // arşivin üzerine YAZILMAZ.
  const runId = now.toISOString().replace(/[:.]/g, "-");

  const archiveFiles: string[] = [];
  let deletedCount = 0;
  let batches = 0;
  let hasMore = false;

  for (let batchIndex = 0; batchIndex < maxBatches; batchIndex++) {
    const rows = await prisma.auditLog.findMany({
      where: { createdAt: { lt: cutoff } },
      // En eskiden başlanır: yarıda kesilse bile en eski (en az değerli) kayıtlar önce gider.
      orderBy: { createdAt: "asc" },
      take: batchSize,
      select: ARCHIVE_SELECT,
    });

    if (rows.length === 0) {
      break;
    }

    archiveFiles.push(writeArchiveBatch(archiveDir, runId, batchIndex, rows));

    const { count } = await prisma.auditLog.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });

    deletedCount += count;
    batches += 1;

    if (rows.length < batchSize) {
      break;
    }

    // Parti dolu geldiyse daha fazlası olabilir; sınıra takılırsak `hasMore` ile bildirilir.
    if (batchIndex === maxBatches - 1) {
      hasMore = true;
    }
  }

  // Kaç satır işlendiği LOGLANIR (Issue #188 gereği). Bu, bakım işinin gerçekten çalıştığının
  // tek görünür kanıtıdır — audit log'a yazılamadığı için.
  console.log("[audit-retention] completed", {
    cutoff: cutoff.toISOString(),
    deletedCount,
    batches,
    hasMore,
  });

  return { cutoff, deletedCount, batches, archiveFiles, hasMore };
}
