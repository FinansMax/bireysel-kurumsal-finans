import { randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

import { registerUser } from "../src/lib/auth/signup";
import { prisma } from "../src/lib/prisma";
import { totpCode } from "../src/lib/auth/totp";
import {
  beginTotpEnrollment,
  confirmTotpEnrollment,
} from "../src/lib/auth/totp-enrollment";
import { RATE_LIMIT_POLICIES } from "../src/lib/rate-limit/policies";

import { markEmailVerified } from "../e2e/support/email-verification";
import { uniqueTestClientIp } from "../e2e/support/rate-limit";
import { createSessionCookieHeader } from "./support/session";

/**
 * Issue #193 — iki faktörlü doğrulama, SALDIRGAN bakışıyla ve gerçek HTTP üzerinden.
 *
 * Buradaki sorular: ikinci faktör atlatılabiliyor mu, 2FA'nın varlığı sızıyor mu, sır
 * dışarıya çıkıyor mu, brute-force sınırlanıyor mu, başkasının 2FA'sına dokunulabiliyor mu.
 */

const PASSWORD = "S3curePassw0rd!";

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function createVerifiedUser(): Promise<{ id: string; email: string }> {
  const email = `totp-sec-${randomUUID()}@example.com`;
  const signup = await registerUser({ email, password: PASSWORD });
  if (!signup.ok) {
    throw new Error("test kullanicisi olusturulamadi");
  }
  await markEmailVerified(email);
  return { id: signup.user.id, email };
}

async function enableTotp(userId: string): Promise<{ secret: string; recoveryCodes: string[] }> {
  const begun = await beginTotpEnrollment(userId);
  if (!begun.ok) throw new Error("enrollment baslatilamadi");
  const confirmed = await confirmTotpEnrollment(userId, totpCode(begun.secret)!);
  if (!confirmed.ok) throw new Error("enrollment dogrulanamadi");
  return { secret: begun.secret, recoveryCodes: begun.recoveryCodes };
}

type SignInFields = { totp?: string; recoveryCode?: string };

async function signIn(
  request: APIRequestContext,
  email: string,
  password: string,
  extra: SignInFields = {},
  ip: string = uniqueTestClientIp(),
) {
  const csrfResponse = await request.get("/api/auth/csrf");
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };

  return request.post("/api/auth/callback/credentials", {
    form: { email, password, csrfToken, json: "true", ...extra },
    maxRedirects: 0,
    headers: { "x-forwarded-for": ip },
  });
}

/**
 * Auth.js'in credentials callback'i başarısızlıkta 302 döner ve hata kodunu `location`
 * header'ının query'sine koyar (`?error=CredentialsSignin&code=<kod>`) — ölçüldü, gövde
 * BOŞTUR. `X-Auth-Return-Redirect` ile çağrılırsa aynı URL gövdede `{ url }` olarak döner;
 * her iki biçim de okunur ki test istemcinin çağrı şekline bağlı kalmasın.
 */
async function signInOutcome(response: Awaited<ReturnType<typeof signIn>>) {
  const headers = response.headersArray();

  const setCookie = headers
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => header.value)
    .join("; ");

  // Auth.js oturum açmayan yanıtlarda cookie'yi BOŞ değerle de gönderebilir; "cookie var"
  // değil "cookie DOLU" aranır.
  const hasSession = /authjs\.session-token=[^;\s]/.test(setCookie);

  const location = headers.find((header) => header.name.toLowerCase() === "location")?.value;

  let code: string | null = null;
  if (location) {
    code = new URL(location).searchParams.get("code");
  } else {
    try {
      const body = (await response.json()) as { url?: string };
      if (body.url) {
        code = new URL(body.url).searchParams.get("code");
      }
    } catch {
      // Gövde JSON değil; `hasSession` yine de anlamlıdır.
    }
  }

  return { hasSession, code, status: response.status() };
}

test.describe("İkinci faktör ATLATILAMIYOR", () => {
  test("2FA açıkken kodsuz giriş OTURUM AÇMIYOR", async ({ request }) => {
    const user = await createVerifiedUser();

    try {
      await enableTotp(user.id);
      const outcome = await signInOutcome(await signIn(request, user.email, PASSWORD));

      expect(outcome.hasSession, "kodsuz istek oturum cookie'si aldi").toBe(false);
      expect(outcome.code).toBe("totp_required");
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("yanlış kod OTURUM AÇMIYOR", async ({ request }) => {
    const user = await createVerifiedUser();

    try {
      await enableTotp(user.id);
      const outcome = await signInOutcome(
        await signIn(request, user.email, PASSWORD, { totp: "000000" }),
      );

      expect(outcome.hasSession).toBe(false);
      expect(outcome.code).toBe("totp_invalid");
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("KONTROL GRUBU: doğru kod OTURUM AÇIYOR", async ({ request }) => {
    // Duyarlılık kanıtı: yukarıdaki iki test, giriş akışı tamamen bozuk olsaydı da geçerdi.
    const user = await createVerifiedUser();

    try {
      const { secret } = await enableTotp(user.id);
      const outcome = await signInOutcome(
        await signIn(request, user.email, PASSWORD, { totp: totpCode(secret, Date.now() + 30_000)! }),
      );

      expect(outcome.hasSession, "dogru kodla oturum acilmadi").toBe(true);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("boş string kod ikinci faktörü ATLAMIYOR", async ({ request }) => {
    // `totp=""` gönderip "alan var, geçir" davranışına düşülmemeli.
    const user = await createVerifiedUser();

    try {
      await enableTotp(user.id);
      const outcome = await signInOutcome(
        await signIn(request, user.email, PASSWORD, { totp: "   " }),
      );

      expect(outcome.hasSession).toBe(false);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("BAŞKA kullanıcının geçerli kodu işe yaramıyor", async ({ request }) => {
    const alice = await createVerifiedUser();
    const bob = await createVerifiedUser();

    try {
      await enableTotp(alice.id);
      const bobSecret = await enableTotp(bob.id);

      const outcome = await signInOutcome(
        await signIn(request, alice.email, PASSWORD, {
          totp: totpCode(bobSecret.secret, Date.now() + 30_000)!,
        }),
      );

      expect(outcome.hasSession).toBe(false);
    } finally {
      await prisma.user.delete({ where: { id: alice.id } });
      await prisma.user.delete({ where: { id: bob.id } });
    }
  });
});

test.describe("2FA'nın VARLIĞI sızmıyor", () => {
  test("yanlış şifre, 2FA açık kullanıcıda da 'credentials' kodu veriyor", async ({ request }) => {
    // KRİTİK: `totp_required` yalnızca ŞİFRESİ DOĞRU isteklere döner. Aksi halde bu uç, bir
    // hesabın 2FA kullanıp kullanmadığını şifresiz öğrenmenin yolu olurdu.
    const withTotp = await createVerifiedUser();
    const withoutTotp = await createVerifiedUser();

    try {
      await enableTotp(withTotp.id);

      const a = await signInOutcome(await signIn(request, withTotp.email, "WrongPassword!"));
      const b = await signInOutcome(await signIn(request, withoutTotp.email, "WrongPassword!"));

      expect(a.code).toBe("credentials");
      expect(a.code, "2FA'li ve 2FA'siz hesap yanlis sifrede AYRISIYOR").toBe(b.code);
      expect(a.status).toBe(b.status);
    } finally {
      await prisma.user.delete({ where: { id: withTotp.id } });
      await prisma.user.delete({ where: { id: withoutTotp.id } });
    }
  });

  test("bilinmeyen e-posta da aynı 'credentials' kodunu veriyor", async ({ request }) => {
    const outcome = await signInOutcome(
      await signIn(request, `unknown-${randomUUID()}@example.com`, "WhateverPassword!"),
    );

    expect(outcome.code).toBe("credentials");
    expect(outcome.hasSession).toBe(false);
  });
});

test.describe("Sır dışarıya SIZMIYOR", () => {
  test("kurulum yanıtı dışında sır hiçbir yerde dönmüyor", async ({ request }) => {
    const user = await createVerifiedUser();

    try {
      const { secret } = await enableTotp(user.id);
      const cookie = await createSessionCookieHeader({ sub: user.id, email: user.email });

      for (const path of ["/api/users/me", "/api/auth/me"]) {
        const response = await request.get(path, { headers: { cookie } });
        const text = await response.text();

        expect(text, `${path} sirri sizdiriyor`).not.toContain(secret);
        expect(text.toLowerCase(), `${path} totp alani donuyor`).not.toContain("secretcipher");
      }
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("kurulum endpoint'i KİMLİKSİZ çağrılamıyor", async ({ request }) => {
    const response = await request.post("/api/auth/totp/setup", {
      headers: { "x-forwarded-for": uniqueTestClientIp() },
    });

    expect(response.status()).toBe(401);
    expect(await response.text()).not.toContain("secret");
  });

  test("confirm ve disable de KİMLİKSİZ çağrılamıyor", async ({ request }) => {
    for (const path of ["/api/auth/totp/confirm", "/api/auth/totp/disable"]) {
      const response = await request.post(path, {
        data: { code: "123456", password: PASSWORD },
        headers: { "x-forwarded-for": uniqueTestClientIp() },
      });

      expect(response.status(), path).toBe(401);
    }
  });

  test("kurulum uçları GET kabul ETMİYOR (invariant #4)", async ({ request }) => {
    // Her çağrı yeni sır üretir ve kurtarma kodlarını değiştirir; GET olsaydı bir `<img>`
    // etiketi kullanıcının kodlarını sessizce geçersiz kılabilirdi.
    const user = await createVerifiedUser();

    try {
      const cookie = await createSessionCookieHeader({ sub: user.id, email: user.email });

      for (const path of ["/api/auth/totp/setup", "/api/auth/totp/confirm", "/api/auth/totp/disable"]) {
        const response = await request.get(path, { headers: { cookie } });
        expect(response.status(), path).toBe(405);
      }
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});

test.describe("Başkasının 2FA'sına dokunulamıyor", () => {
  test("kurulum YALNIZCA oturumun sahibi için çalışıyor (gövdedeki userId yok sayılır)", async ({
    request,
  }) => {
    // Invariant #2: trusted kimlik yalnızca session'dan gelir.
    const alice = await createVerifiedUser();
    const bob = await createVerifiedUser();

    try {
      const cookie = await createSessionCookieHeader({ sub: alice.id, email: alice.email });

      const response = await request.post("/api/auth/totp/setup", {
        headers: { cookie, "x-forwarded-for": uniqueTestClientIp() },
        data: { userId: bob.id, email: bob.email },
      });

      expect(response.status()).toBe(200);

      // Kurulum ALICE'e yazıldı, Bob'a DEĞİL.
      expect(await prisma.userTotpSecret.count({ where: { userId: alice.id } })).toBe(1);
      expect(await prisma.userTotpSecret.count({ where: { userId: bob.id } })).toBe(0);
    } finally {
      await prisma.user.delete({ where: { id: alice.id } });
      await prisma.user.delete({ where: { id: bob.id } });
    }
  });

  test("kapatma MEVCUT ŞİFREYİ istiyor — çalınmış cookie tek başına yetmiyor", async ({
    request,
  }) => {
    // 2FA çalınmış bir session'a karşı korur; kapatma ucu yalnızca cookie ile çalışsaydı
    // ikinci faktör kendi kapatma ucundan aşılabilirdi.
    const user = await createVerifiedUser();

    try {
      await enableTotp(user.id);
      const cookie = await createSessionCookieHeader({ sub: user.id, email: user.email });

      const response = await request.post("/api/auth/totp/disable", {
        headers: { cookie, "x-forwarded-for": uniqueTestClientIp() },
        data: { password: "WrongPassword!" },
      });

      expect(response.status()).toBe(403);
      expect(await prisma.userTotpSecret.count({ where: { userId: user.id, confirmedAt: { not: null } } })).toBe(1);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});

test.describe("Brute-force sınırlanıyor", () => {
  test(`ikinci faktör denemeleri ${RATE_LIMIT_POLICIES.TOTP.limit} sonrası 429 alıyor`, async ({
    request,
  }) => {
    // 6 haneli bir kod, ±1 pencere yüzünden her an üç geçerli değere sahiptir. Bu, sınırlama
    // olmadan brute-force'un gerçekten uygulanabilir olduğu nadir yerlerden biridir.
    const user = await createVerifiedUser();
    const ip = uniqueTestClientIp();

    try {
      await enableTotp(user.id);

      const statuses: number[] = [];
      for (let attempt = 0; attempt < RATE_LIMIT_POLICIES.TOTP.limit + 2; attempt += 1) {
        const response = await signIn(request, user.email, PASSWORD, { totp: "000000" }, ip);
        statuses.push(response.status());
      }

      expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("KONTROL GRUBU: kodsuz giriş TOTP sayacını tüketmiyor", async ({ request }) => {
    // Duyarlılık: TOTP limiti her isteğe uygulansaydı, kod göndermeyen normal bir giriş
    // denemesi de sayacı tüketir ve yukarıdaki test sebebini kaybederdi.
    const user = await createVerifiedUser();
    const ip = uniqueTestClientIp();

    try {
      await enableTotp(user.id);

      for (let attempt = 0; attempt < RATE_LIMIT_POLICIES.TOTP.limit + 2; attempt += 1) {
        const response = await signIn(request, user.email, PASSWORD, {}, ip);
        expect(response.status(), "kodsuz istek TOTP limitine takildi").not.toBe(429);
      }
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
