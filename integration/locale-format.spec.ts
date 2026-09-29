import { expect, test } from "@playwright/test";

import {
  currencySymbol,
  formatAmount,
  formatDay,
  formatInstantDay,
  formatMoney,
} from "../src/lib/format/locale";

/**
 * Gösterim biçimlendirmesi (Issue #197) — saf fonksiyonlar, DB yok.
 *
 * Kabul kriteri: tarihler `23.01.2026`, tutarlar `1.234,56 ₺`; sunucunun `TZ`/`LANG` ayarı
 * çıktıyı DEĞİŞTİRMEZ.
 */

test.describe("formatAmount() — string üzerinde, sayıya çevirmeden", () => {
  const cases: Array<[string, string]> = [
    ["1234.56", "1.234,56"],
    ["1234.5000", "1.234,50"],
    ["0", "0,00"],
    ["42.5", "42,50"],
    ["-42.5000", "-42,50"],
    ["1000000", "1.000.000,00"],
    ["999", "999,00"],
    // Fazla hassasiyet YUVARLANMAZ — yalnızca sondaki sıfırlar atılır.
    ["10.1250", "10,125"],
    ["10.1234", "10,1234"],
  ];

  for (const [input, expected] of cases) {
    test(`${input} → ${expected}`, async () => {
      expect(formatAmount(input)).toBe(expected);
    });
  }

  /**
   * Duyarlılık kanıtı: `Number` üzerinden biçimlendiren bir uygulama 2^53'ü aşan tutarda
   * son haneleri kaybeder. Bu test, string yolunun HER HANEYİ koruduğunu gösterir.
   */
  test("kayan noktanın taşıyamayacağı tutar hane kaybetmeden biçimlenir", async () => {
    const huge = "12345678901234567890.1234";
    expect(Number(huge).toString()).not.toContain("12345678901234567890");
    expect(formatAmount(huge)).toBe("12.345.678.901.234.567.890,1234");
  });

  test("beklenmeyen biçim olduğu gibi döner (gösterim veri düzeltmez)", async () => {
    expect(formatAmount("1.234,56")).toBe("1.234,56");
    expect(formatAmount("abc")).toBe("abc");
  });
});

test.describe("currencySymbol() / formatMoney()", () => {
  test("TRY → ₺, USD → $, EUR → €", async () => {
    expect(currencySymbol("TRY")).toBe("₺");
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("EUR")).toBe("€");
  });

  test("kabul kriteri: 1.234,56 ₺", async () => {
    expect(formatMoney("1234.56", "TRY")).toBe("1.234,56 ₺");
  });

  test("tanınmayan kod sayfayı kırmaz, kodun kendisi basılır", async () => {
    expect(currencySymbol("XYZ")).toBe("XYZ");
    expect(currencySymbol("bozuk")).toBe("bozuk");
  });
});

test.describe("formatDay() / formatInstantDay()", () => {
  test("kabul kriteri: 2026-01-23 → 23.01.2026", async () => {
    expect(formatDay("2026-01-23")).toBe("23.01.2026");
  });

  test("ISO olmayan değer olduğu gibi döner", async () => {
    expect(formatDay("23.01.2026")).toBe("23.01.2026");
  });

  test("an, TENANT'IN saat diliminde güne çevrilir (#134 ile birlikte)", async () => {
    const lateUtc = new Date("2025-12-31T22:00:00.000Z");
    expect(formatInstantDay(lateUtc, "UTC")).toBe("31.12.2025");
    expect(formatInstantDay(lateUtc, "Europe/Istanbul")).toBe("01.01.2026");
  });

  /**
   * Sunucunun `TZ` ayarı çıktıyı değiştirmemeli. Node, `process.env.TZ`'yi çalışma anında
   * uygular; KONTROL GRUBU olarak aynı an için ortamın varsayılanına bağlı `getHours()`'un
   * GERÇEKTEN değiştiği gösterilir — yoksa bu test hiçbir şey kanıtlamazdı.
   */
  test("sunucunun TZ ayarı çıktıyı değiştirmiyor", async () => {
    const original = process.env.TZ;
    const instant = new Date("2025-12-31T22:00:00.000Z");
    try {
      process.env.TZ = "UTC";
      const inUtc = { hours: instant.getHours(), formatted: formatInstantDay(instant, "Europe/Istanbul") };
      process.env.TZ = "America/Los_Angeles";
      const inLa = { hours: instant.getHours(), formatted: formatInstantDay(instant, "Europe/Istanbul") };

      expect(inUtc.hours).not.toBe(inLa.hours);
      expect(inUtc.formatted).toBe("01.01.2026");
      expect(inLa.formatted).toBe("01.01.2026");
      expect(formatMoney("1234.56", "TRY")).toBe("1.234,56 ₺");
    } finally {
      if (original === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = original;
      }
    }
  });
});
