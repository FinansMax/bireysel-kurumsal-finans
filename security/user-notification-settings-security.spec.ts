import { randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import { getSetCookieValues, signInWithCredentials } from "../e2e/support/auth";
import { uniqueTestClientIp } from "../e2e/support/rate-limit";

/**
 * Issue #88 — kullanıcı bildirim tercihi endpoint'i, gerçek HTTP akışı üzerinden.
 *
 * `security/user-profile-security.spec.ts` İLE AYNI DURUŞ (aynı endpoint ailesi, `/api/users/me`):
 * asıl derdi "tercih güncelleniyor mu" DEĞİL (o `integration/user-notification-settings.spec.ts`'te),
 * burada test edilen şey: kimlik doğrulaması olmadan erişilemediği ve bir kullanıcının
 * isteğinin BAŞKA bir kullanıcıyı etkilemediğidir.
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
  const email = `notif-sec-${randomUUID()}@example.com`;
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

test.describe("/api/users/me/settings — authentication zorunluluğu", () => {
  // NOT: `user-profile-security.spec.ts` ile aynı gerekçe — sign-in bilerek burada YAPILMAZ.
  test("GET session olmadan 401 döner", async ({ request }) => {
    const email = await createUser(request);
    try {
      const response = await request.get("/api/users/me/settings");
      expect(response.status()).toBe(401);
    } finally {
      await cleanup(email);
    }
  });

  test("PATCH session olmadan 401 döner ve tercih değişmez", async ({ request }) => {
    const email = await createUser(request);
    try {
      const response = await request.patch("/api/users/me/settings", {
        data: { notificationsEnabled: false },
      });
      expect(response.status()).toBe(401);

      const user = await prisma.user.findUnique({
        where: { email },
        select: { notificationsEnabled: true },
      });
      expect(user?.notificationsEnabled).toBe(true);
    } finally {
      await cleanup(email);
    }
  });
});

test.describe("/api/users/me/settings — yazma sınırları ve izolasyon", () => {
  test("kullanıcı yalnızca KENDİ tercihini günceller, başkasını ETKİLEMEZ", async ({
    request,
  }) => {
    const actor = await createSignedInUser(request);
    const bystander = await createSignedInUser(request);
    try {
      const response = await request.patch("/api/users/me/settings", {
        headers: { cookie: actor.cookie },
        data: { notificationsEnabled: false },
      });
      expect(response.status()).toBe(200);

      const { settings } = (await response.json()) as {
        settings: { notificationsEnabled: boolean };
      };
      expect(settings.notificationsEnabled).toBe(false);

      const other = await prisma.user.findUnique({
        where: { email: bystander.email },
        select: { notificationsEnabled: true },
      });
      expect(other?.notificationsEnabled).toBe(true);
    } finally {
      await cleanup(actor.email);
      await cleanup(bystander.email);
    }
  });

  test("body'deki ekstra alanlar (id, email) YOK SAYILIR", async ({ request }) => {
    const { email, cookie } = await createSignedInUser(request);
    const victim = await createSignedInUser(request);
    try {
      const response = await request.patch("/api/users/me/settings", {
        headers: { cookie },
        data: { notificationsEnabled: false, email: victim.email, id: "sahte-id" },
      });
      expect(response.status()).toBe(200);

      const self = await prisma.user.findUnique({
        where: { email },
        select: { email: true, notificationsEnabled: true },
      });
      expect(self?.email).toBe(email);
      expect(self?.notificationsEnabled).toBe(false);

      const other = await prisma.user.findUnique({ where: { email: victim.email } });
      expect(other?.notificationsEnabled).toBe(true);
    } finally {
      await cleanup(email);
      await cleanup(victim.email);
    }
  });

  test("geçersiz değer 400 döner ve tercih değişmez", async ({ request }) => {
    const { email, cookie } = await createSignedInUser(request);
    try {
      const response = await request.patch("/api/users/me/settings", {
        headers: { cookie },
        data: { notificationsEnabled: "yes" },
      });
      expect(response.status()).toBe(400);

      const user = await prisma.user.findUnique({
        where: { email },
        select: { notificationsEnabled: true },
      });
      expect(user?.notificationsEnabled).toBe(true);
    } finally {
      await cleanup(email);
    }
  });

  test("bozuk JSON gövdesi 400 döner", async ({ request }) => {
    const { email, cookie } = await createSignedInUser(request);
    try {
      const response = await request.patch("/api/users/me/settings", {
        headers: { cookie, "content-type": "application/json" },
        data: "{bozuk-json",
      });
      expect(response.status()).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid request body" });
    } finally {
      await cleanup(email);
    }
  });
});

test.describe("/api/users/me/settings — GET yan etkisizdir", () => {
  test("GET satırı DEĞİŞTİRMEZ", async ({ request }) => {
    const { email, cookie } = await createSignedInUser(request);
    try {
      const before = await request.get("/api/users/me/settings", { headers: { cookie } });
      expect(before.status()).toBe(200);

      const user = await prisma.user.findUnique({
        where: { email },
        select: { notificationsEnabled: true },
      });
      expect(user?.notificationsEnabled).toBe(true);
    } finally {
      await cleanup(email);
    }
  });
});
