import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import { signInWithCredentials } from "./support/auth";
import { uniqueTestClientIp } from "./support/rate-limit";

/**
 * İşlem ekranı — gerçek tarayıcıda, gerçek API'ye karşı (Issue #54).
 *
 * `categories-ui.spec.ts` ile aynı duruş: sonuç her zaman bağımsız bir okuma yoluyla
 * doğrulanır — listede bir satırın görünmesi tek başına "sunucuda gerçekten oluştu" demek
 * değildir.
 *
 * BU EKRANA ÖZGÜ EK İDDİA: bir işlem kaydetmek yalnızca satır eklemez, HESABIN BAKİYESİNİ
 * değiştirir (#53). Bu yüzden her başarılı/başarısız kayıttan sonra bakiye de
 * `GET /api/tenants/:id/accounts` ile ayrıca kontrol edilir.
 */

const PASSWORD = "S3curePassw0rd!";

const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestClientIp() });
});

test.afterAll(async () => {
  // İşlemler önce silinir: hesabın FK'si `onDelete: NoAction` (#53) — ama tenant silme
  // cascade'i ikisini de aynı ifadede kaldırdığı için tenant.deleteMany yeterlidir.
  await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

function apiHeaders(): Record<string, string> {
  return { "x-forwarded-for": uniqueTestClientIp() };
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID()}@example.com`;
}

async function signUpAndSignIn(page: Page, prefix: string): Promise<string> {
  const email = uniqueEmail(prefix);

  const created = await page.request.post("/api/auth/signup", {
    data: { email, password: PASSWORD },
    headers: apiHeaders(),
  });
  expect(created.status()).toBe(201);

  const signedIn = await signInWithCredentials(page.request, email, PASSWORD);
  expect(signedIn.status()).toBe(302);
  expect(signedIn.headers()["location"] ?? "").not.toContain("error=");

  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  createdUserIds.push(user.id);

  return user.id;
}

/** Oturum sahibi için tenant oluşturur (OWNER olur) ve aktif tenant yapar. */
async function createAndActivateTenant(page: Page): Promise<string> {
  const response = await page.request.post("/api/tenants", {
    data: { name: "Islem Ekrani", slug: `transactions-ui-${randomUUID()}` },
    headers: apiHeaders(),
  });
  expect(response.status()).toBe(201);

  const { tenant } = (await response.json()) as { tenant: { id: string } };
  createdTenantIds.push(tenant.id);

  const activated = await page.request.post("/api/tenants/active", {
    data: { tenantId: tenant.id },
  });
  expect(activated.status()).toBe(200);

  return tenant.id;
}

async function createAccount(page: Page, tenantId: string, name: string, balance: string) {
  const response = await page.request.post(`/api/tenants/${tenantId}/accounts`, {
    data: { name, type: "CASH", currency: "TRY", balance },
  });
  expect(response.status()).toBe(201);

  return ((await response.json()) as { account: { id: string } }).account.id;
}

async function createCategory(
  page: Page,
  tenantId: string,
  name: string,
  type: "INCOME" | "EXPENSE",
) {
  const response = await page.request.post(`/api/tenants/${tenantId}/categories`, {
    data: { name, type },
  });
  expect(response.status()).toBe(201);

  return ((await response.json()) as { category: { id: string } }).category.id;
}

async function apiTransactions(
  page: Page,
  tenantId: string,
): Promise<Array<{ amount: string; type: string; description: string | null; categoryId: string | null }>> {
  const response = await page.request.get(`/api/tenants/${tenantId}/transactions`);
  expect(response.status()).toBe(200);

  return (
    (await response.json()) as {
      transactions: Array<{
        amount: string;
        type: string;
        description: string | null;
        categoryId: string | null;
      }>;
    }
  ).transactions;
}

/** Bakiyeyi API'den okur — ekrandaki metinden değil (bağımsız doğrulama). */
async function apiBalance(page: Page, tenantId: string, accountId: string): Promise<string> {
  const response = await page.request.get(`/api/tenants/${tenantId}/accounts`);
  expect(response.status()).toBe(200);

  const { accounts } = (await response.json()) as {
    accounts: Array<{ id: string; balance: string }>;
  };
  const account = accounts.find((candidate) => candidate.id === accountId);
  expect(account, "hesap API yanıtında bulunamadı").toBeTruthy();

  return account!.balance;
}

async function fillTransactionForm(
  page: Page,
  values: { amount: string; type?: string; category?: string; description?: string; date?: string },
) {
  if (values.type) {
    await page.getByLabel("Tür").selectOption(values.type);
  }
  await page.getByLabel("Tutar").fill(values.amount);
  if (values.category !== undefined) {
    await page.getByLabel("Kategori").selectOption({ label: values.category });
  }
  if (values.description !== undefined) {
    await page.getByLabel("Açıklama").fill(values.description);
  }
  if (values.date) {
    await page.getByLabel("Tarih").fill(values.date);
  }
}

/**
 * Gönder düğmesi TAM ADIYLA bulunur, `/işlem kaydet/i` gibi bir regex ile DEĞİL.
 *
 * JavaScript'te `"İ".toLowerCase()` sonucu `"i"` değil, birleşik noktalı `"i̇"`dir (U+0069 +
 * U+0307); bu yüzden büyük/küçük harf duyarsız bir regex "İşlem kaydet" metnini HİÇ eşleştirmez
 * ve test, düğme ekranda dururken zaman aşımına düşer. (`categories-ui.spec.ts`'teki aynı
 * kalıp çalışıyor çünkü oradaki metin "Kategori oluştur" ile başlıyor.)
 */
function submit(page: Page) {
  return page.getByRole("button", { name: "İşlem kaydet" }).click();
}

function formAlert(page: Page) {
  return page.locator("form").getByRole("alert");
}

/**
 * Kayıttan SONRA listede beliren satırı bekler.
 *
 * Süre bilerek varsayılanın (5 sn) üstünde: form `router.refresh()` çağırır, yani satırın
 * görünmesi bir sunucu round-trip'ine ve RSC yeniden render'ına bağlıdır. Tam e2e suite'i
 * paralel koşarken bu adım 5 saniyeyi aşabiliyor ve test, uygulama doğru çalıştığı hâlde
 * kırmızıya düşüyordu.
 *
 * Bu bir GEVŞETME DEĞİLDİR: iddia aynı (satır listede görünmeli), yalnızca bilinen bir yavaş
 * adıma daha fazla süre tanınıyor. Kaydın sunucuda gerçekten oluştuğu zaten `apiTransactions()`
 * ile bu beklemeden BAĞIMSIZ olarak doğrulanıyor.
 */
const ROW_TIMEOUT_MS = 15_000;

function expectRow(page: Page, name: string) {
  return expect(page.getByRole("cell", { name })).toBeVisible({ timeout: ROW_TIMEOUT_MS });
}

test.describe("/transactions — kaydetme ve listeleme", () => {
  test("menüden gidilip işlem kaydediliyor, listede görünüyor ve BAKİYE düşüyor", async ({
    page,
  }) => {
    await signUpAndSignIn(page, "transactions-owner");
    const tenantId = await createAndActivateTenant(page);
    const accountId = await createAccount(page, tenantId, "Kasa", "1000");
    await createCategory(page, tenantId, "Market", "EXPENSE");

    await page.goto("/dashboard");
    await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", {
      name: "İşlemler",
    }).click();
    await expect(page).toHaveURL(/\/transactions$/);

    await fillTransactionForm(page, {
      amount: "250.75",
      category: "Market",
      description: "Haftalik alisveris",
      date: "2026-03-15",
    });
    await submit(page);

    await expectRow(page, "Haftalik alisveris");

    // Bağımsız doğrulama: kayıt gerçekten sunucuda oluştu mu?
    const transactions = await apiTransactions(page, tenantId);
    expect(transactions).toHaveLength(1);
    expect(transactions[0].amount).toBe("250.75");
    expect(transactions[0].type).toBe("EXPENSE");

    // Bu ekranın asıl iddiası: bakiye gerçekten değişti. 1000 - 250.75 = 749.25
    expect(await apiBalance(page, tenantId, accountId)).toBe("749.25");

    // Tarih listede `YYYY-MM-DD` olarak, girildiği gibi görünür.
    await expect(page.getByRole("cell", { name: "2026-03-15" })).toBeVisible();
  });

  test("gelir işlemi bakiyeyi artırıyor", async ({ page }) => {
    await signUpAndSignIn(page, "transactions-income");
    const tenantId = await createAndActivateTenant(page);
    const accountId = await createAccount(page, tenantId, "Kasa", "1000");
    await createCategory(page, tenantId, "Maas", "INCOME");

    await page.goto("/transactions");
    await fillTransactionForm(page, {
      type: "INCOME",
      amount: "500",
      category: "Maas",
      description: "Ocak maasi",
    });
    await submit(page);

    await expectRow(page, "Ocak maasi");
    expect(await apiBalance(page, tenantId, accountId)).toBe("1500");
  });

  test("kategori seçicisi TÜRE GÖRE süzülüyor ve tür değişince seçim temizleniyor", async ({
    page,
  }) => {
    await signUpAndSignIn(page, "transactions-filter");
    const tenantId = await createAndActivateTenant(page);
    await createAccount(page, tenantId, "Kasa", "0");
    await createCategory(page, tenantId, "Market", "EXPENSE");
    await createCategory(page, tenantId, "Maas", "INCOME");

    await page.goto("/transactions");

    const category = page.getByLabel("Kategori");

    // Varsayılan tür "Gider": yalnızca gider kategorisi seçilebilir olmalı.
    await expect(category.getByRole("option", { name: "Market" })).toHaveCount(1);
    await expect(category.getByRole("option", { name: "Maas" })).toHaveCount(0);

    await category.selectOption({ label: "Market" });
    await expect(category).not.toHaveValue("");

    // Tür değişince liste diğer tarafa döner VE önceki seçim düşer — aksi halde kullanıcı
    // ekranda görünmeyen bir kategoriyle kaydetmeye çalışır ve sebebi görünmeyen 400 alırdı.
    await page.getByLabel("Tür").selectOption("INCOME");
    await expect(category).toHaveValue("");
    await expect(category.getByRole("option", { name: "Maas" })).toHaveCount(1);
    await expect(category.getByRole("option", { name: "Market" })).toHaveCount(0);
  });

  test("kategorisiz işlem kaydedilebiliyor", async ({ page }) => {
    await signUpAndSignIn(page, "transactions-nocat");
    const tenantId = await createAndActivateTenant(page);
    await createAccount(page, tenantId, "Kasa", "100");

    await page.goto("/transactions");
    // Kategori hiç seçilmez; varsayılan "Kategorisiz".
    await fillTransactionForm(page, { amount: "40", description: "Kategorisiz gider" });
    await submit(page);

    await expectRow(page, "Kategorisiz gider");

    const transactions = await apiTransactions(page, tenantId);
    expect(transactions).toHaveLength(1);
    expect(transactions[0].categoryId).toBeNull();

    // Listede kategori hücresi boş değil, "Kategorisiz" yazar.
    await expect(page.getByRole("cell", { name: "Kategorisiz", exact: true })).toBeVisible();
  });

  test("geçersiz tutar formda hata veriyor; ne kayıt ne BAKİYE değişiyor", async ({ page }) => {
    await signUpAndSignIn(page, "transactions-invalid");
    const tenantId = await createAndActivateTenant(page);
    const accountId = await createAccount(page, tenantId, "Kasa", "1000");

    await page.goto("/transactions");

    // Negatif tutar: yön `type` alanının işidir, tutar pozitif olmalı (#53).
    await fillTransactionForm(page, { amount: "-50", description: "Olmamali" });
    await submit(page);

    await expect(formAlert(page)).toBeVisible();

    expect(await apiTransactions(page, tenantId)).toHaveLength(0);
    expect(await apiBalance(page, tenantId, accountId)).toBe("1000");
  });

  test("başarılı kayıttan sonra tutar ve açıklama temizleniyor; hesap, tür ve tarih korunuyor", async ({
    page,
  }) => {
    await signUpAndSignIn(page, "transactions-reset");
    const tenantId = await createAndActivateTenant(page);
    await createAccount(page, tenantId, "Kasa", "1000");

    await page.goto("/transactions");
    await fillTransactionForm(page, {
      type: "INCOME",
      amount: "125.50",
      description: "Ilk kayit",
      date: "2026-02-10",
    });
    await submit(page);

    await expectRow(page, "Ilk kayit");

    // Kullanıcı genellikle aynı günün fişlerini aynı hesaba arka arkaya girer.
    await expect(page.getByLabel("Tutar")).toHaveValue("");
    await expect(page.getByLabel("Açıklama")).toHaveValue("");
    await expect(page.getByLabel("Tür")).toHaveValue("INCOME");
    await expect(page.getByLabel("Tarih")).toHaveValue("2026-02-10");
  });
});

test.describe("/transactions — yetki ve kurulum durumu", () => {
  test("hesap yokken form yerine hesap oluşturmaya yönlendiriliyor", async ({ page }) => {
    await signUpAndSignIn(page, "transactions-noaccount");
    await createAndActivateTenant(page);

    await page.goto("/transactions");

    // İşlem hesapsız kaydedilemez (`accountId` zorunlu); boş bir seçici göstermek yerine
    // kullanıcı doğrudan çözüme yönlendirilir.
    await expect(page.getByText("İşlem kaydedebilmek için önce bir hesap gerekiyor")).toBeVisible();
    await expect(page.getByLabel("Tutar")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Hesaplar ekranından oluşturun." })).toBeVisible();
  });

  test("MEMBER listeyi görüyor ama kayıt formunu görmüyor", async ({ page }) => {
    const viewerId = await signUpAndSignIn(page, "transactions-viewer");

    const tenant = await prisma.tenant.create({
      data: { name: "Baska Alan", slug: `transactions-viewer-${randomUUID()}` },
      select: { id: true },
    });
    createdTenantIds.push(tenant.id);

    const account = await prisma.account.create({
      data: { tenantId: tenant.id, name: "Ortak Kasa", type: "CASH", currency: "TRY" },
      select: { id: true },
    });
    await prisma.transaction.create({
      data: {
        tenantId: tenant.id,
        accountId: account.id,
        type: "EXPENSE",
        amount: "75",
        description: "Ortak harcama",
      },
    });
    await prisma.membership.create({
      data: { userId: viewerId, tenantId: tenant.id, role: "MEMBER" },
    });

    const activated = await page.request.post("/api/tenants/active", {
      data: { tenantId: tenant.id },
    });
    expect(activated.status()).toBe(200);

    await page.goto("/transactions");

    // İzin matrisi MEMBER'a VIEW_TRANSACTIONS verir: kayıtları okumak günlük iştir.
    await expect(page.getByRole("cell", { name: "Ortak harcama" })).toBeVisible();

    // Ama yönetim formu HİÇ render edilmez (MANAGE_TRANSACTIONS yok).
    await expect(page.getByLabel("Tutar")).toHaveCount(0);

    // Asıl kontrol arayüzde değil backend'de: form baypas edilirse 403 gelir ve bakiye
    // değişmez.
    const forced = await page.request.post(`/api/tenants/${tenant.id}/transactions`, {
      data: { accountId: account.id, type: "EXPENSE", amount: "999" },
    });
    expect(forced.status()).toBe(403);
    expect(await apiBalance(page, tenant.id, account.id)).toBe("0");
  });

  test("aktif çalışma alanı yokken liste yerine yönlendirici metin gösteriliyor", async ({
    page,
  }) => {
    await signUpAndSignIn(page, "transactions-notenant");

    await page.goto("/transactions");

    await expect(page.getByText("Önce üstteki menüden bir çalışma alanı seçin")).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByLabel("Tutar")).toHaveCount(0);
  });
});
