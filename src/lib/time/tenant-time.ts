/**
 * Gün ve dönem hesaplarının TEK kaynağı (Issue #134).
 *
 * SORUN: üründe hiçbir saat dilimi katmanı yoktu ve üç ayrı yer üç farklı referans
 * kullanıyordu — form varsayılanı SUNUCUNUN yerel gününü, liste gösterimi UTC gününü,
 * `occurredAt` varsayılanı ise sunucunun anını. Sunucu UTC ise fark görünmez; değilse gece
 * yarısı civarındaki kayıtlar listede BİR GÜN KAYMIŞ görünür.
 *
 * Finansal bir üründe bunun bedeli görüntü hatası değildir: bir işlemin hangi GÜNE, dolayısıyla
 * hangi DÖNEME düştüğü raporlamanın doğrudan girdisidir.
 *
 * ---
 *
 * KARAR — REFERANS TENANT'IN SAAT DİLİMİDİR (`Tenant.timeZone`).
 *
 * Kullanıcının tarayıcısı referans ALINMAZ: aynı tenant'ın iki üyesi farklı şehirlerdeyse aynı
 * raporun farklı çıkması, çözdüğü sorundan büyük bir sorun yaratırdı. "Her şey UTC" alternatifi
 * daha basitti ama kullanıcıya "benim girdiğim tarih bu değildi" dedirtme riski taşıyor —
 * Türkiye'de UTC+3 ile çalışan bir ekip için gece 01:00'de girilen kayıt UTC'de "dün" olur.
 *
 * KARAR — `occurredAt` bir AN olarak KALIR (`@db.Date`'e çevrilmez). Gün hassasiyetine
 * indirgemek geri dönüşü olmayan bir migration'dır ve ileride saatli kayıt (ör. tahsilat anı,
 * Epic 15) gerektiğinde yolu kapatır. Gün hesabı, saklanan ANIN tenant saat diliminde
 * yorumlanmasıyla yapılır.
 *
 * ---
 *
 * BAĞIMLILIK EKLENMEDİ. `date-fns-tz`/`luxon` yerine platformun `Intl` API'si kullanılır:
 * IANA saat dilimi veritabanı zaten Node'un içindedir (`docs/conventions.md` → "Bağımlılıklar";
 * `node:crypto` ve `node:net` tercihleriyle aynı duruş).
 */

/**
 * Varsayılan saat dilimi.
 *
 * NEDEN `Europe/Istanbul` ve NEDEN veri dönüşümü gerekmiyor: bugüne kadarki tüm kayıtlar tek
 * saat diliminde girildi, dolayısıyla bu varsayılan GEÇMİŞİ DE DOĞRU yorumlar. Migration
 * mevcut satırlara dokunmaz.
 */
export const DEFAULT_TIME_ZONE = "Europe/Istanbul";

/**
 * Geçerli bir IANA saat dilimi mi?
 *
 * NEDEN LİSTE DEĞİL, DENEYEREK: IANA listesi yıl içinde değişir (yeni bölge, birleşme) ve elle
 * tutulan bir allowlist bir sonraki tzdata güncellemesinde yanlış olur. `Intl` zaten platformun
 * güncel veritabanını kullanıyor; ona sormak, kopyasını tutmaktan doğrudur.
 */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Bir anı, verilen saat diliminde `YYYY-MM-DD` gününe çevirir.
 *
 * `toISOString().slice(0, 10)` KULLANILMAZ — o daima UTC günüdür ve bu modülün var olma sebebi
 * tam olarak o satırdır. `toLocaleDateString()` de kullanılmaz: çıktısı sunucunun locale'ine
 * bağlıdır ve aynı kayıt geliştirme ile CI'da farklı görünebilir.
 *
 * `formatToParts` tercih edilir: sabit bir locale'in (`en-CA`) biçim ayrıntısına güvenmek
 * yerine parçalar adlarıyla okunur — locale verisi değişse bile sonuç aynı kalır.
 */
export function formatDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Tenant'ın saat diliminde "bugün" (`YYYY-MM-DD`).
 *
 * `now` enjekte edilebilir: gün sınırı davranışını gerçek zamanı beklemeden test edebilmek
 * için (`InMemoryRateLimiter`'daki `now` seam'i ile aynı desen). Test-only bir bypass DEĞİLDİR.
 */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  return formatDateInTimeZone(now, timeZone);
}

/**
 * Tenant'ın saat dilimindeki "bugün"ün, TARİH-ONLY değerlerle karşılaştırılabilir karşılığı
 * (UTC gece yarısı, epoch ms).
 *
 * NEDEN AYRI BİR YARDIMCI: bu kod tabanında iki farklı zaman türü var ve karıştırılmaları
 * sessiz hatalar üretiyor:
 *
 * - **AN** (`Transaction.occurredAt`): gerçek bir zaman noktası. Hangi güne düştüğü, tenant'ın
 *   saat diliminde YORUMLANARAK bulunur → `formatDateInTimeZone()`.
 * - **TARİH-ONLY** (`DebtCredit.dueDate`): saati olmayan bir gün, veritabanında UTC gece yarısı
 *   olarak saklanır (`src/lib/finance/validation.ts`). Bu değeri bir saat diliminde
 *   "yorumlamak" YANLIŞ olur — UTC'nin gerisindeki bir dilimde günü bir gün geriye kaydırır.
 *
 * "Vadesi geçti mi" sorusu ikisini karşılaştırır: TARİH-ONLY bir vade ile tenant'ın BUGÜNÜ.
 * Doğru cevap, tenant'ın bugününü aynı TARİH-ONLY gösterimine çevirmektir — vadeyi bir saat
 * dilimine çevirmek değil. `Date.UTC(now.getUTCFullYear(), ...)` yapmak, UTC'nin bugününü
 * kullanırdı: UTC+3'te gece yarısını geçmiş bir tenant için, o gün vadesi dolan kayıtlar
 * "henüz gecikmedi" görünürdü.
 */
export function startOfTodayInTimeZone(timeZone: string, now: Date = new Date()): number {
  // `todayInTimeZone()` zaten `YYYY-MM-DD` üretiyor; onu UTC gece yarısına sabitlemek, saklanan
  // tarih-only değerlerle BİREBİR aynı gösterimi verir.
  return Date.parse(`${todayInTimeZone(timeZone, now)}T00:00:00.000Z`);
}

/**
 * Tenant'tan gelen saat dilimini güvenli hale getirir.
 *
 * DB'deki değer teoride geçersiz olabilir (elle düzenleme, ileride eklenecek bir ayar
 * ekranındaki hata, tzdata'dan kaldırılmış bir bölge). O durumda `Intl` FIRLATIR ve tüm liste
 * sayfası çöker — bir saat dilimi ayarı yüzünden veriye erişimin tamamen kaybolması kabul
 * edilemez. Geçersizse varsayılana düşülür; okuma tarafında sessiz düzeltme, yazma tarafında
 * ise doğrulama (400) doğru dengedir.
 */
export function resolveTenantTimeZone(value: unknown): string {
  return isValidTimeZone(value) ? value : DEFAULT_TIME_ZONE;
}
