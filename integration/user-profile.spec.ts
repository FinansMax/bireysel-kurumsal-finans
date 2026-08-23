import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { registerUser } from "../src/lib/auth/signup";
import { prisma } from "../src/lib/prisma";
import { getUserProfile, updateUserProfile } from "../src/lib/users/profile";

/**
 * Issue #31 — kullanıcı profili (GET/PATCH /api/users/me), iş mantığı seviyesinde.
 *
 * HTTP katmanı (401, ekstra alanların yok sayılması, hassas alanların yanıta sızmaması)
 * `security/user-profile-security.spec.ts` içinde ayrıca test edilir.
 */

const PASSWORD = "S3curePassw0rd!";

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function createUser() {
  const email = `profile-${randomUUID()}@example.com`;
  const result = await registerUser({ email, password: PASSWORD });
  if (!result.ok) throw new Error("test setup failed: registerUser");
  return { id: result.user.id, email };
}

function cleanup(userIds: string[]) {
  return prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

test.describe("getUserProfile()", () => {
  test("kullanıcının kendi bilgisini döner", async () => {
    const user = await createUser();
    try {
      const profile = await getUserProfile(user.id);

      expect(profile).toMatchObject({ id: user.id, email: user.email, name: null });
      expect(profile?.createdAt).toBeInstanceOf(Date);
    } finally {
      await cleanup([user.id]);
    }
  });

  test("hassas alanlar (passwordHash, credentialsChangedAt, emailVerified) DÖNMEZ", async () => {
    const user = await createUser();
    try {
      const profile = await getUserProfile(user.id);

      // Kontrol grubu: kullanıcının DB'de gerçekten bir passwordHash'i var — yani aşağıdaki
      // "yok" iddiası, alanın hiç doldurulmamış olmasından kaynaklanmıyor.
      const raw = await prisma.user.findUnique({
        where: { id: user.id },
        select: { passwordHash: true },
      });
      expect(raw?.passwordHash).toBeTruthy();

      expect(Object.keys(profile!).sort()).toEqual(["createdAt", "email", "id", "name"]);
    } finally {
      await cleanup([user.id]);
    }
  });

  test("var olmayan kullanıcı için null döner", async () => {
    expect(await getUserProfile(`missing-${randomUUID()}`)).toBeNull();
  });
});

test.describe("updateUserProfile() — başarılı güncelleme", () => {
  test("name güncellenebiliyor ve güncel profil dönüyor", async () => {
    const user = await createUser();
    try {
      const result = await updateUserProfile(user.id, { name: "Sude Begüm" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.profile.name).toBe("Sude Begüm");

      // Kalıcı olduğunu ayrıca DB'den doğrula (dönen nesne doğru ama yazılmamış olabilirdi).
      expect((await getUserProfile(user.id))?.name).toBe("Sude Begüm");
    } finally {
      await cleanup([user.id]);
    }
  });

  test("baştaki/sondaki boşluklar temizlenerek saklanıyor", async () => {
    const user = await createUser();
    try {
      const result = await updateUserProfile(user.id, { name: "   Ada Lovelace   " });

      expect(result.ok).toBe(true);
      expect((await getUserProfile(user.id))?.name).toBe("Ada Lovelace");
    } finally {
      await cleanup([user.id]);
    }
  });

  test("e-posta DEĞİŞMEZ (güncellenebilir tek alan name)", async () => {
    const user = await createUser();
    try {
      await updateUserProfile(user.id, { name: "Yeni Ad" });

      expect((await getUserProfile(user.id))?.email).toBe(user.email);
    } finally {
      await cleanup([user.id]);
    }
  });

  test("uluslararası karakterler ve kesme işareti kabul ediliyor", async () => {
    const user = await createUser();
    try {
      for (const name of ["Şule Gökçe", "O'Brien", "José Álvarez", "Анна Иванова"]) {
        const result = await updateUserProfile(user.id, { name });
        expect(result).toMatchObject({ ok: true });
        expect((await getUserProfile(user.id))?.name).toBe(name);
      }
    } finally {
      await cleanup([user.id]);
    }
  });
});

test.describe("updateUserProfile() — geçersiz input", () => {
  test("string olmayan / eksik name 400 döner ve hiçbir şey değişmez", async () => {
    const user = await createUser();
    try {
      for (const invalidInput of [undefined, null, 42, {}, ["Ada"], true]) {
        const result = await updateUserProfile(user.id, { name: invalidInput });
        expect(result).toEqual({
          ok: false,
          status: 400,
          error: "Name must be between 2 and 100 characters",
        });
      }

      expect((await getUserProfile(user.id))?.name).toBeNull();
    } finally {
      await cleanup([user.id]);
    }
  });

  test("yalnızca boşluktan oluşan name reddediliyor", async () => {
    const user = await createUser();
    try {
      // Trim'lenmeden uzunluk kontrolü yapılsaydı bu girdi (5 karakter) GEÇERDİ.
      const result = await updateUserProfile(user.id, { name: "     " });

      expect(result).toMatchObject({ ok: false, status: 400 });
      expect((await getUserProfile(user.id))?.name).toBeNull();
    } finally {
      await cleanup([user.id]);
    }
  });

  test("sınır değerler: 2 ve 100 karakter kabul, 1 ve 101 karakter ret", async () => {
    const user = await createUser();
    try {
      expect(await updateUserProfile(user.id, { name: "a" })).toMatchObject({
        ok: false,
        status: 400,
      });
      expect(await updateUserProfile(user.id, { name: "a".repeat(101) })).toMatchObject({
        ok: false,
        status: 400,
      });

      expect(await updateUserProfile(user.id, { name: "ab" })).toMatchObject({ ok: true });
      expect(await updateUserProfile(user.id, { name: "a".repeat(100) })).toMatchObject({
        ok: true,
      });
    } finally {
      await cleanup([user.id]);
    }
  });

  test("silinmiş kullanıcı için 404 döner (500/exception değil)", async () => {
    const user = await createUser();
    await cleanup([user.id]);

    const result = await updateUserProfile(user.id, { name: "Hayalet" });
    expect(result).toEqual({ ok: false, status: 404, error: "User not found" });
  });
});
