import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import { signInWithCredentials } from "./support/auth";
import { uniqueTestClientIp } from "./support/rate-limit";

/**
 * Hesap ekranı — gerçek tarayıcıda, gerçek API'ye karşı (Issue #47).
 *
 * Sonuç her zaman bağımsız bir okuma yoluyla (`GET /api/tenants/:id/accounts`) doğrulanır:
 * listede bir satırın görünmesi tek başına "sunucuda gerçekten oluştu" demek değildir.
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
    data: { name: "Hesap Ekrani", slug: `accounts-ui-${randomUUID()}` },
    headers: apiHeaders(),
  });
  expect(response.status()).toBe(201);

  const { tenant } = (await response.json()) as { tenant: { id: string } };
  createdTenantIds.push(tenant.id);

  const activated = await page.request.post("/api/tenants/active", { data: { tenantId: tenant.id } });
  expect(activated.status()).toBe(200);

  return tenant.id;
}

async function apiAccounts(
  page: Page,
  tenantId: string,
): Promise<
  Array<{
    name: string;
    type: string;
    balance: string;
    currency: string;
    bankCode: string | null;
  }>
> {
  const response = await page.request.get(`/api/tenants/${tenantId}/accounts`);
  expect(response.status()).toBe(200);

  return (
    (await response.json()) as {
      accounts: Array<{
        name: string;
        type: string;
        balance: string;
        currency: string;
        bankCode: string | null;
      }>;
    }
  ).accounts;
}

async function fillAccountForm(
  page: Page,
  values: { name: string; type?: string; currency?: string; balance?: string; bank?: string },
) {
  await page.getByLabel("Hesap adı").fill(values.name);
  if (values.type) {
    await page.getByLabel("Tür").selectOption(values.type);
  }

  // BANKA SEÇİMİ ARAYÜZDE ZORUNLUDUR (Issue #148): tür "Banka" iken seçim yapılmadan gönderim
  // reddedilir. Bu yüzden yardımcı, seçici görünürse ve test bir banka BELİRTMEMİŞSE varsayılan
  // bir banka seçer — böylece bankayla ilgisi olmayan mevcut testler kendi konularına odaklı
  // kalır. Zorunluluğun KENDİSİ ayrı bir testte doğrulanır ("banka seçmeden kaydedilemiyor").
  const bankSelect = page.getByLabel("Banka");
  if (await bankSelect.isVisible()) {
    if (values.bank !== undefined) {
      await bankSelect.selectOption(values.bank);
    } else if ((await bankSelect.inputValue()) === "") {
      await bankSelect.selectOption("ZIRAAT");
    }
  }
  if (values.currency !== undefined) {
    await page.getByLabel("Para birimi").fill(values.currency);
  }
  if (values.balance !== undefined) {
    await page.getByLabel("Açılış bakiyesi (isteğe bağlı)").fill(values.balance);
  }
}

function submit(page: Page) {
  return page.getByRole("button", { name: /hesap oluştur/i }).click();
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

test.describe("/accounts — oluşturma ve listeleme", () => {
  test("menüden gidilip hesap oluşturuluyor ve listede görünüyor", async ({ page }) => {
    await signUpAndSignIn(page, "accounts-create");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/dashboard");
    await page
      .getByRole("navigation", { name: "Ana menü" })
      .getByRole("link", { name: "Hesaplar" })
      .click();
    await expect(page).toHaveURL(/\/accounts$/);

    // Boş durum: henüz hesap yok.
    await expect(page.getByText("Henüz hesap yok")).toBeVisible();

    await fillAccountForm(page, {
      name: "Vadesiz TL",
      type: "BANK",
      currency: "TRY",
      balance: "1500.75",
    });
    await submit(page);

    // Liste sunucudan yeniden render edilir.
    await expectRow(page, "Vadesiz TL");

    // Asıl kanıt: kayıt sunucuda var ve para STRING olarak, hassasiyeti bozulmadan duruyor.
    const accounts = await apiAccounts(page, tenantId);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      name: "Vadesiz TL",
      type: "BANK",
      currency: "TRY",
      balance: "1500.75",
    });
  });

  test("açılış bakiyesi boş bırakılınca 0 kabul ediliyor", async ({ page }) => {
    await signUpAndSignIn(page, "accounts-nobalance");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/accounts");
    // Bakiye alanı HİÇ doldurulmaz: form bu durumda alanı göndermemelidir (boş string
    // gönderilseydi backend "geçersiz tutar" diye 400 dönerdi).
    // Hesap adı bilerek tür etiketinden ("Kasa") FARKLI seçildi: aynı satırda hem ad hem tür
    // hücresi olduğu için "Kasa" adı, locator'ı iki hücreye birden eşleştirirdi.
    await fillAccountForm(page, { name: "Merkez Nakit", type: "CASH", currency: "TRY" });
    await submit(page);

    await expectRow(page, "Merkez Nakit");

    const accounts = await apiAccounts(page, tenantId);
    expect(accounts[0].balance).toBe("0");
    expect(accounts[0].type).toBe("CASH");
  });

  test("aynı isim ikinci kez kullanılamıyor (formda hata, yeni kayıt yok)", async ({ page }) => {
    await signUpAndSignIn(page, "accounts-dup");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/accounts");
    await fillAccountForm(page, { name: "Tek Hesap", currency: "TRY" });
    await submit(page);
    await expectRow(page, "Tek Hesap");

    await fillAccountForm(page, { name: "Tek Hesap", currency: "TRY" });
    await submit(page);

    await expect(formAlert(page)).toContainText("zaten var", { timeout: ROW_TIMEOUT_MS });
    expect(await apiAccounts(page, tenantId)).toHaveLength(1);
  });

  test("geçersiz bakiye biçimi formda hata veriyor ve kayıt oluşmuyor", async ({ page }) => {
    await signUpAndSignIn(page, "accounts-badmoney");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/accounts");
    // 4'ten fazla ondalık: `Decimal(19,4)` şemasının kabul etmediği bir değer.
    await fillAccountForm(page, { name: "Hatali", currency: "TRY", balance: "10.12345" });
    await submit(page);

    await expect(formAlert(page)).toContainText("Bilgileri kontrol edin", {
      timeout: ROW_TIMEOUT_MS,
    });
    expect(await apiAccounts(page, tenantId)).toHaveLength(0);
  });
});

test.describe("/accounts — yetki ve tenant durumu", () => {
  test("MEMBER listeyi görüyor ama oluşturma formunu görmüyor", async ({ page }) => {
    const viewerId = await signUpAndSignIn(page, "accounts-viewer");

    const tenant = await prisma.tenant.create({
      data: { name: "Baska Alan", slug: `accounts-viewer-${randomUUID()}` },
      select: { id: true },
    });
    createdTenantIds.push(tenant.id);

    await prisma.account.create({
      data: { tenantId: tenant.id, name: "Ortak Kasa", type: "CASH", currency: "TRY", balance: "42.5000" },
    });
    await prisma.membership.create({
      data: { userId: viewerId, tenantId: tenant.id, role: "MEMBER" },
    });

    const activated = await page.request.post("/api/tenants/active", { data: { tenantId: tenant.id } });
    expect(activated.status()).toBe(200);

    await page.goto("/accounts");

    // İzin matrisi MEMBER'a VIEW_ACCOUNTS verir: liste görünür.
    await expect(page.getByRole("cell", { name: "Ortak Kasa", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "42.5 TRY", exact: true })).toBeVisible();

    // Ama yönetim formu HİÇ render edilmez.
    await expect(page.getByLabel("Hesap adı")).toHaveCount(0);

    // Asıl kontrol arayüzde değil backend'de: form baypas edilirse 403 gelir.
    const forced = await page.request.post(`/api/tenants/${tenant.id}/accounts`, {
      data: { name: "Zorla", type: "BANK", currency: "TRY" },
    });
    expect(forced.status()).toBe(403);
  });

  test("aktif çalışma alanı yokken liste yerine yönlendirici metin gösteriliyor", async ({ page }) => {
    await signUpAndSignIn(page, "accounts-notenant");

    await page.goto("/accounts");

    await expect(page.getByText("Önce menüden bir çalışma alanı seçin")).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByLabel("Hesap adı")).toHaveCount(0);
  });
});

test.describe("/accounts — düzenleme ve silme (Issue #130)", () => {
  function editLink(page: Page, accountName: string) {
    return page.getByRole("link", { name: `${accountName} hesabını düzenle` });
  }

  function deleteButton(page: Page, accountName: string) {
    return page.getByRole("button", { name: `${accountName} hesabını sil` });
  }

  function saveEdit(page: Page) {
    return editForm(page).getByRole("button", { name: "Değişiklikleri kaydet" }).click();
  }

  /**
   * Düzenleme formu ERİŞİLEBİLİR ADIYLA bulunur ve alanlar ona kapsamlandırılır.
   *
   * Kapsamlandırmadan `page.getByLabel(...)` bir YARIŞ üretir: düzenleme linkine tıklandıktan
   * sonra sayfa istemci tarafında yeniden render edilirken oluşturma formu hâlâ DOM'da durur
   * ve Playwright onun alanına yazabilir (bu tuzak `categories-ui.spec.ts`'te gözlendi).
   */
  function editForm(page: Page) {
    return page.getByRole("form", { name: "Hesabı düzenle" });
  }

  test("hesap düzenleniyor: form dolu geliyor, kaydedince liste ve API güncelleniyor", async ({
    page,
  }) => {
    await signUpAndSignIn(page, "accounts-edit");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/accounts");

    await fillAccountForm(page, { name: "Eski Ad", currency: "TRY" });
    await submit(page);
    await expectRow(page, "Eski Ad");

    await editLink(page, "Eski Ad").click();

    // Form MEVCUT değerlerle dolu gelmeli; boş bir form kullanıcıyı her alanı yeniden
    // yazmaya zorlardı ve dokunmadığı alanları sıfırlama riski taşırdı.
    await expect(editForm(page).getByLabel("Hesap adı")).toHaveValue("Eski Ad");
    await expect(editForm(page).getByLabel("Para birimi")).toHaveValue("TRY");

    await editForm(page).getByLabel("Hesap adı").fill("Yeni Ad");
    await saveEdit(page);

    await expectRow(page, "Yeni Ad");
    await expect(page.getByRole("cell", { name: "Eski Ad", exact: true })).toHaveCount(0);

    const accounts = await apiAccounts(page, tenantId);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].name).toBe("Yeni Ad");

    // Kaydedince `?edit=` düşmeli: aksi halde kullanıcı kaydettiği hâlde formda duruyormuş
    // gibi görünürdü.
    await expect(page).toHaveURL(/\/accounts$/);
  });

  test("düzenleme formunda BAKİYE alanı YOK (bakiye işlemlerden türetilir)", async ({ page }) => {
    await signUpAndSignIn(page, "accounts-edit-nobalance");
    await createAndActivateTenant(page);

    await page.goto("/accounts");

    await fillAccountForm(page, { name: "Kasa", currency: "TRY", balance: "500" });
    await submit(page);
    await expectRow(page, "Kasa");

    // Oluşturmada alan VAR (kontrol grubu).
    await expect(page.getByLabel("Açılış bakiyesi (isteğe bağlı)")).toBeVisible();

    await editLink(page, "Kasa").click();

    // Düzenlemede YOK: #53'ten beri bakiye işlemlerden türetiliyor; elle düzenlenebilir bir
    // alan, "bakiye = işlemlerin toplamı" invariant'ını sessizce bozmaya davet ederdi.
    await expect(editForm(page).getByLabel("Hesap adı")).toHaveValue("Kasa");
    await expect(editForm(page).getByLabel("Açılış bakiyesi (isteğe bağlı)")).toHaveCount(0);
  });

  test("düzenlemeden vazgeçilince hiçbir şey değişmiyor", async ({ page }) => {
    await signUpAndSignIn(page, "accounts-edit-cancel");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/accounts");

    await fillAccountForm(page, { name: "Dokunma", currency: "TRY" });
    await submit(page);
    await expectRow(page, "Dokunma");

    await editLink(page, "Dokunma").click();
    await editForm(page).getByLabel("Hesap adı").fill("Degistirilmis");
    await page.getByRole("link", { name: "Vazgeç" }).click();

    await expect(page).toHaveURL(/\/accounts$/);
    expect((await apiAccounts(page, tenantId))[0].name).toBe("Dokunma");
  });

  test("hesap siliniyor: onay isteniyor, onaylanınca kayıt gidiyor", async ({ page }) => {
    await signUpAndSignIn(page, "accounts-delete");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/accounts");

    await fillAccountForm(page, { name: "Silinecek", currency: "TRY" });
    await submit(page);
    await expectRow(page, "Silinecek");

    await deleteButton(page, "Silinecek").click();

    // Tek tıkla silme YOK: geri alınamaz bir işlem için onay adımı zorunlu.
    await expect(page.getByText('"Silinecek" hesabını silmek istiyor musunuz?')).toBeVisible();
    expect(await apiAccounts(page, tenantId)).toHaveLength(1);

    await page.getByRole("button", { name: "Evet, sil" }).click();

    await expect(page.getByRole("cell", { name: "Silinecek", exact: true })).toHaveCount(0, {
      timeout: ROW_TIMEOUT_MS,
    });
    expect(await apiAccounts(page, tenantId)).toHaveLength(0);
  });

  test("silmekten vazgeçilince kayıt duruyor", async ({ page }) => {
    await signUpAndSignIn(page, "accounts-delete-cancel");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/accounts");

    await fillAccountForm(page, { name: "Kalacak", currency: "TRY" });
    await submit(page);
    await expectRow(page, "Kalacak");

    await deleteButton(page, "Kalacak").click();
    await page.getByRole("button", { name: "Vazgeç" }).click();

    await expect(page.getByText("silmek istiyor musunuz?")).toHaveCount(0);
    expect(await apiAccounts(page, tenantId)).toHaveLength(1);
  });

  test("İŞLEMİ OLAN hesap silinemiyor: ham 409 değil, ne yapılacağı söyleniyor", async ({
    page,
  }) => {
    await signUpAndSignIn(page, "accounts-delete-blocked");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/accounts");

    await fillAccountForm(page, { name: "Islemli", currency: "TRY" });
    await submit(page);
    await expectRow(page, "Islemli");

    const accountsResponse = await page.request.get(`/api/tenants/${tenantId}/accounts`);
    const { accounts } = (await accountsResponse.json()) as { accounts: Array<{ id: string }> };
    const created = await page.request.post(`/api/tenants/${tenantId}/transactions`, {
      data: { accountId: accounts[0].id, type: "EXPENSE", amount: "10" },
    });
    expect(created.status()).toBe(201);

    await page.reload();
    await deleteButton(page, "Islemli").click();
    await page.getByRole("button", { name: "Evet, sil" }).click();

    // #53'ün kararı: cascade REDDEDİLDİ, çünkü hesabı silmek finansal geçmişini yok ederdi.
    // Kullanıcı ham bir hata değil, çıkış yolu görmeli.
    await expect(
      page.getByText("Bu hesabın işlemleri var. Önce işlemleri silin veya başka bir hesaba taşıyın."),
    ).toBeVisible({ timeout: ROW_TIMEOUT_MS });

    expect(await apiAccounts(page, tenantId)).toHaveLength(1);
  });

  test("MEMBER düzenle/sil aksiyonlarını GÖRMÜYOR ve baypas edilirse 403 alıyor", async ({
    page,
  }) => {
    const viewerId = await signUpAndSignIn(page, "accounts-actions-viewer");

    const tenant = await prisma.tenant.create({
      data: { name: "Baska Alan", slug: `accounts-actions-${randomUUID()}` },
      select: { id: true },
    });
    createdTenantIds.push(tenant.id);

    const account = await prisma.account.create({
      data: { tenantId: tenant.id, name: "Ortak Kasa", type: "CASH", currency: "TRY" },
      select: { id: true },
    });
    await prisma.membership.create({
      data: { userId: viewerId, tenantId: tenant.id, role: "MEMBER" },
    });

    const activated = await page.request.post("/api/tenants/active", {
      data: { tenantId: tenant.id },
    });
    expect(activated.status()).toBe(200);

    await page.goto("/accounts");

    await expect(page.getByRole("cell", { name: "Ortak Kasa", exact: true })).toBeVisible();
    await expect(editLink(page, "Ortak Kasa")).toHaveCount(0);
    await expect(deleteButton(page, "Ortak Kasa")).toHaveCount(0);

    // Arayüzde gizlemek yetmez; asıl kontrol backend'de.
    const patch = await page.request.patch(`/api/tenants/${tenant.id}/accounts/${account.id}`, {
      data: { name: "Ele Gecti" },
    });
    expect(patch.status()).toBe(403);

    const remove = await page.request.delete(`/api/tenants/${tenant.id}/accounts/${account.id}`);
    expect(remove.status()).toBe(403);

    const unchanged = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(unchanged.name).toBe("Ortak Kasa");
  });
});

/**
 * Hesabın bankası (Issue #148).
 *
 * Konu: seçicinin türe göre görünmesi, arayüzdeki zorunluluk ve kaydedilen değerin
 * doğruluğu. Sonuç her zaman BAĞIMSIZ bir okumayla (`GET .../accounts`) doğrulanır — listede
 * bir rozetin görünmesi tek başına "sunucuda gerçekten kaydedildi" demek değildir.
 */
test.describe("/accounts — banka seçimi (Issue #148)", () => {
  test("banka seçici YALNIZCA tür 'Banka' iken görünür", async ({ page }) => {
    await signUpAndSignIn(page, "bank-toggle");
    await createAndActivateTenant(page);

    await page.goto("/accounts");

    // Varsayılan tür "Banka" olduğu için seçici açılışta görünür.
    await expect(page.getByLabel("Banka")).toBeVisible();

    await page.getByLabel("Tür").selectOption("CASH");
    // Kasa hesabının bankası olmaz; alanı devre dışı gösterip bırakmak "burada bir şey eksik"
    // hissi verirdi — hiç render edilmez.
    await expect(page.getByLabel("Banka")).toHaveCount(0);

    await page.getByLabel("Tür").selectOption("BANK");
    await expect(page.getByLabel("Banka")).toBeVisible();
  });

  test("banka seçmeden kaydedilemiyor ve sunucuda hiçbir kayıt oluşmuyor", async ({ page }) => {
    await signUpAndSignIn(page, "bank-required");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/accounts");
    await page.getByLabel("Hesap adı").fill("Bankasiz Hesap");
    await submit(page);

    await expect(formAlert(page)).toContainText("Banka hesapları için bir banka seçin.", {
      timeout: ROW_TIMEOUT_MS,
    });

    // Zorunluluk yalnızca bir mesaj değil: istek hiç gitmemiş olmalı.
    expect(await apiAccounts(page, tenantId)).toHaveLength(0);
  });

  test("seçilen banka kaydediliyor ve listede görünüyor", async ({ page }) => {
    await signUpAndSignIn(page, "bank-create");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/accounts");
    await fillAccountForm(page, { name: "Maas Hesabi", bank: "GARANTI" });
    await submit(page);

    await expectRow(page, "Maas Hesabi");
    // Listede KOD değil AD görünür. İddia TABLOYA kapsanır: form içindeki banka seçicisinin
    // <option> etiketleri de aynı adları taşır ve sayfa geneli bir eşleme onlara da uyardı.
    await expect(page.getByRole("table").getByText("Garanti BBVA")).toBeVisible();

    // BAĞIMSIZ DOĞRULAMA: sunucuda saklanan değer koddur.
    const accounts = await apiAccounts(page, tenantId);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].bankCode).toBe("GARANTI");
  });

  test("kasa hesabı bankasız kaydediliyor", async ({ page }) => {
    await signUpAndSignIn(page, "bank-cash");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/accounts");
    await fillAccountForm(page, { name: "Kucuk Kasa", type: "CASH" });
    await submit(page);

    await expectRow(page, "Kucuk Kasa");

    const accounts = await apiAccounts(page, tenantId);
    expect(accounts[0].type).toBe("CASH");
    expect(accounts[0].bankCode).toBeNull();
  });

  test("düzenlemede banka değiştirilebiliyor", async ({ page }) => {
    await signUpAndSignIn(page, "bank-edit");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/accounts");
    await fillAccountForm(page, { name: "Degisecek Hesap", bank: "ZIRAAT" });
    await submit(page);
    await expectRow(page, "Degisecek Hesap");

    const created = await apiAccounts(page, tenantId);
    expect(created[0].bankCode).toBe("ZIRAAT");

    await page.getByRole("link", { name: "Degisecek Hesap hesabını düzenle" }).click();
    const form = page.getByRole("form", { name: "Hesabı düzenle" });

    // Form MEVCUT bankayla dolu gelir; kullanıcı seçimini baştan yapmak zorunda değil.
    await expect(form.getByLabel("Banka")).toHaveValue("ZIRAAT");

    await form.getByLabel("Banka").selectOption("ISBANK");
    await page.getByRole("button", { name: /değişiklikleri kaydet/i }).click();

    // KAYDIN TAMAMLANDIĞININ İŞARETİ `?edit=`İN DÜŞMESİDİR — satırın listede görünmesi değil:
    // satır kaydetmeden ÖNCE de oradadır ve ona bakan bir bekleme, PATCH tamamlanmadan
    // ilerlerdi (yarış).
    await expect(page).toHaveURL(/\/accounts$/);

    expect((await apiAccounts(page, tenantId))[0].bankCode).toBe("ISBANK");
    await expect(page.getByRole("table").getByText("Türkiye İş Bankası")).toBeVisible({
      timeout: ROW_TIMEOUT_MS,
    });
  });

  test("tür KASA'ya çevrilince banka temizleniyor", async ({ page }) => {
    await signUpAndSignIn(page, "bank-clear");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/accounts");
    await fillAccountForm(page, { name: "Kasaya Donecek", bank: "AKBANK" });
    await submit(page);
    await expectRow(page, "Kasaya Donecek");

    await page.getByRole("link", { name: "Kasaya Donecek hesabını düzenle" }).click();

    // İDDİALAR DÜZENLEME FORMUNA KAPSANIR. Oluşturma formunun da "Tür" ve "Banka" alanları var;
    // istemci tarafı gezinme tamamlanmadan sayfa geneli bir locator ESKİ formu bulur, seçim
    // oraya gider ve kaydedilen kayıt hiç değişmez (sessizce yeşil kalabilecek bir yarış).
    const form = page.getByRole("form", { name: "Hesabı düzenle" });

    // Tür kasaya çevrilince banka seçici KAYBOLUR; kullanıcı ayrıca bir şey temizlemez.
    await form.getByLabel("Tür").selectOption("CASH");
    await expect(form.getByLabel("Banka")).toHaveCount(0);

    await page.getByRole("button", { name: /değişiklikleri kaydet/i }).click();
    await expect(page).toHaveURL(/\/accounts$/);

    // Eski banka kodu asılı kalmamalı: ileride banka bazlı her toplama onu sayardı.
    const accounts = await apiAccounts(page, tenantId);
    expect(accounts[0].type).toBe("CASH");
    expect(accounts[0].bankCode).toBeNull();
    await expect(page.getByRole("table").getByText("Akbank")).toHaveCount(0);
  });
});
