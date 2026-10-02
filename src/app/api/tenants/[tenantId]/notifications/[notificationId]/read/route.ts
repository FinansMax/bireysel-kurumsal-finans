import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/authz/authorize";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { markNotificationRead } from "@/lib/notifications/notification";
import { isValidId } from "@/lib/tenants/validation";

type RouteParams = {
  params: Promise<{ tenantId: string; notificationId: string }>;
};

/**
 * Bildirimi okundu işaretler (Issue #76). Gövde YOKTUR: işaretin tek anlamı var ve zamanı
 * sunucu belirler — istemcinin `readAt` göndermesi, geçmişe/geleceğe tarih yazdırmak olurdu.
 *
 * PATCH, GET DEĞİL (invariant #4): state değiştirir. Idempotenttir; ikinci çağrı ilk okunma
 * anını değiştirmez.
 *
 * YETKİ: `VIEW_TENANT` (üyelik) + sahiplik sorguda. Başkasının bildirimi ile var olmayan id AYNI
 * 404'ü alır (enumeration engeli). Bir "görüntüleme" izniyle yazma yapılması bilinçlidir:
 * değişen şey tenant verisi değil, kullanıcının KENDİ kaydıdır — bkz. liste route'undaki not.
 */
export async function PATCH(_request: Request, { params }: RouteParams) {
  const { tenantId, notificationId } = await params;
  if (!isValidId(tenantId) || !isValidId(notificationId)) {
    return NextResponse.json(
      { error: "Invalid tenant or notification id" },
      { status: 400 },
    );
  }

  const { context, response } = await requirePermission(
    PERMISSIONS.VIEW_TENANT,
    tenantId,
  );
  if (!context) {
    return response;
  }

  const result = await markNotificationRead(
    context.tenant.id,
    context.user.id,
    notificationId,
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json({ notification: result.notification });
}
