import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

import { AccountType, CategoryType, MembershipRole } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { buildTenantExport } from "../src/lib/export/tenant-data";
import {
  consumeExportDownload,
  processPendingExports,
  pruneExpiredExportFiles,
  requestTenantDataExport,
} from "../src/lib/export/tenant-export-service";
import { prisma } from "../src/lib/prisma";

/**
 * Tenant verisi dışa aktarma (Issue #194), gerçek DB'ye karşı.
 */

const EXPORT_DIR = `.data/test-exports-${randomUUID()}`;

test.afterAll(async () => {
  await prisma.$disconnect();
});

/** ZIP'i merkezî dizinden okur (bkz. `export-format.spec.ts` — aynı gerekçe). */
function readZip(zip: Buffer): Map<string, string> {
  let eocd = -1;
  for (let index = zip.length - 22; index >= 0; index -= 1) {
    if (zip.readUInt32LE(index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd === -1) throw new Error("EOCD yok");

  const count = zip.readUInt16LE(eocd + 10);
  let pointer = zip.readUInt32LE(eocd + 16);
  const files = new Map<string, string>();

  for (let index = 0; index < count; index += 1) {
    const compressedSize = zip.readUInt32LE(pointer + 20);
    const nameLength = zip.readUInt16LE(pointer + 28);
    const extraLength = zip.readUInt16LE(pointer + 30);
    const commentLength = zip.readUInt16LE(pointer + 32);
    const localOffset = zip.readUInt32LE(pointer + 42);
    const name = zip.toString("utf8", pointer + 46, pointer + 46 + nameLength);

    const dataStart =
      localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    files.set(
      name,
      inflateRawSync(zip.subarray(dataStart, dataStart + compressedSize)).toString("utf8"),
    );

    pointer += 46 + nameLength + extraLength + commentLength;
  }

  return files;
}

type Fixture = { tenantId: string; userId: string; accountId: string };

async function createTenantWithData(prefix: string): Promise<Fixture> {
  const suffix = randomUUID();
  const user = await prisma.user.create({ data: { email: `${prefix}-${suffix}@example.com` } });
  const tenant = await prisma.tenant.create({
    data: { name: `${prefix} Tenant`, slug: `${prefix}-${suffix}` },
  });
  await prisma.membership.create({
    data: { userId: user.id, tenantId: tenant.id, role: MembershipRole.OWNER },
  });

  const account = await prisma.account.create({
    data: {
      tenantId: tenant.id,
      name: `${prefix} Kasa`,
      type: AccountType.CASH,
      currency: "TRY",
      balance: "1234.5600",
    },
  });
  const category = await prisma.category.create({
    data: { tenantId: tenant.id, name: `${prefix} Kira`, type: CategoryType.EXPENSE },
  });
  await prisma.transaction.create({
    data: {
      tenantId: tenant.id,
      accountId: account.id,
      categoryId: category.id,
      type: CategoryType.EXPENSE,
      amount: "99.9900",
      description: `${prefix} aciklama`,
    },
  });
  await prisma.auditLog.create({
    data: { tenantId: tenant.id, actorUserId: user.id, action: "TENANT_CREATED" },
  });

  return { tenantId: tenant.id, userId: user.id, accountId: account.id };
}

async function cleanup(fixture: Fixture): Promise<void> {
  await prisma.tenant.delete({ where: { id: fixture.tenantId } });
  await prisma.user.delete({ where: { id: fixture.userId } });
}

test.describe("Dışa aktarma içeriği", () => {
  test("manifest, satır sayıları ve tüm CSV'ler üretiliyor", async () => {
    const fixture = await createTenantWithData("exp");

    try {
      const { zip, rowCounts } = await buildTenantExport(fixture.tenantId);
      const files = readZip(zip);

      expect([...files.keys()].sort()).toEqual(
        [
          "audit-log.csv",
          "borc-alacak.csv",
          "davetler.csv",
          "hesaplar.csv",
          "islemler.csv",
          "kategoriler.csv",
          "manifest.json",
          "moduller.csv",
          "tenant.csv",
          "uyeler.csv",
        ].sort(),
      );

      const manifest = JSON.parse(files.get("manifest.json")!) as {
        formatVersion: number;
        rowCounts: Record<string, number>;
      };

      expect(manifest.formatVersion).toBe(1);
      // Kabul kriteri: satır sayıları manifest ile uyumlu.
      expect(manifest.rowCounts).toEqual(rowCounts);
      expect(manifest.rowCounts.accounts).toBe(1);
      expect(manifest.rowCounts.transactions).toBe(1);
      expect(manifest.rowCounts.members).toBe(1);
    } finally {
      await cleanup(fixture);
    }
  });

  test("para alanları STRING olarak ve hassasiyet kaybetmeden yazılıyor", async () => {
    const fixture = await createTenantWithData("money");

    try {
      const files = readZip((await buildTenantExport(fixture.tenantId)).zip);

      // `1234.5600` — sondaki sıfırlar Excel'in sayıya çevirmesiyle kaybolurdu.
      expect(files.get("hesaplar.csv")).toContain("1234.56");
      expect(files.get("islemler.csv")).toContain("99.99");
    } finally {
      await cleanup(fixture);
    }
  });

  test("HASSAS ALANLAR dosyada YOK", async () => {
    // Kabul kriteri: passwordHash, token, credentialsChangedAt gibi alanlar dosyada yok.
    const fixture = await createTenantWithData("secret");

    try {
      await prisma.user.update({
        where: { id: fixture.userId },
        data: { passwordHash: "SALT:HASH-GIZLI-DEGER", credentialsChangedAt: new Date() },
      });
      await prisma.tenantInvitation.create({
        data: {
          tenantId: fixture.tenantId,
          email: `davet-${randomUUID()}@example.com`,
          tokenHash: "DAVET-TOKEN-HASH-GIZLI",
          expiresAt: new Date(Date.now() + 3_600_000),
          invitedByUserId: fixture.userId,
        },
      });

      const all = [...readZip((await buildTenantExport(fixture.tenantId)).zip).values()].join("\n");

      for (const forbidden of [
        "SALT:HASH-GIZLI-DEGER",
        "DAVET-TOKEN-HASH-GIZLI",
        "passwordHash",
        "password_hash",
        "credentialsChangedAt",
        "credentials_changed_at",
        "tokenHash",
        "token_hash",
        "sessionsRevokedAt",
      ]) {
        expect(all, `dosyada yasakli alan: ${forbidden}`).not.toContain(forbidden);
      }

      // KONTROL GRUBU: davet satırı gerçekten dosyada — yukarıdaki kontroller "davet hiç
      // yazılmadı" diye de geçebilirdi.
      expect(all).toContain("davetler");
    } finally {
      await cleanup(fixture);
    }
  });

  test("CSV formül enjeksiyonu kaçırılmış çıkıyor", async () => {
    // Kabul kriteri. Kullanıcının verdiği kategori adı Excel'de formül olarak çalışmamalı.
    const fixture = await createTenantWithData("inject");

    try {
      await prisma.category.create({
        data: {
          tenantId: fixture.tenantId,
          name: '=HYPERLINK("http://kotu.site","Tikla")',
          type: CategoryType.INCOME,
        },
      });

      const csv = readZip((await buildTenantExport(fixture.tenantId)).zip).get("kategoriler.csv")!;

      expect(csv).toContain(`'=HYPERLINK`);
      expect(csv).not.toMatch(/(^|,|")=HYPERLINK/m);
    } finally {
      await cleanup(fixture);
    }
  });
});

test.describe("TENANT İZOLASYONU", () => {
  test("BAŞKA tenant'ın verisi dosyaya GİRMİYOR", async () => {
    const mine = await createTenantWithData("mine");
    const other = await createTenantWithData("other");

    try {
      const all = [...readZip((await buildTenantExport(mine.tenantId)).zip).values()].join("\n");

      // Diğer tenant'ın her kimliği ve her adı aranır.
      expect(all).not.toContain(other.tenantId);
      expect(all).not.toContain(other.accountId);
      expect(all).not.toContain("other Kasa");
      expect(all).not.toContain("other Kira");
      expect(all).not.toContain("other aciklama");

      // KONTROL GRUBU: kendi verisi GERÇEKTEN içinde — yukarıdaki "yok" iddiaları, dosya
      // tamamen boş olsaydı da geçerdi.
      expect(all).toContain(mine.tenantId);
      expect(all).toContain("mine Kasa");
      expect(all).toContain("mine aciklama");
    } finally {
      await cleanup(mine);
      await cleanup(other);
    }
  });
});

test.describe("Yaşam döngüsü: iste → üret → indir", () => {
  test("talep PENDING kayıt bırakıyor ve token dönüyor", async () => {
    const fixture = await createTenantWithData("life");

    try {
      const result = await requestTenantDataExport(fixture.tenantId, fixture.userId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.downloadToken).toMatch(/^[0-9a-f]{64}$/);

      const row = await prisma.tenantDataExport.findUniqueOrThrow({
        where: { id: result.exportId },
      });
      expect(row.status).toBe("PENDING");
      // Ham token DB'de DURMAZ.
      expect(row.tokenHash).not.toBe(result.downloadToken);
    } finally {
      await cleanup(fixture);
    }
  });

  test("ikinci eşzamanlı talep 409 alıyor", async () => {
    const fixture = await createTenantWithData("dup");

    try {
      await requestTenantDataExport(fixture.tenantId, fixture.userId);
      const second = await requestTenantDataExport(fixture.tenantId, fixture.userId);

      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.status).toBe(409);
    } finally {
      await cleanup(fixture);
    }
  });

  test("hazır DEĞİLKEN indirme 409, tüketilmiyor", async () => {
    const fixture = await createTenantWithData("early");

    try {
      const requested = await requestTenantDataExport(fixture.tenantId, fixture.userId);
      if (!requested.ok) return;

      const result = await consumeExportDownload(requested.downloadToken);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(409);

      const row = await prisma.tenantDataExport.findUniqueOrThrow({
        where: { id: requested.exportId },
      });
      expect(row.downloadedAt).toBeNull();
    } finally {
      await cleanup(fixture);
    }
  });

  test("bakım işi üretiyor, indirme ZIP döndürüyor", async () => {
    const fixture = await createTenantWithData("proc");

    try {
      const requested = await requestTenantDataExport(fixture.tenantId, fixture.userId);
      if (!requested.ok) return;

      const processed = await processPendingExports({ exportDir: EXPORT_DIR });
      expect(processed.failed).toBe(0);
      expect(processed.processed).toBeGreaterThanOrEqual(1);

      const row = await prisma.tenantDataExport.findUniqueOrThrow({
        where: { id: requested.exportId },
      });
      expect(row.status).toBe("READY");
      expect(row.filePath).not.toBeNull();
      expect(existsSync(row.filePath!)).toBe(true);

      const download = await consumeExportDownload(requested.downloadToken);
      expect(download.ok).toBe(true);
      if (!download.ok) return;
      expect(readZip(download.zip).has("manifest.json")).toBe(true);
    } finally {
      await cleanup(fixture);
    }
  });

  test("token TEK KULLANIMLIK: ikinci indirme 404", async () => {
    // Kabul kriteri.
    const fixture = await createTenantWithData("once");

    try {
      const requested = await requestTenantDataExport(fixture.tenantId, fixture.userId);
      if (!requested.ok) return;
      await processPendingExports({ exportDir: EXPORT_DIR });

      expect((await consumeExportDownload(requested.downloadToken)).ok).toBe(true);

      const second = await consumeExportDownload(requested.downloadToken);
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.status).toBe(404);
    } finally {
      await cleanup(fixture);
    }
  });

  test("SÜRESİ DOLMUŞ token 404", async () => {
    // Kabul kriteri.
    const fixture = await createTenantWithData("expired");

    try {
      const requested = await requestTenantDataExport(fixture.tenantId, fixture.userId);
      if (!requested.ok) return;
      await processPendingExports({ exportDir: EXPORT_DIR });

      await prisma.tenantDataExport.update({
        where: { id: requested.exportId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const result = await consumeExportDownload(requested.downloadToken);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);
    } finally {
      await cleanup(fixture);
    }
  });

  test("BİLİNMEYEN token da 404 — durumlar ayrışmıyor", async () => {
    // "Yok" / "süresi doldu" / "zaten indirildi" hepsi AYNI yanıt (invariant #7).
    const result = await consumeExportDownload("a".repeat(64));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
  });

  test("süresi dolmuş dosyalar siliniyor ama KAYIT korunuyor", async () => {
    const fixture = await createTenantWithData("prune");

    try {
      const requested = await requestTenantDataExport(fixture.tenantId, fixture.userId);
      if (!requested.ok) return;
      await processPendingExports({ exportDir: EXPORT_DIR });

      const before = await prisma.tenantDataExport.findUniqueOrThrow({
        where: { id: requested.exportId },
      });
      await prisma.tenantDataExport.update({
        where: { id: requested.exportId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await pruneExpiredExportFiles();

      expect(existsSync(before.filePath!)).toBe(false);
      // Kayıt DURUYOR: "ne zaman, kim tarafından" bir audit sorusudur.
      const after = await prisma.tenantDataExport.findUniqueOrThrow({
        where: { id: requested.exportId },
      });
      expect(after.filePath).toBeNull();
    } finally {
      await cleanup(fixture);
    }
  });
});
