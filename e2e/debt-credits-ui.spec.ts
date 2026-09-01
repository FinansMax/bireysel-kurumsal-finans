import { randomUUID } from "node:crypto";

import { MembershipRole } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";

import { prisma } from "../src/lib/prisma";

import { signInWithCredentials } from "./support/auth";
import { uniqueTestClientIp } from "./support/rate-limit";

/**
 * Borç/alacak ekranı — gerçek tarayıcıda, gerçek API'ye karşı (Issue #70).
 *
 * `accounts-ui.spec.ts` ile aynı duruş: sonuç her zaman BAĞIMSIZ bir okumayla
 * (`GET .../debt-credits`) doğrulanır — listede bir satırın görünmesi tek başına "sunucuda
 * gerçekten oluştu" demek değildir.
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

/**
 * Sunucu round-trip'ine bağlı beklemeler için süre (bkz. #129 ve `accounts-ui.spec.ts`).
 *
 * Varsayılan 5 saniye, tam e2e suite'i paralel koşarken YETMİYOR: form `fetch` ile
 * POST/PATCH atar, ardından `router.push()` + `router.refresh()` çağırır — yani hem satırın
 * listede belirmesi hem de `?edit=` parametresinin DÜŞMESİ bir sunucu gidiş-dönüşüne ve RSC
 * yeniden render'ına bağlıdır. Bu süre verilmediğinde test, uygulama doğru çalıştığı hâlde
 * kırmızıya düşüyordu (yük altında ölçüldü).
 *
 * BU BİR GEVŞETME DEĞİLDİR: iddialar aynı kalır, yalnızca bilinen bir yavaş adıma daha fazla
 * süre tanınır. Kaydın sunucuda gerçekten oluştuğu zaten bağımsız bir API okumasıyla, bu
 * beklemelerden AYRI olarak doğrulanıyor.
 *
 * Menü tıklaması gibi düz gezinmelerde varsayılan süre KORUNUR — orada yavaşlık beklenmez ve
 * gereksiz uzun bir bekleme, gerçek bir kırılmayı geç fark ettirir.
 */
const ROW_TIMEOUT_MS = 15_000;

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

  const signedIn = await signInWithCredentials(page.request, email, PASSWORD);
  expect(signedIn.status()).toBe(302);

  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  createdUserIds.push(user.id);
  return user.id;
}

async function createAndActivateTenant(page: Page): Promise<string> {
  const response = await page.request.post("/api/tenants", {
    data: { name: "Borc Ekrani", slug: `debt-ui-${randomUUID()}` },
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

async function apiRecords(page: Page, tenantId: string) {
  const response = await page.request.get(`/api/tenants/${tenantId}/debt-credits`);
  expect(response.status()).toBe(200);

  return ((await response.json()) as {
    debtCredits: Array<{
      id: string;
      type: string;
      counterparty: string;
      amount: string;
      currency: string;
      dueDate: string | null;
      status: string;
    }>;
  }).debtCredits;
}

async function fillForm(
  page: Page,
  values: { counterparty: string; amount: string; type?: string; dueDate?: string },
) {
  if (values.type) {
    await page.getByLabel("Tür").selectOption(values.type);
  }
  await page.getByLabel("Karşı taraf").fill(values.counterparty);
  await page.getByLabel("Tutar").fill(values.amount);
  if (values.dueDate !== undefined) {
    await page.getByLabel("Vade (isteğe bağlı)").fill(values.dueDate);
  }
}

function submit(page: Page) {
  return page.getByRole("button", { name: "Kaydet", exact: true }).click();
}

function expectRow(page: Page, name: string) {
  return expect(page.getByRole("cell", { name, exact: true })).toBeVisible({
    timeout: ROW_TIMEOUT_MS,
  });
}

test.describe("/debt-credits — oluşturma ve listeleme", () => {
  test("menüden gidilip kayıt oluşturuluyor ve listede görünüyor", async ({ page }) => {
    await signUpAndSignIn(page, "debt-create");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/dashboard");
    await page
      .getByRole("navigation", { name: "Ana menü" })
      .getByRole("link", { name: "Borç/Alacak" })
      .click();
    await expect(page).toHaveURL(/\/debt-credits$/);

    await expect(page.getByText("Henüz borç/alacak kaydı yok")).toBeVisible();

    await fillForm(page, {
      type: "CREDIT",
      counterparty: "Ahmet Yilmaz",
      amount: "2500.75",
      dueDate: "2026-12-31",
    });
    await submit(page);

    await expectRow(page, "Ahmet Yilmaz");

    // Asıl kanıt: kayıt sunucuda var ve para STRING olarak, hassasiyeti bozulmadan duruyor.
    const records = await apiRecords(page, tenantId);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      type: "CREDIT",
      counterparty: "Ahmet Yilmaz",
      amount: "2500.75",
      currency: "TRY",
      status: "OPEN",
    });

    // Alacak `+` ile gösterilir; yönü `type` taşır (#53'ün kuralı).
    await expect(page.getByRole("table").getByText("+2500.75 TRY")).toBeVisible();
    await expect(page.getByRole("table").getByText("Alacak")).toBeVisible();
    await expect(page.getByRole("table").getByText("Açık")).toBeVisible();
  });

  test("vade boş bırakılabiliyor ve listede '—' olarak görünüyor", async ({ page }) => {
    await signUpAndSignIn(page, "debt-nodue");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/debt-credits");
    // "Borçluyum ama tarihi belli değil" meşru bir kayıttır; uydurma tarih girmeye
    // zorlanmamalı.
    await fillForm(page, { counterparty: "Vadesiz Kayit", amount: "100" });
    await submit(page);

    await expectRow(page, "Vadesiz Kayit");

    const records = await apiRecords(page, tenantId);
    expect(records[0].dueDate).toBeNull();
    await expect(page.getByRole("table").getByText("—")).toBeVisible();
  });

  test("geçersiz tutar formda hata veriyor ve kayıt oluşmuyor", async ({ page }) => {
    await signUpAndSignIn(page, "debt-invalid");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/debt-credits");
    // Yön tür alanından gelir; eksi yazmak reddedilir (negatif bir borç, kılık değiştirmiş
    // bir alacak olurdu).
    await fillForm(page, { counterparty: "Gecersiz Tutar", amount: "-50" });
    await submit(page);

    await expect(page.locator("form").getByRole("alert")).toContainText("tutar pozitif", {
      timeout: ROW_TIMEOUT_MS,
    });
    expect(await apiRecords(page, tenantId)).toHaveLength(0);
  });

  test("vadesi geçmiş AÇIK kayıt 'Gecikmiş' işaretleniyor; kapanmış olan işaretlenmiyor", async ({
    page,
  }) => {
    await signUpAndSignIn(page, "debt-overdue");
    const tenantId = await createAndActivateTenant(page);

    await page.request.post(`/api/tenants/${tenantId}/debt-credits`, {
      data: {
        type: "DEBT",
        counterparty: "Geciken Borc",
        amount: "100",
        currency: "TRY",
        dueDate: "2020-01-01",
      },
    });
    await page.request.post(`/api/tenants/${tenantId}/debt-credits`, {
      data: {
        type: "DEBT",
        counterparty: "Kapanmis Borc",
        amount: "100",
        currency: "TRY",
        dueDate: "2020-01-01",
        status: "SETTLED",
      },
    });

    await page.goto("/debt-credits");

    // İş bitmiş bir kayıtta kırmızı rozet yalnızca gürültü olurdu.
    await expect(page.getByRole("table").getByText("Gecikmiş")).toHaveCount(1);
    const overdueRow = page.getByRole("row").filter({ hasText: "Geciken Borc" });
    await expect(overdueRow.getByText("Gecikmiş")).toBeVisible();
  });
});

test.describe("/debt-credits — düzenleme, durum ve silme", () => {
  function editLink(page: Page, counterparty: string) {
    return page.getByRole("link", { name: `${counterparty} kaydını düzenle` });
  }

  function editForm(page: Page) {
    return page.getByRole("form", { name: "Kaydı düzenle" });
  }

  test("kayıt 'Kapandı' işaretleniyor ve geri açılabiliyor", async ({ page }) => {
    await signUpAndSignIn(page, "debt-settle");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/debt-credits");
    await fillForm(page, { counterparty: "Kapatilacak", amount: "300" });
    await submit(page);
    await expectRow(page, "Kapatilacak");

    await editLink(page, "Kapatilacak").click();
    // İDDİALAR DÜZENLEME FORMUNA KAPSANIR: oluşturma formunun da aynı adlı alanları var ve
    // istemci tarafı gezinme tamamlanmadan sayfa geneli bir locator ESKİ formu bulurdu.
    const form = editForm(page);

    // Kullanıcı bunu bilmeli: "kapandı" bir ödeme kaydı DEĞİLDİR.
    await expect(
      form.getByText("işlem oluşturmaz", { exact: false }),
    ).toBeVisible();

    await form.getByLabel("Durum").selectOption("SETTLED");
    await page.getByRole("button", { name: /değişiklikleri kaydet/i }).click();
    await expect(page).toHaveURL(/\/debt-credits$/, { timeout: ROW_TIMEOUT_MS });

    expect((await apiRecords(page, tenantId))[0].status).toBe("SETTLED");
    await expect(page.getByRole("table").getByText("Kapandı")).toBeVisible();

    // GERİ DÖNÜŞ VAR: yanlış işaretlemenin düzeltilmesi, silip yeniden oluşturmayı
    // gerektirmemeli.
    await editLink(page, "Kapatilacak").click();
    await editForm(page).getByLabel("Durum").selectOption("OPEN");
    await page.getByRole("button", { name: /değişiklikleri kaydet/i }).click();
    await expect(page).toHaveURL(/\/debt-credits$/, { timeout: ROW_TIMEOUT_MS });

    expect((await apiRecords(page, tenantId))[0].status).toBe("OPEN");
  });

  test("düzenleme formu dolu geliyor ve tutar güncelleniyor", async ({ page }) => {
    await signUpAndSignIn(page, "debt-edit");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/debt-credits");
    await fillForm(page, { counterparty: "Duzenlenecek", amount: "300", dueDate: "2026-06-15" });
    await submit(page);
    await expectRow(page, "Duzenlenecek");

    await editLink(page, "Duzenlenecek").click();
    const form = editForm(page);

    await expect(form.getByLabel("Karşı taraf")).toHaveValue("Duzenlenecek");
    await expect(form.getByLabel("Tutar")).toHaveValue("300");
    await expect(form.getByLabel("Vade (isteğe bağlı)")).toHaveValue("2026-06-15");

    await form.getByLabel("Tutar").fill("450.25");
    await page.getByRole("button", { name: /değişiklikleri kaydet/i }).click();
    await expect(page).toHaveURL(/\/debt-credits$/, { timeout: ROW_TIMEOUT_MS });

    expect((await apiRecords(page, tenantId))[0].amount).toBe("450.25");
  });

  test("kayıt siliniyor: onay isteniyor, onaylanınca gidiyor", async ({ page }) => {
    await signUpAndSignIn(page, "debt-delete");
    const tenantId = await createAndActivateTenant(page);

    await page.goto("/debt-credits");
    await fillForm(page, { counterparty: "Silinecek", amount: "100" });
    await submit(page);
    await expectRow(page, "Silinecek");

    await page.getByRole("button", { name: "Silinecek kaydını sil" }).click();
    await page.getByRole("button", { name: /evet, sil/i }).click();

    await expect(page.getByText("Henüz borç/alacak kaydı yok")).toBeVisible({
      timeout: ROW_TIMEOUT_MS,
    });
    expect(await apiRecords(page, tenantId)).toHaveLength(0);
  });

  test("MEMBER listeyi görüyor ama form ve aksiyonları GÖRMÜYOR", async ({ page }) => {
    const ownerId = await signUpAndSignIn(page, "debt-owner");
    const tenantId = await createAndActivateTenant(page);

    await page.request.post(`/api/tenants/${tenantId}/debt-credits`, {
      data: { type: "DEBT", counterparty: "Gorunur Kayit", amount: "100", currency: "TRY" },
    });

    // Aynı tarayıcıda ikinci bir kullanıcı: MEMBER olarak aynı tenant'a bağlanır.
    const memberId = await signUpAndSignIn(page, "debt-member");
    expect(memberId).not.toBe(ownerId);
    await prisma.membership.create({
      data: { userId: memberId, tenantId, role: MembershipRole.MEMBER },
    });
    await page.request.post("/api/tenants/active", { data: { tenantId } });

    await page.goto("/debt-credits");

    await expectRow(page, "Gorunur Kayit");
    // Yetki UI'da GİZLENMEKLE kalmaz, backend'de de zorlanır (bkz. security spec).
    await expect(page.getByRole("form", { name: "Yeni borç/alacak" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Gorunur Kayit kaydını düzenle" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Gorunur Kayit kaydını sil" })).toHaveCount(0);
  });
});
