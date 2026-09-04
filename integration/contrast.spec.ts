import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

/**
 * Tasarım sistemi renk kontrastı — WCAG 2.1 AA (Issue #198).
 *
 * NEDEN BURADA, NEDEN BİR ARAÇLA DEĞİL: kontrast oranı saf matematiktir (WCAG'in relative
 * luminance formülü). Tarayıcı açmaya, ekran görüntüsü almaya ya da yeni bir bağımlılık eklemeye
 * gerek yok — `globals.css`'teki token'ları okuyup hesaplamak yeterli. Bu, denetimi milisaniyeler
 * içinde ve HER koşuda yapılabilir kılıyor; bir e2e denetimi ise yalnızca gezilen ekranları
 * kapsardı.
 *
 * NEDEN GEREKLİ: token'lar tek yerde tanımlı ve elle seçiliyor. Bir tasarım ayarı sırasında bir
 * tonu bir kademe açmak, kimsenin fark etmeyeceği bir erişilebilirlik gerilemesi üretir — ölçüm
 * olmadan bunun geri bildirimi YOKTUR. Nitekim bu test yazıldığında açık temada iki token eşiğin
 * altındaydı: `--text-faint` en koyu yüzeyde 2.62:1, `--text-muted` 4.15:1.
 *
 * KAPSAM: yalnızca METİN/YÜZEY çiftleri. Kenarlık, ikon ve grafik renkleri (WCAG 1.4.11, eşik
 * 3:1) bu testin konusu değil — #198'in o maddesi ayrı ele alınmalı ve ölçütü de farklı.
 */

const CSS = readFileSync(path.join(__dirname, "..", "src", "app", "globals.css"), "utf-8");

/**
 * `#rrggbb` → WCAG relative luminance.
 *
 * Kanal değerleri önce sRGB gamma'sından çıkarılır (lineerleştirme); bunu atlayıp ham RGB
 * ortalaması almak, koyu tonlarda oranı ciddi biçimde YANLIŞ hesaplar.
 */
function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)));

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort(
    (a, b) => b - a,
  );

  return (lighter + 0.05) / (darker + 0.05);
}

/** Bir CSS bloğundaki `--token: #rrggbb;` tanımları. */
function parseTokens(block: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const match of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens[match[1]] = match[2].toLowerCase();
  }
  return tokens;
}

const DARK_BLOCK_START = CSS.indexOf("@media (prefers-color-scheme: dark)");

const LIGHT_TOKENS = parseTokens(CSS.slice(0, DARK_BLOCK_START));
// Koyu tema AYNI token'ları yeniden tanımlar; tanımlamadıklarında açık temanınki geçerlidir.
const DARK_TOKENS = { ...LIGHT_TOKENS, ...parseTokens(CSS.slice(DARK_BLOCK_START)) };

/**
 * Üründe GERÇEKTEN bir arada kullanılan metin/yüzey çiftleri.
 *
 * Liste elle tutulur ve bu bilinçlidir: her token her yüzeyle eşleşmiyor, kartezyen çarpım
 * kullanılmayan kombinasyonlar için sahte hatalar üretirdi. `text-faint` × `surface-inset`
 * listede çünkü dashboard'daki nötr rozet tam olarak bu çifti kullanıyor.
 */
const TEXT_ON_SURFACE: ReadonlyArray<[fg: string, bg: string]> = [
  ["text-strong", "surface"],
  ["text-strong", "canvas"],
  ["text-strong", "surface-muted"],
  ["text-strong", "surface-inset"],
  ["text-default", "surface"],
  ["text-default", "canvas"],
  ["text-default", "surface-muted"],
  ["text-default", "surface-inset"],
  ["text-muted", "surface"],
  ["text-muted", "canvas"],
  ["text-muted", "surface-muted"],
  ["text-muted", "surface-inset"],
  ["text-faint", "surface"],
  ["text-faint", "canvas"],
  ["text-faint", "surface-muted"],
  ["text-faint", "surface-inset"],
  // Koyu yüzey (sidebar, hero) açık temada da KOYUDUR; kendi metin token'ları var.
  ["shell-text", "shell"],
  ["shell-text", "shell-raised"],
  ["shell-text-muted", "shell"],
  ["shell-text-muted", "shell-raised"],
];

/** WCAG 2.1 AA, normal boyutlu metin. */
const AA_NORMAL_TEXT = 4.5;

test.describe("globals.css — token ayrıştırma", () => {
  test("test kendi kendini doğruluyor: token'lar gerçekten okundu", () => {
    // Bu kontrol olmadan, dosya yeniden düzenlenip ayrıştırıcı sıfır token bulsa da aşağıdaki
    // testler SESSİZCE geçerdi (boş bir listede döngü hiç dönmez).
    expect(Object.keys(LIGHT_TOKENS).length).toBeGreaterThan(30);
    expect(DARK_BLOCK_START).toBeGreaterThan(0);

    for (const [foreground, background] of TEXT_ON_SURFACE) {
      expect(LIGHT_TOKENS[foreground], `${foreground} açık temada tanımlı değil`).toBeDefined();
      expect(LIGHT_TOKENS[background], `${background} açık temada tanımlı değil`).toBeDefined();
    }
  });

  test("koyu tema token'ları açık temadan GERÇEKTEN farklı", () => {
    // Kontrol grubu: koyu blok yanlış ayrıştırılsaydı iki tema aynı değerleri taşır ve koyu tema
    // testleri aslında açık temayı ölçerdi.
    expect(DARK_TOKENS["surface"]).not.toBe(LIGHT_TOKENS["surface"]);
    expect(DARK_TOKENS["text-strong"]).not.toBe(LIGHT_TOKENS["text-strong"]);
  });
});

for (const [themeName, tokens] of [
  ["açık tema", LIGHT_TOKENS],
  ["koyu tema", DARK_TOKENS],
] as const) {
  test.describe(`Kontrast — ${themeName} (WCAG AA, >= ${AA_NORMAL_TEXT}:1)`, () => {
    for (const [foreground, background] of TEXT_ON_SURFACE) {
      test(`${foreground} / ${background}`, () => {
        const ratio = contrastRatio(tokens[foreground], tokens[background]);

        expect(
          ratio,
          `${foreground} (${tokens[foreground]}) / ${background} (${tokens[background]}) = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      });
    }
  });
}

test.describe("Kontrast hesabı doğru", () => {
  test("bilinen değerler WCAG referansıyla eşleşiyor", () => {
    // Hesabın kendisi test edilmezse, yanlış bir formül tüm çiftleri "geçmiş" gösterebilirdi.
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // Sıra önemsiz: oran simetriktir.
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    // WCAG'in kendi örneği: #777777 üzerinde beyaz ~4.48 (AA'yı KIL PAYI geçmez).
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(AA_NORMAL_TEXT);
  });
});

test.describe("Metin hiyerarşisi korunuyor", () => {
  test("strong > default > muted > faint (açık tema, koyudan açığa)", () => {
    // Kontrastı yükseltmek uğruna iki kademeyi birbirine yaklaştırmak, tipografik hiyerarşiyi
    // sessizce yok ederdi: her şey "aynı grilikte" görünen bir arayüz, erişilebilir ama okunaksız.
    const order = ["text-strong", "text-default", "text-muted", "text-faint"];
    const luminances = order.map((token) => relativeLuminance(LIGHT_TOKENS[token]));

    for (let i = 1; i < luminances.length; i += 1) {
      expect(luminances[i], `${order[i]} bir öncekinden AÇIK olmalı`).toBeGreaterThan(
        luminances[i - 1],
      );
    }
  });
});
