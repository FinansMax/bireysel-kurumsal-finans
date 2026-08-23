import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import { getSetCookieValues, signInWithCredentials } from "./support/auth";
import { uniqueTestClientIp } from "./support/rate-limit";

/**
 * CSRF duruşunun GERÇEK TARAYICI ile kanıtı (Issue #28).
 *
 * Bu dosya YENİ bir CSRF token sistemi test ETMEZ — böyle bir sistem bilinçli olarak
 * kurulmamıştır (bkz. README "CSRF Duruşu"). Burada kanıtlanan şey, mevcut korumanın
 * (`SameSite=Lax` + CORS) cross-site state-changing istekleri gerçekten durdurduğudur.
 *
 * Neden `e2e/` altında: bu testin anlamlı olabilmesi için SameSite kuralını UYGULAYAN gerçek
 * bir tarayıcı gerekir. `security/` suite'i bilinçli olarak browser/page fixture'ı kullanmaz
 * (bkz. `playwright.security.config.ts`), bu yüzden tarayıcı gerektiren bu kanıt chromium
 * projesinin bulunduğu e2e suite'ine konur. Aynı senaryonun SUNUCU tarafı (cookie'siz
 * state-changing istek → 401 + hiçbir mutasyon yok) `security/tenant-isolation-boundaries.spec.ts`
 * içindeki "unauthenticated mutation" bloğunda ayrıca kapsanır.
 *
 * Saldırgan sayfası `http://attacker.test/` üzerinden servis edilir (Playwright route ile,
 * DNS'e çıkmadan). 127.0.0.1'e göre FARKLI bir site olduğu için tarayıcı cross-site kurallarını
 * uygular — testin tamamı buna dayanır.
 */

const APP_ORIGIN = "http://127.0.0.1:3000";
const ATTACKER_ORIGIN = "http://attacker.test";

test.afterAll(async () => {
  await prisma.$disconnect();
});

/** Gerçek sign-in akışından alınan session cookie'sini tarayıcıya 127.0.0.1 için yükler. */
async function authenticateBrowser(page: Page, email: string, password: string) {
  const signInResponse = await signInWithCredentials(page.request, email, password);
  const rawCookie = getSetCookieValues(signInResponse).find((cookie) =>
    cookie.startsWith("authjs.session-token="),
  );
  if (!rawCookie) throw new Error("sign-in response'unda session cookie yok");

  const value = rawCookie.split(";")[0].split("=").slice(1).join("=");
  await page.context().addCookies([
    {
      name: "authjs.session-token",
      value,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

async function serveAttackerPage(page: Page, body: string) {
  await page.route(`${ATTACKER_ORIGIN}/**`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body }),
  );
}

async function createUser(page: Page) {
  const email = `e2e-csrf-${randomUUID()}@example.com`;
  const password = "S3curePassw0rd!";
  const response = await page.request.post("/api/auth/signup", {
    data: { email, password },
    headers: { "x-forwarded-for": uniqueTestClientIp() },
  });
  expect(response.status()).toBe(201);
  return { email, password };
}

test.describe("CSRF — SameSite=Lax gerçek tarayıcıda cross-site isteği durduruyor", () => {
  test("KONTROL: aynı-site istek session cookie'sini taşıyor (cookie gerçekten geçerli)", async ({
    page,
  }) => {
    const { email, password } = await createUser(page);

    try {
      await authenticateBrowser(page, email, password);

      // Bu kontrol grubu OLMADAN aşağıdaki testler anlamsız olurdu: 401'in sebebinin
      // "cookie zaten geçersizdi" değil, "tarayıcı cookie'yi cross-site göndermedi" olduğunu
      // ancak aynı-site isteğin 200 dönmesi kanıtlar.
      const response = await page.request.get(`${APP_ORIGIN}/api/auth/me`);
      expect(response.status()).toBe(200);
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  test("cross-site form POST: cookie gönderilmiyor → 401 ve hiçbir tenant oluşmuyor", async ({
    page,
  }) => {
    const { email, password } = await createUser(page);
    const slug = `csrf-attempt-${randomUUID()}`;

    try {
      await authenticateBrowser(page, email, password);

      // Klasik CSRF vektörü: form POST "simple request"tir — CORS preflight TETİKLEMEZ, yani
      // istek sunucuya GERÇEKTEN ulaşır. Onu durduran tek şey, tarayıcının SameSite=Lax
      // nedeniyle session cookie'sini eklememesidir.
      //
      // NOT: Bu POST, session kurulduktan hemen SONRA yapılır — yani Chromium'un
      // "Lax-allowing-unsafe" (Lax+POST) geçici muafiyetinin geçerli olacağı zaman
      // penceresinin içindedir. Cookie yine de gönderilmiyor; bu, muafiyetin yalnızca
      // SameSite ÖZNİTELİĞİ HİÇ OLMAYAN cookie'ler için geçerli olmasıyla tutarlıdır —
      // bizim cookie'lerimizde öznitelik AÇIKÇA set edilir (bkz.
      // `security/signin-signout-security.spec.ts` ve `active-tenant-security.spec.ts`).
      await serveAttackerPage(
        page,
        `<html><body>
           <form id="csrf" method="POST" action="${APP_ORIGIN}/api/tenants">
             <input name="name" value="CSRF Co" />
             <input name="slug" value="${slug}" />
           </form>
           <script>document.getElementById("csrf").submit()</script>
         </body></html>`,
      );

      await page.goto(`${ATTACKER_ORIGIN}/`);
      await page.waitForURL(`${APP_ORIGIN}/api/tenants`);

      // Sunucu isteği aldı ama kimliksiz olduğu için reddetti.
      const body = await page.locator("body").innerText();
      expect(JSON.parse(body)).toEqual({ error: "Unauthorized" });

      // En kritiği: hiçbir yan etki oluşmadı.
      expect(await prisma.tenant.findUnique({ where: { slug } })).toBeNull();
    } finally {
      await prisma.tenant.deleteMany({ where: { slug } });
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  test("cross-site JSON POST / PATCH / DELETE: CORS preflight nedeniyle sunucuya HİÇ ulaşmıyor", async ({
    page,
  }) => {
    const { email, password } = await createUser(page);
    // Benzersiz bir isim kullanılır ve YALNIZCA bu isim sorgulanır: e2e suite'i
    // `fullyParallel` çalıştığı için global bir `tenant.count()` karşılaştırması, paralel
    // testlerin oluşturduğu tenant'lar yüzünden flaky olurdu.
    const attackName = `CSRF Co ${randomUUID()}`;

    try {
      await authenticateBrowser(page, email, password);
      await serveAttackerPage(page, "<html><body>attacker</body></html>");
      await page.goto(`${ATTACKER_ORIGIN}/`);

      // Form POST'un aksine bunlar "simple request" DEĞİLDİR (JSON content-type / PATCH /
      // DELETE), bu yüzden tarayıcı önce bir CORS preflight yapar. Uygulama hiçbir
      // `Access-Control-Allow-Origin` header'ı döndürmediği için preflight başarısız olur ve
      // asıl istek HİÇ GÖNDERİLMEZ — SameSite'tan bağımsız, ikinci bir savunma katmanı.
      const outcomes = await page.evaluate(
        async ({ appOrigin, name }) => {
          const results: Record<string, string> = {};
          const attempts: Array<[string, string]> = [
            ["jsonPost", "POST"],
            ["patch", "PATCH"],
            ["delete", "DELETE"],
          ];

          for (const [label, method] of attempts) {
            try {
              const response = await fetch(`${appOrigin}/api/tenants`, {
                method,
                credentials: "include",
                headers: { "content-type": "application/json" },
                body: method === "DELETE" ? undefined : JSON.stringify({ name }),
              });
              results[label] = `reached:${response.status}`;
            } catch {
              results[label] = "blocked";
            }
          }
          return results;
        },
        { appOrigin: APP_ORIGIN, name: attackName },
      );

      expect(outcomes).toEqual({ jsonPost: "blocked", patch: "blocked", delete: "blocked" });

      // Saldırganın adıyla hiçbir tenant oluşmadı.
      expect(await prisma.tenant.findFirst({ where: { name: attackName } })).toBeNull();
    } finally {
      await prisma.tenant.deleteMany({ where: { name: attackName } });
      await prisma.user.deleteMany({ where: { email } });
    }
  });
});
