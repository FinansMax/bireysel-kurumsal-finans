import { deflateRawSync } from "node:zlib";

/**
 * Asgari ZIP yazıcı (Issue #194).
 *
 * BAĞIMLILIK EKLENMEDİ. Bu repo bilinçli olarak yalın (CLAUDE.md § 4) ve ZIP'in bizim
 * ihtiyacımız olan kısmı küçüktür: her dosya için bir yerel başlık + deflate edilmiş veri,
 * sonda bir merkezî dizin. Sıkıştırmanın kendisi zaten Node'da (`zlib`).
 *
 * NE YAPMAZ (bilinen ve kabul edilen sınırlar):
 * - **ZIP64 yok.** 4 GB üzeri arşiv veya 65535'ten fazla dosya üretilemez. Bizim ürettiğimiz
 *   arşiv bir tenant'ın CSV'leridir; dosya sayısı sabit ve bir düzine civarındadır.
 *   `buildZip()` sınırları AŞARSA sessizce bozuk dosya üretmek yerine FIRLATIR.
 * - **Şifreleme yok.** Dosyanın gizliliği depolama ve indirme token'ıyla sağlanır.
 * - **Dizin girdisi yok.** Düz bir dosya listesi yeterlidir.
 *
 * Üretilen arşiv, standart araçlarla (Windows Gezgini, `unzip`, macOS Arşiv Yardımcısı)
 * açılabilir; testler bunu `zlib` ile geri açarak doğrular.
 */

/** ZIP spesifikasyonunun kullandığı CRC-32 (IEEE 802.3 polinomu, yansıtılmış: 0xEDB88320). */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }

  return table;
})();

export function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

export type ZipEntry = {
  /** Arşiv içindeki yol. `/` ile ayrılır (ZIP spesifikasyonu ters eğik çizgi kullanmaz). */
  name: string;
  content: Buffer;
};

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

const DEFLATE_METHOD = 8;

/** ZIP64 olmadan temsil edilebilecek üst sınırlar. Aşılırsa üretmek yerine fırlatılır. */
const MAX_ENTRIES = 0xffff;
const MAX_SIZE = 0xffffffff;

/**
 * MS-DOS tarih/saat biçimi. ZIP bunu zorunlu tutar ve saniyeler 2'şer adımdadır.
 *
 * SABİT BİR DEĞER KULLANILIYOR (1980-01-01, biçimin en küçük geçerli değeri): arşivin
 * BAYT BAYT YENİDEN ÜRETİLEBİLİR olması, aynı veriden aynı dosyanın çıkmasını sağlar ve
 * testlerin karşılaştırma yapabilmesini kolaylaştırır. Gerçek üretim zamanı zaten
 * `manifest.json` içinde ve DB kaydında duruyor; ZIP başlığındaki zaman damgası yalnızca
 * gürültü olurdu.
 */
const DOS_DATE = 0x0021; // 1980-01-01
const DOS_TIME = 0x0000;

function localHeader(entry: { nameBytes: Buffer; crc: number; compressedSize: number; size: number }): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(20, 4); // Açmak için gereken sürüm: 2.0 (deflate)
  // Bit 11 = dosya adı UTF-8'dir. Bu olmadan Türkçe karakterli adlar bazı araçlarda bozulur.
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(DEFLATE_METHOD, 8);
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.compressedSize, 18);
  header.writeUInt32LE(entry.size, 22);
  header.writeUInt16LE(entry.nameBytes.length, 26);
  header.writeUInt16LE(0, 28); // extra field yok
  return header;
}

function centralHeader(entry: {
  nameBytes: Buffer;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
}): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(20, 4); // Üreten sürüm
  header.writeUInt16LE(20, 6); // Gereken sürüm
  header.writeUInt16LE(0x0800, 8); // UTF-8 adı
  header.writeUInt16LE(DEFLATE_METHOD, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressedSize, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(entry.nameBytes.length, 28);
  header.writeUInt16LE(0, 30); // extra
  header.writeUInt16LE(0, 32); // comment
  header.writeUInt16LE(0, 34); // disk numarası
  header.writeUInt16LE(0, 36); // iç öznitelikler
  header.writeUInt32LE(0, 38); // dış öznitelikler
  header.writeUInt32LE(entry.offset, 42);
  return header;
}

/**
 * Girdileri tek bir ZIP arşivine yazar.
 *
 * Aynı ad iki kez verilirse FIRLATIR: ZIP bunu teknik olarak kabul eder ama açan araçlar
 * birini sessizce ezer — dışa aktarmada bu, bir tablonun kaybolması demektir.
 */
export function buildZip(entries: readonly ZipEntry[]): Buffer {
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`ZIP entry limit exceeded (${entries.length} > ${MAX_ENTRIES})`);
  }

  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.name)) {
      throw new Error(`Duplicate zip entry name: ${entry.name}`);
    }
    seen.add(entry.name);
  }

  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.content);

    if (entry.content.length > MAX_SIZE || compressed.length > MAX_SIZE) {
      throw new Error(`ZIP64 required for entry: ${entry.name}`);
    }

    const meta = {
      nameBytes,
      crc: crc32(entry.content),
      compressedSize: compressed.length,
      size: entry.content.length,
    };

    chunks.push(localHeader(meta), nameBytes, compressed);
    // Merkezî dizin girdisi de ADI TAŞIR. Yalnızca 46 baytlık başlığı yazmak, açan araçların
    // dizini hiç ayrıştıramamasına ve arşivi BOŞ görmesine yol açar (ölçüldü: .NET
    // ZipFile 0 girdi bildirdi).
    central.push(centralHeader({ ...meta, offset }), nameBytes);

    offset += 30 + nameBytes.length + compressed.length;
  }

  const centralBuffer = Buffer.concat(central);

  if (offset > MAX_SIZE || centralBuffer.length > MAX_SIZE) {
    throw new Error("ZIP64 required: archive too large");
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  end.writeUInt16LE(0, 4); // bu disk
  end.writeUInt16LE(0, 6); // merkezî dizinin başladığı disk
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // arşiv yorumu yok

  return Buffer.concat([...chunks, centralBuffer, end]);
}
