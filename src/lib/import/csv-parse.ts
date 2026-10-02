/**
 * CSV ayrıştırma (Issue #83) — `src/lib/export/csv.ts`'in tersi.
 *
 * Bu modül DB bilmez, HTTP bilmez: "metni kayıtlara böl" işini yapar.
 *
 * BAĞIMLILIK EKLENMEDİ (`csv.ts` ile aynı gerekçe): RFC 4180 alıntı ve kaçırma kurallarından
 * ibarettir. Desteklenen: `"..."` alıntılı alanlar, alıntı içinde `""` kaçırması, alıntı içinde
 * virgül ve satır sonu, CRLF/LF satır sonları, baştaki UTF-8 BOM (Excel'in kaydettiği CSV'lerde
 * vardır). Ayraç yalnızca virgüldür — Türkçe Excel'in `;` ayraçlı çıktısı sessizce yanlış
 * ayrıştırılmaz, sütun sayısı tutmadığı için satır hatası olarak raporlanır.
 */

export type ParsedCsv =
  | { ok: true; records: string[][] }
  | { ok: false; error: "unterminated_quote" | "invalid_quote" };

const BOM = "﻿";

export function parseCsv(input: string): ParsedCsv {
  const text = input.startsWith(BOM) ? input.slice(BOM.length) : input;

  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  // Alanın alıntılı olup olmadığı: `"a"b` gibi kapanış tırnağından sonra gelen karakter
  // hatadır; sessizce birleştirmek, bozuk bir dosyayı "geçerli" gibi gösterirdi.
  let fieldWasQuoted = false;

  const endField = () => {
    record.push(field);
    field = "";
    fieldWasQuoted = false;
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      if (field.length > 0 || fieldWasQuoted) {
        return { ok: false, error: "invalid_quote" };
      }
      inQuotes = true;
      fieldWasQuoted = true;
    } else if (char === ",") {
      endField();
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[index + 1] === "\n") {
        index++;
      }
      endRecord();
    } else {
      if (fieldWasQuoted) {
        return { ok: false, error: "invalid_quote" };
      }
      field += char;
    }
  }

  if (inQuotes) {
    return { ok: false, error: "unterminated_quote" };
  }
  // Son satır satır sonuyla bitmiyorsa kayıt hâlâ açıktır.
  if (field.length > 0 || fieldWasQuoted || record.length > 0) {
    endRecord();
  }

  // Tamamen boş satırlar (ör. dosya sonundaki fazladan satır sonları) kayıt SAYILMAZ.
  return {
    ok: true,
    records: records.filter((row) => !(row.length === 1 && row[0] === "")),
  };
}

const FORMULA_ESCAPE = /^'[=+\-@\t\r]/;

/**
 * `escapeFormulaInjection()`'ın (`src/lib/export/csv.ts`) tersi: dışa aktarım, `=`/`+`/`-`/`@`
 * ile başlayan hücrelerin başına `'` ekler. Aynı dosya geri yüklendiğinde bu `'` VERİNİN
 * PARÇASI DEĞİLDİR — bırakılsaydı dışa aktar → içe aktar döngüsü açıklamayı her turda bozardı.
 *
 * Yalnızca TAM OLARAK bu desen çözülür (`'` + formül ön eki); başka `'` ile başlayan metne
 * dokunulmaz.
 */
export function unescapeFormulaInjection(value: string): string {
  return FORMULA_ESCAPE.test(value) ? value.slice(1) : value;
}
