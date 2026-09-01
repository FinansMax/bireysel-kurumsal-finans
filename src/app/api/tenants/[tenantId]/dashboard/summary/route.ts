import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/authz/authorize";
import { hasAllPermissions, PERMISSIONS } from "@/lib/authz/permissions";
import { getDashboardSummary } from "@/lib/finance/dashboard";
import { isValidId } from "@/lib/tenants/validation";

type RouteParams = { params: Promise<{ tenantId: string }> };

/**
 * Panel özeti (Issue #62).
 *
 * TEK BİR İZİN YETMEZ: yanıt üç modelin verisini birlikte açar — hesap bakiyeleri, işlem
 * toplamları ve kategori sayısı. Bu yüzden guard `VIEW_ACCOUNTS` ile başlar (401/400/403
 * semantiğini merkezi guard'dan almak için) ve ardından ÜÇ görüntüleme izninin tamamı aranır.
 * Bugün üç rolün üçü de bu izinlere sahiptir; kontrol yine de yazılıdır çünkü matris
 * değiştiğinde (ör. yeni bir "yalnızca kategori" rolü) bu endpoint sessizce fazla veri
 * sızdıran yer olurdu.
 *
 * `GET` YAN ETKİSİZDİR (invariant #4): yalnızca aggregate okur, hiçbir şey yazmaz — koruma
 * `integration/get-side-effect-free-pattern.spec.ts`.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { tenantId } = await params;
  if (!isValidId(tenantId)) {
    return NextResponse.json({ error: "Invalid tenant id" }, { status: 400 });
  }

  const { context, response } = await requirePermission(PERMISSIONS.VIEW_ACCOUNTS, tenantId);
  if (!context) {
    return response;
  }

  if (
    !hasAllPermissions(context.role, [
      PERMISSIONS.VIEW_ACCOUNTS,
      PERMISSIONS.VIEW_TRANSACTIONS,
      PERMISSIONS.VIEW_CATEGORIES,
    ])
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Scope'un kaynağı `context.tenant.id` — URL parametresi DEĞİL (Issue #13). `now` GEÇİLMEZ:
  // dönem penceresi sunucunun kararıdır, istemcinin değil (bkz. `getDashboardSummary`).
  const summary = await getDashboardSummary(context.tenant.id);

  return NextResponse.json({ summary });
}
