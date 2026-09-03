import { NextResponse } from "next/server";

import { pruneAuditLogs } from "@/lib/audit/retention";
import { isValidMaintenanceSecret } from "@/lib/config/maintenance-secret";
import { checkRateLimit } from "@/lib/rate-limit/guard";
import { RATE_LIMIT_BUCKETS, RATE_LIMIT_POLICIES } from "@/lib/rate-limit/policies";

/**
 * AuditLog saklama görevi — zamanlanmış iş tarafından tetiklenir (Issue #188).
 *
 * POST'TUR, GET DEĞİL (invariant #4): kayıt siler. Bir GET olsaydı, `SameSite=Lax` top-level
 * cross-site GET'leri engellemediği için herhangi bir sayfadaki `<img src>` bakım görevini
 * tetikleyebilirdi — ve bu endpoint oturuma değil bir anahtara dayandığı için CSRF'in normal
 * savunması burada zaten geçerli değil.
 *
 * RATE LIMIT VARDIR ve iş mantığından öncedir (invariant #9). Endpoint PUBLIC'tir (oturum
 * istemez) ve PAHALIDIR (toplu okuma + silme + dosya yazma) — yani #9'un tarif ettiği sınıfın
 * tam ortasında. Ayrıca limit, paylaşılan anahtarın brute-force edilmesini de yavaşlatır.
 *
 * SIRA: rate limit → anahtar → iş. Anahtar kontrolü işten önce gelir ki yetkisiz bir çağrı
 * hiçbir satıra dokunmasın.
 */
export async function POST(request: Request) {
  const rateLimitResponse = await checkRateLimit(
    request,
    RATE_LIMIT_BUCKETS.MAINTENANCE,
    RATE_LIMIT_POLICIES.MAINTENANCE,
  );
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  if (!isValidMaintenanceSecret(request.headers.get("authorization"))) {
    /**
     * 404, 401/403 DEĞİL. Anahtar yapılandırılmamışsa da yanlışsa da AYNI yanıt döner:
     * kimliksiz bir çağıran, bu adreste bir bakım endpoint'i olup olmadığını ve
     * yapılandırılmış olup olmadığını ayırt edemez (invariant #7 — enumeration). Doğru
     * anahtarla çağıran zaten 200 alır ve farkı görür.
     */
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await pruneAuditLogs();

  /**
   * Yanıt SAYILARI içerir, SATIRLARI değil. Silinen audit kayıtları kişisel veri taşır
   * (aktör, tenant, metadata); bunları HTTP yanıtına koymak, arşiv dosyasının erişim
   * kontrolünü anlamsız kılardı. Zamanlanmış işin ihtiyacı olan tek şey "kaç satır işlendi"
   * ve "tekrar çağırmalı mıyım".
   */
  return NextResponse.json(
    {
      deletedCount: result.deletedCount,
      batches: result.batches,
      hasMore: result.hasMore,
      cutoff: result.cutoff.toISOString(),
    },
    { status: 200 },
  );
}
