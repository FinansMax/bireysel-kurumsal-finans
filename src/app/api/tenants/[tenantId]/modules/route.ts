import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/authz/authorize";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { listTenantModules } from "@/lib/modules/tenant-module";
import { isValidId } from "@/lib/tenants/validation";

type RouteParams = { params: Promise<{ tenantId: string }> };

/**
 * Tenant'ın modül durumu (Issue #151).
 *
 * GÖRÜNTÜLEME HER ROLE AÇIKTIR: menüyü kurabilmek için hangi modüllerin açık olduğunu bilmek
 * gerekir ve bu bilgi bir sır değildir. Modülün İÇERİĞİ elbette kendi izinleriyle korunur.
 *
 * `GET` YAN ETKİSİZDİR (invariant #4): katalog + DB birleştirilir, hiçbir satır yazılmaz —
 * özellikle "eksik satırları oluştur" gibi bir tembel-kurulum YAPILMAZ.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { tenantId } = await params;
  if (!isValidId(tenantId)) {
    return NextResponse.json({ error: "Invalid tenant id" }, { status: 400 });
  }

  const { context, response } = await requirePermission(PERMISSIONS.VIEW_MODULES, tenantId);
  if (!context) {
    return response;
  }

  // Sorgu scope'unun kaynağı `context.tenant.id` — URL parametresi DEĞİL (Issue #13).
  const modules = await listTenantModules(context.tenant.id);
  return NextResponse.json({ modules });
}
