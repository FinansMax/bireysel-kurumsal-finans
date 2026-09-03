import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { prisma } from "../src/lib/prisma";
import {
  DEFAULT_TIME_ZONE,
  formatDateInTimeZone,
  isValidTimeZone,
  resolveTenantTimeZone,
  todayInTimeZone,
} from "../src/lib/time/tenant-time";

/**
 * Saat dilimi referansı (Issue #134).
 *
 * NEDEN BU TESTLER VAR: üründe üç ayrı yer üç farklı referans kullanıyordu — form varsayılanı
 * SUNUCUNUN yerel gününü, liste gösterimi UTC gününü, `occurredAt` varsayılanı sunucunun anını.
 * Sunucu UTC ise fark GÖRÜNMEZ; bu yüzden hata CI'da da geliştirme makinesinde de sessiz
 * kalabilir. Buradaki testler farkı GÖRÜNÜR kılar.
 */

const createdTenantIds: string[] = [];

test.afterAll(async () => {
  if (createdTenantIds.length > 0) {
    await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
  }
  await prisma.$disconnect();
});

test.describe("formatDateInTimeZone() — gün sınırı", () => {
  test("KRİTİK REGRESYON: sunucu UTC iken 23 Ocak 01:00 Istanbul, 23 Ocak görünür", () => {
    /**
     * Issue #134'ün kabul kriteri, birebir. 22 Ocak 22:00 UTC = 23 Ocak 01:00 Istanbul (UTC+3).
     * Eski `toISOString().slice(0, 10)` davranışı bunu "2026-01-22" gösterirdi — kullanıcı
     * 23 Ocak'ta kaydettiği işlemi listede 22 Ocak'ta görürdü.
     */
    const instant = new Date("2026-01-22T22:00:00.000Z");

    expect(formatDateInTimeZone(instant, "Europe/Istanbul")).toBe("2026-01-23");

    // DUYARLILIK: eski davranış gerçekten FARKLI bir gün üretiyordu — yani yukarıdaki iddia
    // "zaten aynıydı"dan kaynaklanmıyor.
    expect(instant.toISOString().slice(0, 10)).toBe("2026-01-22");
  });

  test("ters yön: 01:00 UTC, Istanbul'da hâlâ aynı gün (04:00)", () => {
    const instant = new Date("2026-01-23T01:00:00.000Z");
    expect(formatDateInTimeZone(instant, "Europe/Istanbul")).toBe("2026-01-23");
  });

  test("farklı saat dilimleri AYNI anı farklı güne düşürebilir", () => {
    // Referansın tenant'a bağlı olmasının somut karşılığı.
    const instant = new Date("2026-03-01T02:00:00.000Z");
    expect(formatDateInTimeZone(instant, "Europe/Istanbul")).toBe("2026-03-01");
    expect(formatDateInTimeZone(instant, "America/New_York")).toBe("2026-02-28");
  });

  test("yaz saati geçişinde doğru gün üretilir", () => {
    // 2026-03-29 03:00 Europe/Istanbul kalıcı UTC+3'tür (Türkiye DST uygulamıyor); kontrol,
    // DST uygulayan bir bölgeyle yapılır.
    const beforeDst = new Date("2026-03-29T00:30:00.000Z");
    expect(formatDateInTimeZone(beforeDst, "Europe/Berlin")).toBe("2026-03-29");
  });

  test("çıktı sunucunun locale'ine BAĞLI DEĞİL — daima YYYY-MM-DD", () => {
    // `toLocaleDateString()` kullanılsaydı çıktı sunucunun locale'ine bağlı olurdu ve aynı
    // kayıt geliştirme ile CI'da farklı görünebilirdi.
    const instant = new Date("2026-12-05T12:00:00.000Z");
    expect(formatDateInTimeZone(instant, "Europe/Istanbul")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(formatDateInTimeZone(instant, "Europe/Istanbul")).toBe("2026-12-05");
  });
});

test.describe("todayInTimeZone()", () => {
  test("enjekte edilen 'şimdi' ile gün sınırı deterministik test edilir", () => {
    expect(todayInTimeZone("Europe/Istanbul", new Date("2026-01-22T22:00:00.000Z"))).toBe(
      "2026-01-23",
    );
    expect(todayInTimeZone("UTC", new Date("2026-01-22T22:00:00.000Z"))).toBe("2026-01-22");
  });
});

test.describe("isValidTimeZone() / resolveTenantTimeZone()", () => {
  test("geçerli IANA adları kabul edilir", () => {
    for (const tz of ["Europe/Istanbul", "UTC", "America/New_York", "Asia/Tokyo"]) {
      expect(isValidTimeZone(tz), tz).toBe(true);
    }
  });

  test("geçersiz değerler reddedilir", () => {
    for (const tz of ["", "Mars/Olympus", "GMT+3", 42, null, undefined, {}]) {
      expect(isValidTimeZone(tz), String(tz)).toBe(false);
    }
  });

  test("okuma tarafında geçersiz değer VARSAYILANA düşer, sayfayı ÇÖKERTMEZ", () => {
    /**
     * DB'deki değer teoride geçersiz olabilir (elle düzenleme, tzdata'dan kaldırılmış bölge).
     * O durumda `Intl` fırlatır ve tüm liste sayfası çöker — bir ayar yüzünden veriye erişimin
     * tamamen kaybolması kabul edilemez.
     */
    expect(resolveTenantTimeZone("Mars/Olympus")).toBe(DEFAULT_TIME_ZONE);
    expect(resolveTenantTimeZone(null)).toBe(DEFAULT_TIME_ZONE);
    expect(resolveTenantTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
  });
});

test.describe("Tenant.timeZone şeması", () => {
  test("yeni tenant varsayılan olarak Europe/Istanbul alır", async () => {
    const tenant = await prisma.tenant.create({
      data: { name: "TZ Test", slug: `tz-${randomUUID()}` },
      select: { id: true, timeZone: true },
    });
    createdTenantIds.push(tenant.id);

    // Varsayılan GEÇMİŞİ DE DOĞRU YORUMLAR: bugüne kadarki kayıtlar tek saat diliminde
    // girildi, bu yüzden migration veri dönüşümü gerektirmedi.
    expect(tenant.timeZone).toBe(DEFAULT_TIME_ZONE);
  });

  test("başka bir saat dilimi saklanabiliyor", async () => {
    const tenant = await prisma.tenant.create({
      data: { name: "TZ Test 2", slug: `tz-${randomUUID()}`, timeZone: "America/New_York" },
      select: { id: true, timeZone: true },
    });
    createdTenantIds.push(tenant.id);

    expect(tenant.timeZone).toBe("America/New_York");
    expect(isValidTimeZone(tenant.timeZone)).toBe(true);
  });
});
