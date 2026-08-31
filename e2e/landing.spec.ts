import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import { signInWithCredentials } from "./support/auth";
import { uniqueTestClientIp } from "./support/rate-limit";

/**
 * Public açılış sayfası (`/`) — gerçek tarayıcıda.
 *
 * Bu ekranın iki ayrı iddiası var ve ikisi de ayrı ayrı test edilir:
 *
 * 1. **Ürün gibi görünmesi.** Sayfada geliştirme/altyapı çıktısı (health, JSON, "backend
 *    çalışıyor" benzeri) BULUNMAMALIDIR. Eski hâli tam olarak buydu ("Proje altyapısı
 *    başarıyla çalışıyor.") ve regresyonu ucuz olduğu için testle sabitlenmiştir.
 * 2. **Oturuma duyarlı olması.** Oturumsuz ziyaretçi giriş/kayıt eylemlerini, giriş yapmış
 *    kullanıcı "Panele Git"i görür — ve kabuk (`(app)` layout'undaki "Ana menü") HİÇBİR
 *    durumda burada render edilmez.
 */

const PASSWORD = "S3curePassw0rd!";
const createdUserIds: string[] = [];

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestClientIp() });
});

test.afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

async function signUpAndSignIn(page: Page): Promise<void> {
  const email = `landing-${randomUUID()}@example.com`;

  const created = await page.request.post("/api/auth/signup", {
    data: { email, password: PASSWORD },
    headers: { "x-forwarded-for": uniqueTestClientIp() },
  });
  expect(created.status()).toBe(201);

  const signedIn = await signInWithCredentials(page.request, email, PASSWORD);
  expect(signedIn.status()).toBe(302);
  expect(signedIn.headers()["location"] ?? "").not.toContain("error=");

  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  createdUserIds.push(user.id);
}

/** Uygulama kabuğunun navigasyonu — açılış sayfasında ASLA görünmemeli. */
function appNav(page: Page) {
  return page.getByRole("navigation", { name: "Ana menü" });
}

test.describe("/ — oturumsuz ziyaretçi", () => {
  test("ana mesaj, CTA'lar ve header eylemleri görünüyor", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Paranın kontrolü sende.", level: 1 }),
    ).toBeVisible();

    // Header'daki hesap eylemleri. `nav` ile kapsamlanır: aynı metinler footer'da da var ve
    // kapsamsız bir locator strict mode ihlaliyle düşerdi.
    const accountNav = page.getByRole("navigation", { name: "Hesap" });
    await expect(accountNav.getByRole("link", { name: "Giriş Yap" })).toBeVisible();
    await expect(accountNav.getByRole("link", { name: "Kayıt Ol" })).toBeVisible();

    // Oturumsuz ziyaretçiye "Panele Git" GÖSTERİLMEZ — panele gitse zaten /login'e düşerdi.
    await expect(page.getByRole("link", { name: "Panele Git" })).toHaveCount(0);
  });

  test("kabuk (Ana menü) açılış sayfasında render EDİLMİYOR", async ({ page }) => {
    await page.goto("/");
    // `/` root layout'un altındadır, `(app)` route group'unun değil — kabuk yapısal olarak
    // erişilemez. Bu test o yapının bozulmasını (ör. sayfanın `(app)` altına taşınması)
    // yakalar.
    await expect(appNav(page)).toHaveCount(0);
  });

  test("sayfada geliştirme/altyapı çıktısı YOK", async ({ page }) => {
    await page.goto("/");

    const body = (await page.locator("body").textContent()) ?? "";
    for (const forbidden of [
      "Proje altyapısı",
      "health",
      "database",
      "DATABASE_URL",
      '"status"',
      "localhost:3000",
    ]) {
      expect(body.toLowerCase(), `yasaklı metin: ${forbidden}`).not.toContain(
        forbidden.toLowerCase(),
      );
    }

    // Duyarlılık: yukarıdaki "yok" iddiaları, sayfa boş olsaydı da geçerdi. Sayfanın gerçekten
    // dolu olduğu ayrıca kontrol edilir.
    expect(body).toContain("Ücretsiz Başla");
  });

  test("'Ücretsiz Başla' signup akışına, 'Giriş Yap' login'e gidiyor", async ({ page }) => {
    await page.goto("/");

    // Sayfada iki ana CTA var (hero ve kapanış bölümü); ikisi de aynı yere gider.
    await page.getByRole("link", { name: "Ücretsiz Başla" }).first().click();
    await expect(page).toHaveURL(/\/signup$/);
    // Hedefin gerçekten mevcut kayıt ekranı olduğu doğrulanır; yalnızca URL değil.
    await expect(page.getByRole("heading", { name: "Kayıt ol" })).toBeVisible();

    await page.goto("/");
    await page.getByRole("navigation", { name: "Hesap" }).getByRole("link", { name: "Giriş Yap" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Giriş yap" })).toBeVisible();
  });

  test("özellik listesi yalnızca ÜRÜNDE VAR OLAN yetenekleri sayıyor", async ({ page }) => {
    await page.goto("/");

    for (const feature of [
      "Çoklu çalışma alanı",
      "Gelir ve gider takibi",
      "Kategori yönetimi",
      "Ekip ve roller",
    ]) {
      await expect(page.getByRole("heading", { name: feature })).toBeVisible();
    }

    // Kurulum akışının üç adımı da başlık olarak duruyor.
    for (const step of ["Hesaplarını tanımla", "Hareketleri kaydet", "Aradığını bul"]) {
      await expect(page.getByRole("heading", { name: step })).toBeVisible();
    }

    // HENÜZ OLMAYAN özellikler için söz VERİLMEMELİ. `/dashboard` boş (#62/#63), rapor/grafik
    // ekranı yok, içe-dışa aktarma ve fatura takibi backlog'da. Biri açılış sayfasını
    // doldurmak için bunları eklerse bu test kırmızıya döner.
    const body = (await page.locator("body").textContent()) ?? "";
    for (const notYet of ["Rapor", "Grafik", "Fatura", "Dışa aktar", "İçe aktar", "Bildirim"]) {
      expect(body, `ürüne girmemiş özellik iddiası: ${notYet}`).not.toContain(notYet);
    }
  });
});

test.describe("/ — giriş yapmış kullanıcı", () => {
  test("header 'Panele Git' gösteriyor, giriş/kayıt eylemleri kalkıyor", async ({ page }) => {
    await signUpAndSignIn(page);
    await page.goto("/");

    const accountNav = page.getByRole("navigation", { name: "Hesap" });
    await expect(accountNav.getByRole("link", { name: "Panele Git" })).toBeVisible();
    await expect(accountNav.getByRole("link", { name: "Giriş Yap" })).toHaveCount(0);
    await expect(accountNav.getByRole("link", { name: "Kayıt Ol" })).toHaveCount(0);
  });

  test("giriş yapmış kullanıcı panele ATILMIYOR; açılış sayfasını görebiliyor", async ({
    page,
  }) => {
    await signUpAndSignIn(page);
    await page.goto("/");

    // `/` oturum varsa `/dashboard`'a YÖNLENDİRMEZ: paylaşılan bir linkten ana sayfayı görmek
    // meşrudur. Bu, `requirePageUser()` yerine `getCurrentUser()` kullanılmasının sonucudur.
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { name: "Paranın kontrolü sende.", level: 1 }),
    ).toBeVisible();
  });

  test("'Panele Git' korumalı panele götürüyor ve kabuk orada devreye giriyor", async ({
    page,
  }) => {
    await signUpAndSignIn(page);
    await page.goto("/");

    // Açılış sayfasında kabuk yok...
    await expect(appNav(page)).toHaveCount(0);

    await page.getByRole("navigation", { name: "Hesap" }).getByRole("link", { name: "Panele Git" }).click();

    // ...panele geçince var. Public alan ile uygulama kabuğunun görsel ayrımı budur.
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(appNav(page)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Genel Bakış" })).toBeVisible();
  });
});
