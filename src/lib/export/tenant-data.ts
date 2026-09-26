import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { tenantScoped } from "@/lib/tenancy/scope";

import { toCsv, type CsvColumn } from "./csv";
import { buildZip, type ZipEntry } from "./zip";

/**
 * Bir tenant'ın verisinin ZIP içeriğini üretir (Issue #194).
 *
 * TENANT İZOLASYONU BU DOSYANIN TEK EN ÖNEMLİ ÖZELLİĞİDİR. Buradaki her sorgu
 * `tenantScoped()` üzerinden geçer (invariant #1). Bir dışa aktarma dosyasına sızan tek bir
 * yabancı satır, en kötü sınıftan bir izolasyon ihlalidir: kalıcı bir dosyaya yazılır,
 * kullanıcıya teslim edilir ve geri alınamaz.
 *
 * `tenantId` DAİMA `requirePermission()` context'inden gelir — URL veya gövde asla kaynak
 * değildir (invariant #2). Bu fonksiyon HTTP bilmez.
 */

/** Manifest biçimi sürümlenir: içe aktarma (Epic 10) bunu okuyacak. */
export const EXPORT_FORMAT_VERSION = 1;

/**
 * Para alanları CSV'ye STRING olarak yazılır.
 *
 * NEDEN: Prisma `Decimal` döner ve `Number()`'a çevirmek kayan nokta yuvarlaması demektir
 * (invariant #10). Ama asıl tehlike Excel'dedir: `1234.5600` gibi bir hücreyi sayıya çevirip
 * sondaki sıfırları atar, çok büyük değerleri bilimsel gösterime kaydırır ve 15 basamaktan
 * sonra HASSASİYET KAYBEDER. Değer metin olarak yazıldığında dosya, aktarıldığı andaki tam
 * değeri taşır.
 *
 * `toString()` Prisma Decimal'in tam ondalık gösterimini verir; ölçek `(19,4)` olduğu için
 * sonuç daima aynı biçimdedir.
 */
function money(value: Prisma.Decimal): string {
  return value.toString();
}

export type ExportRowCounts = Record<string, number>;

export type BuildTenantExportResult = {
  zip: Buffer;
  rowCounts: ExportRowCounts;
};

/**
 * Üye satırında HANGİ alanların olduğu bilinçli bir listedir.
 *
 * VAR: e-posta, ad, rol, katılma zamanı — bunlar tenant'ın kendi verisidir ve
 * taşınabilirliğin konusudur.
 *
 * YOK ve asla eklenmez: `passwordHash`, `credentialsChangedAt`, `sessionsRevokedAt`,
 * `emailVerified`. İlki bir sırdır; diğerleri kullanıcının GÜVENLİK durumudur ve tenant'ın
 * verisi değildir — bir tenant sahibinin, üyesinin şifresini ne zaman değiştirdiğini
 * öğrenmesi için hiçbir gerekçe yoktur.
 */
const MEMBER_COLUMNS: ReadonlyArray<CsvColumn<{
  id: string;
  role: string;
  createdAt: Date;
  user: { id: string; email: string; name: string | null };
}>> = [
  { header: "membership_id", value: (row) => row.id },
  { header: "user_id", value: (row) => row.user.id },
  { header: "email", value: (row) => row.user.email },
  { header: "name", value: (row) => row.user.name },
  { header: "role", value: (row) => row.role },
  { header: "joined_at", value: (row) => row.createdAt },
];

export type BuildTenantExportOptions = {
  /** Test edilebilirlik için: üretim zamanı enjekte edilebilir. */
  now?: Date;
};

export async function buildTenantExport(
  tenantId: string,
  options: BuildTenantExportOptions = {},
): Promise<BuildTenantExportResult> {
  const generatedAt = options.now ?? new Date();

  // Tenant'ın kendisi: `findUnique({ where: { id } })` DEĞİL — tenant-scoped modellerdeki
  // kuralla tutarlı kalmak için tek bir `findFirst` + açık `id` kullanılır ve sonuç
  // yoksa hata verilir.
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, slug: true, timeZone: true, createdAt: true },
  });

  if (!tenant) {
    throw new Error(`Tenant not found: ${tenantId}`);
  }

  const [accounts, categories, transactions, debtCredits, memberships, invitations, modules, auditLogs] =
    await Promise.all([
      prisma.account.findMany({
        where: tenantScoped(tenantId, {}),
        orderBy: { createdAt: "asc" },
      }),
      prisma.category.findMany({
        where: tenantScoped(tenantId, {}),
        orderBy: { createdAt: "asc" },
      }),
      prisma.transaction.findMany({
        where: tenantScoped(tenantId, {}),
        orderBy: { occurredAt: "asc" },
      }),
      prisma.debtCredit.findMany({
        where: tenantScoped(tenantId, {}),
        orderBy: { createdAt: "asc" },
      }),
      prisma.membership.findMany({
        where: tenantScoped(tenantId, {}),
        // DAR SELECT (invariant: `passwordHash`/token asla dışarı): kullanıcıdan yalnızca
        // üç alan okunur. `include: { user: true }` yazmak, şemaya eklenecek her yeni
        // kullanıcı alanını sessizce dosyaya taşırdı.
        select: {
          id: true,
          role: true,
          createdAt: true,
          user: { select: { id: true, email: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.tenantInvitation.findMany({
        where: tenantScoped(tenantId, {}),
        // `tokenHash` BİLEREK YOK: davet token'ının hash'i bir sırdır ve dosyaya girerse
        // kabul akışına karşı çevrimdışı saldırı yüzeyi açardı.
        select: {
          id: true,
          email: true,
          role: true,
          expiresAt: true,
          usedAt: true,
          cancelledAt: true,
          createdAt: true,
          invitedByUserId: true,
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.tenantModule.findMany({
        where: tenantScoped(tenantId, {}),
        orderBy: { moduleKey: "asc" },
      }),
      prisma.auditLog.findMany({
        where: tenantScoped(tenantId, {}),
        orderBy: { createdAt: "asc" },
      }),
    ]);

  const files: Array<{ name: string; key: string; content: string; count: number }> = [
    {
      key: "tenant",
      name: "tenant.csv",
      count: 1,
      content: toCsv([tenant], [
        { header: "id", value: (row) => row.id },
        { header: "name", value: (row) => row.name },
        { header: "slug", value: (row) => row.slug },
        { header: "time_zone", value: (row) => row.timeZone },
        { header: "created_at", value: (row) => row.createdAt },
      ]),
    },
    {
      key: "accounts",
      name: "hesaplar.csv",
      count: accounts.length,
      content: toCsv(accounts, [
        { header: "id", value: (row) => row.id },
        { header: "name", value: (row) => row.name },
        { header: "type", value: (row) => row.type },
        { header: "bank_code", value: (row) => row.bankCode },
        { header: "balance", value: (row) => money(row.balance) },
        { header: "currency", value: (row) => row.currency },
        { header: "created_at", value: (row) => row.createdAt },
        { header: "updated_at", value: (row) => row.updatedAt },
      ]),
    },
    {
      key: "categories",
      name: "kategoriler.csv",
      count: categories.length,
      content: toCsv(categories, [
        { header: "id", value: (row) => row.id },
        { header: "name", value: (row) => row.name },
        { header: "type", value: (row) => row.type },
        { header: "created_at", value: (row) => row.createdAt },
        { header: "updated_at", value: (row) => row.updatedAt },
      ]),
    },
    {
      key: "transactions",
      name: "islemler.csv",
      count: transactions.length,
      content: toCsv(transactions, [
        { header: "id", value: (row) => row.id },
        { header: "type", value: (row) => row.type },
        { header: "amount", value: (row) => money(row.amount) },
        { header: "description", value: (row) => row.description },
        { header: "occurred_at", value: (row) => row.occurredAt },
        { header: "account_id", value: (row) => row.accountId },
        { header: "category_id", value: (row) => row.categoryId },
        { header: "created_at", value: (row) => row.createdAt },
        { header: "updated_at", value: (row) => row.updatedAt },
      ]),
    },
    {
      key: "debtCredits",
      name: "borc-alacak.csv",
      count: debtCredits.length,
      content: toCsv(debtCredits, [
        { header: "id", value: (row) => row.id },
        { header: "type", value: (row) => row.type },
        { header: "counterparty", value: (row) => row.counterparty },
        { header: "amount", value: (row) => money(row.amount) },
        { header: "currency", value: (row) => row.currency },
        { header: "due_date", value: (row) => row.dueDate },
        { header: "status", value: (row) => row.status },
        { header: "created_at", value: (row) => row.createdAt },
        { header: "updated_at", value: (row) => row.updatedAt },
      ]),
    },
    {
      key: "members",
      name: "uyeler.csv",
      count: memberships.length,
      content: toCsv(memberships, MEMBER_COLUMNS),
    },
    {
      key: "invitations",
      name: "davetler.csv",
      count: invitations.length,
      content: toCsv(invitations, [
        { header: "id", value: (row) => row.id },
        { header: "email", value: (row) => row.email },
        { header: "role", value: (row) => row.role },
        { header: "expires_at", value: (row) => row.expiresAt },
        { header: "used_at", value: (row) => row.usedAt },
        { header: "cancelled_at", value: (row) => row.cancelledAt },
        { header: "invited_by_user_id", value: (row) => row.invitedByUserId },
        { header: "created_at", value: (row) => row.createdAt },
      ]),
    },
    {
      key: "modules",
      name: "moduller.csv",
      count: modules.length,
      content: toCsv(modules, [
        { header: "module_key", value: (row) => row.moduleKey },
        { header: "enabled", value: (row) => row.enabled },
        { header: "settings", value: (row) => (row.settings === null ? null : JSON.stringify(row.settings)) },
        { header: "seeded_at", value: (row) => row.seededAt },
        { header: "enabled_at", value: (row) => row.enabledAt },
        { header: "disabled_at", value: (row) => row.disabledAt },
      ]),
    },
    {
      key: "auditLogs",
      name: "audit-log.csv",
      count: auditLogs.length,
      content: toCsv(auditLogs, [
        { header: "id", value: (row) => row.id },
        { header: "created_at", value: (row) => row.createdAt },
        { header: "actor_user_id", value: (row) => row.actorUserId },
        { header: "action", value: (row) => row.action },
        { header: "target_type", value: (row) => row.targetType },
        { header: "target_id", value: (row) => row.targetId },
        { header: "metadata", value: (row) => (row.metadata === null ? null : JSON.stringify(row.metadata)) },
      ]),
    },
  ];

  const rowCounts: ExportRowCounts = {};
  for (const file of files) {
    rowCounts[file.key] = file.count;
  }

  /**
   * Manifest, dosyanın kendi kendini açıklayan parçasıdır: sürüm, üretim zamanı, hangi
   * dosyada kaç satır olduğu. "Eksik mi çıktı" sorusu bununla cevaplanır ve içe aktarma
   * (Epic 10) biçim sürümünü buradan okuyacak.
   *
   * TENANT ADI VE SLUG'I DA BURADADIR: dosya adı değiştirilmiş bir arşivin hangi tenant'a
   * ait olduğu içeriğinden anlaşılabilmelidir.
   */
  const manifest = {
    formatVersion: EXPORT_FORMAT_VERSION,
    generatedAt: generatedAt.toISOString(),
    tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
    files: files.map((file) => ({ key: file.key, name: file.name, rowCount: file.count })),
    rowCounts,
    notes: {
      encoding: "UTF-8 (BOM)",
      newline: "CRLF (RFC 4180)",
      money:
        "Para alanlari STRING olarak yazilir; Excel'in sayiya cevirip hassasiyet kaybetmesini onlemek icin.",
      formulaEscaping:
        "=, +, -, @ ile baslayan hucreler tek tirnakla kacirilmistir (CSV formul enjeksiyonu).",
    },
  };

  const entries: ZipEntry[] = [
    { name: "manifest.json", content: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") },
    ...files.map((file) => ({ name: file.name, content: Buffer.from(file.content, "utf8") })),
  ];

  return { zip: buildZip(entries), rowCounts };
}
