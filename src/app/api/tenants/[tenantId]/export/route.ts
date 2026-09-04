import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/authz/authorize";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { requestTenantDataExport } from "@/lib/export/tenant-export-service";
import { checkRateLimit } from "@/lib/rate-limit/guard";
import { RATE_LIMIT_BUCKETS, RATE_LIMIT_POLICIES } from "@/lib/rate-limit/policies";
import { isValidId } from "@/lib/tenants/validation";

type RouteParams = { params: Promise<{ tenantId: string }> };

/**
 * Tenant verisinin dışa aktarılmasını ister (Issue #194).
 *
 * POST'TUR, GET DEĞİL (invariant #4): kalıcı bir kayıt oluşturur ve bir üretim işi tetikler.
 *
 * YANIT ZIP DEĞİL: üretim eşzamanlı değildir (bkz. `tenant-export-service.ts`). Yanıt bir
 * `exportId` ve TEK KULLANIMLIK indirme token'ı taşır; dosya hazır olduğunda
 * `POST /api/exports/download` ile alınır.
 *
 * TOKEN YALNIZCA BU YANITTA görünür — DB'de sadece SHA-256 hash'i var (invariant #6).
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { tenantId } = await params;
  if (!isValidId(tenantId)) {
    return NextResponse.json({ error: "Invalid tenant id" }, { status: 400 });
  }

  // Rate limit iş mantığından ÖNCE (invariant #9): üretim pahalıdır ve kalıcı dosya bırakır.
  const rateLimitResponse = await checkRateLimit(
    request,
    RATE_LIMIT_BUCKETS.DATA_EXPORT,
    RATE_LIMIT_POLICIES.DATA_EXPORT,
  );
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const { context, response } = await requirePermission(PERMISSIONS.EXPORT_TENANT_DATA, tenantId);
  if (!context) {
    return response;
  }

  // Scope'un kaynağı `context.tenant.id` — URL parametresi DEĞİL (invariant #2).
  const result = await requestTenantDataExport(context.tenant.id, context.user.id);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(
    {
      exportId: result.exportId,
      downloadToken: result.downloadToken,
      expiresAt: result.expiresAt.toISOString(),
      status: "PENDING",
    },
    { status: 202 },
  );
}
