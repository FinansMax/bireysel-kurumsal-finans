import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/guard";
import { requireActiveTenant, type ActiveTenantContext } from "@/lib/tenants/tenant-context";

import { hasPermission, type Permission } from "./permissions";

type RequirePermissionResult =
  | { context: ActiveTenantContext; response: null }
  | { context: null; response: NextResponse };

const FORBIDDEN_RESPONSE = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });

/**
 * Merkezi backend authorization guard'ı (Issue #12).
 *
 * Akış: Authenticated User → Active Tenant → Live Membership → Role → Permission Matrix
 * → Allow/Deny. Client'tan gelen hiçbir role/tenantId/membership değeri bu karar için
 * kaynak olarak kullanılmaz — tek kaynak, `requireActiveTenant()`'ın (#10) DB'den canlı
 * doğruladığı context'tir.
 *
 * Durum kodları:
 * - Authentication yok → 401 (mevcut `requireUser()` semantiği)
 * - Active tenant yok / geçersiz / stale membership → 400 (mevcut `requireActiveTenant()`
 *   semantiği, #10 ile aynı)
 * - `expectedTenantId` verilmiş ve aktif tenant ile eşleşmiyorsa → 403 (URL'deki tenantId'yi
 *   değiştirerek başka bir tenant üzerinde işlem yapma girişimine karşı)
 * - Aktif tenant'taki role, istenen permission'a (#11 matrisine göre) sahip değilse → 403
 *
 * Kullanım:
 *   const { context, response } = await requirePermission(PERMISSIONS.VIEW_MEMBERS, tenantId);
 *   if (!context) return response;
 */
export async function requirePermission(
  permission: Permission,
  expectedTenantId?: string,
): Promise<RequirePermissionResult> {
  const { user, response: authResponse } = await requireUser();
  if (!user) {
    return { context: null, response: authResponse };
  }

  const { context, response: tenantResponse } = await requireActiveTenant();
  if (!context) {
    return { context: null, response: tenantResponse };
  }

  if (expectedTenantId !== undefined && expectedTenantId !== context.tenant.id) {
    return { context: null, response: FORBIDDEN_RESPONSE() };
  }

  if (!hasPermission(context.role, permission)) {
    return { context: null, response: FORBIDDEN_RESPONSE() };
  }

  return { context, response: null };
}
