import { CategoryType, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { tenantScoped } from "@/lib/tenancy/scope";

import { nextDay } from "./transaction";

/**
 * Kategori bazlı harcama dağılımı — Issue #65.
 *
 * TENANT İZOLASYONU: `dashboard.ts` ile aynı desen — buradaki HER sorgu `tenantScoped()`
 * üzerinden geçer ve modül SALT OKUNURDUR (tek bir yazma çağrısı yoktur). `tenantId` daima
 * çağıranın `requirePermission()` context'inden gelir.
 *
 * ---
 *
 * YALNIZCA GİDER. Adı bunu söylüyor ama sınırı yazmak önemli: `type: EXPENSE` filtresi bir
 * varsayılan değil, tanımın kendisidir. Gelirleri de aynı halkaya koymak, "harcamanın %40'ı
 * kira" gibi her cümleyi anlamsızlaştırırdı — pay ve payda farklı şeyler olurdu.
 *
 * PARA BİRİMLERİ AYRI. `dashboard.ts`'teki kararın aynısı ve aynı gerekçeyle: kur dönüşümü
 * yok, dolayısıyla TRY ve USD harcamaları tek bir dağılımda toplanamaz. Her para birimi kendi
 * halkasını alır. İşlemin para birimi kendi satırında değil, bağlı olduğu `Account.currency`
 * üzerindedir; Prisma `groupBy` ilişki alanıyla gruplayamadığı ve ham SQL yasak olduğu için
 * gruplama `accountId` üzerinden yapılır, katlama `Prisma.Decimal` ile tamamlanır — hiçbir
 * noktada `number`a dönüşülmez (invariant #10).
 *
 * TARİH ARALIĞI SÖZLEŞMESİ `listTransactions()` İLE AYNIDIR: `from` ve `to` DAHİLDİR ve üst
 * sınır ortak `nextDay()` kuralıyla uygulanır (bkz. `transaction.ts`). İki ayrı kural, aynı
 * tarih aralığının iki ekranda iki farklı sonuç vermesi demek olurdu.
 */

/**
 * Halkanın tek bir dilimi.
 *
 * `categoryId: null` = KATEGORİSİZ. İki ayrı durumu birleştirir: kategori hiç seçilmemiş
 * (şemada `categoryId` opsiyoneldir) ya da kategori sonradan silinmiş (`onDelete: SetNull`,
 * #53). Kullanıcı açısından ikisi de aynı şeydir — "bu harcama sınıflandırılmamış" — ve ayrı
 * göstermek, olmayan bir ayrımı icat etmek olurdu.
 */
export type CategorySlice = {
  categoryId: string | null;
  /** `null` = kategorisiz. Sunum katmanı bunu `CategoryBadge` ile zaten biliyor. */
  name: string | null;
  amount: string;
  /**
   * Bu para birimindeki TOPLAM gidere göre pay: `0.00`–`100.00` arası string.
   *
   * `dashboard.ts`'teki oran kararının aynısı: bölme `Prisma.Decimal` ile SERVİSTE yapılır,
   * çünkü sunum katmanında yapmak `Number(amount) / Number(total)` demekti — paranın kayan
   * noktaya dönmesi.
   */
  sharePercent: string;
  /**
   * Halkada bu dilimin BAŞLANGIÇ noktası (kendinden önceki dilimlerin toplam payı),
   * `0.00`–`100.00`.
   *
   * Kümülatif toplam da serviste üretilir ve TAM değerler üzerinden hesaplanır (yuvarlanmış
   * payların toplamı üzerinden değil): aksi halde her dilimde biriken yuvarlama hatası, son
   * dilimi halkanın başlangıcıyla çakıştırırdı.
   */
  offsetPercent: string;
};

export type CurrencySpending = {
  currency: string;
  /** Bu para birimindeki toplam gider (dilimlerin toplamı). */
  total: string;
  /** Tutara göre AZALAN sırada. Boş dizi DÖNMEZ — dilimsiz bir para birimi hiç eklenmez. */
  slices: CategorySlice[];
};

export type SpendingByCategory = {
  /** Uygulanan aralık, `YYYY-MM-DD` (ikisi de DAHİL). İstemci ne sorduğunu geri görebilmeli. */
  range: { from: string; to: string };
  /** YALNIZCA aralıkta gideri olan para birimleri. Boş dizi = aralıkta hiç gider yok. */
  currencies: CurrencySpending[];
};

export type SpendingRange = {
  /** Dahil. */
  from: Date;
  /** Dahil (üst sınır `nextDay()` ile uygulanır). */
  to: Date;
};

const ZERO = new Prisma.Decimal(0);

/**
 * Varsayılan aralık: İÇİNDE BULUNULAN AYIN TAMAMI (UTC).
 *
 * "Son 30 gün" REDDEDİLDİ: panelin hemen üstündeki özet "bu ay" diyor ve iki bölümün farklı
 * dönemleri göstermesi, aynı ekranda birbirini yalanlayan iki sayı üretirdi. Ay sonuna kadar
 * (bugüne kadar değil) alınır ki ileri tarihli kayıtlar da özetle aynı kovada kalsın.
 *
 * UTC — `dashboard.ts` ve `parseFilterDate()` ile aynı tercih; saat dilimi yönetimi hâlâ yok
 * (Issue #134).
 */
export function defaultSpendingRange(now: Date = new Date()): SpendingRange {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  return {
    from: new Date(Date.UTC(year, month, 1)),
    // Ayın 0. günü = bir önceki ayın son günü; artık yıl kuralı elle yazılmaz.
    to: new Date(Date.UTC(year, month + 1, 0)),
  };
}

/** `Date` → `YYYY-MM-DD` (UTC). Aralık sınırları hep gün hassasiyetindedir. */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function percentOf(value: Prisma.Decimal, total: Prisma.Decimal): string {
  if (total.isZero()) {
    return "0.00";
  }
  return value.div(total).times(100).toFixed(2);
}

/** Tutara göre azalan; eşitlikte ada göre. Kategorisiz DAİMA sona düşer (adı yoktur). */
function compareSlices(
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
  // `localeCompare` KULLANILMAZ: sıra ICU sürümüne bağlı olmasın (dashboard.ts'teki aynı not).
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

export async function getSpendingByCategory(
  tenantId: string,
  range: SpendingRange,
): Promise<SpendingByCategory> {
  const groups = await prisma.transaction.groupBy({
    by: ["accountId", "categoryId"],
    where: tenantScoped(tenantId, {
      type: CategoryType.EXPENSE,
      // Üst sınır `lt nextDay(to)`: `lte: to` yazmak, `to` gününde saati olan bir işlemi
      // dışarıda bırakırdı (ortak kural, bkz. `transaction.ts` → `nextDay`).
      occurredAt: { gte: range.from, lt: nextDay(range.to) },
    }),
    _sum: { amount: true },
  });

  // Hesap ve kategori adları groupBy'DAN SONRA okunur (`dashboard.ts`'teki aynı gerekçe):
  // paralel okunsalardı, araya giren yeni bir hesap groupBy'da görünüp haritada olmayabilir ve
  // o para biriminin toplamı sessizce eksik kalırdı.
  const [accounts, categories] = await Promise.all([
    prisma.account.findMany({
      where: tenantScoped(tenantId, {}),
      select: { id: true, currency: true },
    }),
    prisma.category.findMany({
      where: tenantScoped(tenantId, {}),
      select: { id: true, name: true },
    }),
  ]);

  const currencyByAccountId = new Map(accounts.map(({ id, currency }) => [id, currency]));
  const nameByCategoryId = new Map(categories.map(({ id, name }) => [id, name]));

  // currency → (categoryId | "") → tutar. Anahtar olarak `null` kullanılamadığı için
  // kategorisiz kova boş string'tir; dışarı çıkarken tekrar `null`a çevrilir.
  const UNCATEGORIZED = "";
  const byCurrency = new Map<string, Map<string, Prisma.Decimal>>();

  for (const group of groups) {
    const currency = currencyByAccountId.get(group.accountId);
    if (!currency) {
      // Ulaşılamaz olmalı (yukarıdaki okuma sırası + `onDelete: NoAction`). Yine de burada
      // durmak yanlış olurdu: panel tek bir tutarsız satır yüzünden hiç açılmamalı.
      continue;
    }

    // Kategori kaydı bulunamıyorsa (aralık okunurken silinmiş olabilir) dilim KATEGORİSİZ
    // kovasına katlanır — "bilinmeyen kategori" diye sahte bir dilim üretmek yerine, kaydın
    // birazdan DB'de de alacağı hâl (`SetNull`) gösterilir.
    const key =
      group.categoryId && nameByCategoryId.has(group.categoryId)
        ? group.categoryId
        : UNCATEGORIZED;

    const buckets = byCurrency.get(currency) ?? new Map<string, Prisma.Decimal>();
    // `Prisma.Decimal` değişmezdir: `plus()` yeni örnek döner.
    buckets.set(key, (buckets.get(key) ?? ZERO).plus(group._sum.amount ?? ZERO));
    byCurrency.set(currency, buckets);
  }

  const currencies: CurrencySpending[] = [...byCurrency.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, buckets]) => {
      const entries = [...buckets.entries()]
        .map(([key, amount]) => ({
          categoryId: key === UNCATEGORIZED ? null : key,
          name: key === UNCATEGORIZED ? null : (nameByCategoryId.get(key) ?? null),
          amount,
        }))
        .sort(compareSlices);

      let total = ZERO;
      for (const entry of entries) {
        total = total.plus(entry.amount);
      }

      let cumulative = ZERO;
      const slices = entries.map((entry) => {
        const slice: CategorySlice = {
          categoryId: entry.categoryId,
          name: entry.name,
          amount: entry.amount.toString(),
          sharePercent: percentOf(entry.amount, total),
          offsetPercent: percentOf(cumulative, total),
        };
        cumulative = cumulative.plus(entry.amount);
        return slice;
      });

      return { currency, total: total.toString(), slices };
    });

  return {
    range: { from: toIsoDate(range.from), to: toIsoDate(range.to) },
    currencies,
  };
}
