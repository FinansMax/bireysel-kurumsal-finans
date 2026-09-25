import { NextResponse } from "next/server";

import { decodeAuditLogCursor, type AuditLogCursor } from "@/lib/audit/audit-log-cursor";
import { listAuditLog } from "@/lib/audit/list-audit-log";
import { requirePermission } from "@/lib/authz/authorize";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { isValidId } from "@/lib/tenants/validation";

type RouteParams = { params: Promise<{ tenantId: string }> };

/**
 * Tenant'ın denetim kaydı listesi (Issue #78).
 *
 * YETKİ: `VIEW_AUDIT_LOG` — matriste OWNER ve ADMIN'de, MEMBER'da değil
 * (`src/lib/authz/permissions.ts`). #78'in gövdesi "sadece OWNER" diyordu; matris ve onun testi
 * (`integration/permissions.spec.ts`) ADMIN'i de kapsıyor ve matris bu kod tabanında YETKİLİ
 * KAYNAKTIR (CLAUDE.md §4.3). Matrisi bu route uğruna değiştirmek, test edilmiş bir güvenlik
 * kararını yan etki olarak dönüştürmek olurdu; ayrım gerekiyorsa kendi issue'sunda yapılmalı.
 *
 * GET YAN ETKİSİZDİR (invariant #4): liste okur, hiçbir şey yazmaz. Denetim kaydını GÖRÜNTÜLEMEK
 * ayrıca denetim kaydına YAZILMAZ — her okuma bir satır üretseydi liste kendi kendini besleyen
 * bir gürültü kaynağına dönerdi.
 */
export async function GET(request: Request, { params }: RouteParams) {
  const { tenantId } = await params;
  if (!isValidId(tenantId)) {
    return NextResponse.json({ error: "Invalid tenant id" }, { status: 400 });
  }

  // Ucuz şekil kontrolü authz'den ÖNCE (route sırası, CLAUDE.md §5).
  //
  // `getAll()` KULLANILIR, `get()` DEĞİL: `get()` tekrarlanan bir parametrede sessizce ilk
  // değeri döndürür ve "tekrar hatadır" kontrolü hiç tetiklenmezdi (`/transactions` ile aynı
  // gerekçe).
  const search = new URL(request.url).searchParams;
  const afterValues = search.getAll("after");
  if (afterValues.length > 1) {
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  }

  let after: AuditLogCursor | null = null;
  if (afterValues.length === 1) {
    after = decodeAuditLogCursor(afterValues[0]);
    // Bozuk imleç 400 alır, SESSİZCE ilk sayfaya düşmez: kullanıcı ikinci sayfayı beklerken
    // birinciyi görüp bunu fark etmeyebilirdi.
    if (!after) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }
  }

  const { context, response } = await requirePermission(PERMISSIONS.VIEW_AUDIT_LOG, tenantId);
  if (!context) {
    return response;
  }

  // Scope'un kaynağı `context.tenant.id` — URL parametresi DEĞİL (invariant #2). İmleç yalnızca
  // "nereden devam edileceğini" söyler; kurcalanmış bir imleç başka tenant'ın verisini açamaz.
  const { entries, nextCursor } = await listAuditLog(context.tenant.id, after);

  return NextResponse.json({ entries, nextCursor });
}
