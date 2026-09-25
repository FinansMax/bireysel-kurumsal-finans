import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { authenticateUser } from "../src/lib/auth/authenticate";
import { registerUser } from "../src/lib/auth/signup";
import { countUnusedRecoveryCodes } from "../src/lib/auth/recovery-codes";
import { totpCode, totpStepForTime } from "../src/lib/auth/totp";
import {
  beginTotpEnrollment,
  confirmTotpEnrollment,
  disableTotp,
  isTotpEnabled,
} from "../src/lib/auth/totp-enrollment";
import { prisma } from "../src/lib/prisma";

/**
 * TOTP kurulum akışı ve giriş entegrasyonu (Issue #193), gerçek DB'ye karşı.
 */

const PASSWORD = "S3curePassw0rd!";

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function createUser(): Promise<{ id: string; email: string }> {
  const email = `totp-${randomUUID()}@example.com`;
  const signup = await registerUser({ email, password: PASSWORD });

  if (!signup.ok) {
    throw new Error("test kullanicisi olusturulamadi");
  }

  return { id: signup.user.id, email };
}

/** Kurulumu sonuna kadar götürür ve sırrı döner. */
async function enableTotpFor(userId: string): Promise<{ secret: string; recoveryCodes: string[] }> {
  const begun = await beginTotpEnrollment(userId);
  if (!begun.ok) {
    throw new Error("enrollment baslatilamadi");
  }

  const confirmed = await confirmTotpEnrollment(userId, totpCode(begun.secret)!);
  if (!confirmed.ok) {
    throw new Error("enrollment dogrulanamadi");
  }

  return { secret: begun.secret, recoveryCodes: begun.recoveryCodes };
}

test.describe("Kurulum: başlat", () => {
  test("sır, otpauth URI ve kurtarma kodları dönüyor; DB'de 2FA HENÜZ AKTİF DEĞİL", async () => {
    const user = await createUser();

    try {
      const result = await beginTotpEnrollment(user.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(result.otpauthUri).toContain(encodeURIComponent(user.email));
      expect(result.recoveryCodes).toHaveLength(10);

      // KRİTİK: doğrulanmamış kurulum 2FA'yı AKTİFLEŞTİRMEZ — aksi halde QR'ı okuyamayan
      // kullanıcı kendi hesabından kilitlenirdi.
      expect(await isTotpEnabled(user.id)).toBe(false);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("sır DB'de DÜZ METİN olarak saklanmıyor", async () => {
    const user = await createUser();

    try {
      const result = await beginTotpEnrollment(user.id);
      if (!result.ok) return;

      const row = await prisma.userTotpSecret.findUniqueOrThrow({ where: { userId: user.id } });

      expect(row.secretCipher).not.toContain(result.secret);
      expect(row.secretCipher.startsWith("v1.")).toBe(true);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("kurtarma kodları DB'de DÜZ METİN olarak saklanmıyor", async () => {
    const user = await createUser();

    try {
      const result = await beginTotpEnrollment(user.id);
      if (!result.ok) return;

      const rows = await prisma.userRecoveryCode.findMany({ where: { userId: user.id } });
      const stored = rows.map((row) => row.codeHash).join("|");

      expect(rows).toHaveLength(10);
      for (const code of result.recoveryCodes) {
        expect(stored).not.toContain(code.replace("-", ""));
        expect(stored).not.toContain(code);
      }
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("kurtarma kodları KURULUMUN BAŞINDA üretiliyor", async () => {
    // Sonunda üretilseydi, "authenticator eklendi ama kod görülmedi" penceresinde telefonunu
    // kaybeden kullanıcı kilitlenirdi.
    const user = await createUser();

    try {
      await beginTotpEnrollment(user.id);
      expect(await countUnusedRecoveryCodes(user.id)).toBe(10);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("tekrar başlatmak İDEMPOTENT: yeni sır yazar, satır çoğaltmaz", async () => {
    const user = await createUser();

    try {
      const first = await beginTotpEnrollment(user.id);
      const second = await beginTotpEnrollment(user.id);
      if (!first.ok || !second.ok) return;

      expect(second.secret).not.toBe(first.secret);
      expect(await prisma.userTotpSecret.count({ where: { userId: user.id } })).toBe(1);
      // Eski kodlar da değişmeli: yarım kalmış kurulumun kodları geçerli kalmamalı.
      expect(await countUnusedRecoveryCodes(user.id)).toBe(10);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("2FA ZATEN AKTİFKEN yeniden başlatmak 409 veriyor", async () => {
    // Sessizce yeni sır üretmek, çalışan authenticator'ı fark ettirmeden geçersiz kılardı.
    const user = await createUser();

    try {
      await enableTotpFor(user.id);
      const result = await beginTotpEnrollment(user.id);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(409);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});

test.describe("Kurulum: doğrula", () => {
  test("doğru kod 2FA'yı aktifleştiriyor", async () => {
    const user = await createUser();

    try {
      const begun = await beginTotpEnrollment(user.id);
      if (!begun.ok) return;

      const result = await confirmTotpEnrollment(user.id, totpCode(begun.secret)!);

      expect(result.ok).toBe(true);
      expect(await isTotpEnabled(user.id)).toBe(true);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("yanlış kod reddediliyor ve 2FA aktif OLMUYOR", async () => {
    const user = await createUser();

    try {
      const begun = await beginTotpEnrollment(user.id);
      if (!begun.ok) return;

      const result = await confirmTotpEnrollment(user.id, "000000");

      expect(result.ok).toBe(false);
      expect(await isTotpEnabled(user.id)).toBe(false);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("kurulum başlatılmadan doğrulama 404", async () => {
    const user = await createUser();

    try {
      const result = await confirmTotpEnrollment(user.id, "123456");

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("KURULUM KODU giriş için TEKRAR KULLANILAMIYOR", async () => {
    // Kurulum ve giriş aynı replay penceresini paylaşır; `confirmedAt` yazılırken
    // `lastUsedStep` de yazılmasaydı bu kod hemen bir girişte tekrar kullanılabilirdi.
    const user = await createUser();

    try {
      const begun = await beginTotpEnrollment(user.id);
      if (!begun.ok) return;

      const code = totpCode(begun.secret)!;
      await confirmTotpEnrollment(user.id, code);

      const login = await authenticateUser({ email: user.email, password: PASSWORD, totp: code });
      expect(login).toEqual({ ok: false, reason: "totp_invalid" });
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});

test.describe("Giriş akışı", () => {
  test("2FA KAPALI kullanıcı için akış DEĞİŞMİYOR", async () => {
    // Bu, özelliğin en önemli geriye dönük uyumluluk garantisi.
    const user = await createUser();

    try {
      const result = await authenticateUser({ email: user.email, password: PASSWORD });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.user.id).toBe(user.id);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("2FA açık: kodsuz giriş 'totp_required' veriyor (invalid_credentials DEĞİL)", async () => {
    // Doğru şifreye 'şifreniz yanlış' demek, kullanıcıyı çözemeyeceği bir hataya sokardı.
    const user = await createUser();

    try {
      await enableTotpFor(user.id);
      const result = await authenticateUser({ email: user.email, password: PASSWORD });

      expect(result).toEqual({ ok: false, reason: "totp_required" });
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("2FA açık: YANLIŞ ŞİFRE hâlâ 'invalid_credentials' (2FA varlığı sızmıyor)", async () => {
    // KRİTİK: şifreyi bilmeyen biri, hesabın 2FA kullandığını ÖĞRENEMEZ.
    const user = await createUser();

    try {
      await enableTotpFor(user.id);
      const result = await authenticateUser({ email: user.email, password: "WrongPassword!" });

      expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("doğru şifre + doğru kod giriş yapıyor", async () => {
    const user = await createUser();

    try {
      const { secret } = await enableTotpFor(user.id);
      // Kurulum kodunun adımını tüketmemek için bir sonraki pencereyi kullan.
      const nextWindow = Date.now() + 30_000;
      const result = await authenticateUser({
        email: user.email,
        password: PASSWORD,
        totp: totpCode(secret, nextWindow)!,
      });

      expect(result.ok).toBe(true);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("doğru şifre + YANLIŞ kod giriş YAPAMIYOR", async () => {
    const user = await createUser();

    try {
      await enableTotpFor(user.id);
      const result = await authenticateUser({
        email: user.email,
        password: PASSWORD,
        totp: "000000",
      });

      expect(result).toEqual({ ok: false, reason: "totp_invalid" });
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("AYNI KOD İKİNCİ KEZ kabul edilmiyor (replay)", async () => {
    const user = await createUser();

    try {
      const { secret } = await enableTotpFor(user.id);
      const nextWindow = Date.now() + 30_000;
      const code = totpCode(secret, nextWindow)!;

      const first = await authenticateUser({ email: user.email, password: PASSWORD, totp: code });
      expect(first.ok).toBe(true);

      const second = await authenticateUser({ email: user.email, password: PASSWORD, totp: code });
      expect(second).toEqual({ ok: false, reason: "totp_invalid" });
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("başarılı girişte lastUsedStep ilerliyor", async () => {
    const user = await createUser();

    try {
      const { secret } = await enableTotpFor(user.id);
      const at = Date.now() + 30_000;
      await authenticateUser({ email: user.email, password: PASSWORD, totp: totpCode(secret, at)! });

      const row = await prisma.userTotpSecret.findUniqueOrThrow({ where: { userId: user.id } });
      expect(Number(row.lastUsedStep)).toBe(totpStepForTime(at));
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});

test.describe("Kurtarma kodları — giriş", () => {
  test("kurtarma kodu BİR KEZ çalışıyor, İKİNCİDE reddediliyor", async () => {
    const user = await createUser();

    try {
      const { recoveryCodes } = await enableTotpFor(user.id);
      const [code] = recoveryCodes;

      const first = await authenticateUser({
        email: user.email,
        password: PASSWORD,
        recoveryCode: code,
      });
      expect(first.ok).toBe(true);

      const second = await authenticateUser({
        email: user.email,
        password: PASSWORD,
        recoveryCode: code,
      });
      expect(second).toEqual({ ok: false, reason: "totp_invalid" });
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("kullanılan kod silinmiyor, usedAt ile işaretleniyor", async () => {
    const user = await createUser();

    try {
      const { recoveryCodes } = await enableTotpFor(user.id);
      await authenticateUser({ email: user.email, password: PASSWORD, recoveryCode: recoveryCodes[0] });

      expect(await prisma.userRecoveryCode.count({ where: { userId: user.id } })).toBe(10);
      expect(await countUnusedRecoveryCodes(user.id)).toBe(9);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("küçük harf ve tiresiz yazım kabul ediliyor", async () => {
    // Kullanıcı bu kodu elle yazar; biçim katılığı doğru kodu reddetmeye yol açardı.
    const user = await createUser();

    try {
      const { recoveryCodes } = await enableTotpFor(user.id);
      const messy = recoveryCodes[0].replace("-", "").toLowerCase();

      const result = await authenticateUser({
        email: user.email,
        password: PASSWORD,
        recoveryCode: messy,
      });
      expect(result.ok).toBe(true);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("BAŞKA kullanıcının kurtarma kodu çalışmıyor", async () => {
    const alice = await createUser();
    const bob = await createUser();

    try {
      await enableTotpFor(alice.id);
      const { recoveryCodes } = await enableTotpFor(bob.id);

      const result = await authenticateUser({
        email: alice.email,
        password: PASSWORD,
        recoveryCode: recoveryCodes[0],
      });
      expect(result).toEqual({ ok: false, reason: "totp_invalid" });

      // Bob'un kodu TÜKETİLMEDİ: yanlış sahiple denenen kod işaretlenmemeli.
      expect(await countUnusedRecoveryCodes(bob.id)).toBe(10);
    } finally {
      await prisma.user.delete({ where: { id: alice.id } });
      await prisma.user.delete({ where: { id: bob.id } });
    }
  });
});

test.describe("2FA kapatma", () => {
  test("doğru şifreyle kapanıyor; sır ve kurtarma kodları siliniyor", async () => {
    const user = await createUser();

    try {
      await enableTotpFor(user.id);
      const result = await disableTotp(user.id, PASSWORD);

      expect(result.ok).toBe(true);
      expect(await isTotpEnabled(user.id)).toBe(false);
      expect(await prisma.userTotpSecret.count({ where: { userId: user.id } })).toBe(0);
      // Kodlar da silinmeli: 2FA yeniden açıldığında eski kodların geçerli kalması,
      // kullanıcının artık sakladığını sanmadığı kodları çalışır bırakırdı.
      expect(await prisma.userRecoveryCode.count({ where: { userId: user.id } })).toBe(0);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("YANLIŞ şifreyle kapanmıyor (403) ve 2FA AKTİF kalıyor", async () => {
    // Çalınmış bir cookie ile 2FA'yı kapatmak mümkün olsaydı, ikinci faktör anlamsızlaşırdı.
    const user = await createUser();

    try {
      await enableTotpFor(user.id);
      const result = await disableTotp(user.id, "WrongPassword!");

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(403);
      expect(await isTotpEnabled(user.id)).toBe(true);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("şifre eksikse 400", async () => {
    const user = await createUser();

    try {
      await enableTotpFor(user.id);
      const result = await disableTotp(user.id, undefined);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(await isTotpEnabled(user.id)).toBe(true);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("kapatıldıktan sonra kodsuz giriş yeniden çalışıyor", async () => {
    const user = await createUser();

    try {
      await enableTotpFor(user.id);
      await disableTotp(user.id, PASSWORD);

      const result = await authenticateUser({ email: user.email, password: PASSWORD });
      expect(result.ok).toBe(true);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});

test.describe("Audit", () => {
  test("AUTH_TOTP_ENABLED yazılıyor", async () => {
    const user = await createUser();

    try {
      await enableTotpFor(user.id);
      const rows = await prisma.auditLog.findMany({
        where: { actorUserId: user.id, action: "AUTH_TOTP_ENABLED" },
      });

      expect(rows).toHaveLength(1);
      expect(rows[0].targetType).toBe("USER");
      expect(rows[0].targetId).toBe(user.id);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("AUTH_TOTP_DISABLED yazılıyor", async () => {
    const user = await createUser();

    try {
      await enableTotpFor(user.id);
      await disableTotp(user.id, PASSWORD);

      const rows = await prisma.auditLog.findMany({
        where: { actorUserId: user.id, action: "AUTH_TOTP_DISABLED" },
      });
      expect(rows).toHaveLength(1);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("başarısız kod denemesi AUTH_TOTP_FAILURE yazıyor ve AKTÖRÜ biliyor", async () => {
    // AUTH_LOGIN_FAILURE'ın aksine aktör burada kaydedilir: bu noktaya yalnızca ŞİFRESİ
    // DOĞRU bir istekle gelinir, dolayısıyla kayıt bir enumeration sinyali taşımaz.
    const user = await createUser();

    try {
      await enableTotpFor(user.id);
      await authenticateUser({ email: user.email, password: PASSWORD, totp: "000000" });

      const rows = await prisma.auditLog.findMany({
        where: { actorUserId: user.id, action: "AUTH_TOTP_FAILURE" },
      });
      expect(rows.length).toBeGreaterThanOrEqual(1);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("kodsuz ilk deneme FAILURE YAZMIYOR (akışın adımı, saldırı değil)", async () => {
    // Aksi halde her normal giriş bir "failure" üretir ve gerçek saldırı sinyali gürültüye
    // boğulurdu.
    const user = await createUser();

    try {
      await enableTotpFor(user.id);
      await authenticateUser({ email: user.email, password: PASSWORD });

      expect(
        await prisma.auditLog.count({
          where: { actorUserId: user.id, action: "AUTH_TOTP_FAILURE" },
        }),
      ).toBe(0);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("başarısız 2FA denemesi AUTH_LOGIN_SUCCESS YAZMIYOR", async () => {
    // "Login success" bir oturumun verildiği anlamına gelir. Şifresi doğru ama kodu yanlış
    // bir denemeyi başarı saymak, audit log'u hiç var olmamış bir oturum hakkında yanıltırdı.
    const user = await createUser();

    try {
      await enableTotpFor(user.id);
      await authenticateUser({ email: user.email, password: PASSWORD, totp: "000000" });

      expect(
        await prisma.auditLog.count({
          where: { actorUserId: user.id, action: "AUTH_LOGIN_SUCCESS" },
        }),
      ).toBe(0);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
