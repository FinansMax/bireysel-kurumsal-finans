import { formatDateInTimeZone } from "@/lib/time/tenant-time";

/**
 * Tarih ve para GÖSTERİMİNİN tek kaynağı (Issue #197).
 *
 * SORUN: tarihler `2026-01-23`, tutarlar `1234.5 TRY` olarak basılıyordu — Türkçe bir arayüzde
 * ISO tarih ve ondalık NOKTA. `toLocaleDateString()`/`toLocaleString()` bilerek
 * kullanılmamıştı: çıktıyı SUNUCUNUN locale'ine ve saat dilimine bağlarlardı (#54, #134).
 *
 * KARAR — LOCALE VE SAAT DİLİMİ DAİMA AÇIKÇA VERİLİR. Ortamın varsayılanına (`LANG`, `TZ`)
 * hiçbir fonksiyon güvenmez; aynı kayıt geliştirme, CI ve üretimde aynı görünür. Bu yüzden
 * bu modül bir locale PARAMETRESİ de almaz: tek dil (`tr-TR`) var, çoklu dil (i18n) #197'nin
 * kapsamı dışında.
 *
 * KARAR — BİÇİMLENDİRME SUNUCUDA YAPILIR ve string olarak iner. İstemcide `Intl` çalıştırmak,
 * tarayıcının ICU verisi Node'unkinden farklıysa hydration uyuşmazlığı üretirdi.
 *
 * Bağımlılık yok: `Intl` yeterli.
 */

export const DISPLAY_LOCALE = "tr-TR";

const AMOUNT_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Servisten gelen ham tutar string'ini (`"1234.5000"`) Türkçe gösterime çevirir
 * (`"1.234,50"`).
 *
 * KRİTİK — DEĞER SAYIYA ÇEVRİLMEZ (invariant #10). `Intl.NumberFormat(...).format(Number(v))`
 * kısa yoldu ama para için yasak olan kayan nokta dönüşümünü sunum katmanından geri
 * getirirdi: 16 haneyi aşan bir tutar sessizce yuvarlanır. Burada yalnızca karakterler yer
 * değiştirir.
 *
 * KESİR: en az 2 hane gösterilir; fazlası YUVARLANMAZ, yalnızca sondaki sıfırlar atılır
 * (`"10.1250"` → `"10,125"`). Yuvarlamak aritmetik gerektirir ve daha önemlisi, saklanan
 * hassasiyeti ekranda gizleyip iki farklı tutarı aynı gösterirdi.
 *
 * Beklenen biçimde olmayan bir değer (ör. geçmişten kalma bir biçim) OLDUĞU GİBİ döner:
 * gösterim katmanı veri düzeltmez, yalnızca okunur kılar.
 */
export function formatAmount(value: string): string {
  const match = AMOUNT_PATTERN.exec(value);
  if (!match) {
    return value;
  }
  const [, sign, integer, fraction = ""] = match;

  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const trimmed = fraction.replace(/0+$/, "");
  const decimals = trimmed.length >= 2 ? trimmed : trimmed.padEnd(2, "0");

  return `${sign}${grouped},${decimals}`;
}

const symbolCache = new Map<string, string>();

/**
 * Para biriminin Türkçe gösterimdeki sembolü (`TRY` → `₺`, `USD` → `$`).
 *
 * Sembol `Intl`'den okunur ama TUTAR `Intl`'e hiç girmez: `formatToParts(0)` yalnızca "bu
 * locale'de bu para biriminin işareti nedir" sorusunu cevaplar. Elle tutulan bir sembol
 * tablosu, ISO listesiyle aynı sebepten reddedildi (#241): platformla birlikte güncellenmez.
 *
 * `Intl`'in tanımadığı bir kod (biçimce hatalı eski bir kayıt) KODUN KENDİSİNİ döndürür —
 * gösterim yüzünden sayfa hata vermemeli.
 */
export function currencySymbol(currency: string): string {
  const cached = symbolCache.get(currency);
  if (cached !== undefined) {
    return cached;
  }

  let symbol = currency;
  try {
    const part = new Intl.NumberFormat(DISPLAY_LOCALE, { style: "currency", currency })
      .formatToParts(0)
      .find((candidate) => candidate.type === "currency");
    symbol = part?.value ?? currency;
  } catch {
    symbol = currency;
  }

  symbolCache.set(currency, symbol);
  return symbol;
}

/**
 * Tutar + para birimi: `"1.234,56 ₺"`.
 *
 * Sembol SONDA: `tr-TR`'nin ICU varsayılanı `₺1.234,56`'dır, ama Türkiye'de fatura ve banka
 * ekstrelerindeki yaygın yazım tutardan sonra birimdir ve #197'nin kabul kriteri de budur.
 */
export function formatMoney(value: string, currency: string): string {
  return `${formatAmount(value)} ${currencySymbol(currency)}`;
}

const ISO_DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `YYYY-MM-DD` takvim gününü `GG.AA.YYYY` olarak gösterir.
 *
 * Saf string dönüşümüdür, `Date` ÜRETMEZ: `new Date("2026-01-23")` UTC gece yarısıdır ve
 * UTC'nin gerisindeki bir dilimde BİR GÜN ÖNCEYE kayardı — tarih-only değerlerin (ör.
 * `DebtCredit.dueDate`) bu modülden geçerken kaymaması gerekir.
 */
export function formatDay(isoDay: string): string {
  const match = ISO_DAY_PATTERN.exec(isoDay);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : isoDay;
}

/**
 * Bir ANI (`Transaction.occurredAt`, `AuditLog.createdAt`) tenant'ın saat dilimindeki gün
 * olarak gösterir. Gün hesabı `tenant-time.ts`'indir (#134); burası yalnızca yazımı değiştirir.
 *
 * Form alanları (`<input type="date">`) bunu KULLANMAZ: tarayıcı `value` olarak yalnızca ISO
 * kabul eder — onlar `formatDateInTimeZone()`'u doğrudan çağırmaya devam eder.
 */
export function formatInstantDay(date: Date, timeZone: string): string {
  return formatDay(formatDateInTimeZone(date, timeZone));
}
