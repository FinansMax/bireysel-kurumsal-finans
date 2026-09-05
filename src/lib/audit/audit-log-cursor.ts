import { isValidId } from "@/lib/tenants/validation";

/**
 * Audit log listesi sayfalama imleci (Issue #78).
 *
 * `transaction-cursor.ts` ile AYNI desen ve aynı gerekçeler; oradaki uzun açıklama burada
 * tekrarlanmıyor. Farklar:
 *
 * ANAHTAR İKİ ALANDIR — `(createdAt, id)`. İşlem listesinde anahtar üç alanlıydı çünkü orada
 * kullanıcının seçtiği bir tarih (`occurredAt`) ile kaydın yazılma anı (`createdAt`) ayrı
 * kavramlar. Audit log'da böyle bir ayrım YOKTUR: kayıt yazıldığı anda oluşur. `createdAt` tek
 * başına benzersiz değildir (aynı milisaniyede iki olay — ör. bir transaction'ın ardından
 * yazılan iki audit satırı) ve sıralama anahtarı kesin bir toplam sıra vermezse iki sayfanın
 * sınırındaki satırlar ya atlanır ya tekrarlanır; bu yüzden sona `id` eklenir.
 *
 * `listAuditLog()`in `orderBy`ı da aynı ikilidir ve İKİSİ BİRLİKTE DEĞİŞMELİDİR.
 *
 * OPAKLIK BİR GÜVENLİK SINIRI DEĞİLDİR (aynı gerekçe): imleç yalnızca "nereden devam
 * edileceğini" söyler, hangi tenant'ın okunacağını DEĞİL. O sorunun tek kaynağı
 * `requirePermission()` context'idir ve sorgu her hâlükârda `tenantScoped()` içinden geçer.
 */

export type AuditLogCursor = {
  createdAt: Date;
  id: string;
};

/** Alanları ayıran karakter: `id` (cuid) ve ISO tarih biçiminde geçemez, kaçış gerekmez. */
const SEPARATOR = "|";

export function encodeAuditLogCursor(row: AuditLogCursor): string {
  return Buffer.from(`${row.createdAt.toISOString()}${SEPARATOR}${row.id}`, "utf8").toString(
    "base64url",
  );
}

/**
 * Bozuk imleç `null` döner — SESSİZCE İLK SAYFAYA DÜŞMEZ.
 *
 * Çağıran taraf bunu 400'e çevirir. Sessizce baştan başlamak, kullanıcının "ikinci sayfa"
 * beklerken birinci sayfayı görmesi ve bunu fark etmemesi demekti; sessiz yanlış cevap, hata
 * mesajından kötüdür.
 */
export function decodeAuditLogCursor(value: string): AuditLogCursor | null {
  let decoded: string;
  try {
    decoded = Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const parts = decoded.split(SEPARATOR);
  if (parts.length !== 2) {
    return null;
  }

  const [createdAtRaw, id] = parts;
  const createdAt = new Date(createdAtRaw);

  // `isValidId` ile id'nin şekli de doğrulanır: kurcalanmış bir imleç sorguya rastgele bir
  // metin taşımasın. Güvenlik sınırı DEĞİL (yukarı bakın), yalnızca çöp girdiyi erken kesmek.
  if (Number.isNaN(createdAt.getTime()) || !isValidId(id)) {
    return null;
  }

  return { createdAt, id };
}
