import { AccountType, CategoryType, DebtCreditStatus, DebtCreditType, Prisma } from "@prisma/client";

// Temel, bağımlılıksız input validasyonu (bkz. src/lib/tenants/validation.ts deseni).

export const MIN_ACCOUNT_NAME_LENGTH = 2;
export const MAX_ACCOUNT_NAME_LENGTH = 100;

export function isValidAccountName(name: string): boolean {
  return name.length >= MIN_ACCOUNT_NAME_LENGTH && name.length <= MAX_ACCOUNT_NAME_LENGTH;
}

const ACCOUNT_TYPES = Object.values(AccountType);

export function isValidAccountType(value: unknown): value is AccountType {
  return typeof value === "string" && (ACCOUNT_TYPES as string[]).includes(value);
}

export const MIN_CATEGORY_NAME_LENGTH = 2;
export const MAX_CATEGORY_NAME_LENGTH = 100;

/**
 * Kategori adı (Issue #49). Sınırlar `Account` ile BİLEREK aynıdır: ikisi de kullanıcının
 * yazdığı kısa bir etikettir ve farklı bir sayı seçmek, gerekçesi olmayan bir tutarsızlık
 * olurdu.
 */
export function isValidCategoryName(name: string): boolean {
  return name.length >= MIN_CATEGORY_NAME_LENGTH && name.length <= MAX_CATEGORY_NAME_LENGTH;
}

const CATEGORY_TYPES = Object.values(CategoryType);

export function isValidCategoryType(value: unknown): value is CategoryType {
  return typeof value === "string" && (CATEGORY_TYPES as string[]).includes(value);
}

/**
 * Para birimi: ISO 4217 biçimi (3 büyük harf). Tam ISO listesi bir bağımlılık (veya elle
 * bakımı gereken 180 satırlık bir tablo) gerektirirdi; buradaki kontrol BİÇİMSELDİR ve
 * bilinçlidir — bkz. `prisma/schema.prisma`'daki `Account.currency` notu.
 */
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function normalizeCurrency(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidCurrency(currency: string): boolean {
  return CURRENCY_PATTERN.test(currency);
}

/**
 * Parasal tutarın metinsel gösterimi.
 *
 * Tam sayı kısmı en fazla 15, ondalık kısmı en fazla 4 basamak — `Decimal(19, 4)` şemasının
 * birebir karşılığı. Ondalık ayırıcı yalnızca `.`'dır (yerelleştirilmiş "1.234,56" biçimi
 * KABUL EDİLMEZ; biçimlendirme sunum katmanının işidir, API sözleşmesinin değil).
 *
 * NEGATİF DEĞER SERBESTTİR: bir banka hesabı eksiye düşebilir, kredi kartı hesabı zaten
 * negatif bakiye taşır. "Bakiye negatif olamaz" bir iş kuralı olarak DAYATILMAZ.
 */
const MONEY_PATTERN = /^-?\d{1,15}(\.\d{1,4})?$/;

/**
 * Para değerini `Prisma.Decimal`e çevirir; geçersizse `null` döner (asla fırlatmaz).
 *
 * `number` KABUL EDİLMEZ — bu bir katılık gösterisi değil, invariant'ın kendisidir
 * (docs/security-invariants.md #10): JavaScript `number`'ı ikili kayan noktadır ve
 * `0.1 + 0.2 !== 0.3`; bir kez `number`'a dönüşen tutar, sonradan `Decimal`e çevrilse bile
 * yuvarlanmış olabilir. Bu yüzden tutarlar API sözleşmesinde DAİMA string'tir ve dönüşüm
 * yalnızca burada, string'den yapılır.
 */
export function parseMoney(value: unknown): Prisma.Decimal | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!MONEY_PATTERN.test(trimmed)) {
    return null;
  }

  return new Prisma.Decimal(trimmed);
}

export const MAX_TRANSACTION_DESCRIPTION_LENGTH = 500;

/**
 * İşlem notu (Issue #53). Kategori/hesap adından FARKLI olarak alt sınırı yoktur ve üst sınırı
 * daha geniştir: bu bir etiket değil, kullanıcının serbest açıklamasıdır ("Ocak kirası, 3 aylık
 * peşin"). 500 karakter, bir açıklama için fazlasıyla yeterlidir ve sınırsız metnin liste
 * yanıtlarını şişirmesini engeller.
 *
 * Boş/yalnızca-boşluk not `null`a indirgenir: "not yok" durumunun tek bir gösterimi olur,
 * aksi halde `null` ve `""` aynı anlama gelen iki ayrı değer olarak yan yana yaşardı.
 * Geçersizse `undefined` döner (boş nota karşılık gelen `null`dan ayırt edilebilsin diye).
 */
export function parseDescription(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.length <= MAX_TRANSACTION_DESCRIPTION_LENGTH ? trimmed : undefined;
}

/**
 * İşlem tutarı: `parseMoney()`in KESİN POZİTİF varyantı.
 *
 * `Account.balance` negatif olabilir (hesap eksiye düşebilir), ama bir işlemin tutarı
 * olamaz: yönü `type` taşır. Negatif bir `EXPENSE`, kılık değiştirmiş bir gelir olurdu ve
 * "dönemin toplam gideri" gibi her toplamı sessizce bozardı. Sıfır da reddedilir — bakiyeyi
 * değiştirmeyen bir para hareketi kayıt değil, gürültüdür.
 */
export function parsePositiveMoney(value: unknown): Prisma.Decimal | null {
  const parsed = parseMoney(value);
  if (!parsed || parsed.lessThanOrEqualTo(0)) {
    return null;
  }
  return parsed;
}

/**
 * `YYYY-MM-DD` veya tam ISO 8601 tarih-saat. Yerelleştirilmiş biçimler (`27.08.2026`)
 * KABUL EDİLMEZ — `parseMoney()` ile aynı gerekçe: biçimlendirme sunum katmanının işidir.
 */
// Basamaklar `[0-9]`, ondalık noktası `[.]` ile yazılır: desen ters bölü kaçışı içermez,
// dolayısıyla okurken "burada bir kaçış eksik mi" sorusu doğmaz.
const OCCURRED_AT_PATTERN =
  /^([0-9]{4})-([0-9]{2})-([0-9]{2})(T[0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]{1,3})?)?(Z|[+-][0-9]{2}:[0-9]{2})?)?$/;

/**
 * Takvimde gerçekten var olan bir gün mü?
 *
 * Bu kontrol `new Date()`e BIRAKILAMAZ: JavaScript `"2026-02-31"`i hataya çevirmez, sessizce
 * 3 Mart'a TAŞIRIR. Yani doğrulama olmadan, kullanıcının yazdığı tarihten farklı bir tarih
 * kaydedilirdi — finansal bir kayıtta kabul edilemez.
 */
function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  // Ayın 0. günü = bir önceki ayın son günü; artık yıl kuralını elle yazmaya gerek kalmaz.
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * İşlemin gerçekleştiği anı çözer; geçersizse `null` döner (asla fırlatmaz).
 *
 * GELECEK TARİH SERBESTTİR: ileri tarihli çek/planlı ödeme kaydetmek meşrudur. Bunun bilinen
 * sonucu, böyle bir kaydın bakiyeyi HEMEN etkilemesidir; "bekleyen işlem" ayrımı ayrı bir
 * issue'nun konusudur (bkz. README).
 */
export function parseOccurredAt(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = OCCURRED_AT_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }

  if (!isRealCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))) {
    return null;
  }

  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const MAX_SEARCH_QUERY_LENGTH = 100;

/**
 * İşlem listesi filtrelerindeki serbest metin (Issue #56).
 *
 * Boş/yalnızca-boşluk metin "filtre yok" demektir ve `null` döner — boş bir `?q=` ile hiç
 * gönderilmemiş `q` arasında davranış farkı olmamalıdır. Geçersizse (string değil veya çok
 * uzun) `undefined` döner; çağıran bunu 400'e çevirir.
 *
 * SQL enjeksiyonu bu katmanın derdi DEĞİLDİR: metin Prisma'nın `contains` filtresine
 * parametre olarak geçer, sorguya string olarak gömülmez (ham SQL bu kod tabanında yasak).
 * Uzunluk sınırı güvenlik değil maliyet içindir: `description` üzerinde index yoktur, çok
 * uzun bir desen boşuna tarama maliyeti üretir.
 */
export function parseSearchQuery(value: unknown): string | null | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.length <= MAX_SEARCH_QUERY_LENGTH ? trimmed : undefined;
}

/**
 * Tarih aralığı sınırı: YALNIZCA `YYYY-MM-DD`.
 *
 * `parseOccurredAt()`ten farklı olarak tam ISO tarih-saat KABUL EDİLMEZ. Gerekçe: aralık
 * filtresi takvimsel bir kavramdır ve `to` için "o ana kadar mı, o günün sonuna kadar mı"
 * sorusu ancak gün hassasiyetinde tek anlamlı olur. Saat kabul etmek, aynı parametreye iki
 * farklı anlam yüklerdi.
 *
 * Takvim kontrolü yine elle yapılır — `new Date("2026-02-31")` hata vermez, sessizce 3 Mart'a
 * taşır (bkz. `parseOccurredAt()`).
 */
const FILTER_DATE_PATTERN = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

/**
 * Bir TAKVİM GÜNÜ (`YYYY-MM-DD`, UTC gece yarısı).
 *
 * Aralık filtreleri (#56) ve vade tarihi (#70) AYNI kuralı paylaşır ve paylaşmalıdır: ikisi de
 * saat taşımayan takvimsel kavramlardır. `parseFilterDate` bu fonksiyonun filtre bağlamındaki
 * adıdır — iki ayrı implementasyon, aynı biçimin iki ekranda farklı kabul edilmesi demek
 * olurdu.
 */
export function parseCalendarDate(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = FILTER_DATE_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!isRealCalendarDate(year, month, day)) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day));
}

/** `parseCalendarDate`in filtre bağlamındaki adı (#56). Aynı fonksiyon, tek kural. */
export const parseFilterDate = parseCalendarDate;

export const MIN_COUNTERPARTY_LENGTH = 2;
export const MAX_COUNTERPARTY_LENGTH = 100;

/**
 * Borç/alacak kaydındaki karşı taraf adı (Issue #70). Sınırlar hesap ve kategori adıyla
 * BİLEREK aynı: üçü de kullanıcının yazdığı kısa bir etikettir.
 */
export function isValidCounterparty(name: string): boolean {
  return name.length >= MIN_COUNTERPARTY_LENGTH && name.length <= MAX_COUNTERPARTY_LENGTH;
}

const DEBT_CREDIT_TYPES = Object.values(DebtCreditType);

export function isValidDebtCreditType(value: unknown): value is DebtCreditType {
  return typeof value === "string" && (DEBT_CREDIT_TYPES as string[]).includes(value);
}

const DEBT_CREDIT_STATUSES = Object.values(DebtCreditStatus);

export function isValidDebtCreditStatus(value: unknown): value is DebtCreditStatus {
  return typeof value === "string" && (DEBT_CREDIT_STATUSES as string[]).includes(value);
}
