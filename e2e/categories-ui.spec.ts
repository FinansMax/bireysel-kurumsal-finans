import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import { signInWithCredentials } from "./support/auth";
import { uniqueTestClientIp } from "./support/rate-limit";

/**
 * Kategori ekranı — gerçek tarayıcıda, gerçek API'ye karşı (Issue #50).
 *
 * `accounts-ui.spec.ts` ile aynı duruş: sonuç her zaman bağımsız bir okuma yoluyla
 * (`GET /api/tenants/:id/categories`) doğrulanır — listede bir satırın görünmesi tek başına
 * "sunucuda gerçekten oluştu" demek değildir.
 */

const PASSWORD = "S3curePassw0rd!";

const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestClientIp() });
});

test.afterAll(async () => {
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
    data: { name: "Kategori Ekrani", slug: `categories-ui-${randomUUID()}` },
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

async function apiCategories(
  page: Page,
  tenantId: string,
): Promise<Array<{ name: string; type: string }>> {
  const response = await page.request.get(`/api/tenants/${tenantId}/categories`);
  expect(response.status()).toBe(200);

  return ((await response.json()) as { categories: Array<{ name: string; type: string }> })
    .categories;
}

async function fillCategoryForm(page: Page, values: { name: string; type?: string }) {
  await page.getByLabel("Kategori adı").fill(values.name);
  if (values.type) {
    await page.getByLabel("Tür").selectOption(values.type);
  }
}

function submit(page: Page) {
  return page.getByRole("button", { name: /kategori oluştur/i }).click();
}

function formAlert(page: Page) {
  return page.locator("form").getByRole("alert");
}

/**
 * Kayıttan SONRA listede beliren satırı bekler (Issue #129).
 *
 * Süre bilerek varsayılanın (5 sn) üstünde: form `router.refresh()` çağırır, yani satırın
 * görünmesi bir sunucu round-trip'ine ve RSC yeniden render'ına bağlıdır. Tam e2e suite'i
 * paralel koşarken bu adım 5 saniyeyi aşabiliyor ve test, uygulama doğru çalıştığı hâlde
 * kırmızıya düşüyordu — CI'daki `retries: 2` bunu örtüyor, yerelde ise sürekli sahte kırmızı
 * üretiyordu.
 *
 * `exact: true` ZORUNLU (Issue #130): satır aksiyonlarının erişilebilir adı kaydın adını
 * içerir ("Vadesiz TL hesabını düzenle"), dolayısıyla varsayılan ALT DİZE eşlemesi hem ad
 * hücresine hem aksiyon hücresine uyar ve locator strict mode ihlaliyle düşer.
 *
 * Bu bir GEVŞETME DEĞİLDİR: iddia aynı (satır listede görünmeli), yalnızca bilinen bir yavaş
 * adıma daha fazla süre tanınıyor. Kaydın sunucuda gerçekten oluştuğu zaten bağımsız bir API
 * okumasıyla, bu beklemeden ayrı olarak doğrulanıyor. Desen ilk kez
 * `transactions-ui.spec.ts`'te (#54) uygulandı ve orada kararsızlığı tamamen bitirdi.
 *
 * Aynı süre form HATA KUTUSU beklemelerinde de kullanılır: o da bir sunucu round-trip'inden
 * sonra belirir (form `fetch` ile POST atar, mesajı yanıtın durum kodundan kurar).
 */
const ROW_TIMEOUT_MS = 15_000;

function expectRow(page: Page, name: string) {
  return expect(page.getByRole("cell", { name, exact: true })).toBeVisible({ timeout: ROW_TIMEOUT_MS });
}

test.describe("/categories — oluşturma ve listeleme", () => {
  test("menüden gidilip kategori oluşturuluyor ve listede görünüyor", async ({ page }) => {
    await signUpAndSignIn(page, "categories-create");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/dashboard");
    await page
      .getByRole("navigation", { name: "Ana menü" })
      .getByRole("link", { name: "Kategoriler" })
      .click();
    await expect(page).toHaveURL(/\/categories$/);

    // Boş durum: henüz kategori yok.
    await expect(page.getByText("Henüz kategori yok")).toBeVisible();

    await fillCategoryForm(page, { name: "Kira Gideri", type: "EXPENSE" });
    await submit(page);

    // Liste sunucudan yeniden render edilir.
    await expectRow(page, "Kira Gideri");

    // Asıl kanıt: kayıt sunucuda var.
    const categories = await apiCategories(page, tenantId);
    expect(categories).toHaveLength(1);
    expect(categories[0]).toMatchObject({ name: "Kira Gideri", type: "EXPENSE" });
  });

  test("aynı isim gelir ve gider tarafında ayrı ayrı kullanılabiliyor", async ({ page }) => {
    await signUpAndSignIn(page, "categories-bothtypes");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/categories");

    // Bu, #49'un `@@unique([tenantId, type, name])` kararının uçtan uca kanıtıdır: "Faiz"
    // hem gelir hem gider tarafında doğal bir isimdir ve ikisi de kabul edilmelidir.
    await fillCategoryForm(page, { name: "Faiz", type: "EXPENSE" });
    await submit(page);
    await expectRow(page, "Gider");

    await fillCategoryForm(page, { name: "Faiz", type: "INCOME" });
    await submit(page);
    await expectRow(page, "Gelir");

    // Formda hata YOK: ikinci kayıt reddedilmedi.
    await expect(formAlert(page)).toHaveCount(0);

    const categories = await apiCategories(page, tenantId);
    expect(categories).toHaveLength(2);
    expect(categories.map((category) => category.type).sort()).toEqual(["EXPENSE", "INCOME"]);
  });

  test("aynı tür içinde aynı isim ikinci kez kullanılamıyor (formda hata, yeni kayıt yok)", async ({
    page,
  }) => {
    await signUpAndSignIn(page, "categories-dup");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/categories");
    await fillCategoryForm(page, { name: "Market", type: "EXPENSE" });
    await submit(page);
    await expectRow(page, "Market");

    await fillCategoryForm(page, { name: "Market", type: "EXPENSE" });
    await submit(page);

    // Mesaj TÜRÜ de söyler: benzersizlik tenant + tür + isim üzerindendir.
    await expect(formAlert(page)).toContainText("Bu türde bu isimde", {
      timeout: ROW_TIMEOUT_MS,
    });
    expect(await apiCategories(page, tenantId)).toHaveLength(1);
  });

  test("geçersiz ad formda hata veriyor ve kayıt oluşmuyor", async ({ page }) => {
    await signUpAndSignIn(page, "categories-badname");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/categories");
    // Tek karakter: `isValidCategoryName()`'in alt sınırının (2) altında.
    await fillCategoryForm(page, { name: "A", type: "EXPENSE" });
    await submit(page);

    await expect(formAlert(page)).toContainText("Bilgileri kontrol edin", {
      timeout: ROW_TIMEOUT_MS,
    });
    expect(await apiCategories(page, tenantId)).toHaveLength(0);
  });

  test("başarılı kayıttan sonra ad temizleniyor ama tür seçimi korunuyor", async ({ page }) => {
    await signUpAndSignIn(page, "categories-formstate");
    await createAndActivateTenant(page);

    await page.goto("/categories");
    await fillCategoryForm(page, { name: "Maas", type: "INCOME" });
    await submit(page);
    await expectRow(page, "Maas");

    // Kullanıcı genellikle arka arkaya aynı taraftan kategori girer; türün sıfırlanması
    // her kayıtta yeniden seçmeyi gerektirirdi.
    await expect(page.getByLabel("Kategori adı")).toHaveValue("");
    await expect(page.getByLabel("Tür")).toHaveValue("INCOME");
  });
});

test.describe("/categories — yetki ve tenant durumu", () => {
  test("MEMBER listeyi görüyor ama oluşturma formunu görmüyor", async ({ page }) => {
    const viewerId = await signUpAndSignIn(page, "categories-viewer");

    const tenant = await prisma.tenant.create({
      data: { name: "Baska Alan", slug: `categories-viewer-${randomUUID()}` },
      select: { id: true },
    });
    createdTenantIds.push(tenant.id);

    // Ad bilerek tür etiketini ("Gider") İÇERMEZ: `getByRole("cell", { name, exact: true })` varsayılan
    // olarak alt dize eşlemesi yapar, bu yüzden "Ortak Gider" adı aşağıdaki tür hücresi
    // locator'ını iki hücreye birden eşleştirirdi (bkz. `accounts-ui.spec.ts`'teki aynı tuzak).
    await prisma.category.create({
      data: { tenantId: tenant.id, name: "Ortak Harcama", type: "EXPENSE" },
    });
    await prisma.membership.create({
      data: { userId: viewerId, tenantId: tenant.id, role: "MEMBER" },
    });

    const activated = await page.request.post("/api/tenants/active", {
      data: { tenantId: tenant.id },
    });
    expect(activated.status()).toBe(200);

    await page.goto("/categories");

    // İzin matrisi MEMBER'a VIEW_CATEGORIES verir: liste görünür (işlem kaydederken seçecek).
    await expect(page.getByRole("cell", { name: "Ortak Harcama", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Gider", exact: true })).toBeVisible();

    // Ama yönetim formu HİÇ render edilmez.
    await expect(page.getByLabel("Kategori adı")).toHaveCount(0);

    // Asıl kontrol arayüzde değil backend'de: form baypas edilirse 403 gelir.
    const forced = await page.request.post(`/api/tenants/${tenant.id}/categories`, {
      data: { name: "Zorla", type: "EXPENSE" },
    });
    expect(forced.status()).toBe(403);
  });

  test("aktif çalışma alanı yokken liste yerine yönlendirici metin gösteriliyor", async ({
    page,
  }) => {
    await signUpAndSignIn(page, "categories-notenant");

    await page.goto("/categories");

    await expect(page.getByText("Önce menüden bir çalışma alanı seçin")).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByLabel("Kategori adı")).toHaveCount(0);
  });
});

test.describe("/categories — düzenleme ve silme (Issue #130)", () => {
  function editLink(page: Page, name: string) {
    return page.getByRole("link", { name: `${name} kategorisini düzenle` });
  }

  function deleteButton(page: Page, name: string) {
    return page.getByRole("button", { name: `${name} kategorisini sil` });
  }

  function saveEdit(page: Page) {
    return editForm(page).getByRole("button", { name: "Değişiklikleri kaydet" }).click();
  }

  /**
   * Düzenleme formu ERİŞİLEBİLİR ADIYLA bulunur ve alanlar ona kapsamlandırılır.
   *
   * Kapsamlandırmadan `page.getByLabel("Tür")` bir YARIŞ üretiyor: düzenleme linkine
   * tıklandıktan sonra sayfa istemci tarafında yeniden render edilirken oluşturma formu hâlâ
   * DOM'da duruyor ve Playwright onun alanına yazıyor — sonra edit formu eski değerle
   * render ediliyor, test "değişiklik uygulanmadı" diye düşüyordu.
   */
  function editForm(page: Page) {
    return page.getByRole("form", { name: "Kategoriyi düzenle" });
  }

  test("kategori düzenleniyor: form dolu geliyor, kaydedince liste ve API güncelleniyor", async ({
    page,
  }) => {
    await signUpAndSignIn(page, "categories-edit");
    const tenantId = await createAndActivateTenant(page);
    await page.goto("/categories");

    await fillCategoryForm(page, { name: "Eski Kategori", type: "EXPENSE" });
    await submit(page);
    await expectRow(page, "Eski Kategori");

    await editLink(page, "Eski Kategori").click();

    await expect(editForm(page).getByLabel("Kategori adı")).toHaveValue("Eski Kategori");
    await expect(editForm(page).getByLabel("Tür")).toHaveValue("EXPENSE");

    await editForm(page).getByLabel("Kategori adı").fill("Yeni Kategori");
    await saveEdit(page);

    await expectRow(page, "Yeni Kategori");

    const categories = await apiCategories(page, tenantId);
    expect(categories).toHaveLength(1);
    expect(categories[0].name).toBe("Yeni Kategori");
    await expect(page).toHaveURL(/\/categories$/);
  });

  test("kategorinin TÜRÜ değiştirilebiliyor (yanlış tarafa açılmış kayıt düzeltilir)", async ({
    page,
  }) => {
    await signUpAndSignIn(page, "categories-edit-type");
    const tenantId = await createAndActivateTenant(page);
    await page.goto("/categories");

    await fillCategoryForm(page, { name: "Faiz", type: "EXPENSE" });
    await submit(page);
    await expectRow(page, "Faiz");

    await editLink(page, "Faiz").click();
    await editForm(page).getByLabel("Tür").selectOption("INCOME");
    await saveEdit(page);

    // #49'un kararı: tür değiştirmek serbesttir; silip yeniden oluşturmak, kategoriye bağlı
    // işlemleri (#53) koparacağı için daha kötüdür.
    await expectRow(page, "Gelir");
    const categories = await apiCategories(page, tenantId);
    expect(categories[0].type).toBe("INCOME");
  });

  test("tür değişimi karşı tarafta aynı isme çarparsa anlaşılır hata veriyor", async ({ page }) => {
    await signUpAndSignIn(page, "categories-edit-conflict");
    const tenantId = await createAndActivateTenant(page);
    await page.goto("/categories");

    await fillCategoryForm(page, { name: "Kira", type: "INCOME" });
    await submit(page);
    await expectRow(page, "Gelir");

    await fillCategoryForm(page, { name: "Kira", type: "EXPENSE" });
    await submit(page);
    await expectRow(page, "Gider");

    // Gider tarafındaki "Kira"yı gelire çekmek, oradaki "Kira" ile çakışır (#49:
    // benzersizlik tenant + tür + isim).
    //
    // Satır TÜRÜNE göre seçilir, `.first()` ile DEĞİL: liste türe göre sıralı geldiği için
    // (#49) ilk satır GELİR olanıdır ve onu gelire çekmek hiçbir çakışma üretmezdi — test
    // yeşil kalır ama hiçbir şey kanıtlamazdı.
    const expenseRow = page.getByRole("row").filter({ hasText: "Gider" });
    await expenseRow.getByRole("link", { name: "Kira kategorisini düzenle" }).click();
    await editForm(page).getByLabel("Tür").selectOption("INCOME");
    await saveEdit(page);

    await expect(page.getByText("Bu türde bu isimde bir kategori zaten var")).toBeVisible({
      timeout: ROW_TIMEOUT_MS,
    });
    expect(await apiCategories(page, tenantId)).toHaveLength(2);
  });

  test("kategori siliniyor: onay metni işlemlere ne olacağını SÖYLÜYOR", async ({ page }) => {
    await signUpAndSignIn(page, "categories-delete");
    const tenantId = await createAndActivateTenant(page);
    await page.goto("/categories");

    await fillCategoryForm(page, { name: "Silinecek", type: "EXPENSE" });
    await submit(page);
    await expectRow(page, "Silinecek");

    await deleteButton(page, "Silinecek").click();

    // #53'ün kararı: kategori bir ETİKETTİR, silinince işlemler "Kategorisiz" kalır. Hesabın
    // aksine burada bir engel yok — kullanıcıyı koruyan tek şey bu uyarı.
    await expect(
      page.getByText("Bu kategoriyi kullanan işlemler silinmez, 'Kategorisiz' olarak kalır."),
    ).toBeVisible();

    await page.getByRole("button", { name: "Evet, sil" }).click();

    await expect(page.getByRole("cell", { name: "Silinecek", exact: true })).toHaveCount(0, {
      timeout: ROW_TIMEOUT_MS,
    });
    expect(await apiCategories(page, tenantId)).toHaveLength(0);
  });

  test("kullanımdaki kategori silinince İŞLEM SİLİNMİYOR, kategorisiz kalıyor", async ({
    page,
  }) => {
    await signUpAndSignIn(page, "categories-delete-inuse");
    const tenantId = await createAndActivateTenant(page);

    const accountResponse = await page.request.post(`/api/tenants/${tenantId}/accounts`, {
      data: { name: "Kasa", type: "CASH", currency: "TRY" },
    });
    expect(accountResponse.status()).toBe(201);
    const accountId = ((await accountResponse.json()) as { account: { id: string } }).account.id;

    const categoryResponse = await page.request.post(`/api/tenants/${tenantId}/categories`, {
      data: { name: "Kullanimda", type: "EXPENSE" },
    });
    expect(categoryResponse.status()).toBe(201);
    const categoryId = ((await categoryResponse.json()) as { category: { id: string } }).category
      .id;

    const txResponse = await page.request.post(`/api/tenants/${tenantId}/transactions`, {
      data: { accountId, categoryId, type: "EXPENSE", amount: "25", description: "Kalmali" },
    });
    expect(txResponse.status()).toBe(201);

    await page.goto("/categories");
    await deleteButton(page, "Kullanimda").click();
    await page.getByRole("button", { name: "Evet, sil" }).click();

    await expect(page.getByRole("cell", { name: "Kullanimda", exact: true })).toHaveCount(0, {
      timeout: ROW_TIMEOUT_MS,
    });

    // Bağımsız doğrulama: işlem DURUYOR ve kategorisiz kalmış (`onDelete: SetNull`).
    const transactions = await page.request.get(`/api/tenants/${tenantId}/transactions`);
    const body = (await transactions.json()) as {
      transactions: Array<{ description: string | null; categoryId: string | null }>;
    };
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0].description).toBe("Kalmali");
    expect(body.transactions[0].categoryId).toBeNull();
  });

  test("MEMBER düzenle/sil aksiyonlarını GÖRMÜYOR ve baypas edilirse 403 alıyor", async ({
    page,
  }) => {
    const viewerId = await signUpAndSignIn(page, "categories-actions-viewer");

    const tenant = await prisma.tenant.create({
      data: { name: "Baska Alan", slug: `categories-actions-${randomUUID()}` },
      select: { id: true },
    });
    createdTenantIds.push(tenant.id);

    const category = await prisma.category.create({
      data: { tenantId: tenant.id, name: "Ortak Harcama", type: "EXPENSE" },
      select: { id: true },
    });
    await prisma.membership.create({
      data: { userId: viewerId, tenantId: tenant.id, role: "MEMBER" },
    });

    const activated = await page.request.post("/api/tenants/active", {
      data: { tenantId: tenant.id },
    });
    expect(activated.status()).toBe(200);

    await page.goto("/categories");

    await expect(page.getByRole("cell", { name: "Ortak Harcama", exact: true })).toBeVisible();
    await expect(editLink(page, "Ortak Harcama")).toHaveCount(0);
    await expect(deleteButton(page, "Ortak Harcama")).toHaveCount(0);

    const patch = await page.request.patch(`/api/tenants/${tenant.id}/categories/${category.id}`, {
      data: { name: "Ele Gecti" },
    });
    expect(patch.status()).toBe(403);

    const remove = await page.request.delete(
      `/api/tenants/${tenant.id}/categories/${category.id}`,
    );
    expect(remove.status()).toBe(403);

    const unchanged = await prisma.category.findUniqueOrThrow({ where: { id: category.id } });
    expect(unchanged.name).toBe("Ortak Harcama");
  });
});
