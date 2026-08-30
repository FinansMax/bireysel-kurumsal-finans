import { randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import { getSetCookieValues, signInWithCredentials } from "../e2e/support/auth";
import { uniqueTestClientIp } from "../e2e/support/rate-limit";

/**
 * Issue #31 — kullanıcı profili endpoint'i, gerçek HTTP akışı üzerinden.
 *
 * Bu dosyanın asıl derdi "name güncelleniyor mu" DEĞİL (o `integration/user-profile.spec.ts`'te);
 * burada test edilen şey: kimlik doğrulaması olmadan erişilemediği, yanıtın hassas alan
 * sızdırmadığı ve body'ye konan ekstra alanların (email/id/passwordHash) hiçbir etkisinin
 * olmadığıdır.
 */

const PASSWORD = "S3curePassw0rd!";

test.afterAll(async () => {
  await prisma.$disconnect();
});

function signUp(request: APIRequestContext, email: string, password: string) {
  return request.post("/api/auth/signup", {
    data: { email, password },
    headers: { "x-forwarded-for": uniqueTestClientIp() },
  });
}

async function createUser(request: APIRequestContext) {
  const email = `profile-sec-${randomUUID()}@example.com`;
  expect((await signUp(request, email, PASSWORD)).status()).toBe(201);
  return email;
}

async function createSignedInUser(request: APIRequestContext) {
  const email = await createUser(request);
  const response = await signInWithCredentials(request, email, PASSWORD);
  const cookie = getSetCookieValues(response)
    .find((value) => value.startsWith("authjs.session-token="))
    ?.split(";")[0];
  if (!cookie) throw new Error("sign-in response'unda session cookie yok");
  return { email, cookie };
}

function cleanup(email: string) {
  return prisma.user.deleteMany({ where: { email } });
}

test.describe("/api/users/me — authentication zorunluluğu", () => {
  // NOT: Bu blokta kasıtlı olarak sign-in YAPILMAZ. Playwright'ın `request` fixture'ı bir
  // cookie jar tutar; testin başında bir sign-in yapmak sonraki isteklere otomatik olarak
  // geçerli bir session cookie'si iliştirir ve "session olmadan" senaryosunu sessizce
  // authenticated bir isteğe dönüştürürdü.
  test("GET session olmadan 401 döner", async ({ request }) => {
    const email = await createUser(request);
    try {
      const response = await request.get("/api/users/me");
      expect(response.status()).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    } finally {
      await cleanup(email);
    }
  });

  test("PATCH session olmadan 401 döner ve profil değişmez", async ({ request }) => {
    const email = await createUser(request);
    try {
      const response = await request.patch("/api/users/me", { data: { name: "Saldirgan" } });
      expect(response.status()).toBe(401);

      const user = await prisma.user.findUnique({ where: { email }, select: { name: true } });
      expect(user?.name).toBeNull();
    } finally {
      await cleanup(email);
    }
  });

  test("geçersiz/uydurma session cookie'siyle 401 döner", async ({ request }) => {
    const email = await createUser(request);
    try {
      const response = await request.get("/api/users/me", {
        headers: { cookie: "authjs.session-token=uydurma-token-degeri" },
      });
      expect(response.status()).toBe(401);
    } finally {
      await cleanup(email);
    }
  });
});

test.describe("/api/users/me — yanıt içeriği", () => {
  test("yanıtta passwordHash ve diğer hassas alanlar YOK", async ({ request }) => {
    const { email, cookie } = await createSignedInUser(request);
    try {
      const response = await request.get("/api/users/me", { headers: { cookie } });
      expect(response.status()).toBe(200);

      const body = (await response.json()) as { user: Record<string, unknown> };
      expect(Object.keys(body.user).sort()).toEqual(["createdAt", "email", "id", "name"]);

      // Ham gövde üzerinde de kontrol: alan adı gömülü bir yapıda geçiyor olsaydı yukarıdaki
      // anahtar karşılaştırması bunu kaçırabilirdi.
      const rawBody = await response.text();
      for (const forbidden of ["passwordHash", "credentialsChangedAt", "emailVerified"]) {
        expect(rawBody).not.toContain(forbidden);
      }
    } finally {
      await cleanup(email);
    }
  });

  test("kullanıcı yalnızca KENDİ profilini görür", async ({ request }) => {
    const other = await createSignedInUser(request);
    const self = await createSignedInUser(request);
    try {
      const response = await request.get("/api/users/me", { headers: { cookie: self.cookie } });
      const body = (await response.json()) as { user: { email: string } };

      expect(body.user.email).toBe(self.email);
      expect(body.user.email).not.toBe(other.email);
    } finally {
      await cleanup(self.email);
      await cleanup(other.email);
    }
  });
});

test.describe("/api/users/me — PATCH yazma sınırları", () => {
  test("body'deki ekstra alanlar (email, id, passwordHash) YOK SAYILIR", async ({ request }) => {
    const { email, cookie } = await createSignedInUser(request);
    const victim = await createSignedInUser(request);
    try {
      const before = await prisma.user.findUnique({
        where: { email },
        select: { id: true, passwordHash: true },
      });

      const response = await request.patch("/api/users/me", {
        headers: { cookie },
        data: {
          name: "Mesru Ad",
          email: victim.email,
          id: "sahte-id",
          passwordHash: "sahte-hash",
          credentialsChangedAt: new Date().toISOString(),
          emailVerified: new Date().toISOString(),
        },
      });
      expect(response.status()).toBe(200);

      const after = await prisma.user.findUnique({
        where: { id: before!.id },
        select: {
          id: true,
          email: true,
          name: true,
          passwordHash: true,
          credentialsChangedAt: true,
          emailVerified: true,
        },
      });

      // Sadece `name` değişmiş olmalı; diğer her şey aynı kalmalı.
      expect(after?.name).toBe("Mesru Ad");
      expect(after?.email).toBe(email);
      expect(after?.id).toBe(before!.id);
      expect(after?.passwordHash).toBe(before!.passwordHash);
      expect(after?.credentialsChangedAt).toBeNull();
      expect(after?.emailVerified).toBeNull();
    } finally {
      await cleanup(email);
      await cleanup(victim.email);
    }
  });

  test("başka bir kullanıcının profili etkilenmez", async ({ request }) => {
    const actor = await createSignedInUser(request);
    const bystander = await createSignedInUser(request);
    try {
      const response = await request.patch("/api/users/me", {
        headers: { cookie: actor.cookie },
        data: { name: "Sadece Benim Adim" },
      });
      expect(response.status()).toBe(200);

      const other = await prisma.user.findUnique({
        where: { email: bystander.email },
        select: { name: true },
      });
      expect(other?.name).toBeNull();
    } finally {
      await cleanup(actor.email);
      await cleanup(bystander.email);
    }
  });

  test("geçersiz name 400 döner ve profil değişmez", async ({ request }) => {
    const { email, cookie } = await createSignedInUser(request);
    try {
      const response = await request.patch("/api/users/me", {
        headers: { cookie },
        data: { name: "a" },
      });
      expect(response.status()).toBe(400);

      const user = await prisma.user.findUnique({ where: { email }, select: { name: true } });
      expect(user?.name).toBeNull();
    } finally {
      await cleanup(email);
    }
  });

  test("bozuk JSON gövdesi 400 döner", async ({ request }) => {
    const { email, cookie } = await createSignedInUser(request);
    try {
      const response = await request.patch("/api/users/me", {
        headers: { cookie, "content-type": "application/json" },
        data: "{bozuk-json",
      });
      expect(response.status()).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid request body" });
    } finally {
      await cleanup(email);
    }
  });

  test("şifre değişmediği için oturum geçerli kalır (credentialsChangedAt bumplanmaz)", async ({
    request,
  }) => {
    const { email, cookie } = await createSignedInUser(request);
    try {
      const patch = await request.patch("/api/users/me", {
        headers: { cookie },
        data: { name: "Guncel Ad" },
      });
      expect(patch.status()).toBe(200);

      // Profil güncellemesi bir credential değişikliği DEĞİLDİR; session revocation (#26)
      // tetiklenmemeli, kullanıcı oturumundan düşmemelidir.
      const after = await request.get("/api/users/me", { headers: { cookie } });
      expect(after.status()).toBe(200);
    } finally {
      await cleanup(email);
    }
  });
});

/**
 * Profil güncellemesi ile oturumun taşıdığı ad arasındaki senkron (Issue #113).
 *
 * Bu blok, iki endpoint'in AYNI soruya farklı cevap vermediğini uçtan uca kanıtlar:
 * `GET /api/users/me` adı DB'den okur, `GET /api/auth/me` oturumun JWT içeriğinden. #113'ten
 * önce ikincisi bir sonraki girişe kadar bayat kalıyordu ve kullanıcı arayüzde eski adını
 * görmeye devam ediyordu.
 *
 * `jwt` callback'i (`src/lib/auth/config.ts`) session revocation'ın kritik kod yoludur; bu
 * yüzden burada yalnızca "ad tazelendi mi" değil, revocation'ın hâlâ çalıştığı da doğrulanır.
 */
test.describe("/api/auth/me — profil güncellemesiyle senkron (Issue #113)", () => {
  async function authMeName(request: APIRequestContext, cookie: string) {
    const response = await request.get("/api/auth/me", { headers: { cookie } });
    expect(response.status()).toBe(200);
    return ((await response.json()) as { user: { name: string | null } }).user.name;
  }

  async function usersMeName(request: APIRequestContext, cookie: string) {
    const response = await request.get("/api/users/me", { headers: { cookie } });
    expect(response.status()).toBe(200);
    return ((await response.json()) as { user: { name: string | null } }).user.name;
  }

  test("ad güncellendikten sonra YENİDEN GİRİŞ OLMADAN güncel ad dönüyor", async ({ request }) => {
    const { email, cookie } = await createSignedInUser(request);
    try {
      // Kontrol grubu: güncelleme ÖNCESİ ad yok. Bu iddia olmadan aşağıdaki beklenti,
      // "endpoint her zaman bu adı döndürüyor" ihtimalini dışlayamazdı.
      expect(await authMeName(request, cookie)).toBeNull();

      const patched = await request.patch("/api/users/me", {
        data: { name: "Guncellenmis Ad" },
        headers: { cookie },
      });
      expect(patched.status()).toBe(200);

      // AYNI oturum cookie'si ile: yeniden giriş yok.
      expect(await authMeName(request, cookie)).toBe("Guncellenmis Ad");
    } finally {
      await cleanup(email);
    }
  });

  test("iki endpoint AYNI adı döndürüyor (kaynak ayrışmıyor)", async ({ request }) => {
    const { email, cookie } = await createSignedInUser(request);
    try {
      for (const name of ["Birinci Ad", "Ikinci Ad"]) {
        const patched = await request.patch("/api/users/me", {
          data: { name },
          headers: { cookie },
        });
        expect(patched.status()).toBe(200);

        // #113'ün tam olarak tarif ettiği ayrışma: biri DB'den, diğeri JWT'den okuyor.
        expect(await usersMeName(request, cookie)).toBe(name);
        expect(await authMeName(request, cookie)).toBe(name);
      }
    } finally {
      await cleanup(email);
    }
  });

  test("ad tazeleme SESSION REVOCATION'ı baypas etmiyor", async ({ request }) => {
    const { email, cookie } = await createSignedInUser(request);
    try {
      const patched = await request.patch("/api/users/me", {
        data: { name: "Taze Ad" },
        headers: { cookie },
      });
      expect(patched.status()).toBe(200);
      expect(await authMeName(request, cookie)).toBe("Taze Ad");

      // Kritik credential değişikliği: token bundan ÖNCE üretildiği için reddedilmeli.
      // `jwt` callback'i adı revocation kararından SONRA yazdığı için bu yol değişmemiş
      // olmalı — #113'ün tek gerçek riski buydu.
      await prisma.user.update({
        where: { email },
        data: { credentialsChangedAt: new Date(Date.now() + 5_000) },
      });

      const revoked = await request.get("/api/auth/me", { headers: { cookie } });
      expect(revoked.status()).toBe(401);
    } finally {
      await cleanup(email);
    }
  });
});
