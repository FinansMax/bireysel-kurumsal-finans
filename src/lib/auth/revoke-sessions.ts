import { prisma } from "@/lib/prisma";

/**
 * "Tüm oturumları kapat" (Issue #186).
 *
 * NEDEN VAR: stateless JWT mimarisinde sign-out yalnızca istemcinin cookie'sini temizler —
 * ÇALINMIŞ bir token 8 saat boyunca geçerli kalmaya devam eder. Bu, README'de kayda geçmiş
 * bilinçli bir kabuldü, ama kullanıcının "şüpheli bir durum var, her yerden çıkayım"
 * diyebileceği hiçbir yol yoktu. Finansal bir üründe kurumsal müşterinin ilk sorduğu
 * şeylerden biridir.
 *
 * Altyapı ZATEN vardı (#26): tek eksik, şifre değişimi dışında da tetiklenebilen bir zaman
 * damgasıydı.
 *
 * NEDEN `updateUserPassword()` DEĞİL: o fonksiyonun invariant'ı "şifre değiştiyse
 * `credentialsChangedAt` da değişmiş olmalı"dır ve şifreyi DEĞİŞTİRMEDEN çağrılması o
 * invariant'ı anlamsız kılardı. Ayrıca `credentialsChangedAt`'e yazmak, "bu kullanıcının
 * şifresi değişti mi" sorusunun cevabını bozardı — audit kaydı ve ileride eklenecek
 * "şifreniz değişti" bildirimi bu ayrımı ister. Bu yüzden AYRI bir alan ve AYRI bir fonksiyon.
 */

export type RevokeSessionsResult =
  | { ok: true; revokedAt: Date }
  | { ok: false; status: 404; error: string };

/**
 * Kullanıcının tüm JWT oturumlarını geçersiz kılar.
 *
 * ÇAĞIRANIN OTURUMU DA DÜŞER ve bu bilinçlidir: stateless JWT'de "bu isteği yapan token"ı
 * ayrıcalıklı kılmanın bir yolu yoktur (token'ları birbirinden ayırt eden sunucu tarafı bir
 * kayıt yok — o, mimariyi değiştiren ayrı bir karar, #186 "Scope Dışı"). `change-password`
 * akışı da aynı nedenle aynı şekilde davranır; yanıt bunu kullanıcıya açıkça söyler.
 *
 * `updateMany` + `count` kullanılır: silinmiş bir kullanıcı için `update()` fırlatırdı, oysa
 * burada beklenen davranış tanımlı bir `404`tür (servis sözleşmesi: throw etme, union dön).
 */
export async function revokeUserSessions(userId: string): Promise<RevokeSessionsResult> {
  const revokedAt = new Date();

  const { count } = await prisma.user.updateMany({
    where: { id: userId },
    data: { sessionsRevokedAt: revokedAt },
  });

  if (count !== 1) {
    return { ok: false, status: 404, error: "User not found" };
  }

  return { ok: true, revokedAt };
}
