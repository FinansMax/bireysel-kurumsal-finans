import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * Kullanıcının kendi tercihleri: bildirim açık/kapalı (Issue #88).
 *
 * `profile.ts` (Issue #31) İLE AYNI DURUŞ: `User` tenant-owned bir model DEĞİLDİR, bu yüzden
 * `tenantScoped()` kuralı burada uygulanmaz ve bare `update({ where: { id } })` GÜVENLİDİR —
 * `userId` her zaman `requireUser()`'dan gelen trusted session sahibidir, client input'u
 * DEĞİLDİR. Ayrı bir dosyada tutulması: profil (kimlik alanları) ve tercihler (davranış
 * alanları) farklı büyüme hızına sahip — issue #88 "PATCH /api/users/me/settings" için AYRI
 * bir uç istiyor, `/api/users/me`'nin (ad) kapsamına karışmaz.
 */

const settingsSelect = {
  id: true,
  notificationsEnabled: true,
} satisfies Prisma.UserSelect;

export type UserSettings = Prisma.UserGetPayload<{ select: typeof settingsSelect }>;

export async function getUserSettings(userId: string): Promise<UserSettings | null> {
  return prisma.user.findUnique({ where: { id: userId }, select: settingsSelect });
}

export type UpdateUserSettingsInput = { notificationsEnabled: unknown };

export type UpdateUserSettingsResult =
  | { ok: true; settings: UserSettings }
  | { ok: false; status: 400 | 404; error: string };

const INVALID_NOTIFICATIONS_ENABLED_ERROR = "notificationsEnabled must be a boolean";

export async function updateUserSettings(
  userId: string,
  input: UpdateUserSettingsInput,
): Promise<UpdateUserSettingsResult> {
  if (typeof input.notificationsEnabled !== "boolean") {
    return { ok: false, status: 400, error: INVALID_NOTIFICATIONS_ENABLED_ERROR };
  }

  try {
    const settings = await prisma.user.update({
      where: { id: userId },
      data: { notificationsEnabled: input.notificationsEnabled },
      select: settingsSelect,
    });

    return { ok: true, settings };
  } catch (error) {
    // Oturumu geçerli ama satırı silinmiş kullanıcı (ör. eşzamanlı hesap silme) — `profile.ts`
    // ile aynı gerekçe: Prisma P2025 fırlatır, 500 değil 404 ile ifade edilir.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return { ok: false, status: 404, error: "User not found" };
    }
    throw error;
  }
}
