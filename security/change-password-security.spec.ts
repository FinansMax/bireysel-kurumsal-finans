import { randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import { getSetCookieValues, signInWithCredentials } from "../e2e/support/auth";
import { uniqueTestClientIp } from "../e2e/support/rate-limit";

/**
 * Issue #33 — authenticated password change, gerçek HTTP akışı üzerinden.
 *
 * Bu dosya mock/backdoor KULLANMAZ: oturumlar gerçek sign-in akışıyla (Auth.js CSRF +
 * credentials callback) kurulur, şifre gerçek endpoint üzerinden değiştirilir ve sonuç yine
 * gerçek endpoint'lerle (`/api/auth/me`, sign-in) doğrulanır.
 */

const ORIGINAL_PASSWORD = "S3curePassw0rd!";
const NEW_PASSWORD = "N3wSecurePassw0rd!";

test.afterAll(async () => {
  await prisma.$disconnect();
});

function signUp(request: APIRequestContext, email: string, password: string) {
  return request.post("/api/auth/signup", {
    data: { email, password },
    headers: { "x-forwarded-for": uniqueTestClientIp() },
  });
}

async function signInAndGetCookie(request: APIRequestContext, email: string, password: string) {
  const response = await signInWithCredentials(request, email, password);
  const cookie = getSetCookieValues(response)
    .find((value) => value.startsWith("authjs.session-token="))
    ?.split(";")[0];
  if (!cookie) throw new Error("sign-in response'unda session cookie yok");
  return cookie;
}

function changePasswordRequest(
  request: APIRequestContext,
  cookie: string | null,
  body: Record<string, unknown>,
) {
  return request.post("/api/auth/change-password", {
    headers: {
      "x-forwarded-for": uniqueTestClientIp(),
      ...(cookie ? { cookie } : {}),
    },
    data: body,
  });
}

/**
 * JWT `iat` Unix SANİYE hassasiyetindedir ve `isSessionRevoked()` bilinçli olarak "token'ın
 * `iat` saniyesinin tamamı hâlâ geçerlidir" kuralını uygular (bkz. README "Session Revocation"
 * → Precision). Bir sign-in ile ondan sonra gelen şifre değişikliğinin FARKLI saniyelere
 * düşmesini garanti etmek, bu invariant'ın kendi granülaritesinin gereğidir — UI flakiness
 * workaround'ı değildir (bu dosya `page` fixture'ını hiç kullanmaz). Aynı yardımcı
 * `security/session-revocation-security.spec.ts` içinde de aynı gerekçeyle kullanılır.
 */
function waitForNextIatSecond(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1100));
}

async function createUser(request: APIRequestContext) {
  const email = `change-pw-sec-${randomUUID()}@example.com`;
  expect((await signUp(request, email, ORIGINAL_PASSWORD)).status()).toBe(201);
  return email;
}

async function createSignedInUser(request: APIRequestContext) {
  const email = await createUser(request);
  const cookie = await signInAndGetCookie(request, email, ORIGINAL_PASSWORD);
  return { email, cookie };
}

/**
 * Auth.js credentials callback'i BAŞARISIZ girişte de 302 döner; başarı/başarısızlık ayrımı
 * status kodunda değil, `location` header'ındaki `error=CredentialsSignin` parametresindedir
 * (mevcut `security/signin-signout-security.spec.ts` ve `session-revocation-security.spec.ts`
 * ile aynı yöntem). Status koduna bakmak, başarısız bir girişi yanlışlıkla "başarılı" saymaya
 * yol açar — bu yardımcılar tam olarak o hatayı önlemek için var.
 */
async function expectSignInToFail(request: APIRequestContext, email: string, password: string) {
  const response = await signInWithCredentials(request, email, password);
  expect(response.headers()["location"]).toContain("error=CredentialsSignin");
}

async function expectSignInToSucceed(request: APIRequestContext, email: string, password: string) {
  const response = await signInWithCredentials(request, email, password);
  expect(response.status()).toBe(302);
  expect(response.headers()["location"] ?? "").not.toContain("error=");
}

function cleanup(email: string) {
  return prisma.user.deleteMany({ where: { email } });
}

test.describe("POST /api/auth/change-password — authentication zorunluluğu", () => {
  // NOT: Bu blokta kasıtlı olarak `createSignedInUser()` KULLANILMAZ. Playwright'ın `request`
  // fixture'ı bir cookie jar tutar; testin başında bir sign-in yapmak, sonraki isteklere
  // otomatik olarak geçerli bir session cookie'si iliştirir ve "session olmadan" senaryosunu
  // sessizce authenticated bir isteğe dönüştürürdü.
  test("session olmadan 401 döner ve hiçbir şifre değişmez", async ({ request }) => {
    const email = await createUser(request);
    try {
      const response = await changePasswordRequest(request, null, {
        currentPassword: ORIGINAL_PASSWORD,
        newPassword: NEW_PASSWORD,
      });
      expect(response.status()).toBe(401);

      // Kontrol grubu: kullanıcı hâlâ ESKİ şifresiyle giriş yapabiliyor olmalı — yani 401'in
      // sebebi "istek zaten geçersizdi" değil, gerçekten kimlik doğrulamasının yapılmamasıdır.
      await expectSignInToSucceed(request, email, ORIGINAL_PASSWORD);
    } finally {
      await cleanup(email);
    }
  });

  test("geçersiz/uydurma session cookie'siyle 401 döner", async ({ request }) => {
    const email = await createUser(request);
    try {
      const response = await changePasswordRequest(
        request,
        "authjs.session-token=uydurma-token-degeri",
        { currentPassword: ORIGINAL_PASSWORD, newPassword: NEW_PASSWORD },
      );
      expect(response.status()).toBe(401);
    } finally {
      await cleanup(email);
    }
  });
});

test.describe("POST /api/auth/change-password — mevcut şifre kanıtı", () => {
  test("geçerli session + YANLIŞ mevcut şifre 401 döner ve şifre değişmez", async ({ request }) => {
    const { email, cookie } = await createSignedInUser(request);
    try {
      const response = await changePasswordRequest(request, cookie, {
        currentPassword: "WrongCurrentPassw0rd!",
        newPassword: NEW_PASSWORD,
      });
      expect(response.status()).toBe(401);

      // Bu, endpoint'in var oluş sebebidir: çalınmış bir session cookie'si TEK BAŞINA hesabı
      // devralmaya yetmemeli. Yeni şifre çalışmamalı, eski şifre hâlâ çalışmalı.
      await expectSignInToFail(request, email, NEW_PASSWORD);
      await expectSignInToSucceed(request, email, ORIGINAL_PASSWORD);
    } finally {
      await cleanup(email);
    }
  });

  test("hata yanıtı iç durum sızdırmaz", async ({ request }) => {
    const { email, cookie } = await createSignedInUser(request);
    try {
      const response = await changePasswordRequest(request, cookie, {
        currentPassword: "WrongCurrentPassw0rd!",
        newPassword: NEW_PASSWORD,
      });

      // Sabit, genel bir mesaj; hash/kullanıcı/stack trace bilgisi yok.
      expect(await response.json()).toEqual({ error: "Current password is incorrect" });
    } finally {
      await cleanup(email);
    }
  });

  test("zayıf yeni şifre 400 döner ve mevcut şifre korunur", async ({ request }) => {
    const { email, cookie } = await createSignedInUser(request);
    try {
      const response = await changePasswordRequest(request, cookie, {
        currentPassword: ORIGINAL_PASSWORD,
        newPassword: "short",
      });
      expect(response.status()).toBe(400);

      await expectSignInToSucceed(request, email, ORIGINAL_PASSWORD);
    } finally {
      await cleanup(email);
    }
  });
});

test.describe("POST /api/auth/change-password — başarılı değişiklik ve session revocation", () => {
  test("değişiklik sonrası eski şifre çalışmaz, yeni şifre çalışır", async ({ request }) => {
    const { email, cookie } = await createSignedInUser(request);
    try {
      const response = await changePasswordRequest(request, cookie, {
        currentPassword: ORIGINAL_PASSWORD,
        newPassword: NEW_PASSWORD,
      });
      expect(response.status()).toBe(200);

      await expectSignInToFail(request, email, ORIGINAL_PASSWORD);
      await expectSignInToSucceed(request, email, NEW_PASSWORD);
    } finally {
      await cleanup(email);
    }
  });

  test("değişiklik ÖNCESİ üretilmiş session cookie'si artık kabul edilmez (Issue #26)", async ({
    request,
  }) => {
    const { email, cookie } = await createSignedInUser(request);
    try {
      // Kontrol grubu: cookie şu an GERÇEKTEN geçerli — aşağıdaki 401'in sebebinin
      // "cookie zaten baştan geçersizdi" olmadığını kanıtlar.
      const before = await request.get("/api/auth/me", { headers: { cookie } });
      expect(before.status()).toBe(200);

      await waitForNextIatSecond();

      const response = await changePasswordRequest(request, cookie, {
        currentPassword: ORIGINAL_PASSWORD,
        newPassword: NEW_PASSWORD,
      });
      expect(response.status()).toBe(200);

      // Şifreyi değiştiren kullanıcının KENDİ oturumu da düşer: stateless JWT mimarisinde
      // "bu isteği yapan token" ayrıcalıklı kılınamaz (bkz. README "Session Revocation").
      const after = await request.get("/api/auth/me", { headers: { cookie } });
      expect(after.status()).toBe(401);
    } finally {
      await cleanup(email);
    }
  });

  test("başka bir kullanıcının oturumu etkilenmez", async ({ request }) => {
    const victim = await createSignedInUser(request);
    const bystander = await createSignedInUser(request);
    try {
      await waitForNextIatSecond();

      const response = await changePasswordRequest(request, victim.cookie, {
        currentPassword: ORIGINAL_PASSWORD,
        newPassword: NEW_PASSWORD,
      });
      expect(response.status()).toBe(200);

      const bystanderSession = await request.get("/api/auth/me", {
        headers: { cookie: bystander.cookie },
      });
      expect(bystanderSession.status()).toBe(200);
    } finally {
      await cleanup(victim.email);
      await cleanup(bystander.email);
    }
  });

  test("bir kullanıcı body'ye başka bir userId koyarak onun şifresini değiştiremez", async ({
    request,
  }) => {
    const attacker = await createSignedInUser(request);
    const victim = await createSignedInUser(request);
    try {
      const victimUser = await prisma.user.findUnique({
        where: { email: victim.email },
        select: { id: true },
      });

      const response = await changePasswordRequest(request, attacker.cookie, {
        userId: victimUser!.id,
        email: victim.email,
        currentPassword: ORIGINAL_PASSWORD,
        newPassword: NEW_PASSWORD,
      });
      // Saldırganın KENDİ şifresi değişir (kendi mevcut şifresini doğru verdi); kurbanınki
      // etkilenmez — hedef kullanıcı yalnızca trusted session'dan belirlenir.
      expect(response.status()).toBe(200);

      await expectSignInToSucceed(request, victim.email, ORIGINAL_PASSWORD);
      await expectSignInToFail(request, victim.email, NEW_PASSWORD);
    } finally {
      await cleanup(attacker.email);
      await cleanup(victim.email);
    }
  });
});
