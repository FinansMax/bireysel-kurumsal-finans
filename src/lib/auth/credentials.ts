import type { Prisma } from "@prisma/client";

/**
 * Bir kullanıcının şifre hash'ini ve `credentialsChangedAt`'i AYNI tek `UPDATE` ifadesinde
 * (dolayısıyla atomik olarak) günceller (Issue #26).
 *
 * Invariant: "password değiştiyse `credentialsChangedAt` da değişmiş olmalı" — bu ikisi ASLA
 * ayrı ayrı güncellenmemelidir; bu yüzden password hash'ini değiştiren HER akış (password reset
 * #7, gelecekteki authenticated password change — Epic 3) bu tek fonksiyonu kullanmalıdır,
 * kendi `prisma.user.update()` çağrısını yazmamalıdır.
 *
 * `db` parametresi bilerek `PrismaClient` yerine `Prisma.TransactionClient` kabul eder: hem
 * plain `prisma` client'ı (yapısal olarak uyumludur) hem de daha büyük bir `$transaction`
 * içindeki `tx` handle'ı (ör. authenticated password change'in "mevcut şifreyi doğrula +
 * güncelle" akışı) buraya geçirilebilir.
 */
export async function updateUserPassword(
  db: Prisma.TransactionClient,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { passwordHash, credentialsChangedAt: new Date() },
  });
}
