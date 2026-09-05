import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { TenantDataExportStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { tenantScoped } from "@/lib/tenancy/scope";

import { buildTenantExport, type ExportRowCounts } from "./tenant-data";

/**
 * Dışa aktarma yaşam döngüsü (Issue #194): iste → üret → indir.
 *
 * ÜRETİM EŞZAMANLI DEĞİLDİR. İstek `PENDING` bir kayıt bırakır ve hemen döner; ZIP'i ayrı
 * bir bakım işi üretir. Senkron üretim, büyük bir tenant'ta HTTP zaman aşımına uğrar ve
 * kullanıcıya yarım bir dosya ya da hiç dosya bırakırdı.
 *
 * Bu repo'da kuyruk altyapısı YOKTUR ve bir tane getirmek bu issue'nun kapsamı dışıdır;
 * kullanılan desen `#188`'in (AuditLog saklama) getirdiği "platform cron'u bir bakım
 * endpoint'ini çağırır" desenidir.
 */

/** 256 bit — brute-force ile tahmin edilmesi hesaplama açısından imkânsız (invariant #6). */
const DOWNLOAD_TOKEN_BYTES = 32;

/**
 * 24 saat (issue'nun şartı). Üretilen dosya tenant'ın TÜM verisidir; süresiz bir bağlantı,
 * sızdığında süresiz bir veri sızıntısıdır.
 */
const DOWNLOAD_TTL_MS = 24 * 60 * 60 * 1000;

const DEFAULT_EXPORT_DIR = path.join(".data", "exports");

export function hashDownloadToken(rawToken: string): string {
  // Token kriptografik olarak rastgele ve yüksek entropilidir; brute-force edilebilirliği
  // kendi entropisiyle sınırlıdır. Bu yüzden yavaş/salt'lı scrypt yerine hızlı SHA-256
  // (`PasswordResetToken` ile birebir aynı gerekçe).
  return createHash("sha256").update(rawToken).digest("hex");
}

function resolveExportDir(override?: string): string {
  return override ?? process.env.TENANT_EXPORT_DIR ?? path.join(process.cwd(), DEFAULT_EXPORT_DIR);
}

export type RequestExportResult =
  | { ok: true; exportId: string; downloadToken: string; expiresAt: Date }
  | { ok: false; status: 409; error: string };

/**
 * Yeni bir dışa aktarma talebi oluşturur.
 *
 * AYNI ANDA BİRDEN FAZLA BEKLEYEN TALEP OLAMAZ (`409`). Aksi halde arka arkaya basılan bir
 * düğme, aynı veriyi üreten onlarca iş ve onlarca kalıcı dosya bırakırdı. Rate limit bunu
 * dışarıdan yavaşlatır; bu kontrol ise mantığın kendisinde durur.
 *
 * TOKEN İSTEK ANINDA ÜRETİLİR, dosya hazır olduğunda değil: kullanıcının talebin sonucuna
 * ulaşabilmesi için elinde bir anahtar olmalıdır. Dosya hazır değilken indirme `409` döner.
 */
export async function requestTenantDataExport(
  tenantId: string,
  requestedByUserId: string,
): Promise<RequestExportResult> {
  const pending = await prisma.tenantDataExport.count({
    where: tenantScoped(tenantId, {
      status: { in: [TenantDataExportStatus.PENDING, TenantDataExportStatus.PROCESSING] },
    }),
  });

  if (pending > 0) {
    return { ok: false, status: 409, error: "An export is already in progress" };
  }

  const rawToken = randomBytes(DOWNLOAD_TOKEN_BYTES).toString("hex");
  const expiresAt = new Date(Date.now() + DOWNLOAD_TTL_MS);

  const created = await prisma.tenantDataExport.create({
    data: {
      tenantId,
      requestedByUserId,
      tokenHash: hashDownloadToken(rawToken),
      expiresAt,
    },
    select: { id: true },
  });

  return { ok: true, exportId: created.id, downloadToken: rawToken, expiresAt };
}

export type ProcessExportsOptions = {
  exportDir?: string;
  /** Tek çağrıda işlenecek azami iş sayısı. Zamanlanmış işin süresi sınırlıdır. */
  limit?: number;
};

export type ProcessExportsResult = {
  processed: number;
  failed: number;
  hasMore: boolean;
};

/**
 * Bekleyen dışa aktarmaları üretir. Zamanlanmış iş tarafından çağrılır.
 *
 * İŞİ ATOMİK OLARAK SAHİPLENİR: `PENDING → PROCESSING` geçişi koşullu bir `updateMany` ile
 * yapılır (`status: PENDING`). Eşzamanlı iki bakım çağrısında aynı işi yalnızca biri
 * `count === 1` görür; diğeri onu atlar. "Önce oku, sonra yaz" iki kez üretime yol açardı.
 */
export async function processPendingExports(
  options: ProcessExportsOptions = {},
): Promise<ProcessExportsResult> {
  const exportDir = resolveExportDir(options.exportDir);
  const limit = options.limit ?? 5;

  let processed = 0;
  let failed = 0;

  for (let index = 0; index < limit; index += 1) {
    const candidate = await prisma.tenantDataExport.findFirst({
      where: { status: TenantDataExportStatus.PENDING },
      orderBy: { createdAt: "asc" },
      select: { id: true, tenantId: true },
    });

    if (!candidate) {
      return { processed, failed, hasMore: false };
    }

    const claimed = await prisma.tenantDataExport.updateMany({
      where: { id: candidate.id, status: TenantDataExportStatus.PENDING },
      data: { status: TenantDataExportStatus.PROCESSING, startedAt: new Date() },
    });

    if (claimed.count !== 1) {
      // Başka bir çalışan sahiplendi; bir sonrakine geç.
      continue;
    }

    try {
      const { zip, rowCounts } = await buildTenantExport(candidate.tenantId);
      const filePath = writeExportFile(exportDir, candidate.id, zip);

      await prisma.tenantDataExport.update({
        where: { id: candidate.id },
        data: {
          status: TenantDataExportStatus.READY,
          filePath,
          byteSize: zip.byteLength,
          rowCounts: rowCounts as ExportRowCounts,
          completedAt: new Date(),
        },
      });

      processed += 1;
    } catch (error) {
      failed += 1;

      // HATA MESAJI DB'YE YAZILIR AMA KULLANICIYA DÖNMEZ (invariant #7): operatör neyin
      // bozulduğunu görebilmeli, çağıran yalnızca "başarısız" bilgisini almalıdır.
      await prisma.tenantDataExport.update({
        where: { id: candidate.id },
        data: {
          status: TenantDataExportStatus.FAILED,
          failureReason: error instanceof Error ? error.message : "Unknown error",
          completedAt: new Date(),
        },
      });
    }
  }

  const remaining = await prisma.tenantDataExport.count({
    where: { status: TenantDataExportStatus.PENDING },
  });

  return { processed, failed, hasMore: remaining > 0 };
}

/**
 * ÖNCE `.tmp`, SONRA `rename`: `rename` aynı dosya sistemi içinde atomiktir. Doğrudan hedefe
 * yazmak, yarıda kesilen bir işten sonra YARIM bir ZIP bırakırdı ve o dosya "hazır" sanılıp
 * indirilebilirdi. Yarım bir `.tmp` ise açıkça yarımdır. (Aynı desen `#188`'in arşiv
 * yazıcısında da kullanılıyor.)
 */
function writeExportFile(exportDir: string, exportId: string, zip: Buffer): string {
  mkdirSync(exportDir, { recursive: true });

  const finalPath = path.join(exportDir, `${exportId}.zip`);
  const tempPath = `${finalPath}.tmp`;

  writeFileSync(tempPath, zip);
  renameSync(tempPath, finalPath);

  return finalPath;
}

export type ConsumeDownloadResult =
  | { ok: true; zip: Buffer; fileName: string; tenantId: string; requestedByUserId: string }
  | { ok: false; status: 404 | 409; error: string };

const NOT_FOUND_ERROR = "Not found";

/**
 * İndirme token'ını ATOMİK olarak tüketir ve dosyayı döner.
 *
 * TEK KULLANIMLIK VE SÜRELİ. Tüketim tek bir koşullu `updateMany` ile yapılır
 * (`tokenHash = ? AND downloadedAt IS NULL AND expiresAt > now() AND status = READY`).
 * Aynı bağlantı eşzamanlı iki kez açılsa bile veritabanı seviyesinde yalnızca biri
 * `count === 1` görür. "Önce oku, sonra yaz" iki indirmeye izin verirdi
 * (`password-reset.ts`'teki aynı desen).
 *
 * "BULUNAMADI" / "SÜRESİ DOLDU" / "ZATEN İNDİRİLDİ" AYRIŞTIRILMAZ — hepsi `404` (invariant
 * #7). Token'ı eline geçiren biri, onun var olup olmadığını ya da ne durumda olduğunu
 * öğrenemez.
 *
 * `409` YALNIZCA HENÜZ HAZIR OLMAYAN İŞ İÇİNDİR ve bu bir sızıntı değildir: o token'ı
 * yalnızca talebi yapan kişi bilir ve "hazır mı" sorusunun cevabını görmesi akışın kendisidir.
 */
export async function consumeExportDownload(rawToken: unknown): Promise<ConsumeDownloadResult> {
  if (typeof rawToken !== "string" || rawToken.length === 0) {
    return { ok: false, status: 404, error: NOT_FOUND_ERROR };
  }

  const tokenHash = hashDownloadToken(rawToken);

  // Hazır olmayan iş için 409 dönebilmek adına önce DAR bir okuma yapılır. Bu bir
  // "önce kontrol et sonra yaz" DEĞİLDİR: tüketim kararı aşağıdaki koşullu yazmadadır ve
  // bu okuma yalnızca hangi hata kodunun döneceğini belirler.
  const record = await prisma.tenantDataExport.findUnique({
    where: { tokenHash },
    select: { id: true, status: true, expiresAt: true, downloadedAt: true },
  });

  if (
    record &&
    record.downloadedAt === null &&
    record.expiresAt > new Date() &&
    (record.status === TenantDataExportStatus.PENDING ||
      record.status === TenantDataExportStatus.PROCESSING)
  ) {
    return { ok: false, status: 409, error: "Export is not ready yet" };
  }

  const consumed = await prisma.tenantDataExport.updateMany({
    where: {
      tokenHash,
      downloadedAt: null,
      expiresAt: { gt: new Date() },
      status: TenantDataExportStatus.READY,
    },
    data: { downloadedAt: new Date() },
  });

  if (consumed.count !== 1) {
    return { ok: false, status: 404, error: NOT_FOUND_ERROR };
  }

  const consumedRecord = await prisma.tenantDataExport.findUnique({
    where: { tokenHash },
    select: { id: true, tenantId: true, requestedByUserId: true, filePath: true },
  });

  if (!consumedRecord?.filePath) {
    // READY olup dosyası olmayan bir kayıt tutarsızdır. Token zaten tüketildi; tekrar
    // denemenin faydası yok ve nedeni dışarıya söylenmez.
    return { ok: false, status: 404, error: NOT_FOUND_ERROR };
  }

  let zip: Buffer;
  try {
    zip = readFileSync(consumedRecord.filePath);
  } catch {
    return { ok: false, status: 404, error: NOT_FOUND_ERROR };
  }

  // Dosya adı SLUG DEĞİL ID taşır: slug kullanıcı girdisidir ve bir `Content-Disposition`
  // başlığına konduğunda kaçırılması gereken karakterler içerebilir.
  return {
    ok: true,
    zip,
    fileName: `tenant-export-${consumedRecord.id}.zip`,
    tenantId: consumedRecord.tenantId,
    requestedByUserId: consumedRecord.requestedByUserId,
  };
}

/**
 * Süresi dolmuş dışa aktarmaların DOSYALARINI siler.
 *
 * KAYIT SİLİNMEZ, DOSYA SİLİNİR: "ne zaman, kim tarafından dışa aktarıldı" sorusu bir audit
 * sorusudur ve cevabı korunmalıdır. Silinmesi gereken şey, süresi dolduğu hâlde diskte duran
 * ve tenant'ın tüm verisini taşıyan ZIP'tir.
 */
export async function pruneExpiredExportFiles(options: { now?: Date } = {}): Promise<number> {
  const now = options.now ?? new Date();

  const expired = await prisma.tenantDataExport.findMany({
    where: { expiresAt: { lt: now }, filePath: { not: null } },
    select: { id: true, filePath: true },
  });

  let removed = 0;

  for (const record of expired) {
    if (!record.filePath) {
      continue;
    }

    // `force: true` — dosya zaten yoksa bu bir hata değildir; hedef durum "dosya yok".
    rmSync(record.filePath, { force: true });
    await prisma.tenantDataExport.update({
      where: { id: record.id },
      data: { filePath: null, byteSize: null },
    });
    removed += 1;
  }

  return removed;
}
