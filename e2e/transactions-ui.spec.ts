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

/**
 * Sayfada İKİ form var (kayıt ve filtre) ve ikisi "Hesap"/"Kategori" gibi etiketleri
 * PAYLAŞIYOR; dahası `getByLabel("Tarih")` filtre formundaki "Başlangıç tarihi"ne de alt dize
 * olarak uyuyor. Bu yüzden alanlar daima ilgili formun ERİŞİLEBİLİR ADIYLA kapsamlandırılır —
 * aksi halde locator iki öğeye birden eşleşir ve test strict mode ihlaliyle düşer.
 */
function createForm(page: Page) {
  return page.getByRole("form", { name: "Yeni işlem" });
}

function filterForm(page: Page) {
  return page.getByRole("form", { name: "İşlem filtreleri" });
}

async function fillTransactionForm(
  page: Page,
  values: { amount: string; type?: string; category?: string; description?: string; date?: string },
) {
  const form = createForm(page);
  if (values.type) {
    await form.getByLabel("Tür").selectOption(values.type);
  }
  await form.getByLabel("Tutar").fill(values.amount);
  if (values.category !== undefined) {
    await form.getByLabel("Kategori").selectOption({ label: values.category });
  }
  if (values.description !== undefined) {
    await form.getByLabel("Açıklama").fill(values.description);
  }
  if (values.date) {
    await form.getByLabel("Tarih").fill(values.date);
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
  return createForm(page).getByRole("button", { name: "İşlem kaydet" }).click();
}

function formAlert(page: Page) {
  return createForm(page).getByRole("alert");
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

    const category = createForm(page).getByLabel("Kategori");

    // Varsayılan tür "Gider": yalnızca gider kategorisi seçilebilir olmalı.
    await expect(category.getByRole("option", { name: "Market" })).toHaveCount(1);
    await expect(category.getByRole("option", { name: "Maas" })).toHaveCount(0);

    await category.selectOption({ label: "Market" });
    await expect(category).not.toHaveValue("");

    // Tür değişince liste diğer tarafa döner VE önceki seçim düşer — aksi halde kullanıcı
    // ekranda görünmeyen bir kategoriyle kaydetmeye çalışır ve sebebi görünmeyen 400 alırdı.
    await createForm(page).getByLabel("Tür").selectOption("INCOME");
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

    await expect(formAlert(page)).toBeVisible({ timeout: ROW_TIMEOUT_MS });

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
    await expect(createForm(page).getByLabel("Tutar")).toHaveValue("");
    await expect(createForm(page).getByLabel("Açıklama")).toHaveValue("");
    await expect(createForm(page).getByLabel("Tür")).toHaveValue("INCOME");
    await expect(createForm(page).getByLabel("Tarih")).toHaveValue("2026-02-10");
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
    await expect(createForm(page)).toHaveCount(0);
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
    await expect(createForm(page)).toHaveCount(0);

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
    await expect(createForm(page)).toHaveCount(0);
  });
});

test.describe("/transactions — filtreleme (Issue #56)", () => {
  async function createViaApi(
    page: Page,
    tenantId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const response = await page.request.post(`/api/tenants/${tenantId}/transactions`, { data });
    expect(response.status()).toBe(201);
  }

  /** Tarihleri ve açıklamaları bilinen, iki hesaplı bir veri kümesi. */
  async function seedScreen(page: Page, prefix: string) {
    await signUpAndSignIn(page, prefix);
    const tenantId = await createAndActivateTenant(page);
    const kasa = await createAccount(page, tenantId, "Kasa", "0");
    const banka = await createAccount(page, tenantId, "Banka", "0");

    await createViaApi(page, tenantId, {
      accountId: kasa,
      type: "EXPENSE",
      amount: "10",
      description: "Ocak kirasi",
      occurredAt: "2026-01-10",
    });
    await createViaApi(page, tenantId, {
      accountId: kasa,
      type: "INCOME",
      amount: "20",
      description: "Subat maasi",
      occurredAt: "2026-02-20",
    });
    await createViaApi(page, tenantId, {
      accountId: banka,
      type: "EXPENSE",
      amount: "30",
      description: "Mart yakiti",
      occurredAt: "2026-03-30",
    });

    return { tenantId, kasa, banka };
  }

  function row(page: Page, name: string) {
    return page.getByRole("cell", { name });
  }

  test("tarih aralığı listeyi daraltıyor ve filtre URL'e yazılıyor", async ({ page }) => {
    const { tenantId } = await seedScreen(page, "tx-filter-range");

    await page.goto("/transactions");
    await expect(row(page, "Ocak kirasi")).toBeVisible();

    const filters = filterForm(page);
    await filters.getByLabel("Başlangıç tarihi").fill("2026-02-01");
    await filters.getByLabel("Bitiş tarihi").fill("2026-02-28");
    await filters.getByRole("button", { name: "Filtrele" }).click();

    await expect(row(page, "Subat maasi")).toBeVisible();
    await expect(row(page, "Ocak kirasi")).toHaveCount(0);
    await expect(row(page, "Mart yakiti")).toHaveCount(0);

    // Filtre durumu URL'de: sonuç paylaşılabilir ve geri tuşu doğru çalışır.
    await expect(page).toHaveURL(/from=2026-02-01/);
    await expect(page).toHaveURL(/to=2026-02-28/);

    // Bağımsız doğrulama: API aynı filtreyle aynı sonucu veriyor.
    const api = await page.request.get(
      `/api/tenants/${tenantId}/transactions?from=2026-02-01&to=2026-02-28`,
    );
    expect(api.status()).toBe(200);
    expect(((await api.json()) as { transactions: unknown[] }).transactions).toHaveLength(1);
  });

  test("bitiş tarihi DAHİL — o gün içinde saati olan kayıt eleniyor değil", async ({ page }) => {
    await signUpAndSignIn(page, "tx-filter-bound");
    const tenantId = await createAndActivateTenant(page);
    const kasa = await createAccount(page, tenantId, "Kasa", "0");

    // Bu testin varlık sebebi: üst sınır `lte: gün başlangıcı` olarak yazılsaydı, aynı günün
    // 10:00'unda kaydedilmiş bu işlem sessizce DIŞARIDA kalırdı.
    await createViaApi(page, tenantId, {
      accountId: kasa,
      type: "EXPENSE",
      amount: "1",
      description: "Sinirdaki kayit",
      occurredAt: "2026-03-15T10:00:00.000Z",
    });

    await page.goto("/transactions?to=2026-03-15");
    await expect(row(page, "Sinirdaki kayit")).toBeVisible();
  });

  test("hesap filtresi yalnızca o hesabın kayıtlarını bırakıyor", async ({ page }) => {
    await seedScreen(page, "tx-filter-account");

    await page.goto("/transactions");
    await filterForm(page).getByLabel("Hesap").selectOption({ label: "Banka" });
    await filterForm(page).getByRole("button", { name: "Filtrele" }).click();

    await expect(row(page, "Mart yakiti")).toBeVisible();
    await expect(row(page, "Ocak kirasi")).toHaveCount(0);
  });

  test("açıklamada arama büyük/küçük harf duyarsız", async ({ page }) => {
    await seedScreen(page, "tx-filter-search");

    await page.goto("/transactions");
    await filterForm(page).getByLabel("Açıklamada ara").fill("KIRA");
    await filterForm(page).getByRole("button", { name: "Filtrele" }).click();

    await expect(row(page, "Ocak kirasi")).toBeVisible();
    await expect(row(page, "Subat maasi")).toHaveCount(0);
  });

  test("eşleşme yoksa 'filtreyle eşleşen yok' denir, 'henüz işlem yok' DENMEZ", async ({
    page,
  }) => {
    await seedScreen(page, "tx-filter-empty");

    await page.goto("/transactions?q=hicbiryerde-gecmeyen");

    // İki boş durumu aynı cümleyle geçmek, kullanıcının elindeki kayıtları yok saymak olurdu.
    await expect(page.getByText("Bu filtreyle eşleşen işlem yok")).toBeVisible();
    await expect(page.getByText("Henüz işlem yok")).toHaveCount(0);
  });

  test("'Filtreleri temizle' tam listeye dönüyor", async ({ page }) => {
    await seedScreen(page, "tx-filter-clear");

    await page.goto("/transactions?q=kira");
    await expect(row(page, "Subat maasi")).toHaveCount(0);

    await page.getByRole("link", { name: "Filtreleri temizle" }).click();

    await expect(row(page, "Ocak kirasi")).toBeVisible();
    await expect(row(page, "Subat maasi")).toBeVisible();
    await expect(row(page, "Mart yakiti")).toBeVisible();
    await expect(page).toHaveURL(/\/transactions$/);
  });

  test("filtre yokken 'Filtreleri temizle' hiç gösterilmiyor", async ({ page }) => {
    await seedScreen(page, "tx-filter-noclear");

    await page.goto("/transactions");
    await expect(page.getByRole("link", { name: "Filtreleri temizle" })).toHaveCount(0);
  });

  test("GEÇERSİZ filtre: hata gösteriliyor ve liste GÖSTERİLMİYOR (tam liste de değil)", async ({
    page,
  }) => {
    await seedScreen(page, "tx-filter-invalid");

    // Elle düzenlenmiş URL: ters aralık.
    await page.goto("/transactions?from=2026-04-01&to=2026-03-01");

    // Hata METNİYLE aranır, `getByRole("alert")` ile DEĞİL: Next.js her sayfaya kendi
    // route duyurucusunu (`__next-route-announcer__`) `role="alert"` ile ekler ve rol
    // sorgusu iki öğeye birden eşleşir.
    await expect(page.getByText("Filtre geçersiz olduğu için")).toBeVisible();

    // KRİTİK: geçersiz filtreyi yok sayıp tüm listeyi göstermek, filtrenin uygulandığını
    // sanan kullanıcıya yanlış bir veri kümesini doğruymuş gibi sunmak olurdu.
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(row(page, "Ocak kirasi")).toHaveCount(0);

    // Duyarlılık kanıtı: aralık düzeltilince liste geri geliyor.
    await page.goto("/transactions?from=2026-01-01&to=2026-12-31");
    await expect(row(page, "Ocak kirasi")).toBeVisible();
  });

  test("filtre alanları gönderilen değerlerle dolu kalıyor", async ({ page }) => {
    await seedScreen(page, "tx-filter-sticky");

    await page.goto("/transactions?from=2026-01-01&q=kira");

    // Kullanıcı neye göre filtrelediğini formda görmeli; alanların sıfırlanması "filtre yok"
    // izlenimi verirdi.
    await expect(filterForm(page).getByLabel("Başlangıç tarihi")).toHaveValue("2026-01-01");
    await expect(filterForm(page).getByLabel("Açıklamada ara")).toHaveValue("kira");
  });
});
