import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/authz/authorize";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { updateTenantSettings } from "@/lib/tenants/settings";
import { isValidId } from "@/lib/tenants/validation";

type RouteParams = { params: Promise<{ tenantId: string }> };

/**
 * Tenant'ın temel ayarlarını günceller: ad ve varsayılan para birimi (Issue #86).
 *
 * YETKİ YALNIZ OWNER'DADIR (`UPDATE_TENANT_SETTINGS`) — gerekçenin tamamı
 * `src/lib/tenants/settings.ts`tedir.
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { tenantId } = await params;
  if (!isValidId(tenantId)) {
    return NextResponse.json({ error: "Invalid tenant id" }, { status: 400 });
  }

  const { context, response } = await requirePermission(
    PERMISSIONS.UPDATE_TENANT_SETTINGS,
    tenantId,
  );
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

  const { name, defaultCurrency } = body as Record<string, unknown>;

  // Scope'un kaynağı `context.tenant.id` — URL parametresi DEĞİL (Issue #13).
  const result = await updateTenantSettings(context.tenant.id, context.user.id, {
    name,
    defaultCurrency,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ tenant: result.tenant });
}
