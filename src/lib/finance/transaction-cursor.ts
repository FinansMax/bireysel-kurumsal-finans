import { isValidId } from "@/lib/tenants/validation";

/**
 * İşlem listesi sayfalama imleci (Issue #135).
 *
 * NEDEN KEYSET, `OFFSET` DEĞİL: offset iki yerden birden bozulur. (1) `OFFSET 10000`,
 * Postgres'e atlanacak on bin satırı yine de ürettirir — derin sayfa doğrusal olarak
 * yavaşlar. (2) Sayfa 1 okunduktan sonra araya yeni bir işlem girerse tüm satırlar bir
 * kayar; sayfa 2'nin ilk satırı, kullanıcının sayfa 1'de zaten gördüğü satır olur. İkincisi
 * bu üründe teorik değil: liste `occurredAt DESC` sıralıdır ve yeni kayıtlar tam da listenin
 * BAŞINA düşer.
 *
 * İmleç, son satırın sıralama anahtarını taşır ve sorgu "bu anahtardan küçük olanlar" diye
 * devam eder. Araya kayıt girmesi sonucu etkilemez: okunan pencere mutlak bir konuma değil,
 * somut bir satıra dayanır.
 *
 * ANAHTAR ÜÇ ALANDIR — `(occurredAt, createdAt, id)`. `occurredAt` tek başına benzersiz
 * değildir (aynı güne birden çok işlem normaldir); `createdAt` de değildir (aynı
 * milisaniyede iki kayıt, ör. toplu içe aktarma). Sıralama anahtarı KESİN bir toplam sıra
 * vermezse iki sayfanın sınırındaki satırlar ya atlanır ya tekrarlanır — bu yüzden en sona
 * `id` eklenir; benzersiz olduğu için sıra artık kesindir. `listTransactions()`in
 * `orderBy`ı da aynı üçlüdür ve İKİSİ BİRLİKTE DEĞİŞMELİDİR.
 *
 * NEDEN OPAK (base64url): imleç bir API sözleşmesi değil, bir devam noktasıdır. Düz metin
 * olsaydı istemciler onu ayrıştırıp alanlarına bağımlı hâle gelirdi ve sıralama anahtarını
 * değiştirmek breaking change olurdu.
 *
 * OPAKLIK BİR GÜVENLİK SINIRI DEĞİLDİR: base64 şifreleme değildir, imleç kurcalanabilir.
 * Buna GEREK YOKTUR — imleç yalnızca "nereden devam edileceğini" söyler, hangi tenant'ın
 * verisinin okunacağını DEĞİL. O soruların tek kaynağı `requirePermission()` context'idir ve
 * sorgu her hâlükârda `tenantScoped()` içinden geçer. Kurcalanmış bir imleç, kullanıcıya
 * yalnızca KENDİ tenant'ının listesinde başka bir pencere gösterebilir — ki bu, filtreyi elle
 * değiştirmekten farksızdır. Kanıt: `security/transaction-security.spec.ts`.
 */

export type TransactionCursor = {
  occurredAt: Date;
  createdAt: Date;
  id: string;
};

/** Alanları ayıran karakter: `id` (cuid) ve ISO tarih biçiminde geçemez, kaçış gerekmez. */
const SEPARATOR = "|";

export function encodeTransactionCursor(row: TransactionCursor): string {
  const raw = [row.occurredAt.toISOString(), row.createdAt.toISOString(), row.id].join(SEPARATOR);
  return Buffer.from(raw, "utf8").toString("base64url");
}

/**
 * ISO 8601 tarihi ÇİFT YÖNLÜ doğrular: çözümlenen değer yeniden yazıldığında girdinin
 * birebir aynısı olmalıdır.
 *
 * `new Date(...)` fazlasıyla hoşgörülüdür ("2026-13-45" gibi bir girdiyi sessizce başka bir
 * güne taşır). Tek yönlü kontrol, kurcalanmış bir imleci geçerli sayıp kullanıcıya sessizce
 * yanlış bir pencere gösterirdi — hata vermek, yanlış veri göstermekten iyidir.
 */
function parseIsoDate(value: string): Date | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    return null;
  }
  return date;
}

/** Geçersiz imleç `null` döner; çağıran bunu `400`'e çevirir — sessizce ilk sayfaya DÖNMEZ. */
export function parseTransactionCursor(value: unknown): TransactionCursor | null {
  if (typeof value !== "string" || value === "") {
    return null;
  }

  // `base64url` çözümü bozuk girdide throw etmez, çöp üretir; doğrulama aşağıdaki alan
  // kontrolleriyle yapılır. Bu yüzden burada try/catch YOKTUR — yakalanacak bir şey yok.
  const raw = Buffer.from(value, "base64url").toString("utf8");
  const parts = raw.split(SEPARATOR);
  if (parts.length !== 3) {
    return null;
  }

  const occurredAt = parseIsoDate(parts[0]);
  const createdAt = parseIsoDate(parts[1]);
  if (!occurredAt || !createdAt || !isValidId(parts[2])) {
    return null;
  }

  return { occurredAt, createdAt, id: parts[2] };
}
