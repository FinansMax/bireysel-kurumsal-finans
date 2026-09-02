import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { revokeUserSessions } from "../src/lib/auth/revoke-sessions";
import { isSessionRevoked } from "../src/lib/auth/session-revocation";
import { registerUser } from "../src/lib/auth/signup";
import { prisma } from "../src/lib/prisma";

/**
 * "Tüm oturumları kapat" (Issue #186) — iş kuralları.
 *
 * NEDEN BU TESTLER VAR: revocation kararı artık İKİ zaman damgasına bakıyor
 * (`credentialsChangedAt` ve `sessionsRevokedAt`). En büyüğünü almak yerine yanlışlıkla
 * yalnızca birine bakmak, "şifre değiştirdikten sonra oturumları kapatınca eski token yeniden
 * geçerli olur" gibi sessiz ve ciddi bir gerileme üretirdi. Buradaki testler ikisinin
 * birleşimini sabitler.
 */

const createdUserIds: string[] = [];

test.afterAll(async () => {
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

async function createUser(): Promise<string> {
  const result = await registerUser({
    email: `revoke-${randomUUID()}@example.com`,
    password: "S3curePassw0rd!",
  });
  if (!result.ok) throw new Error("test setup failed: registerUser");
  createdUserIds.push(result.user.id);
  return result.user.id;
}

/** `iat` saniye cinsindendir; testlerde okunabilir olsun diye yardımcı. */
function secondsAt(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

test.describe("isSessionRevoked() — iki zaman damgası", () => {
  test("ikisi de null ise hiçbir token revoke edilmez", () => {
    // Migration sonrası mevcut kullanıcılar bu durumdadır; kimse dışarı atılmamalıdır.
    expect(isSessionRevoked(secondsAt(new Date()), null, null)).toBe(false);
    expect(isSessionRevoked(secondsAt(new Date()), undefined, undefined)).toBe(false);
  });

  test("yalnızca sessionsRevokedAt doluyken çalışır (şifre hiç değişmemiş olabilir)", () => {
    const tokenIat = secondsAt(new Date("2026-01-01T10:00:00.000Z"));
    const revokedAt = new Date("2026-01-01T10:00:05.000Z");

    expect(isSessionRevoked(tokenIat, null, revokedAt)).toBe(true);
  });

  test("yalnızca credentialsChangedAt doluyken eski davranış korunur (regresyon)", () => {
    const tokenIat = secondsAt(new Date("2026-01-01T10:00:00.000Z"));
    const changedAt = new Date("2026-01-01T10:00:05.000Z");

    expect(isSessionRevoked(tokenIat, changedAt)).toBe(true);
    expect(isSessionRevoked(tokenIat, changedAt, null)).toBe(true);
  });

  test("EN BÜYÜK zaman damgası kazanır — hangisi daha yeniyse", () => {
    /**
     * Asıl gerileme riski burada: yalnızca `credentialsChangedAt`'e bakan bir implementasyon,
     * şifre değişiminden SONRA yapılan bir toplu iptali görmezdi.
     */
    const tokenIat = secondsAt(new Date("2026-01-01T10:00:03.000Z"));

    // Şifre eski, iptal yeni → token revoke edilmeli.
    expect(
      isSessionRevoked(
        tokenIat,
        new Date("2026-01-01T10:00:00.000Z"),
        new Date("2026-01-01T10:00:09.000Z"),
      ),
    ).toBe(true);

    // İptal eski, şifre yeni → yine revoke edilmeli (simetri).
    expect(
      isSessionRevoked(
        tokenIat,
        new Date("2026-01-01T10:00:09.000Z"),
        new Date("2026-01-01T10:00:00.000Z"),
      ),
    ).toBe(true);

    // KONTROL GRUBU: ikisi de token'dan ESKİ ise revoke EDİLMEZ. Bu olmadan yukarıdaki iki
    // iddia, fonksiyonun her koşulda true dönmesinden de kaynaklanabilirdi.
    expect(
      isSessionRevoked(
        secondsAt(new Date("2026-01-01T10:00:30.000Z")),
        new Date("2026-01-01T10:00:00.000Z"),
        new Date("2026-01-01T10:00:09.000Z"),
      ),
    ).toBe(false);
  });

  test("aynı saniye içindeki token revoke EDİLMEZ (grace window korundu)", () => {
    /**
     * `src/lib/auth/session-revocation.ts`'teki hassasiyet kararının regresyon testi:
     * `iat` saniye, zaman damgaları milisaniye. Aynı saniyeye denk gelen bir token,
     * "yanlış pozitif revocation" olmasın diye geçerli sayılır. Bu kural yeni alan
     * eklendiğinde de aynen geçerlidir.
     */
    const tokenIat = secondsAt(new Date("2026-01-01T10:00:07.000Z"));
    const sameSecond = new Date("2026-01-01T10:00:07.850Z");

    expect(isSessionRevoked(tokenIat, null, sameSecond)).toBe(false);

    // DUYARLILIK: saniye sınırı geçildiğinde revoke ediliyor — yani yukarıdaki `false`,
    // fonksiyonun hiç çalışmamasından kaynaklanmıyor.
    expect(isSessionRevoked(tokenIat, null, new Date("2026-01-01T10:00:08.000Z"))).toBe(true);
  });
});

test.describe("revokeUserSessions()", () => {
  test("sessionsRevokedAt yazılır ve credentialsChangedAt'e DOKUNULMAZ", async () => {
    const userId = await createUser();

    const before = await prisma.user.findUnique({
      where: { id: userId },
      select: { credentialsChangedAt: true, sessionsRevokedAt: true, passwordHash: true },
    });
    expect(before?.sessionsRevokedAt).toBeNull();

    const result = await revokeUserSessions(userId);
    expect(result.ok).toBe(true);

    const after = await prisma.user.findUnique({
      where: { id: userId },
      select: { credentialsChangedAt: true, sessionsRevokedAt: true, passwordHash: true },
    });

    expect(after?.sessionsRevokedAt).toBeInstanceOf(Date);
    // KRİTİK: şifre alanları değişmemeli. `credentialsChangedAt`'e yazmak "bu kullanıcının
    // şifresi değişti" bilgisini bozardı — audit ve ileride eklenecek bildirim bu ayrımı ister.
    expect(after?.credentialsChangedAt).toEqual(before?.credentialsChangedAt);
    expect(after?.passwordHash).toBe(before?.passwordHash);
  });

  test("tekrar çağrılınca zaman damgası İLERLER (idempotent değil, tazelenir)", async () => {
    const userId = await createUser();

    const first = await revokeUserSessions(userId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Aynı milisaniyeye denk gelmemesi için kısa bir bekleme; ölçülen şey zaman damgasının
    // yeniden yazıldığı, sabit kalmadığıdır.
    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = await revokeUserSessions(userId);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.revokedAt.getTime()).toBeGreaterThan(first.revokedAt.getTime());
  });

  test("silinmiş kullanıcı için 404 döner (throw ETMEZ)", async () => {
    // Servis sözleşmesi: beklenen hatalar result union'ı ile taşınır.
    const result = await revokeUserSessions(`nonexistent-${randomUUID()}`);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
    }
  });

  test("yalnızca hedef kullanıcı etkilenir", async () => {
    const target = await createUser();
    const bystander = await createUser();

    await revokeUserSessions(target);

    const other = await prisma.user.findUnique({
      where: { id: bystander },
      select: { sessionsRevokedAt: true },
    });
    expect(other?.sessionsRevokedAt).toBeNull();
  });
});
