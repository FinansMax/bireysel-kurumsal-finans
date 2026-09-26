import { Prisma } from "@prisma/client";

import { todayInTimeZone } from "@/lib/time/tenant-time";

import { FILTER_ERRORS, parseTransactionFilters } from "./transaction-filters";

/**
 * Dönemsel toplamalar (panel özeti, harcama dağılımı, gelir-gider raporu) arasında PAYLAŞILAN
 * kurallar — Issue #67.
 *
 * NEDEN AYRI BİR MODÜL: aynı üç soru üç ayrı yerde soruluyordu — "dönem nedir", "bir tutar
 * toplamın yüzde kaçıdır", "dilimler hangi sırada". Üç kopya, zamanla üç farklı cevaba dönüşür
 * ve bu, kullanıcının fark etmesi en zor hata türüdür (iki ekran aynı veriden iki farklı sayı
 * gösterir). Modül tenant, HTTP ve Prisma sorgusu BİLMEZ; yalnızca saf kurallardır.
 *
 * Bu bir "utils" çöplüğü DEĞİLDİR ve öyle olmamalıdır: buraya yalnızca BİRDEN FAZLA toplama
 * modülünün paylaştığı, saf ve test edilebilir kurallar girer.
 */

/** Kapalı aralık: iki uç da DAHİLDİR (üst sınır `nextDay()` ile uygulanır). */
export type DateRange = {
  from: Date;
  to: Date;
};

/**
 * İçinde bulunulan ayın TAMAMI — TENANT'IN saat diliminde (Issue #134).
 *
 * Panelin ve rapor ekranının varsayılan dönemi budur: iki ekranın farklı varsayılanları olsaydı,
 * aynı veriden iki farklı "bu ay" doğardı.
 *
 * NEDEN TENANT'IN SAAT DİLİMİ, SUNUCUNUN `now()`'I DEĞİL: sunucu UTC değilken, ya da tenant
 * UTC'den farklı bir dilimdeyken, "hangi ay içindeyiz" sorusunun cevabı tenant'ın yerel
 * takvimine göre verilmelidir. Örnek: UTC 23:30, Europe/Istanbul'da (+03:00) zaten ertesi
 * günün 02:30'udur — ayın son gecesiyse tenant için yeni ay çoktan başlamıştır. Önceki sürüm
 * (`currentMonthRange()`, UTC "şimdi") bu yüzden kaldırıldı.
 *
 * SINIR DEĞERLER YİNE UTC GECE YARISI TEMSİLLİDİR (`Date.UTC(year, month, 1)` vb.) — bu bir
 * ANI değil, bir TAKVİM GÜNÜNÜ etiketler (aynen `parseFilterDate()`'in ürettiği gibi).
 * `todayInTimeZone()` zaten hangi YIL/AY'da olduğumuzu tenant diliminde çözer; bulunduktan
 * sonra ay sınırları saf takvim aritmetiğidir, ikinci bir saat dilimi dönüşümüne gerek yoktur.
 */
export function currentMonthRangeInTimeZone(timeZone: string, now: Date = new Date()): DateRange {
  const [year, month] = todayInTimeZone(timeZone, now).split("-").map(Number);

  return {
    from: new Date(Date.UTC(year, month - 1, 1)),
    to: new Date(Date.UTC(year, month, 0)),
  };
}

/** `Date` → `YYYY-MM-DD` (UTC). Aralık sınırları daima gün hassasiyetindedir. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Bir tutarın toplam içindeki payı: `0.00`–`100.00` arası string.
 *
 * Bölme `Prisma.Decimal` ile YAPILIR ve dışarı yalnızca ORAN çıkar. Bunu sunum katmanına
 * bırakmak `Number(amount) / Number(total)` demekti — paranın kayan noktaya dönmesi
 * (invariant #10).
 *
 * Toplam sıfırsa bölme hiç yapılmaz: `NaN`/`Infinity` bir yüzde alanına asla sızmamalı.
 */
export function percentOf(value: Prisma.Decimal, total: Prisma.Decimal): string {
  if (total.isZero()) {
    return "0.00";
  }
  return value.div(total).times(100).toFixed(2);
}

/**
 * Kırılım satırlarının sırası: tutara göre AZALAN, eşitlikte ada göre.
 *
 * `name: null` (kategorisiz) DAİMA sona düşer — adı yoktur, alfabede yeri de yoktur.
 *
 * `localeCompare` KULLANILMAZ: sıra ICU sürümüne bağlı olmamalı, aksi halde aynı veri iki
 * ortamda iki farklı sırada görünürdü.
 */
export function compareByAmountThenName(
  a: { amount: Prisma.Decimal; name: string | null },
  b: { amount: Prisma.Decimal; name: string | null },
): number {
  if (!a.amount.equals(b.amount)) {
    return b.amount.greaterThan(a.amount) ? 1 : -1;
  }
  if (a.name === null) {
    return b.name === null ? 0 : 1;
  }
  if (b.name === null) {
    return -1;
  }
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** Para birimi kodları ASCII'dir; `localeCompare` yok (yukarıdaki aynı gerekçe). */
export function compareCurrencyCode(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export type ResolvedDateRange =
  | { ok: true; range: DateRange }
  | { ok: false; error: string };

/**
 * `?from=&to=` → dönem. Dönem alan HER endpoint ve ekran bunu kullanır.
 *
 * AYRIŞTIRICI `/transactions` İLE ORTAKTIR (`parseTransactionFilters`, #56): aynı biçim
 * (`YYYY-MM-DD`), aynı "tekrarlanan parametre hatadır", aynı "ters aralık 400'dür" kuralı.
 * İşlem listesine özgü filtreler (`accountId`, `q`, `after`) bu çağrıda HİÇ sorulmaz,
 * dolayısıyla sessizce yok sayılırlar.
 *
 * ARALIK KISMEN VERİLEBİLİR (`?from=` var, `?to=` yok): eksik uç `fallback`in aynı ucundan
 * tamamlanır. "İkisi de zorunlu" alternatifi, kullanıcıyı aslında tek bir sınır sorduğu
 * durumda ikinci bir tarih uydurmaya zorlardı.
 *
 * TERS ARALIK KONTROLÜ BİRLEŞTİRMEDEN SONRA DA YAPILIR: ayrıştırıcı yalnızca ikisi de
 * verildiğinde bakabilir, oysa tek uçlu bir istek varsayılanla birleşince de ters aralık
 * üretebilir (`?from=2099-01-01` + varsayılan `to`). Sessizce boş sonuç döndürmek kullanıcıya
 * "bu dönemde kayıt yok" dedirtirdi; oysa sorun filtrededir (#56'nın kararının aynısı).
 */
export function resolveDateRange(
  get: (key: string) => string | string[] | null | undefined,
  fallback: DateRange,
): ResolvedDateRange {
  const parsed = parseTransactionFilters((key) =>
    key === "from" || key === "to" ? get(key) : null,
  );
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  const range: DateRange = {
    from: parsed.filters.from ?? fallback.from,
    to: parsed.filters.to ?? fallback.to,
  };

  if (range.from.getTime() > range.to.getTime()) {
    return { ok: false, error: FILTER_ERRORS.RANGE };
  }

  return { ok: true, range };
}
