import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { AUDIT_ACTIONS } from "../src/lib/audit/actions";
import { changePassword } from "../src/lib/auth/change-password";
import { verifyPassword } from "../src/lib/auth/password";
import { registerUser } from "../src/lib/auth/signup";
import { prisma } from "../src/lib/prisma";

/**
 * Issue #33 — authenticated password change, iş mantığı seviyesinde.
 *
 * HTTP katmanı (401/429, session revocation'ın uçtan uca etkisi) `security/
 * change-password-security.spec.ts` içinde ayrıca test edilir.
 */

const ORIGINAL_PASSWORD = "S3curePassw0rd!";
const NEW_PASSWORD = "N3wSecurePassw0rd!";

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function createUser() {
  const email = `change-pw-${randomUUID()}@example.com`;
  const result = await registerUser({ email, password: ORIGINAL_PASSWORD });
  if (!result.ok) throw new Error("test setup failed: registerUser");
  return { id: result.user.id, email };
}

async function readUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, credentialsChangedAt: true },
  });
  if (!user) throw new Error("test setup failed: user bulunamadı");
  return user;
}

async function latestAuditAction(userId: string) {
  const entry = await prisma.auditLog.findFirst({
    where: { actorUserId: userId },
    orderBy: { createdAt: "desc" },
    select: { action: true, targetId: true },
  });
  return entry;
}

function cleanup(userIds: string[]) {
  return prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

test.describe("changePassword() — başarılı değişiklik", () => {
  test("doğru mevcut şifreyle yeni şifre belirlenebiliyor", async () => {
    const user = await createUser();
    try {
      const result = await changePassword(user.id, ORIGINAL_PASSWORD, NEW_PASSWORD);
      expect(result).toEqual({ ok: true });

      const { passwordHash } = await readUser(user.id);
      // Kontrol grubu: sadece "ok döndü" yetmez — hash gerçekten YENİ şifreye ait olmalı ve
      // ESKİ şifre artık doğrulanmamalı.
      expect(await verifyPassword(NEW_PASSWORD, passwordHash!)).toBe(true);
      expect(await verifyPassword(ORIGINAL_PASSWORD, passwordHash!)).toBe(false);
    } finally {
      await cleanup([user.id]);
    }
  });

  test("credentialsChangedAt bumplanıyor (session revocation tetikleniyor — Issue #26)", async () => {
    const user = await createUser();
    try {
      // registerUser yeni bir hesap oluşturur; henüz hiç credential değişmediği için null olmalı.
      expect((await readUser(user.id)).credentialsChangedAt).toBeNull();

      const before = Date.now();
      const result = await changePassword(user.id, ORIGINAL_PASSWORD, NEW_PASSWORD);
      expect(result.ok).toBe(true);

      const { credentialsChangedAt } = await readUser(user.id);
      expect(credentialsChangedAt).not.toBeNull();
      expect(credentialsChangedAt!.getTime()).toBeGreaterThanOrEqual(before);
    } finally {
      await cleanup([user.id]);
    }
  });

  test("başarılı değişiklik AUTH_PASSWORD_CHANGED olarak audit'e yazılıyor", async () => {
    const user = await createUser();
    try {
      await changePassword(user.id, ORIGINAL_PASSWORD, NEW_PASSWORD);

      const entry = await latestAuditAction(user.id);
      expect(entry?.action).toBe(AUDIT_ACTIONS.AUTH_PASSWORD_CHANGED);
      expect(entry?.targetId).toBe(user.id);
    } finally {
      await cleanup([user.id]);
    }
  });
});

test.describe("changePassword() — mevcut şifre doğrulaması", () => {
  test("yanlış mevcut şifre 401 döner ve şifreyi DEĞİŞTİRMEZ", async () => {
    const user = await createUser();
    try {
      const result = await changePassword(user.id, "WrongCurrentPassw0rd!", NEW_PASSWORD);
      expect(result).toEqual({
        ok: false,
        status: 401,
        error: "Current password is incorrect",
      });

      // Yan etki yok: şifre hâlâ orijinal ve session revocation TETİKLENMEMİŞ olmalı —
      // aksi halde saldırgan, şifreyi bilmeden kurbanın tüm oturumlarını düşürebilirdi.
      const { passwordHash, credentialsChangedAt } = await readUser(user.id);
      expect(await verifyPassword(ORIGINAL_PASSWORD, passwordHash!)).toBe(true);
      expect(credentialsChangedAt).toBeNull();
    } finally {
      await cleanup([user.id]);
    }
  });

  test("başarısız deneme AUTH_PASSWORD_CHANGE_FAILURE olarak audit'e yazılıyor", async () => {
    const user = await createUser();
    try {
      await changePassword(user.id, "WrongCurrentPassw0rd!", NEW_PASSWORD);

      const entry = await latestAuditAction(user.id);
      expect(entry?.action).toBe(AUDIT_ACTIONS.AUTH_PASSWORD_CHANGE_FAILURE);
      expect(entry?.targetId).toBe(user.id);
    } finally {
      await cleanup([user.id]);
    }
  });

  test("eksik/boş/string olmayan mevcut şifre, yanlış şifreyle AYNI yanıtı verir", async () => {
    const user = await createUser();
    try {
      const wrongPassword = await changePassword(user.id, "WrongCurrentPassw0rd!", NEW_PASSWORD);

      for (const invalidInput of [undefined, null, "", 12345, {}, ["S3curePassw0rd!"]]) {
        const result = await changePassword(user.id, invalidInput, NEW_PASSWORD);
        // Girdi biçimi hakkında ayrı bir sinyal (ör. 400 "Invalid request body") verilmez;
        // hepsi mevcut-şifre reddiyle AYNI yanıta düşer.
        expect(result).toEqual(wrongPassword);
      }

      expect(await verifyPassword(ORIGINAL_PASSWORD, (await readUser(user.id)).passwordHash!)).toBe(
        true,
      );
    } finally {
      await cleanup([user.id]);
    }
  });

  test("şifresiz hesap (passwordHash null) bu akışla şifre belirleyemez", async () => {
    const user = await createUser();
    try {
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash: null } });

      const result = await changePassword(user.id, ORIGINAL_PASSWORD, NEW_PASSWORD);
      // Yanlış şifreyle AYNI yanıt: hesabın şifresiz olduğu dışarıya sızdırılmaz.
      expect(result).toEqual({
        ok: false,
        status: 401,
        error: "Current password is incorrect",
      });
      expect((await readUser(user.id)).passwordHash).toBeNull();
    } finally {
      await cleanup([user.id]);
    }
  });
});

test.describe("changePassword() — yeni şifre politikası", () => {
  test("zayıf yeni şifre 400 döner, mevcut şifre doğru olsa bile hiçbir şey değişmez", async () => {
    const user = await createUser();
    try {
      const result = await changePassword(user.id, ORIGINAL_PASSWORD, "short");
      expect(result).toEqual({
        ok: false,
        status: 400,
        error: "Password must be between 8 and 128 characters",
      });

      // KRİTİK: mevcut şifre doğru olduğu için akış politika kontrolüne kadar ilerledi, ama
      // hiçbir yazma yapılmamalı — özellikle credentialsChangedAt bumplanmamalı, aksi halde
      // geçersiz bir istek kullanıcının tüm oturumlarını düşürürdü.
      const { passwordHash, credentialsChangedAt } = await readUser(user.id);
      expect(await verifyPassword(ORIGINAL_PASSWORD, passwordHash!)).toBe(true);
      expect(credentialsChangedAt).toBeNull();
    } finally {
      await cleanup([user.id]);
    }
  });

  test("string olmayan yeni şifre 400 döner", async () => {
    const user = await createUser();
    try {
      for (const invalidInput of [undefined, null, 12345, {}]) {
        const result = await changePassword(user.id, ORIGINAL_PASSWORD, invalidInput);
        expect(result.ok).toBe(false);
        expect(result).toMatchObject({ status: 400 });
      }
    } finally {
      await cleanup([user.id]);
    }
  });

  test("sınır değerler: 8 karakter kabul, 7 karakter ret", async () => {
    const user = await createUser();
    try {
      const tooShort = await changePassword(user.id, ORIGINAL_PASSWORD, "a".repeat(7));
      expect(tooShort).toMatchObject({ ok: false, status: 400 });

      const exactlyMin = await changePassword(user.id, ORIGINAL_PASSWORD, "a".repeat(8));
      expect(exactlyMin).toEqual({ ok: true });
    } finally {
      await cleanup([user.id]);
    }
  });
});
