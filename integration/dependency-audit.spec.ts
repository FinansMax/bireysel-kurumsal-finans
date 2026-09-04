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
 * - Eşik `critical`'dan `high`'a çekilirse de kırmızıya döner — bu BİR HATA DEĞİL, bilinçli
 *   bir değişiklik olmalıdır ve #227'nin kapanış şartlarını (README + issue güncellemesi)
 *   tetiklemelidir. Test o anda "bu üçünü birlikte yap" hatırlatıcısıdır.
 */
const ROOT = join(__dirname, "..");
const CI = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
const README = readFileSync(join(ROOT, "README.md"), "utf8");

test.describe("npm audit CI job'ı (Issue #189)", () => {
  test("audit job'ı ci.yml'de tanımlı", () => {
    expect(CI).toMatch(/^ {2}audit:$/m);
  });

  test("tarama --omit=dev ile koşuyor", () => {
    // --omit=dev düşerse geliştirme araçlarındaki açıklar da CI'ı kırar; o gürültü,
    // kararın dayandığı "deploy edilen koda ulaşan açık" ölçütünü anlamsız kılar.
    expect(CI).toContain("npm audit --omit=dev");
  });

  test("eşik critical — değiştirilirse #227'nin kapanış şartları da işlenmeli", () => {
    expect(CI).toContain("--audit-level=critical");
    expect(CI).not.toContain("--audit-level=high");
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
    expect(README).toContain("### `npm audit` CI job'ı — eşik `critical`");
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
