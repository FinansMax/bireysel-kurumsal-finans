/**
 * Türkiye'de faaliyet gösteren bankaların seçilebilir listesi (Issue #148).
 *
 * ---
 *
 * NEDEN PRISMA ENUM DEĞİL: `AccountType` ve `CategoryType` enum'dur çünkü kümeleri KÜÇÜK ve
 * KARARLIDIR (şemadaki notlarına bakın). Banka listesi ikisi de değildir — birleşmeler, yeni
 * lisanslar ve marka değişimleri olur. Enum yapmak her banka değişikliğinde bir migration
 * demekti. `AuditLog.action`'daki serbest `String` tercihiyle aynı gerekçe: küme sürekli
 * büyüyor.
 *
 * NEDEN SERBEST METİN DE DEĞİL: kullanıcı yazsaydı "Garanti", "garanti bankası" ve "TGB" üç
 * ayrı banka olurdu; banka bazlı herhangi bir gruplama/rapor sonsuza dek imkânsızlaşırdı.
 * Doğrulama bu yüzden bir ALLOWLIST'tir (bkz. `isValidBankCode`).
 *
 * NEDEN KOD SAKLANIYOR, AD DEĞİL: marka değişimleri ("Garanti" → "Garanti BBVA") veri
 * migration'ı gerektirmemeli. DB'de `GARANTI` durur, ekranda görünen ad buradan okunur.
 *
 * ---
 *
 * ⚠️ BU LİSTE ELLE BAKILAN BİR ANLIK GÖRÜNTÜDÜR ve BDDK'nın güncel listesine göre periyodik
 * olarak DOĞRULANMALIDIR. Kod tabanı bunu otomatik doğrulayamaz: canlı bir kaynak sorgulamak
 * yeni bir bağımlılık ve çalışma zamanı ağ çağrısı demekti.
 *
 * Bu yüzden `OTHER` ("Diğer") seçeneği VARDIR ve kaldırılmamalıdır: kullanıcı hiçbir zaman
 * "bankam listede yok" diye tıkanmamalıdır. Listedeki bir eksik, kullanıcının hesabını hiç
 * kaydedememesinden çok daha küçük bir sorundur.
 *
 * MARKALAR (Enpara, CEPTETEB gibi) LİSTEDE YOKTUR: bunlar ayrı bir banka değil, mevcut bir
 * bankanın ürün markasıdır (Enpara → QNB, CEPTETEB → TEB). Marka satırı eklemek, aynı bankanın
 * hesaplarını iki ayrı kova gibi gösterirdi. Kullanıcı ayrımı hesap ADINDA yapabilir.
 */

export type BankGroup =
  | "PUBLIC"
  | "PRIVATE"
  | "FOREIGN"
  | "PARTICIPATION"
  | "INVESTMENT"
  | "OTHER";

export type Bank = {
  /** DB'de saklanan sabit kod. ASLA yeniden adlandırılmaz (veri ona bağlıdır). */
  code: string;
  /** Ekranda görünen ad. Marka değişiminde SERBESTÇE güncellenebilir. */
  name: string;
  group: BankGroup;
};

/** Seçicideki grup başlıkları. Uzun bir listeyi taranabilir kılan tek şey bu. */
export const BANK_GROUP_LABELS: Record<BankGroup, string> = {
  PUBLIC: "Kamu sermayeli mevduat bankaları",
  PRIVATE: "Özel sermayeli mevduat bankaları",
  FOREIGN: "Yabancı sermayeli bankalar",
  PARTICIPATION: "Katılım bankaları",
  INVESTMENT: "Kalkınma ve yatırım bankaları",
  OTHER: "Diğer",
};

/** Grupların seçicideki sırası — alfabetik değil, kullanım sıklığına göre. */
export const BANK_GROUP_ORDER: readonly BankGroup[] = [
  "PUBLIC",
  "PRIVATE",
  "PARTICIPATION",
  "FOREIGN",
  "INVESTMENT",
  "OTHER",
];

export const BANKS: readonly Bank[] = [
  { code: "ZIRAAT", name: "Ziraat Bankası", group: "PUBLIC" },
  { code: "HALKBANK", name: "Halkbank", group: "PUBLIC" },
  { code: "VAKIFBANK", name: "VakıfBank", group: "PUBLIC" },

  { code: "AKBANK", name: "Akbank", group: "PRIVATE" },
  { code: "ISBANK", name: "Türkiye İş Bankası", group: "PRIVATE" },
  { code: "GARANTI", name: "Garanti BBVA", group: "PRIVATE" },
  { code: "YAPIKREDI", name: "Yapı Kredi", group: "PRIVATE" },
  { code: "QNB", name: "QNB Bank", group: "PRIVATE" },
  { code: "DENIZBANK", name: "DenizBank", group: "PRIVATE" },
  { code: "TEB", name: "TEB", group: "PRIVATE" },
  { code: "SEKERBANK", name: "Şekerbank", group: "PRIVATE" },
  { code: "ANADOLUBANK", name: "Anadolubank", group: "PRIVATE" },
  { code: "FIBABANKA", name: "Fibabanka", group: "PRIVATE" },
  { code: "ALTERNATIFBANK", name: "Alternatif Bank", group: "PRIVATE" },
  { code: "TURKISHBANK", name: "Turkish Bank", group: "PRIVATE" },
  { code: "ADABANK", name: "Adabank", group: "PRIVATE" },

  { code: "ING", name: "ING", group: "FOREIGN" },
  { code: "HSBC", name: "HSBC", group: "FOREIGN" },
  { code: "ODEABANK", name: "Odeabank", group: "FOREIGN" },
  { code: "BURGAN", name: "Burgan Bank", group: "FOREIGN" },
  { code: "ICBC", name: "ICBC Turkey Bank", group: "FOREIGN" },
  { code: "CITIBANK", name: "Citibank", group: "FOREIGN" },
  { code: "DEUTSCHE", name: "Deutsche Bank", group: "FOREIGN" },
  { code: "RABOBANK", name: "Rabobank", group: "FOREIGN" },
  { code: "BANKOFCHINA", name: "Bank of China Turkey", group: "FOREIGN" },
  { code: "MUFG", name: "MUFG Bank Turkey", group: "FOREIGN" },
  { code: "JPMORGAN", name: "JPMorgan Chase Bank", group: "FOREIGN" },
  { code: "INTESA", name: "Intesa Sanpaolo", group: "FOREIGN" },

  { code: "ZIRAATKATILIM", name: "Ziraat Katılım", group: "PARTICIPATION" },
  { code: "VAKIFKATILIM", name: "Vakıf Katılım", group: "PARTICIPATION" },
  { code: "EMLAKKATILIM", name: "Türkiye Emlak Katılım", group: "PARTICIPATION" },
  { code: "ALBARAKA", name: "Albaraka Türk", group: "PARTICIPATION" },
  { code: "KUVEYTTURK", name: "Kuveyt Türk", group: "PARTICIPATION" },
  { code: "TURKIYEFINANS", name: "Türkiye Finans", group: "PARTICIPATION" },
  { code: "HAYATFINANS", name: "Hayat Finans", group: "PARTICIPATION" },
  { code: "DUNYAKATILIM", name: "Dünya Katılım", group: "PARTICIPATION" },

  { code: "TSKB", name: "TSKB", group: "INVESTMENT" },
  { code: "TKYB", name: "Türkiye Kalkınma ve Yatırım Bankası", group: "INVESTMENT" },
  { code: "ILLERBANK", name: "İller Bankası", group: "INVESTMENT" },
  { code: "AKTIFBANK", name: "Aktif Bank", group: "INVESTMENT" },
  { code: "NUROLBANK", name: "Nurol Yatırım Bankası", group: "INVESTMENT" },
  { code: "GSDBANK", name: "GSD Yatırım Bankası", group: "INVESTMENT" },
  { code: "DILERBANK", name: "Diler Yatırım Bankası", group: "INVESTMENT" },
  { code: "PASHABANK", name: "PASHA Yatırım Bankası", group: "INVESTMENT" },
  { code: "GOLDENGLOBAL", name: "Golden Global Yatırım Bankası", group: "INVESTMENT" },
  { code: "TAKASBANK", name: "Takasbank", group: "INVESTMENT" },

  // Listede olmayan her banka için kaçış kapısı. Kullanıcı asla tıkanmamalı.
  { code: "OTHER", name: "Diğer", group: "OTHER" },
];

const BANK_BY_CODE = new Map(BANKS.map((bank) => [bank.code, bank]));

/**
 * Allowlist doğrulaması. Bilinmeyen kod KABUL EDİLMEZ — serbest metnin engellenme noktası
 * burasıdır.
 */
export function isValidBankCode(value: unknown): value is string {
  return typeof value === "string" && BANK_BY_CODE.has(value);
}

/** Kod → görünen ad. Bilinmeyen kod için `null` (veri eski bir koddan gelmiş olabilir). */
export function bankName(code: string): string | null {
  return BANK_BY_CODE.get(code)?.name ?? null;
}

/** Seçici için gruplanmış liste; grup sırası `BANK_GROUP_ORDER`, grup içi sıra tanım sırasıdır. */
export function groupedBanks(): ReadonlyArray<{ group: BankGroup; banks: readonly Bank[] }> {
  return BANK_GROUP_ORDER.map((group) => ({
    group,
    banks: BANKS.filter((bank) => bank.group === group),
  })).filter((entry) => entry.banks.length > 0);
}
