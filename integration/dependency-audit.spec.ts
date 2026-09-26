import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

/**
 * Issue #189 — bağımlılık taraması job'ının korunması.
 *
 * NEDEN TEST: bu kararın tamamı bir YAML dosyasında ve bir README paragrafında yaşıyor; ikisi
 * de derleyicinin göremediği yerler. Buradaki testler iki yönlü koruma sağlar:
 *
 * - Job SİLİNİRSE veya `--omit=dev` düşerse kırmızıya döner.
 * - Eşik `high`'dan başka bir değere çekilirse de kırmızıya döner (Issue #227 kapanış kararı:
 *   önce `critical` idi, gürültü maliyeti ölçülüp `high`'a çekildi) — bu BİR HATA DEĞİL,
 *   bilinçli bir değişiklik olmalıdır ve README'nin buna göre güncellenmesini
 *   tetiklemelidir. Test o anda "ölç ve README'yi güncelle" hatırlatıcısıdır.
 */
const ROOT = join(__dirname, "..");
const CI = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
const README = readFileSync(join(ROOT, "README.md"), "utf8");
const PACKAGE_JSON = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  overrides?: Record<string, string>;
};
const LOCKFILE = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8")) as {
  packages: Record<string, { version?: string }>;
};

test.describe("npm audit CI job'ı (Issue #189)", () => {
  test("audit job'ı ci.yml'de tanımlı", () => {
    expect(CI).toMatch(/^ {2}audit:$/m);
  });

  test("tarama --omit=dev ile koşuyor", () => {
    // --omit=dev düşerse geliştirme araçlarındaki açıklar da CI'ı kırar; o gürültü,
    // kararın dayandığı "deploy edilen koda ulaşan açık" ölçütünü anlamsız kılar.
    expect(CI).toContain("npm audit --omit=dev");
  });

  test("eşik high (Issue #227) — değiştirilirse README de güncellenmeli", () => {
    expect(CI).toContain("--audit-level=high");
    expect(CI).not.toContain("--audit-level=critical");
  });

  test("job kendi gerekçesine README'den referans veriyor", () => {
    // Eşiği ilk gören kişi "neden high değil" diye soracak; cevabın nerede olduğu
    // dosyanın içinde yazılı olmalı, aksi halde karar bir sonraki turda yeniden tartışılır.
    const auditBlock = CI.slice(CI.indexOf("# Bagimlilik taramasi (Issue #189)"), CI.indexOf("  typecheck:"));
    expect(auditBlock).toContain("README");
    expect(auditBlock).toContain("#227");
  });
});

test.describe("Karar kaydı duruyor", () => {
  test("README eşik gerekçesini ve kabul edilen kalan riski içeriyor", () => {
    expect(README).toContain("### `npm audit` CI job'ı — eşik `high` (Issue #227)");
    expect(README).toContain("KABUL EDİLEN KALAN RİSK");
    // Yanlış çıkan varsayımın kaydı: bu satır silinirse aynı yanlış varsayım tekrar yapılır.
    expect(README).toContain("peerDependencies");
    // Takip issue'suna bağlantı, kalan riskin karşı önlemidir; kopmamalı.
    expect(README).toContain("#227");
  });

  test("GHSA numarası yazılı", () => {
    expect(README).toContain("GHSA-ggr8-5vv4-36mx");
  });
});

/**
 * Issue #227 — üç advisory'yi kapatan `overrides` girdisinin korunması.
 *
 * NEDEN TEST: bu düzeltmenin tamamı `package.json`'daki tek bir satırda yaşıyor. Eşik artık
 * `high` olduğu için bir bağımlılık yükseltmesi sırasında bu girdinin düşmesi zaten `audit`
 * job'ını kırar (CI bunu da yakalar) — ama bu test, `npm ci` ve gerçek bir audit koşusu
 * gerektirmeden, tek bir dosya okumasıyla aynı korumayı daha ucuza ve daha erken (integration
 * suite'te) sağlar; iki katman birbirinin yedeğidir.
 *
 * Sürüm KONTROL EDİLİYOR, yalnızca girdinin varlığı değil: `overrides` duruyor ama `^7`'ye
 * çekilmiş olsaydı girdi "var" görünüp açık geri gelirdi.
 */
test.describe("deepmerge-ts overrides (Issue #227)", () => {
  test("package.json'da overrides girdisi var ve 8+ istiyor", () => {
    const override = PACKAGE_JSON.overrides?.["deepmerge-ts"];

    expect(override, "package.json'da overrides['deepmerge-ts'] bulunamadı").toBeDefined();
    // Aralık gösterimi (^8.0.2 / >=8 / 8.x) değil, istenen ANA SÜRÜM kontrol edilir.
    const wantedMajor = Number.parseInt(String(override).replace(/^\D+/, ""), 10);
    expect(wantedMajor).toBeGreaterThanOrEqual(8);
  });

  test("lock dosyasında çözülmüş sürüm gerçekten 8+", () => {
    // `overrides` yazılmış ama `npm install` koşulmamışsa lock dosyası hâlâ eski sürümü taşır;
    // asıl kurulan şey odur. Test kendi kendini doğrular: paket lock'ta bulunamazsa da kırılır.
    const entry = LOCKFILE.packages["node_modules/deepmerge-ts"];

    expect(entry?.version, "deepmerge-ts lock dosyasında bulunamadı").toBeDefined();
    const major = Number.parseInt(String(entry?.version).split(".")[0], 10);
    expect(major).toBeGreaterThanOrEqual(8);
  });

  test("karar README'de yazılı", () => {
    expect(README).toContain('"overrides": { "deepmerge-ts": "^8.0.2" }');
    // Zorlamanın kalan riski kayda geçmiş olmalı; silinirse bir sonraki tur yeniden tartışılır.
    expect(README).toContain("`overrides` bir zorlamadır");
  });
});
