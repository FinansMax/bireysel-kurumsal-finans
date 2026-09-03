import type { Prisma } from "@prisma/client";

import { logger } from "@/lib/observability/logger";
import { prisma } from "@/lib/prisma";

import type { AuditAction, AuditTargetType } from "./actions";
import { sanitizeMetadata } from "./sanitize";

export type WriteAuditLogInput = {
  actorUserId?: string | null;
  tenantId?: string | null;
  action: AuditAction;
  targetType?: AuditTargetType | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * Güvenlik açısından kritik backend olaylarını `AuditLog`'a yazan tek merkezi giriş noktası
 * (Issue #15). Kod tabanındaki hiçbir yer doğrudan `prisma.auditLog.create()` ÇAĞIRMAMALIDIR —
 * hem sanitization hem de best-effort hata yönetimi burada tek yerde garanti edilir.
 *
 * KRİTİK — best-effort: Bu fonksiyon ASLA fırlatmaz (throw etmez). Audit DB insert'i başarısız
 * olursa (bağlantı hatası, kısıtlama ihlali, vb.) hata yakalanır ve mevcut console tabanlı
 * hata loglama deseniyle (bkz. `src/lib/tenants/invitation-email.ts`'teki best-effort outbox
 * yazımı) `console.error` ile loglanır — ana business operation'a ASLA propagate edilmez.
 * Çağıran kod, audit yazımının tenant oluşturma/login/role değiştirme gibi asıl işlemi
 * ASLA başarısız etmeyeceğinden emin olabilir.
 *
 * Metadata, DB'ye yazılmadan önce `sanitizeMetadata()` ile defense-in-depth redaksiyona
 * uğrar (nested object/array dahil) — çağıran kodun hassas bir alanı yanlışlıkla eklemesine
 * karşı ikinci bir savunma katmanıdır; çağıran kod yine de metadata'ya hassas veri KOYMAMALIDIR.
 */
export async function writeAuditLog(input: WriteAuditLogInput): Promise<void> {
  try {
    const metadata = input.metadata
      ? (sanitizeMetadata(input.metadata) as Prisma.InputJsonValue)
      : undefined;

    await prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        tenantId: input.tenantId ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        metadata,
      },
    });
  } catch (error) {
    // Yapılandırılmış log (Issue #183): serbest metin yerine alan bazlı, makine okunabilir.
    logger.error("audit log write failed", {
      extra: {
        action: input.action,
        error: error instanceof Error ? error.message : "unknown error",
      },
    });
  }
}
