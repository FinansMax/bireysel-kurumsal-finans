import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { signInWithCredentials } from "./support/auth";
import { clearOutboxEntry, extractTokenFromResetUrl, readOutboxEntry } from "./support/outbox";
import { uniqueTestClientIp } from "./support/rate-limit";

/**
 * Şifre sıfırlama ekranları — gerçek tarayıcıda, gerçek API'ye karşı (Issue #37).
 *
 * Token, gerçek akışın ürettiği outbox dosyasından okunur (bkz. `e2e/support/outbox.ts`) —
 * test için özel bir backdoor endpoint'i YOKTUR.
 */

const OLD_PASSWORD = "S3curePassw0rd!";
const NEW_PASSWORD = "BrandNewPassw0rd!";

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

async function createUser(page: Page, email: string) {
  const response = await page.request.post("/api/auth/signup", {
    data: { email, password: OLD_PASSWORD },
    headers: apiHeaders(),
  });
  expect(response.status()).toBe(201);
}

/**
 * Uyarı/bilgi kutuları DAİMA `main` içine scope'lanır.
 *
 * Next.js, istemci tarafı gezinmelerde body seviyesinde kendi
 * `<div role="alert" id="__next-route-announcer__">` elementini render eder. Scope'suz bir
 * `page.getByRole("alert")` bu elemana da eşleşir ve strict mode ihlali verir — üstelik
 * announcer'ın o an DOM'da olup olmaması zamanlamaya bağlı olduğu için hata FLAKY görünür
 * (dosya tek başına koşarken geçer, tam suite'te kırılır). `main`'e scope'lamak belirsizliği
 * tamamen ortadan kaldırır: `AuthCard` içeriği her zaman `main` altındadır.
 */
function cardAlert(page: Page) {
  return page.locator("main").getByRole("alert");
}

/** Form içindeki uyarı kutusu (aynı gerekçeyle scope'lu). */
function formAlert(page: Page) {
  return page.locator("form").getByRole("alert");
}

/** Başarı/bilgi kutusu (`role="status"`), yine `main` içine scope'lu. */
function statusBox(page: Page) {
  return page.locator("main").getByRole("status");
}

/**
 * Formu doldurup gönderir VE isteğin tamamlanmasını bekler.
 *
 * Beklemenin yardımcının İÇİNDE olması şart: outbox dosyası istek işlenirken sunucu
 * tarafında yazılır. Çağıran taraf beklemeyi unutursa `readOutboxEntry()` dosyayı henüz
 * yazılmadan okur ve test "outbox entry bulunamadı" ile rastgele kırılır. Bekleme her
 * çağrı yerinde tekrarlanmak yerine burada bir kez garanti altına alınır.
 */
async function requestResetViaUi(page: Page, email: string) {
  await page.goto("/forgot-password");
  await page.getByLabel("E-posta").fill(email);
  await page.getByRole("button", { name: /sıfırlama bağlantısı gönder/i }).click();
  await expect(statusBox(page)).toBeVisible();
}

test.describe("/forgot-password", () => {
  test("kayıtlı e-posta için genel mesaj gösteriliyor ve token üretiliyor", async ({ page }) => {
    const email = uniqueEmail("ui-forgot");
    await createUser(page, email);
    clearOutboxEntry(email);

    try {
      await requestResetViaUi(page, email);

      await expect(statusBox(page)).toContainText("Eğer bu e-posta adresine ait bir hesap varsa");

      // Kontrol grubu: mesaj gösterilmesi tek başına akışın çalıştığını kanıtlamaz —
      // gerçekten bir reset bağlantısı üretilmiş olmalı.
      expect(readOutboxEntry(email)).not.toBeNull();
    } finally {
      clearOutboxEntry(email);
    }
  });

  test("kayıtsız e-posta AYNI mesajı gösteriyor (enumeration engeli)", async ({ page }) => {
    const registered = uniqueEmail("ui-forgot-known");
    await createUser(page, registered);
    const unknown = uniqueEmail("ui-forgot-unknown");
    clearOutboxEntry(registered);

    try {
      await requestResetViaUi(page, registered);
      const knownMessage = await statusBox(page).textContent();

      await requestResetViaUi(page, unknown);
      const unknownMessage = await statusBox(page).textContent();

      expect(unknownMessage).toBe(knownMessage);

      // Ve kayıtsız e-posta için gerçekten hiçbir token üretilmemiş olmalı.
      expect(readOutboxEntry(unknown)).toBeNull();
    } finally {
      clearOutboxEntry(registered);
    }
  });
});

test.describe("/reset-password", () => {
  test("geçerli token ile sıfırlama uçtan uca çalışıyor", async ({ page }) => {
    const email = uniqueEmail("ui-reset");
    await createUser(page, email);
    clearOutboxEntry(email);

    try {
      await requestResetViaUi(page, email);
      await expect(statusBox(page)).toBeVisible();

      const entry = readOutboxEntry(email);
      if (!entry) throw new Error("outbox entry bulunamadı");
      const token = extractTokenFromResetUrl(entry.resetUrl);

      await page.goto(`/reset-password?token=${token}`);
      await page.getByLabel("Yeni şifre").fill(NEW_PASSWORD);
      await page.getByRole("button", { name: /şifreyi güncelle/i }).click();

      await expect(statusBox(page)).toContainText("başarıyla değiştirildi");

      // Asıl kanıt: yeni şifre çalışıyor, eskisi çalışmıyor.
      const withNew = await signInWithCredentials(page.request, email, NEW_PASSWORD);
      expect(withNew.status()).toBe(302);
      expect(withNew.headers()["location"] ?? "").not.toContain("error=");

      const withOld = await signInWithCredentials(page.request, email, OLD_PASSWORD);
      expect(withOld.headers()["location"]).toContain("error=CredentialsSignin");
    } finally {
      clearOutboxEntry(email);
    }
  });

  test("token tek kullanımlık: aynı bağlantı ikinci kez çalışmıyor", async ({ page }) => {
    const email = uniqueEmail("ui-reset-reuse");
    await createUser(page, email);
    clearOutboxEntry(email);

    try {
      await requestResetViaUi(page, email);
      const entry = readOutboxEntry(email);
      if (!entry) throw new Error("outbox entry bulunamadı");
      const token = extractTokenFromResetUrl(entry.resetUrl);

      await page.goto(`/reset-password?token=${token}`);
      await page.getByLabel("Yeni şifre").fill(NEW_PASSWORD);
      await page.getByRole("button", { name: /şifreyi güncelle/i }).click();
      await expect(statusBox(page)).toBeVisible();

      // Aynı token'la tekrar dene.
      await page.goto(`/reset-password?token=${token}`);
      await page.getByLabel("Yeni şifre").fill("YetAnotherPassw0rd!");
      await page.getByRole("button", { name: /şifreyi güncelle/i }).click();

      await expect(formAlert(page)).toContainText("geçersiz veya süresi dolmuş");
    } finally {
      clearOutboxEntry(email);
    }
  });

  test("geçersiz token anlamlı hata gösteriyor", async ({ page }) => {
    await page.goto(`/reset-password?token=${"a".repeat(64)}`);
    await page.getByLabel("Yeni şifre").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: /şifreyi güncelle/i }).click();

    await expect(formAlert(page)).toContainText("geçersiz veya süresi dolmuş");
  });

  test("URL'de token yoksa form gösterilmiyor, yeni bağlantı isteme yönlendirmesi var", async ({
    page,
  }) => {
    await page.goto("/reset-password");

    await expect(cardAlert(page)).toContainText("geçersiz veya süresi dolmuş");
    await expect(page.getByLabel("Yeni şifre")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /şifremi unuttum/i })).toBeVisible();
  });

  test("zayıf yeni şifre, token hatasından AYRI bir mesaj gösteriyor", async ({ page }) => {
    const email = uniqueEmail("ui-reset-weak");
    await createUser(page, email);
    clearOutboxEntry(email);

    try {
      await requestResetViaUi(page, email);
      const entry = readOutboxEntry(email);
      if (!entry) throw new Error("outbox entry bulunamadı");
      const token = extractTokenFromResetUrl(entry.resetUrl);

      await page.goto(`/reset-password?token=${token}`);
      await page.getByLabel("Yeni şifre").fill("short");
      await page.getByRole("button", { name: /şifreyi güncelle/i }).click();

      await expect(formAlert(page)).toContainText("en az 8 karakter");
    } finally {
      clearOutboxEntry(email);
    }
  });
});

test.describe("Şifre sıfırlama — gezinme", () => {
  test("login ekranından şifremi unuttum'a geçilebiliyor", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: /şifremi unuttum/i }).click();

    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.getByRole("button", { name: /sıfırlama bağlantısı gönder/i })).toBeVisible();
  });
});
