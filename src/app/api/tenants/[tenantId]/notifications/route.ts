import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/authz/authorize";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { listNotifications } from "@/lib/notifications/notification";
import { isValidId } from "@/lib/tenants/validation";

type RouteParams = { params: Promise<{ tenantId: string }> };

/**
 * Oturumdaki kullanıcının bu tenant'taki bildirimleri (Issue #76).
 *
 * YETKİ: `VIEW_TENANT` — yani tenant ÜYELİĞİ. Matrise yeni bir izin EKLENMEDİ: bildirim rolün
 * değil kullanıcının kaynağıdır; OWNER da MEMBER da yalnızca KENDİ bildirimini görür. Asıl
 * kısıt sorgudadır (`userId` = `context.user.id`), rol matrisinde değil. Ayrı bir izin, her
 * rolde aynı değeri taşıyan ve hiçbir şeyi ayırt etmeyen bir satır olurdu.
 *
 * `?unread=true` yalnızca okunmamışları döndürür. GET yan etkisizdir (invariant #4): listelemek
 * bildirimi okundu İŞARETLEMEZ — o iş `PATCH .../read`'indir.
 */
export async function GET(request: Request, { params }: RouteParams) {
  const { tenantId } = await params;
  if (!isValidId(tenantId)) {
    return NextResponse.json({ error: "Invalid tenant id" }, { status: 400 });
  }

  // Ucuz şekil kontrolü authz'den ÖNCE (CLAUDE.md §5). `getAll()`: tekrarlanan parametre
  // sessizce ilk değere düşmez, hatadır. Yalnızca `true`/`false` kabul edilir — `?unread=1`
  // gibi bir değerin sessizce "hepsi"ne dönüşmesi, kullanıcıya eksik bir liste göstermekti.
  const unreadValues = new URL(request.url).searchParams.getAll("unread");
  if (
    unreadValues.length > 1 ||
    (unreadValues.length === 1 && !["true", "false"].includes(unreadValues[0]))
  ) {
    return NextResponse.json(
      { error: "Invalid unread filter" },
      { status: 400 },
    );
  }
  const unreadOnly = unreadValues[0] === "true";

  const { context, response } = await requirePermission(
    PERMISSIONS.VIEW_TENANT,
    tenantId,
  );
  if (!context) {
    return response;
  }

  // Scope'un kaynağı `context` — URL parametresi DEĞİL (invariant #2).
  const notifications = await listNotifications(
    context.tenant.id,
    context.user.id,
    {
      unreadOnly,
    },
  );

  return NextResponse.json({ notifications });
}
