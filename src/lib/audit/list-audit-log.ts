import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { tenantScoped } from "@/lib/tenancy/scope";

import { encodeAuditLogCursor, type AuditLogCursor } from "./audit-log-cursor";

/**
 * Tenant'ın denetim kaydı listesi (Issue #78).
 *
 * Bu fonksiyon YETKİ KARARI VERMEZ; kimin çağırabileceği route seviyesinde
 * `requirePermission(PERMISSIONS.VIEW_AUDIT_LOG, tenantId)` ile belirlenir (invariant #3).
 * Buradaki `tenantId` daima `context.tenant.id`den gelir — URL parametresi ya da body DEĞİL.
 */

export const AUDIT_LOG_PAGE_SIZE = 50;

/**
 * Dışarı çıkan alanların allowlist'i.
 *
 * `metadata` BİLEREK DIŞARI VERİLİR: denetim kaydının değeri "ne oldu"yu anlatmasında ve o bağlam
 * metadata'da. Hassas alanlar zaten YAZILIRKEN redakte ediliyor (`src/lib/audit/sanitize.ts`,
 * defense-in-depth) — okuma tarafında ikinci bir filtre, redaksiyonun çalıştığı yanılsamasını
 * güçlendirir ama gerçekte yalnızca bu ekranı korur; kaydın kendisi zaten temiz olmalıdır.
 *
 * `actorUser`dan YALNIZCA `email` seçilir: `passwordHash` gibi alanların bu sorguya hiç
 * girmemesi için dar allowlist (invariant: Prisma sorgularında açık `select`).
 */
const auditLogSelect = {
  id: true,
  action: true,
  targetType: true,
  targetId: true,
  metadata: true,
  createdAt: true,
  actorUserId: true,
  actorUser: { select: { email: true } },
} satisfies Prisma.AuditLogSelect;

type AuditLogRow = Prisma.AuditLogGetPayload<{ select: typeof auditLogSelect }>;

export type AuditLogView = {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
  /**
   * Aktörün e-postası; `null` ise aktör bilinmiyor ya da kullanıcı silinmiş.
   *
   * `AuditLog.actorUserId` `onDelete: SetNull` ile bağlıdır — denetim kaydı bir hesabın
   * silinmesiyle KAYBOLMAZ, yalnızca aktörü anonimleşir. Arayüz bu ikisini ayırt edemez ve
   * etmesi de gerekmez: her ikisinde de söylenecek şey "aktör bilinmiyor".
   */
  actorEmail: string | null;
};

export type AuditLogPage = {
  entries: AuditLogView[];
  nextCursor: string | null;
};

function toView(row: AuditLogRow): AuditLogView {
  return {
    id: row.id,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    metadata: row.metadata,
    createdAt: row.createdAt,
    actorEmail: row.actorUser?.email ?? null,
  };
}

export async function listAuditLog(
  tenantId: string,
  after: AuditLogCursor | null = null,
): Promise<AuditLogPage> {
  // Sayfa boyutundan BİR FAZLA çekilir: fazladan satırın gelip gelmediği "başka sayfa var mı"
  // sorusunun cevabıdır. Ayrı bir `count` sorgusu ikinci bir tarama olurdu ve yanıtta zaten
  // göstermediğimiz bir bilgi için ödenirdi (`listTransactions()` ile aynı tercih).
  const rows = await prisma.auditLog.findMany({
    where: tenantScoped(tenantId, {
      // Keyset koşulu: "sıralamada bu satırdan SONRA gelenler". Anahtar iki alanlı olduğu için
      // karşılaştırma iki dallı. Prisma'nın `cursor` seçeneği KULLANILMADI: tek bir benzersiz
      // alan üzerinden çalışır ve çok sütunlu bir sıralama anahtarını ifade edemez.
      ...(after
        ? {
            OR: [
              { createdAt: { lt: after.createdAt } },
              { createdAt: after.createdAt, id: { lt: after.id } },
            ],
          }
        : {}),
    }),
    select: auditLogSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: AUDIT_LOG_PAGE_SIZE + 1,
  });

  const page = rows.slice(0, AUDIT_LOG_PAGE_SIZE);
  const hasMore = rows.length > AUDIT_LOG_PAGE_SIZE;

  return {
    entries: page.map(toView),
    // `nextCursor` daima döner (yoksa `null`): istemci "başka sayfa var mı" sorusunu alanın
    // VARLIĞINA göre değil DEĞERİNE göre cevaplamalı.
    nextCursor: hasMore ? encodeAuditLogCursor(page[page.length - 1]) : null,
  };
}
