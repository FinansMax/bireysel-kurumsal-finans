import { NextResponse } from "next/server";

import { isValidMaintenanceSecret } from "@/lib/config/maintenance-secret";
import { processPendingExports, pruneExpiredExportFiles } from "@/lib/export/tenant-export-service";
import { checkRateLimit } from "@/lib/rate-limit/guard";
import { RATE_LIMIT_BUCKETS, RATE_LIMIT_POLICIES } from "@/lib/rate-limit/policies";

/**
 * Bekleyen dışa aktarmaları üretir ve süresi dolmuş dosyaları siler (Issue #194).
 *
 * Zamanlanmış iş tarafından tetiklenir — `#188`'in (AuditLog saklama) getirdiği desenin
 * aynısı, aynı `MAINTENANCE_SECRET` ile. Bu repo'da kuyruk altyapısı yoktur ve bir tane
 * getirmek bu issue'nun kapsamı dışıdır.
 *
 * POST, anahtar kontrolü, 404 davranışı ve sıra (rate limit → anahtar → iş) için gerekçeler
 * `src/app/api/maintenance/audit-retention/route.ts`'te birebir aynıdır.
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
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await processPendingExports();
  const removedFiles = await pruneExpiredExportFiles();

  // Yanıt SAYILARDIR: hangi tenant'ın verisinin üretildiği bu yanıtta yer almaz.
  return NextResponse.json(
    { processed: result.processed, failed: result.failed, hasMore: result.hasMore, removedFiles },
    { status: 200 },
  );
}
