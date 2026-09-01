import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/authz/authorize";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { setModuleEnabled } from "@/lib/modules/tenant-module";
import { isValidId } from "@/lib/tenants/validation";

type RouteParams = { params: Promise<{ tenantId: string; moduleKey: string }> };

/**
 * Bir modülü açar/kapatır (Issue #151).
 *
 * YETKİ YALNIZ OWNER'DADIR (`MANAGE_MODULES`): bir modülü açmak tenant'ın ürün yüzeyini
 * değiştirir — yeni ekranlar, yeni izinler, yeni veri. Gerekçenin tamamı
 * `src/lib/authz/permissions.ts`tedir.
 *
 * `moduleKey` bir KATALOG anahtarıdır, kayıt id'si değil; bu yüzden `isValidId()` ile değil
 * servis katmanındaki allowlist ile doğrulanır (bilinmeyen anahtar → 400).
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { tenantId, moduleKey } = await params;
  if (!isValidId(tenantId)) {
    return NextResponse.json({ error: "Invalid tenant id" }, { status: 400 });
  }

  const { context, response } = await requirePermission(PERMISSIONS.MANAGE_MODULES, tenantId);
  if (!context) {
    return response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { enabled } = body as Record<string, unknown>;

  // Scope'un kaynağı `context.tenant.id` — URL parametresi DEĞİL (Issue #13).
  const result = await setModuleEnabled(context.tenant.id, moduleKey, enabled, context.user.id);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ module: result.module });
}
