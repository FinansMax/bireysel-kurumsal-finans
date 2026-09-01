import { MembershipRole } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { PERMISSIONS } from "../src/lib/authz/permissions";
import { MODULES, type ModuleDefinition, type ModuleKey } from "../src/lib/modules/catalog";
import { buildModuleNavLinks } from "../src/lib/modules/nav";

/**
 * Modül menüsünün kuralı (Issue #152).
 *
 * `buildModuleNavLinks()` SAF bir fonksiyondur: DB'ye gitmez, oturum okumaz. Bu yüzden burada
 * gerçek bir tarayıcı ya da veritabanı olmadan, SENTETİK bir katalogla test edilebilir.
 *
 * NEDEN SENTETİK KATALOG: gerçek katalog bugün (#151) bilerek boş `nav` listeleriyle geliyor —
 * modül ekranları kendi issue'larında (#160+) doğacak. Kuralı o güne kadar test edilemez
 * bırakmamak için `definitions` parametresi enjekte edilebilir tasarlandı. Ekranlar geldiğinde
 * bu testler DEĞİŞMEZ; yalnızca gerçek katalog dolar.
 *
 * ⚠️ Buradaki filtreleme bir UX kuralıdır, YETKİLENDİRME DEĞİL (invariant #3). Gerçek koruma
 * `requireModule()`/`requirePageModule()` guard'larındadır ve ayrıca test edilir.
 */

/**
 * Sentetik katalog: iki modül, üç menü öğesi.
 *
 * İzin adları GERÇEK matristen seçildi — uydurma bir izin, `hasPermission()` çağrısını anlamsız
 * kılardı. `MANAGE_MODULES` bilerek OWNER-only olan izindir: rol filtresini gerçekten sınar.
 */
const FAKE_CATALOG: Record<ModuleKey, ModuleDefinition> = {
  [MODULES.CRM]: {
    key: MODULES.CRM,
    label: "CRM",
    description: "test",
    dependsOn: [],
    permissions: [],
    nav: [
      { href: "/crm/institutions", label: "Kurumlar", permission: PERMISSIONS.VIEW_TENANT },
      { href: "/crm/settings", label: "CRM Ayarları", permission: PERMISSIONS.MANAGE_MODULES },
    ],
  },
  [MODULES.COLLECTIONS]: {
    key: MODULES.COLLECTIONS,
    label: "Tahsilat",
    description: "test",
    dependsOn: [MODULES.CRM],
    permissions: [],
    nav: [{ href: "/collections/plans", label: "Ödeme Planları", permission: PERMISSIONS.VIEW_TENANT }],
  },
};

test.describe("buildModuleNavLinks() — modül durumu filtresi", () => {
  test("hiçbir modül açık değilken link üretilmez", () => {
    expect(buildModuleNavLinks([], MembershipRole.OWNER, FAKE_CATALOG)).toEqual([]);
  });

  test("yalnızca AÇIK modülün linkleri görünür", () => {
    const links = buildModuleNavLinks([MODULES.CRM], MembershipRole.OWNER, FAKE_CATALOG);

    // Kapalı modülün ekranı o tenant için VAR DEĞİLDİR; linkini göstermek kullanıcıyı kesin
    // bir yönlendirmeye/404'e davet etmek olurdu.
    expect(links.map((link) => link.href)).toEqual(["/crm/institutions", "/crm/settings"]);
    expect(links.map((link) => link.href)).not.toContain("/collections/plans");
  });

  test("KONTROL GRUBU: modül açılınca linki beliriyor", () => {
    // Duyarlılık kanıtı: yukarıdaki "görünmez" iddiası, fonksiyon her koşulda boş dönseydi de
    // geçerdi.
    const links = buildModuleNavLinks(
      [MODULES.CRM, MODULES.COLLECTIONS],
      MembershipRole.OWNER,
      FAKE_CATALOG,
    );

    expect(links.map((link) => link.href)).toContain("/collections/plans");
  });

  test("sıra KATALOĞUN sırasıdır, açılma sırası değil", () => {
    const links = buildModuleNavLinks(
      // Tahsilat önce veriliyor; menüde yine CRM önce gelmeli.
      [MODULES.COLLECTIONS, MODULES.CRM],
      MembershipRole.OWNER,
      FAKE_CATALOG,
    );

    expect(links.map((link) => link.href)).toEqual([
      "/crm/institutions",
      "/crm/settings",
      "/collections/plans",
    ]);
  });

  test("katalogda olmayan anahtar sessizce yok sayılır", () => {
    // DB'de katalogdan kaldırılmış bir modülün satırı kalabilir; menü bundan etkilenmemeli.
    const links = buildModuleNavLinks(
      [MODULES.CRM, "kaldirilmis" as ModuleKey],
      MembershipRole.OWNER,
      FAKE_CATALOG,
    );

    expect(links).toHaveLength(2);
  });
});

test.describe("buildModuleNavLinks() — izin filtresi", () => {
  test("izni olmayan role o link gösterilmez", () => {
    // `MANAGE_MODULES` matriste OWNER-only'dir.
    const memberLinks = buildModuleNavLinks([MODULES.CRM], MembershipRole.MEMBER, FAKE_CATALOG);
    const adminLinks = buildModuleNavLinks([MODULES.CRM], MembershipRole.ADMIN, FAKE_CATALOG);

    for (const links of [memberLinks, adminLinks]) {
      expect(links.map((link) => link.href)).toEqual(["/crm/institutions"]);
      expect(links.map((link) => link.href)).not.toContain("/crm/settings");
    }
  });

  test("KONTROL GRUBU: izni olan rol aynı linki görüyor", () => {
    const links = buildModuleNavLinks([MODULES.CRM], MembershipRole.OWNER, FAKE_CATALOG);
    expect(links.map((link) => link.href)).toContain("/crm/settings");
  });

  test("modül kapalıysa izin de yetmez", () => {
    // İki filtre BİRLİKTE çalışır: yetki tek başına kapalı bir modülü açmaz.
    expect(buildModuleNavLinks([], MembershipRole.OWNER, FAKE_CATALOG)).toEqual([]);
  });
});

test.describe("buildModuleNavLinks() — gerçek katalog", () => {
  test("bugünkü katalogla hiçbir link üretmiyor (ekranlar henüz yok)", () => {
    // #151 katalogu bilerek boş `nav` ile geliyor: var olmayan bir yola link vermek kullanıcıyı
    // 404'e götürürdü. Bu test, o kararın SESSİZCE bozulmasını (birinin var olmayan bir ekranı
    // menüye eklemesini) yakalar.
    const links = buildModuleNavLinks([MODULES.CRM, MODULES.COLLECTIONS], MembershipRole.OWNER);
    expect(links).toEqual([]);
  });
});
