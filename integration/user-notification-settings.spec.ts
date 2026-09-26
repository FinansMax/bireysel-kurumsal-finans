import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { registerUser } from "../src/lib/auth/signup";
import { prisma } from "../src/lib/prisma";
import { getUserSettings, updateUserSettings } from "../src/lib/users/settings";

/**
 * Issue #88 — kullanıcı bildirim tercihi (GET/PATCH /api/users/me/settings), iş mantığı
 * seviyesinde.
 *
 * HTTP katmanı (401, kullanıcı izolasyonu) `security/user-notification-settings-security.spec.ts`
 * içinde ayrıca test edilir.
 */

const PASSWORD = "S3curePassw0rd!";

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function createUser() {
  const email = `notif-${randomUUID()}@example.com`;
  const result = await registerUser({ email, password: PASSWORD });
  if (!result.ok) throw new Error("test setup failed: registerUser");
  return { id: result.user.id, email };
}

function cleanup(userIds: string[]) {
  return prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

test.describe("getUserSettings() — varsayılan", () => {
  test("yeni kullanıcı varsayılan olarak bildirimleri açık taşıyor", async () => {
    const user = await createUser();
    try {
      const settings = await getUserSettings(user.id);
      expect(settings).toEqual({ id: user.id, notificationsEnabled: true });
    } finally {
      await cleanup([user.id]);
    }
  });

  test("var olmayan kullanıcı için null döner", async () => {
    expect(await getUserSettings(`missing-${randomUUID()}`)).toBeNull();
  });
});

test.describe("updateUserSettings() — başarılı güncelleme", () => {
  test("false'a çevrilebiliyor ve kalıcı oluyor", async () => {
    const user = await createUser();
    try {
      const result = await updateUserSettings(user.id, { notificationsEnabled: false });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.settings.notificationsEnabled).toBe(false);
      expect((await getUserSettings(user.id))?.notificationsEnabled).toBe(false);
    } finally {
      await cleanup([user.id]);
    }
  });

  test("tekrar true'ya çevrilebiliyor (kontrol grubu)", async () => {
    const user = await createUser();
    try {
      await updateUserSettings(user.id, { notificationsEnabled: false });
      const result = await updateUserSettings(user.id, { notificationsEnabled: true });

      expect(result.ok).toBe(true);
      expect((await getUserSettings(user.id))?.notificationsEnabled).toBe(true);
    } finally {
      await cleanup([user.id]);
    }
  });
});

test.describe("updateUserSettings() — geçersiz input", () => {
  test("boolean olmayan değerler 400 döner ve hiçbir şey değişmez", async () => {
    const user = await createUser();
    try {
      for (const invalidInput of [undefined, null, "true", 1, 0, {}, []]) {
        const result = await updateUserSettings(user.id, { notificationsEnabled: invalidInput });
        expect(result).toEqual({
          ok: false,
          status: 400,
          error: "notificationsEnabled must be a boolean",
        });
      }

      // Varsayılan değişmemiş olmalı.
      expect((await getUserSettings(user.id))?.notificationsEnabled).toBe(true);
    } finally {
      await cleanup([user.id]);
    }
  });

  test("silinmiş kullanıcı için 404 döner (500/exception değil)", async () => {
    const user = await createUser();
    await cleanup([user.id]);

    const result = await updateUserSettings(user.id, { notificationsEnabled: false });
    expect(result).toEqual({ ok: false, status: 404, error: "User not found" });
  });
});

test.describe("updateUserSettings() — kullanıcı izolasyonu", () => {
  test("bir kullanıcının tercihini değiştirmek DİĞERİNİ etkilemiyor", async () => {
    const mine = await createUser();
    const theirs = await createUser();
    try {
      await updateUserSettings(mine.id, { notificationsEnabled: false });

      expect((await getUserSettings(theirs.id))?.notificationsEnabled).toBe(true);
    } finally {
      await cleanup([mine.id, theirs.id]);
    }
  });
});
