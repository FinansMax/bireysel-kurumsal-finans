import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { signInWithCredentials } from "./support/auth";
import { markEmailVerified } from "./support/email-verification";
import { uniqueTestClientIp } from "./support/rate-limit";

/**
 * Denetim kaydı ekranı — gerçek tarayıcıda, gerçek veriye karşı (Issue #78).
 *
 * MOCK YOKTUR: listedeki satırlar, testin kendi yaptığı işlemlerin ürettiği GERÇEK audit
 * kayıtlarıdır. Sahte veri seed'lemek, "kayıt gerçekten yazılıyor mu" sorusunu atlardı — ekranın
 * değeri tam olarak o soruya bağlı.
 */

const PASSWORD = "S3curePassw0rd!";

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestClientIp() });
});

function apiHeaders(): Record<string, string> {
  return { "x-forwarded-for": uniqueTestClientIp() };
}

async function signUpAndSignIn(page: Page, prefix: string): Promise<string> {
  const email = `${prefix}-${randomUUID()}@example.com`;

  const created = await page.request.post("/api/auth/signup", {
    data: { email, password: PASSWORD },
    headers: apiHeaders(),
  });
  expect(created.status()).toBe(201);
  // #190: doğrulanmamış hesap çalışma alanı kuramaz; bu testin konusu doğrulama DEĞİL.
  await markEmailVerified(email);

  const signedIn = await signInWithCredentials(page.request, email, PASSWORD);
  expect(signedIn.status()).toBe(302);

  return email;
}

async function createAndActivateTenant(page: Page): Promise<string> {
  const response = await page.request.post("/api/tenants", {
    data: { name: "Denetim Ekrani", slug: `audit-ui-${randomUUID()}` },
    headers: apiHeaders(),
  });
  expect(response.status()).toBe(201);

  const { tenant } = (await response.json()) as { tenant: { id: string } };

  const activated = await page.request.post("/api/tenants/active", {
    data: { tenantId: tenant.id },
  });
  expect(activated.status()).toBe(200);

  return tenant.id;
}

test.describe("/settings/audit-log", () => {
  test("OWNER kendi çalışma alanının kayıtlarını görüyor", async ({ page }) => {
    const email = await signUpAndSignIn(page, "audit-owner");
    await createAndActivateTenant(page);

    await page.goto("/settings/audit-log");

    await expect(page.getByRole("heading", { name: "Denetim kaydı" })).toBeVisible();

    // Çalışma alanının oluşturulması GERÇEK bir audit kaydı üretti; ekran onu göstermeli.
    // Action sabiti olduğu gibi yazılır — destek talebinde koddaki sabitle birebir eşleşmeli.
    await expect(page.getByRole("cell", { name: "TENANT_CREATED" })).toBeVisible();
    // Aktör de görünür: "kim" sorusu bu ekranın var olma sebebi.
    await expect(page.getByRole("cell", { name: email })).toBeVisible();
  });

  test("başka çalışma alanının kaydı bu ekranda YOK", async ({ page }) => {
    await signUpAndSignIn(page, "audit-isolation");

    // İki çalışma alanı; ikincisi aktif kalır.
    const first = await createAndActivateTenant(page);
    await createAndActivateTenant(page);

    await page.goto("/settings/audit-log");

    await expect(page.getByRole("cell", { name: "TENANT_CREATED" }).first()).toBeVisible();
    // Birinci alanın id'si hedef sütununda GEÇMEMELİ: liste aktif tenant'a scope'ludur.
    await expect(page.getByRole("cell", { name: `TENANT:${first}` })).toHaveCount(0);
  });

  test("tablo iskeleti geçerli HTML üretiyor (thead tek satır, hydration hatası yok)", async ({
    page,
  }) => {
    // GERÇEK BİR HATAYI KAPATIR: ekran ilk hâlinde `<Thead>` içine ayrıca `<Tr>` koyuyordu.
    // `Thead` başlık satırını KENDİSİ üretir (`src/components/ui/table.tsx`), dolayısıyla DOM'a
    // iç içe iki `<tr>` yazılıyordu. Tarayıcı bunu sessizce düzeltir — ekran gözle DOĞRU görünür —
    // ama React sunucu çıktısıyla eşleşmeyen bir ağaç bulup hydration hatası verir. Görünür bir
    // metne bakan hiçbir assertion bunu yakalamaz; bu yüzden yapıya ve konsola bakılır.
    const hydrationErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (/hydrat|cannot be a child of/i.test(text)) hydrationErrors.push(text);
    });

    await signUpAndSignIn(page, "audit-markup");
    await createAndActivateTenant(page);

    await page.goto("/settings/audit-log");
    await expect(page.getByRole("cell", { name: "TENANT_CREATED" })).toBeVisible();

    // Başlıkta TAM OLARAK bir satır olmalı. İç içe `<tr>`'de bu sayı ikiye çıkar.
    await expect(page.getByRole("table").locator("thead tr")).toHaveCount(1);
    // DUYARLILIK: başlık hücreleri gerçekten o tek satırın içinde — kolonlar kaybolmuş değil.
    await expect(page.getByRole("table").locator("thead tr > th")).toHaveCount(4);

    expect(hydrationErrors).toEqual([]);
  });

  test("çalışma alanı seçilmemişse boş durum gösteriliyor", async ({ page }) => {
    await signUpAndSignIn(page, "audit-no-tenant");

    await page.goto("/settings/audit-log");

    await expect(page.getByText("Çalışma alanı seçilmedi")).toBeVisible();
  });

  test("bozuk sayfa bağlantısı sessizce yutulmuyor", async ({ page }) => {
    await signUpAndSignIn(page, "audit-bad-cursor");
    await createAndActivateTenant(page);

    await page.goto("/settings/audit-log?after=bozuk");

    // Kullanıcı "ikinci sayfa" beklerken birinciyi görüp bunu fark etmemeli.
    //
    // `main` İÇİNE KAPSANIR: Next'in route announcer'ı da `role="alert"` taşır ve tam suite
    // koşusunda sayfada bulunur; kapsamsız bir locator strict mode ihlali verir (aynı tuzak
    // `e2e/auth-ui.spec.ts`te de not düşülmüş).
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "Sayfa bağlantısı geçersiz",
    );
  });

  test("oturumsuz kullanıcı ekrana giremiyor", async ({ page }) => {
    await page.goto("/settings/audit-log");

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Denetim kaydı" })).toHaveCount(0);
  });
});
