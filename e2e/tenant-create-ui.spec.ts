import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { markEmailVerified } from "./support/email-verification";
import { signInWithCredentials } from "./support/auth";
import { uniqueTestClientIp } from "./support/rate-limit";

/**
 * Tenant oluşturma ekranı — gerçek tarayıcıda, gerçek API'ye karşı (Issue #42).
 *
 * Mock YOKTUR: form `POST /api/tenants`'a gerçek istek atar, sonuç `GET /api/tenants` ile
 * (yani bağımsız bir okuma yoluyla) doğrulanır — "yönlendirme oldu" tek başına kanıt sayılmaz.
 */

const PASSWORD = "S3curePassw0rd!";

/** Her test kendi sahte istemci IP'siyle çalışır — bkz. `e2e/auth-ui.spec.ts`'teki gerekçe. */
test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestClientIp() });
});

function apiHeaders(): Record<string, string> {
  return { "x-forwarded-for": uniqueTestClientIp() };
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID()}@example.com`;
}

/**
 * `verifyEmail: false` YALNIZCA 403 senaryosu içindir (Issue #232): orada doğrulanmamış olmak
 * testin ÖN KOŞULU değil, KONUSUDUR. Diğer her testte hesap doğrulanır — bkz.
 * `e2e/support/email-verification.ts`.
 */
async function signUpAndSignIn(
  page: Page,
  prefix: string,
  options: { verifyEmail?: boolean } = {},
): Promise<string> {
  const email = uniqueEmail(prefix);

  const created = await page.request.post("/api/auth/signup", {
    data: { email, password: PASSWORD },
    headers: apiHeaders(),
  });
  // #190: doğrulanmamış hesap çalışma alanı kuramaz; bu testin konusu doğrulama DEĞİL,
  // onun ÖN KOŞULU (bkz. e2e/support/email-verification.ts).
  if (options.verifyEmail ?? true) {
    await markEmailVerified(email);
  }
  expect(created.status()).toBe(201);

  const signedIn = await signInWithCredentials(page.request, email, PASSWORD);
  expect(signedIn.status()).toBe(302);
  expect(signedIn.headers()["location"] ?? "").not.toContain("error=");

  return email;
}

/** Kullanıcının tenant'ları — formun sonucunu formdan bağımsız doğrulayan okuma yolu. */
async function listTenants(page: Page): Promise<Array<{ id: string; slug: string; role: string }>> {
  const response = await page.request.get("/api/tenants");
  expect(response.status()).toBe(200);

  return ((await response.json()) as { tenants: Array<{ id: string; slug: string; role: string }> })
    .tenants;
}

/** Form içindeki hata kutusu — bkz. `e2e/auth-ui.spec.ts`'teki route announcer notu. */
function formAlert(page: Page) {
  return page.locator("form").getByRole("alert");
}

/**
 * FORM İÇİNDEKİ yeniden gönderme düğmesi.
 *
 * KAPSAM ŞART (#190): doğrulanmamış bir kullanıcı artık kabukta da kalıcı bir uyarı şeridi
 * görüyor ve o şeritte AYNI düğme var. Sayfa geneli bir locator ikisini birden bulur ve strict
 * mode ihlali verir. İki düğmenin de bulunması DOĞRU davranıştır — şerit hesabın durumunu,
 * form ise o denemenin neden başarısız olduğunu anlatır.
 */
function formResendButton(page: Page) {
  return page.locator("form").getByRole("button", { name: "Doğrulama e-postasını tekrar gönder" });
}

async function fillForm(page: Page, name: string, slug?: string) {
  await page.getByLabel("Çalışma alanı adı").fill(name);
  if (slug !== undefined) {
    await page.getByLabel("Adres (isteğe bağlı)").fill(slug);
  }
}

async function submit(page: Page) {
  await page.getByRole("button", { name: /oluştur/i }).click();
}

test.describe("/tenants/new — çalışma alanı oluşturma", () => {
  test("geçerli bilgiyle oluşturuluyor ve oluşturan OWNER oluyor", async ({ page }) => {
    await signUpAndSignIn(page, "ui-tenant-create");

    // Ekrana kabuktaki menüden gidilir: sayfanın gerçekten erişilebilir olduğunu da kanıtlar.
    await page.goto("/dashboard");
    await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Yeni Çalışma Alanı" }).click();
    await expect(page).toHaveURL(/\/tenants\/new$/);

    const slug = `ui-tenant-${randomUUID()}`;
    await fillForm(page, "Deneme Sirketi", slug);
    await submit(page);

    await expect(page).toHaveURL(/\/dashboard$/);

    // Asıl kanıt: kayıt gerçekten oluştu ve kullanıcı OWNER.
    const tenants = await listTenants(page);
    expect(tenants).toHaveLength(1);
    expect(tenants[0].slug).toBe(slug);
    expect(tenants[0].role).toBe("OWNER");
  });

  test("adres boş bırakılırsa isimden türetiliyor", async ({ page }) => {
    await signUpAndSignIn(page, "ui-tenant-autoslug");

    // İSİM DE BENZERSİZ OLMALI: slug global olarak unique'tir ve buradaki senaryoda isimden
    // türetilir. Sabit bir isim (ör. "Acme Kurumsal") ilk koşuda geçer, ikinci koşuda aynı
    // slug'a 409 alıp kırılırdı (bkz. docs/testing.md → "Test verisi izole ve benzersizdir").
    const suffix = randomUUID();

    await page.goto("/tenants/new");
    // Slug alanı HİÇ doldurulmaz: boş string göndermek backend'de "geçersiz slug" dalına
    // düşerdi; formun bu alanı tamamen atlaması gerekiyor.
    await fillForm(page, `Acme ${suffix}`);
    await submit(page);

    await expect(page).toHaveURL(/\/dashboard$/);

    const tenants = await listTenants(page);
    expect(tenants).toHaveLength(1);
    // `slugify()`: küçük harfe çevirir, alfanumerik olmayan her diziyi tek tireye indirir.
    expect(tenants[0].slug).toBe(`acme-${suffix}`);
  });

  test("kullanılan adres formda anlamlı hata gösteriyor ve ikinci kayıt oluşmuyor", async ({
    page,
  }) => {
    await signUpAndSignIn(page, "ui-tenant-dup");

    const slug = `ui-dup-${randomUUID()}`;
    const first = await page.request.post("/api/tenants", {
      data: { name: "Ilk Sirket", slug },
      headers: apiHeaders(),
    });
    expect(first.status()).toBe(201);

    await page.goto("/tenants/new");
    await fillForm(page, "Ikinci Sirket", slug);
    await submit(page);

    await expect(formAlert(page)).toContainText("zaten kullanılıyor");
    // Hata durumunda yönlendirme OLMAMALI.
    await expect(page).toHaveURL(/\/tenants\/new$/);

    // Kontrol grubu: gerçekten ikinci bir tenant oluşmadı.
    const tenants = await listTenants(page);
    expect(tenants).toHaveLength(1);
  });

  test("geçersiz ad formda hata gösteriyor ve hiçbir şey oluşmuyor", async ({ page }) => {
    await signUpAndSignIn(page, "ui-tenant-invalid");

    await page.goto("/tenants/new");
    await fillForm(page, "A");
    await submit(page);

    await expect(formAlert(page)).toContainText("2-100 karakter");
    await expect(page).toHaveURL(/\/tenants\/new$/);

    expect(await listTenants(page)).toHaveLength(0);
  });

  /**
   * Issue #232: form, 403'ün gerekçesini yutup "Lütfen daha sonra tekrar deneyin" gösteriyordu.
   *
   * Bu cümle sadece yetersiz değil, AKTİF OLARAK YANLIŞTI: beklemek durumu düzeltmez. Test
   * hem doğru mesajın göründüğünü hem de yanlış olanın GÖRÜNMEDİĞİNİ doğrular — ikincisi
   * olmadan, iki mesajı birden basan bir regresyon fark edilmezdi.
   *
   * Buradaki 403 GERÇEK sunucudan gelir ve `code: "EMAIL_NOT_VERIFIED"` taşır. Eşlemenin
   * statüye değil KODA dayandığı, bir alttaki "tanınmayan 403" testiyle birlikte kanıtlanır:
   * aynı statü, farklı kod, farklı sonuç.
   */
  test("doğrulanmamış hesap 403'ün gerekçesini görüyor, 'daha sonra tekrar deneyin' görmüyor", async ({
    page,
  }) => {
    await signUpAndSignIn(page, "ui-tenant-unverified", { verifyEmail: false });

    await page.goto("/tenants/new");
    await fillForm(page, "Dogrulanmamis Sirket", `ui-unverified-${randomUUID()}`);
    await submit(page);

    await expect(formAlert(page)).toContainText("e-posta adresinizi doğrulamanız");
    await expect(formAlert(page)).not.toContainText("daha sonra tekrar deneyin");

    // Eyleme dönük kısım: kullanıcıya ne yapacağı SÖYLENMEKLE kalmaz, yapabileceği bir yol da
    // sunulur.
    await expect(formResendButton(page)).toBeVisible();

    // KABUKTAKİ ŞERİT DE VAR (#190): engel bir sayfaya değil HESABA aittir.
    await expect(
      page.getByRole("status").filter({ hasText: "E-posta adresiniz doğrulanmadı" }),
    ).toBeVisible();

    await expect(page).toHaveURL(/\/tenants\/new$/);
    // Kontrol grubu: 403 gerçekten sunucudan geldi, yani hiçbir kayıt oluşmadı.
    expect(await listTenants(page)).toHaveLength(0);
  });

  test("403 aksiyonu MEVCUT endpoint'e gönderiyor ve düğme cooldown'a giriyor", async ({
    page,
  }) => {
    await signUpAndSignIn(page, "ui-tenant-resend", { verifyEmail: false });

    await page.goto("/tenants/new");
    await fillForm(page, "Tekrar Gonder Sirketi", `ui-resend-${randomUUID()}`);
    await submit(page);
    await expect(formAlert(page)).toContainText("e-posta adresinizi doğrulamanız");

    // İsteğin GERÇEKTEN atıldığı ve DOĞRU endpoint'e gittiği doğrulanır: yeni bir endpoint
    // yazmamak #232'nin şartıydı (rate limit `RESEND_VERIFICATION` orada yaşıyor).
    const resent = page.waitForResponse(
      (response) =>
        response.url().includes("/api/auth/resend-verification") &&
        response.request().method() === "POST",
    );
    await formResendButton(page).click();
    expect((await resent).status()).toBe(200);

    // Onay `role="status"` taşır, `role="alert"` DEĞİL — başarı bildirimi ekran okuyucuda
    // hata gibi okunmamalı.
    await expect(page.locator("form").getByRole("status")).toContainText(
      "Doğrulama e-postası gönderildi",
    );

    // COOLDOWN: endpoint invariant #7 gereği hep aynı 200'ü döndüğü için ikinci tıklama görünür
    // hiçbir şey değiştirmez; düğmenin tükenmesi, yanıtı AYRIŞTIRMADAN verilen tek geri
    // bildirimdir.
    await expect(
      page.locator("form").getByRole("button", { name: "Gönderildi" }),
    ).toBeDisabled();

    // COOLDOWN YALNIZCA TIKLANAN DÜĞMEYE AİT: kabuktaki şeridin düğmesi hâlâ açık olmalı.
    // İki bileşen aynı state'i paylaşsaydı, formdaki tıklama şeridi de kilitlerdi.
    await expect(
      page.getByRole("status").getByRole("button", { name: "Doğrulama e-postasını tekrar gönder" }),
    ).toBeEnabled();

    // Süre dolunca düğme GERİ AÇILIR. Bu beklenti olmadan, düğmeyi kalıcı olarak kilitleyen
    // bir regresyon (ör. `setCoolingDown(false)` hiç çalışmaması) testten geçerdi.
    await expect(formResendButton(page)).toBeEnabled({ timeout: 15_000 });
  });

  /**
   * Issue #232: 403 eşlemesi STATÜYE değil, yanıttaki `code` alanına dayanır.
   *
   * Önceki hâli "bu endpoint'te 403'ün tek kaynağı doğrulama kapısıdır" varsayımıyla
   * çalışıyordu. Bu test, o varsayımın geri gelmesini engeller: aynı statü, tanınmayan bir
   * kodla geldiğinde form ALAKASIZ bir hataya "e-postanızı doğrulayın" DEMEMELİ. Yukarıdaki
   * gerçek-403 testiyle birlikte tam bir çift oluşturur — biri kodun tanındığını, bu ise
   * tanınmadığında ne olduğunu kanıtlar.
   *
   * İki senaryo birden koşulur: tanınmayan bir kod VE hiç kod olmaması. İkincisi, koda geçmeden
   * önceki bütün 403 üreticilerinin (ve ileride kod koymayı unutan her yeni dalın) doğru tarafa
   * düştüğünü gösterir.
   */
  test("tanınmayan bir 403 kodu doğrulama mesajı üretmiyor", async ({ page }) => {
    await signUpAndSignIn(page, "ui-tenant-403-code");

    let forbiddenBody: Record<string, unknown> = {
      error: "Forbidden",
      code: "MAINTENANCE_MODE",
    };

    await page.route("**/api/tenants", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify(forbiddenBody),
      });
    });

    await page.goto("/tenants/new");

    for (const senaryo of ["tanınmayan kod", "kod yok"]) {
      await fillForm(page, "Yetkisiz Sirket", `ui-403-${randomUUID()}`);
      await submit(page);

      await expect(formAlert(page), senaryo).toContainText("Bu işlem için yetkiniz yok");
      await expect(formAlert(page), senaryo).not.toContainText("doğrulamanız");
      await expect(
        page.getByRole("button", { name: "Doğrulama e-postasını tekrar gönder" }),
        senaryo,
      ).toHaveCount(0);

      // İkinci tur: sunucu hiç `code` göndermiyor.
      forbiddenBody = { error: "Forbidden" };
    }
  });

  /**
   * Generic "daha sonra tekrar deneyin" metni SİLİNMEDİ, DARALTILDI: gerçekten geçici olan
   * durumlarda hâlâ doğru cevap odur. Bu test o daralmanın diğer ucunu tutar — aksi halde
   * "403 mesajı görünüyor" testi, herkese 403 mesajı basan bir regresyonda da yeşil kalırdı.
   *
   * 500 yanıtı ENJEKTE EDİLİR: sunucuyu gerçekten çökertmeden 5xx üretmenin başka yolu yok.
   * Bir güvenlik mekanizması mock'lanmıyor (docs/testing.md #3) — mock'lanan şey, formun
   * KARŞILAŞTIĞI yanıt. Hesap bilerek DOĞRULANMIŞ: mesajın kaynağının gerçek bir 403 değil,
   * enjekte edilen 5xx olduğu böylece kesinleşir.
   */
  test("sunucu 5xx dönerse geçici hata mesajı gösteriliyor", async ({ page }) => {
    await signUpAndSignIn(page, "ui-tenant-5xx");

    await page.route("**/api/tenants", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Internal error" }),
      });
    });

    await page.goto("/tenants/new");
    await fillForm(page, "Bes Yuz Sirketi", `ui-5xx-${randomUUID()}`);
    await submit(page);

    await expect(formAlert(page)).toContainText("daha sonra tekrar deneyin");
    // Doğrulama aksiyonu YALNIZCA 403'e aittir; geçici hatada gösterilmesi kullanıcıyı
    // ilgisiz bir işe yönlendirirdi.
    await expect(
      page.getByRole("button", { name: "Doğrulama e-postasını tekrar gönder" }),
    ).toHaveCount(0);
    await expect(page).toHaveURL(/\/tenants\/new$/);
  });

  test("oturumsuz kullanıcı /tenants/new'a giremiyor", async ({ page }) => {
    await page.goto("/tenants/new");

    await expect(page).toHaveURL(/\/login$/);
    // Kontrol grubu: form hiç render edilmemiş olmalı.
    await expect(page.getByLabel("Çalışma alanı adı")).toHaveCount(0);
  });
});
