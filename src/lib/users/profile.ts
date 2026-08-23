import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { isValidName, normalizeName, MAX_NAME_LENGTH, MIN_NAME_LENGTH } from "./validation";

/**
 * Profil yanıtının alan allowlist'i (Issue #31).
 *
 * `select` bilinçli olarak DAR tutulur: `passwordHash`, `credentialsChangedAt` ve
 * `emailVerified` gibi alanlar buraya EKLENMEMELİDİR — bu select doğrudan HTTP yanıtına
 * dönüşür. Yeni bir alan eklenecekse önce "bu bilgi client'a gitmeli mi?" sorusu yanıtlanmalı.
 */
const profileSelect = {
  id: true,
  email: true,
  name: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type UserProfile = Prisma.UserGetPayload<{ select: typeof profileSelect }>;

/**
 * Kullanıcının kendi profilini okur (Issue #31).
 *
 * `userId`, çağıran route'ta `requireUser()`'dan gelen trusted session sahibidir — client'ın
 * gönderdiği bir değer DEĞİLDİR. Bu endpoint başkasının profilini okuyacak bir parametre
 * KABUL ETMEZ; "hangi kullanıcı" sorusunun tek cevabı oturumun kendisidir.
 *
 * NOT — `findUnique({ where: { id } })` burada NEDEN güvenli: `User` tenant-owned bir model
 * DEĞİLDİR, dolayısıyla `tenantScoped()` kuralı (Issue #13, bkz. `src/lib/tenancy/scope.ts`)
 * bu modele uygulanmaz. Ayrıca `id` client input'u değil, doğrulanmış session'dan gelir.
 * Tenant-owned modellerde (Membership/Account/Transaction ...) bu desen KULLANILMAZ.
 *
 * `/api/auth/me` ile FARKI: orası oturumun (JWT'nin) içeriğini yansıtır; burası veritabanının
 * güncel halini döner. Profil güncellendikten sonra taze veriyi veren endpoint budur.
 */
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  return prisma.user.findUnique({ where: { id: userId }, select: profileSelect });
}

export type UpdateUserProfileInput = { name: unknown };

export type UpdateUserProfileResult =
  | { ok: true; profile: UserProfile }
  | { ok: false; status: 400 | 404; error: string };

const INVALID_NAME_ERROR = `Name must be between ${MIN_NAME_LENGTH} and ${MAX_NAME_LENGTH} characters`;

/**
 * Kullanıcının kendi profilini günceller (Issue #31).
 *
 * GÜNCELLENEBİLİR TEK ALAN `name`'dir. `email` bu endpoint üzerinden DEĞİŞTİRİLEMEZ: e-posta
 * hem giriş kimliğidir hem de `@unique`'tir, dolayısıyla değişimi bir doğrulama akışı
 * (yeni adrese onay maili) gerektirir — kapsam dışıdır (bkz. Issue #30 "Scope Dışı").
 * `id`, `passwordHash`, `credentialsChangedAt` gibi alanlar da aynı şekilde dokunulamaz.
 *
 * Bu kısıtlama YAPISALDIR, filtreleme ile değil: fonksiyon `input` nesnesini Prisma'ya
 * geçirmez; yalnızca doğruladığı `name` değerini açıkça yazar. Body'ye `email`/`passwordHash`
 * eklemek hiçbir etki yaratmaz (regresyon testi:
 * `security/user-profile-security.spec.ts` → "body'deki ekstra alanlar yok sayılır").
 */
export async function updateUserProfile(
  userId: string,
  input: UpdateUserProfileInput,
): Promise<UpdateUserProfileResult> {
  if (typeof input.name !== "string") {
    return { ok: false, status: 400, error: INVALID_NAME_ERROR };
  }

  const name = normalizeName(input.name);
  if (!isValidName(name)) {
    return { ok: false, status: 400, error: INVALID_NAME_ERROR };
  }

  try {
    const profile = await prisma.user.update({
      where: { id: userId },
      data: { name },
      select: profileSelect,
    });

    return { ok: true, profile };
  } catch (error) {
    // Oturumu geçerli ama satırı silinmiş kullanıcı (ör. eşzamanlı hesap silme): Prisma
    // "record not found" (P2025) fırlatır. Bu, 500 değil 404 ile ifade edilir.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return { ok: false, status: 404, error: "User not found" };
    }
    throw error;
  }
}
