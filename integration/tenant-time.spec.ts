import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { prisma } from "../src/lib/prisma";
import {
  DEFAULT_TIME_ZONE,
  formatDateInTimeZone,
  isValidTimeZone,
  resolveTenantTimeZone,
  startOfTodayInTimeZone,
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

/**
 * `startOfTodayInTimeZone()` — TARİH-ONLY karşılaştırmalarının referansı (Issue #134).
 *
 * NEDEN AYRI: bu kod tabanında iki zaman türü var ve karıştırılmaları sessiz hata üretiyor.
 * `occurredAt` bir ANDIR (saat dilimine göre YORUMLANIR); `DebtCredit.dueDate` TARİH-ONLY'dir
 * ve UTC gece yarısı olarak saklanır (yorumlanMAZ). "Vadesi geçti mi" sorusu ikisini
 * karşılaştırır, dolayısıyla tenant'ın bugünü de tarih-only gösterime çevrilmelidir.
 *
 * `now` enjekte ediliyor: gün sınırı davranışı gerçek zamanı beklemeden kanıtlanabilsin.
 */
test.describe("startOfTodayInTimeZone() — vade karşılaştırmasının referansı", () => {
  /** Bir `YYYY-MM-DD` gününün, veritabanındaki tarih-only gösterimi (UTC gece yarısı). */
  function dateOnly(iso: string): number {
    return Date.parse(`${iso}T00:00:00.000Z`);
  }

  test("KRİTİK REGRESYON: UTC+3'te gece yarısı geçmişse gün İLERLEMİŞ sayılır", () => {
    // 4 Eylül 22:00 UTC = 5 Eylül 01:00 Istanbul.
    const now = new Date("2026-09-04T22:00:00.000Z");

    // Eski davranış UTC'nin gününü (4 Eylül) alıyordu; doğrusu tenant'ın günü (5 Eylül).
    expect(startOfTodayInTimeZone("Europe/Istanbul", now)).toBe(dateOnly("2026-09-05"));

    // DUYARLILIK: aynı an, UTC'de hâlâ 4 Eylül. İki beklentinin FARKLI çıkması, testin
    // gerçekten saat dilimini ölçtüğünü gösterir.
    expect(startOfTodayInTimeZone("UTC", now)).toBe(dateOnly("2026-09-04"));
  });

  test("UTC'nin GERİSİNDEKİ dilimde gün henüz ilerlememiş sayılır", () => {
    // 5 Eylül 02:00 UTC = 4 Eylül 22:00 New York (UTC-4).
    const now = new Date("2026-09-05T02:00:00.000Z");

    expect(startOfTodayInTimeZone("America/New_York", now)).toBe(dateOnly("2026-09-04"));
    expect(startOfTodayInTimeZone("UTC", now)).toBe(dateOnly("2026-09-05"));
  });

  test("vade karşılaştırması: aynı an, iki tenant, iki farklı gecikme kararı", () => {
    // 4 Eylül vadeli AÇIK bir kayıt. An: 4 Eylül 22:00 UTC.
    const dueDate = dateOnly("2026-09-04");
    const now = new Date("2026-09-04T22:00:00.000Z");

    // Istanbul'da gün 5 Eylül'e geçti → vade GEÇMİŞ.
    expect(dueDate < startOfTodayInTimeZone("Europe/Istanbul", now)).toBe(true);
    // New York'ta hâlâ 4 Eylül → vade BUGÜN, gecikmiş değil.
    expect(dueDate < startOfTodayInTimeZone("America/New_York", now)).toBe(false);
  });

  test("dönen değer daima UTC gece yarısıdır (tarih-only ile birebir karşılaştırılabilir)", () => {
    const value = startOfTodayInTimeZone("Europe/Istanbul", new Date("2026-03-15T09:30:00.000Z"));
    const asDate = new Date(value);

    expect(asDate.getUTCHours()).toBe(0);
    expect(asDate.getUTCMinutes()).toBe(0);
    expect(asDate.getUTCSeconds()).toBe(0);
    expect(asDate.getUTCMilliseconds()).toBe(0);
  });

  test("geçersiz saat dilimi ÇÖKERTMEZ (resolveTenantTimeZone ile birlikte)", () => {
    // Okuma tarafında sessiz düzeltme kararı (bkz. resolveTenantTimeZone gerekçesi): bir ayar
    // hatası yüzünden borç/alacak listesinin tamamen kaybolması kabul edilemez.
    const timeZone = resolveTenantTimeZone("Mars/Olympus_Mons");
    expect(() => startOfTodayInTimeZone(timeZone)).not.toThrow();
  });
});

/**
 * Gösterim deseni koruması (Issue #134).
 *
 * `tenant-scope-pattern.spec.ts` ile aynı yaklaşım: bir lint/AST aracı DEĞİL, sessiz bir
 * regresyonu yakalayan kaynak-metni testi.
 *
 * YAKALADIĞI ŞEY: `occurredAt` bir ANDIR ve `toISOString().slice(0, 10)` daima UTC gününü
 * verir. Sunucu UTC iken fark GÖRÜNMEZ — CI'da da geliştirme makinesinde de. Yani biri bu
 * satırı geri yazsa, üründe gün kayması olur ve hiçbir test kırılmaz.
 *
 * `dueDate` bilinçli olarak KAPSAM DIŞIDIR: o TARİH-ONLY bir değerdir, UTC gece yarısı olarak
 * saklanır ve saat dilimine çevrilmesi YANLIŞ olurdu. Bu yüzden kontrol "hiç
 * `toISOString()` kullanılmasın" değil, "`occurredAt` üzerinde kullanılmasın" biçimindedir.
 */
test.describe("Gösterim deseni — occurredAt saat dilimine göre yazılır", () => {
  const APP_ROOT = path.join(__dirname, "..", "src", "app");

  function collectSourceFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        files.push(...collectSourceFiles(full));
      } else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) {
        files.push(full);
      }
    }
    return files;
  }

  const SOURCES = collectSourceFiles(APP_ROOT).map((file) => ({
    file,
    code: readFileSync(file, "utf-8"),
  }));

  test("tarama gerçekten dosya buluyor (test kendi kendini doğruluyor)", () => {
    // Bu kontrol olmadan, dizin taşınsa aşağıdaki test SIFIR dosya tarayıp sessizce geçerdi.
    expect(SOURCES.length).toBeGreaterThan(10);
  });

  test("hiçbir ekran occurredAt'i toISOString() ile GÜNE çevirmiyor", () => {
    const offenders = SOURCES.filter((entry) => /occurredAt\s*\.\s*toISOString\s*\(/.test(entry.code))
      .map(({ file }) => path.relative(APP_ROOT, file));

    expect(offenders, `UTC gününe düşen ekran(lar): ${offenders.join(", ")}`).toEqual([]);
  });

  test("KONTROL GRUBU: iki ekran gerçekten formatDateInTimeZone kullanıyor", () => {
    // "Yasak desen yok" tek başına yetmez: ekranlar tarihi hiç göstermiyor olsaydı da geçerdi.
    const users = SOURCES.filter(({ code }) => code.includes("formatDateInTimeZone(")).map(
      ({ file }) => path.relative(APP_ROOT, file).split(path.sep).join("/"),
    );

    expect(users).toContain("(app)/transactions/page.tsx");
    expect(users).toContain("(app)/dashboard/page.tsx");
  });
});
