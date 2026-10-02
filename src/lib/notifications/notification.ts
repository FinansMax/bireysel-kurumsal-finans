import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { tenantScoped } from "@/lib/tenancy/scope";

/**
 * Uygulama içi bildirimler (Issue #76) — yalnızca ALTYAPI.
 *
 * İKİ KATMANLI SAHİPLİK: bir bildirim hem bir tenant'a hem bir kullanıcıya aittir. Her sorgu
 * `tenantScoped()` üzerinden geçer (invariant #1) VE `userId` taşır: aynı tenant'ın iki üyesi
 * birbirinin bildirimini göremez, okundu işaretleyemez. `tenantId` ve `userId` daima route'taki
 * `requirePermission()` context'inden gelir — URL/body DEĞİL (invariant #2).
 *
 * BAŞKASININ BİLDİRİMİ 404'TÜR, 403 DEĞİL: "var ama senin değil" ile "yok" aynı yanıtı alır;
 * aksi hâlde bildirim id'leri başka kullanıcıların varlığını sızdırırdı (enumeration).
 *
 * AUDIT LOG YAZILMAZ. Okundu işareti kullanıcının KENDİ arayüz durumudur; tenant verisini
 * değiştirmez. Her tıklamayı denetim kaydına yazmak, #188'in saklama politikasının
 * küçültmeye çalıştığı tabloyu gürültüyle doldururdu.
 */

export const MAX_NOTIFICATION_MESSAGE_LENGTH = 500;

/**
 * Liste üst sınırı. Sayfalama bu issue'nun kapsamında değil; sınır, unutulmuş bir hesabın
 * binlerce bildirimini tek yanıtta döndürmeyi engeller. Okunmamışlar önce gelmez — sıra
 * zamana göredir, "okunmamış" ayrı bir filtredir.
 */
export const NOTIFICATION_LIST_LIMIT = 50;

const notificationSelect = {
  id: true,
  message: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

export type NotificationView = Prisma.NotificationGetPayload<{
  select: typeof notificationSelect;
}>;

export async function listNotifications(
  tenantId: string,
  userId: string,
  options: { unreadOnly: boolean },
): Promise<NotificationView[]> {
  return prisma.notification.findMany({
    where: tenantScoped(tenantId, options.unreadOnly ? { userId, readAt: null } : { userId }),
    select: notificationSelect,
    // `id` ikincil anahtar: aynı milisaniyede üretilen iki bildirimin sırası kararlı olmalı.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: NOTIFICATION_LIST_LIMIT,
  });
}

export type MarkNotificationReadResult =
  | { ok: true; notification: NotificationView }
  | { ok: false; status: 404; error: string };

const NOT_FOUND_ERROR = "Notification not found";

/**
 * Bildirimi okundu işaretler. İDEMPOTENTTİR: zaten okunmuş bir bildirim tekrar işaretlenince
 * `ok: true` döner ve `readAt` DEĞİŞMEZ — ilk okunma anı korunur.
 *
 * Koşullu atomik `updateMany` (`readAt: null`): iki sekme aynı anda işaretlerse yalnızca biri
 * yazar; "önce oku sonra yaz" yarışı yok. `count === 0` iki anlama gelebilir — zaten okunmuş
 * ya da yok/başkasının — ve ayrımı AYNI scope'la yapılan salt-okunur bir sorgu verir.
 */
export async function markNotificationRead(
  tenantId: string,
  userId: string,
  notificationId: string,
  now: Date = new Date(),
): Promise<MarkNotificationReadResult> {
  await prisma.notification.updateMany({
    where: tenantScoped(tenantId, { id: notificationId, userId, readAt: null }),
    data: { readAt: now },
  });

  const notification = await prisma.notification.findFirst({
    where: tenantScoped(tenantId, { id: notificationId, userId }),
    select: notificationSelect,
  });
  if (!notification) {
    return { ok: false, status: 404, error: NOT_FOUND_ERROR };
  }

  return { ok: true, notification };
}

export type CreateNotificationResult =
  | { ok: true; notification: NotificationView }
  | { ok: false; status: 400 | 404; error: string };

/**
 * Bildirim üretir — ileride vade hatırlatma gibi SUNUCU TARAFI üreticilerin çağıracağı yol.
 * HTTP endpoint'i YOKTUR: bir kullanıcının başka bir kullanıcıya bildirim "göndermesi" bu
 * issue'nun istediği bir yetenek değil ve açılırsa spam/oltalama yüzeyi olurdu.
 *
 * Alıcının tenant ÜYESİ olduğu doğrulanır: üyeliği bitmiş birine bildirim yazmak, erişemeyeceği
 * bir tenant'ta ona ait satır bırakmak olurdu. Kontrol ile yazım arasındaki yarış (üyelik tam
 * o anda silinirse) kabul edilmiştir: sonuç, kullanıcının zaten göremeyeceği tek bir satırdır —
 * veri sızıntısı değil.
 */
export async function createNotification(
  tenantId: string,
  userId: string,
  message: unknown,
): Promise<CreateNotificationResult> {
  if (typeof message !== "string") {
    return { ok: false, status: 400, error: "Invalid message" };
  }
  const trimmed = message.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_NOTIFICATION_MESSAGE_LENGTH
  ) {
    return { ok: false, status: 400, error: "Invalid message" };
  }

  const membership = await prisma.membership.findFirst({
    where: tenantScoped(tenantId, { userId }),
    select: { id: true },
  });
  if (!membership) {
    return { ok: false, status: 404, error: "Recipient not found" };
  }

  const notification = await prisma.notification.create({
    data: { tenantId, userId, message: trimmed },
    select: notificationSelect,
  });

  return { ok: true, notification };
}
