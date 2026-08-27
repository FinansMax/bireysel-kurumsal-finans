import { CategoryType, Prisma } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "@/lib/audit/actions";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { runSerializable, SerializationConflictError } from "@/lib/db/serializable";
import { prisma } from "@/lib/prisma";
import { tenantScoped } from "@/lib/tenancy/scope";
import { isValidId } from "@/lib/tenants/validation";

import {
  isValidCategoryType,
  MAX_TRANSACTION_DESCRIPTION_LENGTH,
  parseDescription,
  parseOccurredAt,
  parsePositiveMoney,
} from "./validation";

/**
 * Tenant'ın gelir/gider işlemleri (Issue #53).
 *
 * TENANT İZOLASYONU: `account.ts`/`category.ts` ile aynı desen — her sorgu `tenantScoped()`
 * üzerinden geçer, mutation'lar `updateMany`/`deleteMany` + `count === 1` ile yapılır,
 * yalnız-ID ile `update`/`delete` KULLANILMAZ. `tenantId` daima çağıran route'taki
 * `requirePermission()` context'inden gelir — URL parametresi veya body DEĞİL. Bu, işlemin
 * BAĞLANDIĞI hesap ve kategori için de geçerlidir: ikisi de aynı tenant içinde aranır, aksi
 * halde bir saldırgan kendi işlemini başka tenant'ın hesabına yazdırabilirdi.
 *
 * BU MODELE ÖZGÜ OLAN: işlem tek başına bir kayıt değildir, `Account.balance`ı DEĞİŞTİRİR.
 * Kayıt ile bakiye güncellemesi daima TEK bir DB transaction'ı içindedir; ikisinin arasında
 * bir çökme, bakiyesi kaydına uymayan bir hesap bırakırdı.
 *
 * Bu fonksiyonlar authorization kararı VERMEZ; kimin çağırabileceği route seviyesinde
 * `requirePermission(PERMISSIONS.VIEW_TRANSACTIONS | MANAGE_TRANSACTIONS, tenantId)` ile
 * belirlenir.
 */

class NotFoundError extends Error {}
class AccountNotFoundError extends Error {}
class CategoryNotFoundError extends Error {}
class CategoryTypeMismatchError extends Error {}

const transactionSelect = {
  id: true,
  type: true,
  amount: true,
  description: true,
  occurredAt: true,
  accountId: true,
  categoryId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TransactionSelect;

type TransactionRow = Prisma.TransactionGetPayload<{ select: typeof transactionSelect }>;

/**
 * Dışarı verilen işlem gösterimi. `amount` BİLEREK `string`tir — `AccountView.balance` ile
 * aynı gerekçe (invariant #10): para JSON'da string taşınır ve dönüşüm tek bir yerde yapılır.
 */
export type TransactionView = Omit<TransactionRow, "amount"> & { amount: string };

function toView(row: TransactionRow): TransactionView {
  return { ...row, amount: row.amount.toString() };
}

/**
 * Bir işlemin hesabın bakiyesine etkisi: gelir artırır, gider azaltır.
 *
 * Tutar daima pozitiftir (bkz. `parsePositiveMoney()`), yönü `type` taşır — bu yüzden işaret
 * TEK bir yerde, burada üretilir. Ters çevirme (silme/güncelleme) de aynı fonksiyonun
 * `negated()`ı ile yapılır, böylece "ekleme" ile "geri alma" mantığı birbirinden ayrışamaz.
 */
function balanceDelta(type: CategoryType, amount: Prisma.Decimal): Prisma.Decimal {
  return type === CategoryType.INCOME ? amount : amount.negated();
}

/**
 * Bakiyeyi ATOMİK olarak kaydırır: `increment`, Prisma tarafında `balance = balance + x`
 * SQL'ine çevrilir.
 *
 * Bu yüzden bakiye güncellemesi için `Serializable` izolasyona GEREK YOKTUR: uygulama
 * katmanında "oku, JS'te topla, geri yaz" yapılsaydı iki eşzamanlı işlem birbirinin yazımını
 * ezerdi (lost update) ve Serializable + retry şart olurdu. `increment` bu okumayı hiç yapmaz;
 * satır kilidi altında toplamayı DB'nin kendisi yapar.
 */
async function shiftBalance(
  tx: Prisma.TransactionClient,
  tenantId: string,
  accountId: string,
  delta: Prisma.Decimal,
): Promise<void> {
  if (delta.isZero()) {
    return;
  }

  await tx.account.updateMany({
    where: tenantScoped(tenantId, { id: accountId }),
    data: { balance: { increment: delta } },
  });
}

/** Hesap AYNI tenant'ta mı? Değilse (veya hiç yoksa) aynı hata — enumeration engeli. */
async function requireAccount(
  tx: Prisma.TransactionClient,
  tenantId: string,
  accountId: string,
): Promise<void> {
  const account = await tx.account.findFirst({
    where: tenantScoped(tenantId, { id: accountId }),
    select: { id: true },
  });

  if (!account) {
    throw new AccountNotFoundError();
  }
}

/**
 * Kategori aynı tenant'ta mı VE işlemin yönüyle uyuyor mu?
 *
 * Tür uyumu bir süsleme değil, `Category`nin (#49) benzersizlik kararının devamıdır: kategori
 * daima bir türün bağlamında seçilir. Gider işlemine gelir kategorisi bağlanabilseydi, tür
 * bazlı her rapor anlamsızlaşırdı.
 *
 * "Yok" ile "yanlış tür" FARKLI yanıtlar alır (404 / 400) ve bu bilgi sızdırmaz: her iki kayıt
 * da çağıranın KENDİ tenant'ındadır, öğrendiği şey kendi verisidir.
 */
async function requireCategory(
  tx: Prisma.TransactionClient,
  tenantId: string,
  categoryId: string,
  type: CategoryType,
): Promise<void> {
  const category = await tx.category.findFirst({
    where: tenantScoped(tenantId, { id: categoryId }),
    select: { type: true },
  });

  if (!category) {
    throw new CategoryNotFoundError();
  }
  if (category.type !== type) {
    throw new CategoryTypeMismatchError();
  }
}

/**
 * Liste filtreleri (Issue #56). Hepsi opsiyoneldir; verilmeyen alan filtrelemez.
 *
 * Değerler ÇAĞIRAN TARAFINDA doğrulanmış olarak gelir (route katmanı) — bu tip, ham istemci
 * girdisini temsil etmez.
 */
export type TransactionFilters = {
  /** Dahil: bu günün başlangıcından itibaren. */
  from?: Date;
  /** Dahil: bu GÜNÜN SONUNA kadar (aşağıdaki `nextDay()` notuna bakın). */
  to?: Date;
  accountId?: string;
  categoryId?: string;
  /** `description` içinde geçen, büyük/küçük harf duyarsız serbest metin. */
  q?: string;
};

/**
 * Verilen günün ertesi gününün başlangıcı.
 *
 * `to` filtresi KULLANICI İÇİN DAHİLDİR ("15 Mart'a kadar" 15 Mart'ı da kapsar), ama
 * `occurredAt` bir `DateTime`tir: `lte: 2026-03-15T00:00:00Z` yazmak o gün saat 10:00'da
 * kaydedilmiş bir işlemi DIŞARIDA bırakırdı — kullanıcının gördüğü listeyle filtre sonucu
 * sessizce ayrışırdı. Bu yüzden üst sınır, ertesi günün başlangıcına `lt` olarak uygulanır.
 */
function nextDay(date: Date): Date {
  return new Date(date.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * İşlemleri listeler: önce gerçekleşme tarihi (yeniden eskiye), eşitlikte kayıt zamanı.
 *
 * İkinci ölçüt sıralamayı DETERMİNİSTİK yapar — aynı güne girilmiş iki işlemin sırası aksi
 * halde DB'nin keyfine kalırdı.
 *
 * FİLTRELER `tenantScoped()`İN ÜZERİNE eklenir, onun YERİNE geçmez (aynı kural `Category`nin
 * `?type` filtresinde de var). Tek bir filtrenin tenant koşulunu düşürmesi, listeyi tüm
 * tenant'lara açardı; koruma `integration/tenant-scope-pattern.spec.ts`'tedir.
 *
 * BİLİNEN SINIR: liste hâlâ sayfalanmaz. Sayfalama bu issue'nun kapsamında değildir ve ayrı
 * bir issue gerektirir — filtreleme onu daha az acil yapar ama ortadan kaldırmaz.
 */
export async function listTransactions(
  tenantId: string,
  filters: TransactionFilters = {},
): Promise<TransactionView[]> {
  const occurredAt: Prisma.DateTimeFilter = {};
  if (filters.from) {
    occurredAt.gte = filters.from;
  }
  if (filters.to) {
    occurredAt.lt = nextDay(filters.to);
  }

  const transactions = await prisma.transaction.findMany({
    where: tenantScoped(tenantId, {
      ...(filters.from || filters.to ? { occurredAt } : {}),
      ...(filters.accountId ? { accountId: filters.accountId } : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      // `QueryMode.insensitive` Postgres'te ILIKE'a çevrilir. Sabit, düz `"insensitive"`
      // string'i yerine typed enum'dan alınır: spread içinde literal tipi `string`e genişler
      // ve Prisma'nın `QueryMode` beklentisiyle uyuşmazdı.
      //
      // `description` üzerinde index YOKTUR: bu sorgu tarama yapar. Tenant başına işlem sayısı
      // büyüdüğünde bir trigram index gerekecek — bugün eklemek, ölçülmemiş bir maliyeti
      // şemaya yazmak olurdu.
      ...(filters.q
        ? { description: { contains: filters.q, mode: Prisma.QueryMode.insensitive } }
        : {}),
    }),
    select: transactionSelect,
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
  });

  return transactions.map(toView);
}

export type CreateTransactionInput = {
  accountId: unknown;
  type: unknown;
  amount: unknown;
  categoryId?: unknown;
  description?: unknown;
  occurredAt?: unknown;
};

export type CreateTransactionResult =
  | { ok: true; transaction: TransactionView }
  | { ok: false; status: 400 | 404; error: string };

const INVALID_TYPE_ERROR = "Type must be one of INCOME, EXPENSE";
const INVALID_AMOUNT_ERROR =
  "Amount must be a positive decimal string with at most 4 decimal places";
const INVALID_DESCRIPTION_ERROR = `Description must be at most ${MAX_TRANSACTION_DESCRIPTION_LENGTH} characters`;
const INVALID_OCCURRED_AT_ERROR = "occurredAt must be an ISO 8601 date or date-time";
const INVALID_ACCOUNT_ID_ERROR = "Invalid account id";
const INVALID_CATEGORY_ID_ERROR = "Invalid category id";
const CATEGORY_TYPE_MISMATCH_ERROR = "Category type must match the transaction type";
const ACCOUNT_NOT_FOUND_ERROR = "Account not found";
const CATEGORY_NOT_FOUND_ERROR = "Category not found";
const NOT_FOUND_ERROR = "Transaction not found";
const SERIALIZATION_CONFLICT_ERROR = "Temporary write conflict, please retry";
const NO_FIELDS_ERROR = "No updatable fields provided";

/** Doğrulanmış, servis içinde üretilmiş alanlar — istemci nesnesi ASLA Prisma'ya geçirilmez. */
type ValidatedFields = {
  type?: CategoryType;
  amount?: Prisma.Decimal;
  description?: string | null;
  occurredAt?: Date;
  accountId?: string;
  categoryId?: string | null;
};

export async function createTransaction(
  tenantId: string,
  actorUserId: string,
  input: CreateTransactionInput,
): Promise<CreateTransactionResult> {
  if (!isValidId(input.accountId)) {
    return { ok: false, status: 400, error: INVALID_ACCOUNT_ID_ERROR };
  }
  const accountId = input.accountId;

  if (!isValidCategoryType(input.type)) {
    return { ok: false, status: 400, error: INVALID_TYPE_ERROR };
  }
  const type = input.type;

  const amount = parsePositiveMoney(input.amount);
  if (!amount) {
    return { ok: false, status: 400, error: INVALID_AMOUNT_ERROR };
  }

  // `undefined` (hiç gönderilmedi) ile `null` (açıkça "notu yok") AYRIDIR; ikisi de geçerlidir,
  // ama geçersiz bir değer sessizce boşa düşürülMEZ.
  let description: string | null = null;
  if (input.description !== undefined) {
    const parsed = parseDescription(input.description);
    if (parsed === undefined) {
      return { ok: false, status: 400, error: INVALID_DESCRIPTION_ERROR };
    }
    description = parsed;
  }

  // Gönderilmezse şemadaki `@default(now())` geçerlidir (işlem formunun doğal varsayılanı
  // bugündür); bu yüzden alan `undefined` bırakılır, burada `new Date()` ile DOLDURULMAZ.
  let occurredAt: Date | undefined;
  if (input.occurredAt !== undefined) {
    const parsed = parseOccurredAt(input.occurredAt);
    if (!parsed) {
      return { ok: false, status: 400, error: INVALID_OCCURRED_AT_ERROR };
    }
    occurredAt = parsed;
  }

  let categoryId: string | null = null;
  if (input.categoryId !== undefined && input.categoryId !== null) {
    if (!isValidId(input.categoryId)) {
      return { ok: false, status: 400, error: INVALID_CATEGORY_ID_ERROR };
    }
    categoryId = input.categoryId;
  }

  try {
    // Serializable DEĞİL, varsayılan izolasyon: burada okumaya bağlı bir invariant yoktur.
    // Hesap/kategori varlık kontrolleri sonradan yazılan satırı geçersiz kılmaz (FK kısıtı
    // zaten arkada durur) ve bakiye `increment` ile atomik kaydırılır — bkz. `shiftBalance()`.
    // Gereksiz Serializable, her eşzamanlı kayıt için yeniden deneme üretirdi.
    const created = await prisma.$transaction(async (tx) => {
      await requireAccount(tx, tenantId, accountId);
      if (categoryId !== null) {
        await requireCategory(tx, tenantId, categoryId, type);
      }

      const row = await tx.transaction.create({
        data: { tenantId, accountId, categoryId, type, amount, description, occurredAt },
        select: transactionSelect,
      });

      await shiftBalance(tx, tenantId, accountId, balanceDelta(type, amount));

      return row;
    });

    // Audit yazımı transaction commit ettikten SONRA ve best-effort (Issue #15).
    // Metadata TUTARI TAŞIMAZ: audit log finansal tutarların ikinci bir kopyası değildir
    // (`account.ts`/`category.ts` ile aynı karar) — "kim, ne zaman, hangi hesapta" yeterlidir.
    await writeAuditLog({
      actorUserId,
      tenantId,
      action: AUDIT_ACTIONS.TRANSACTION_CREATED,
      targetType: AUDIT_TARGET_TYPES.TRANSACTION,
      targetId: created.id,
      metadata: { type: created.type, accountId: created.accountId },
    });

    return { ok: true, transaction: toView(created) };
  } catch (error) {
    // 503 dalı YOKTUR: create `runSerializable()` kullanmaz, dolayısıyla buradan bir
    // `SerializationConflictError` çıkamaz (bkz. `updateTransaction()` dokümantasyonu).
    const mapped = mapDomainError(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

export type UpdateTransactionInput = {
  accountId?: unknown;
  categoryId?: unknown;
  type?: unknown;
  amount?: unknown;
  description?: unknown;
  occurredAt?: unknown;
};

export type UpdateTransactionResult =
  | { ok: true; transaction: TransactionView }
  // 503: eşzamanlı yükte transaction serialize edilemedi ve yeniden denemeler tükendi
  // (Issue #122). GEÇİCİ bir durumdur — 409 (iş kuralı ihlali) ile karıştırılmamalıdır.
  | { ok: false; status: 400 | 404 | 503; error: string };

/**
 * İşlemi günceller. Yalnızca GÖNDERİLEN alanlar değişir (partial update).
 *
 * NEDEN SERIALIZABLE (create/delete'ten farklı olarak): bakiye düzeltmesi, işlemin ESKİ
 * değerinin OKUNMASINA dayanır — "önceki etkiyi geri al, yenisini uygula". İki eşzamanlı
 * güncelleme aynı eski tutarı okuyup ikisi de kendi farkını uygularsa bakiye kalıcı olarak
 * bozulur. Bu tam olarak `CLAUDE.md`'nin "okumaya bağlı invariant" tanımıdır;
 * `runSerializable()` kaybeden isteği yeniden dener (Issue #122), denemeler tükenirse 503.
 *
 * `create`/`delete`te bu risk YOKTUR: create hiçbir eski değer okumaz, delete ise `deleteMany`
 * + `count === 1` kapısıyla korunur — eşzamanlı ikinci silme 0 satır etkiler ve bakiyeye hiç
 * dokunmadan 404'e düşer.
 *
 * `tenantId`/`id`/`createdAt` YAPISAL olarak güncellenemez: fonksiyon `input` nesnesini
 * Prisma'ya geçirmez, yalnızca doğruladığı alanları `fields` içine açıkça yazar.
 */
export async function updateTransaction(
  tenantId: string,
  transactionId: string,
  actorUserId: string,
  input: UpdateTransactionInput,
): Promise<UpdateTransactionResult> {
  const fields: ValidatedFields = {};

  if (input.type !== undefined) {
    if (!isValidCategoryType(input.type)) {
      return { ok: false, status: 400, error: INVALID_TYPE_ERROR };
    }
    fields.type = input.type;
  }

  if (input.amount !== undefined) {
    const parsed = parsePositiveMoney(input.amount);
    if (!parsed) {
      return { ok: false, status: 400, error: INVALID_AMOUNT_ERROR };
    }
    fields.amount = parsed;
  }

  if (input.description !== undefined) {
    const parsed = parseDescription(input.description);
    if (parsed === undefined) {
      return { ok: false, status: 400, error: INVALID_DESCRIPTION_ERROR };
    }
    fields.description = parsed;
  }

  if (input.occurredAt !== undefined) {
    const parsed = parseOccurredAt(input.occurredAt);
    if (!parsed) {
      return { ok: false, status: 400, error: INVALID_OCCURRED_AT_ERROR };
    }
    fields.occurredAt = parsed;
  }

  if (input.accountId !== undefined) {
    if (!isValidId(input.accountId)) {
      return { ok: false, status: 400, error: INVALID_ACCOUNT_ID_ERROR };
    }
    fields.accountId = input.accountId;
  }

  // `categoryId: null` "kategoriyi kaldır" demektir ve geçerli bir güncellemedir.
  if (input.categoryId !== undefined) {
    if (input.categoryId === null) {
      fields.categoryId = null;
    } else if (!isValidId(input.categoryId)) {
      return { ok: false, status: 400, error: INVALID_CATEGORY_ID_ERROR };
    } else {
      fields.categoryId = input.categoryId;
    }
  }

  if (Object.keys(fields).length === 0) {
    return { ok: false, status: 400, error: NO_FIELDS_ERROR };
  }

  try {
    const updated = await runSerializable(async (tx) => {
      const existing = await tx.transaction.findFirst({
        where: tenantScoped(tenantId, { id: transactionId }),
        select: { accountId: true, categoryId: true, type: true, amount: true },
      });
      if (!existing) {
        throw new NotFoundError();
      }

      const nextType = fields.type ?? existing.type;
      const nextAmount = fields.amount ?? existing.amount;
      const nextAccountId = fields.accountId ?? existing.accountId;
      const nextCategoryId =
        fields.categoryId !== undefined ? fields.categoryId : existing.categoryId;

      if (nextAccountId !== existing.accountId) {
        await requireAccount(tx, tenantId, nextAccountId);
      }

      // Kategori DEĞİŞMEMİŞ olsa bile yeniden kontrol edilir: `type` değiştiyse, dokunulmamış
      // eski kategori artık yanlış tarafta kalmış olabilir. Böyle bir güncelleme sessizce
      // geçseydi kayıt tür-kategori tutarsızlığıyla kalırdı; kullanıcı ya kategoriyi de
      // değiştirmeli ya da (`categoryId: null` ile) kaldırmalıdır.
      if (nextCategoryId !== null) {
        await requireCategory(tx, tenantId, nextCategoryId, nextType);
      }

      // `update({ where: { id } })` KULLANILMAZ: id tek başına unique olduğu için Prisma bunu
      // kabul ederdi, ama o zaman tenant scope'u mutation'ın KENDİSİNDE taşınmazdı.
      const { count } = await tx.transaction.updateMany({
        where: tenantScoped(tenantId, { id: transactionId }),
        // `Unchecked...` varyantı, FK sütunlarının (`accountId`/`categoryId`) güncellenebildiği
        // tek varyanttır. Güvenli olmasının nedeni tipin kendisi değil, `fields`in istemciden
        // GELMEMESİ: her anahtarı yukarıda tek tek doğrulanıp açıkça atanmıştır.
        data: fields satisfies Prisma.TransactionUncheckedUpdateManyInput,
      });
      if (count !== 1) {
        throw new NotFoundError();
      }

      const previousDelta = balanceDelta(existing.type, existing.amount);
      const nextDelta = balanceDelta(nextType, nextAmount);

      if (nextAccountId === existing.accountId) {
        // Tek hesap: yalnızca NET fark uygulanır (önce geri al sonra ekle deseni, aynı satıra
        // gereksiz iki yazma olurdu).
        await shiftBalance(tx, tenantId, nextAccountId, nextDelta.minus(previousDelta));
      } else {
        // İşlem hesap değiştirdi: eski hesaptan etkisi tamamen geri alınır, yenisine eklenir.
        await shiftBalance(tx, tenantId, existing.accountId, previousDelta.negated());
        await shiftBalance(tx, tenantId, nextAccountId, nextDelta);
      }

      return tx.transaction.findFirstOrThrow({
        where: tenantScoped(tenantId, { id: transactionId }),
        select: transactionSelect,
      });
    });

    await writeAuditLog({
      actorUserId,
      tenantId,
      action: AUDIT_ACTIONS.TRANSACTION_UPDATED,
      targetType: AUDIT_TARGET_TYPES.TRANSACTION,
      targetId: updated.id,
      // Hangi ALANLARIN değiştiği kaydedilir, yeni değerler değil (`account.ts` ile aynı karar).
      metadata: { updatedFields: Object.keys(fields) },
    });

    return { ok: true, transaction: toView(updated) };
  } catch (error) {
    if (error instanceof SerializationConflictError) {
      return { ok: false, status: 503, error: SERIALIZATION_CONFLICT_ERROR };
    }
    const mapped = mapDomainError(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

export type DeleteTransactionResult = { ok: true } | { ok: false; status: 404; error: string };

/**
 * İşlemi siler ve etkisini hesabın bakiyesinden geri alır — ikisi tek transaction içinde.
 *
 * Serializable'a gerek yoktur: `deleteMany` + `count === 1` kapısı, eşzamanlı ikinci silmenin
 * bakiyeyi İKİNCİ KEZ geri almasını imkânsız kılar (o istek 0 satır etkiler ve 404'e düşer).
 */
export async function deleteTransaction(
  tenantId: string,
  transactionId: string,
  actorUserId: string,
): Promise<DeleteTransactionResult> {
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.transaction.findFirst({
        where: tenantScoped(tenantId, { id: transactionId }),
        select: { accountId: true, type: true, amount: true },
      });
      if (!existing) {
        throw new NotFoundError();
      }

      // `delete({ where: { id } })` yerine `deleteMany` + `tenantScoped()`: silme sorgusunun
      // kendisi de tenant ile scope'lanır (bkz. `account.ts`'teki aynı gerekçe).
      const { count } = await tx.transaction.deleteMany({
        where: tenantScoped(tenantId, { id: transactionId }),
      });
      if (count !== 1) {
        throw new NotFoundError();
      }

      await shiftBalance(
        tx,
        tenantId,
        existing.accountId,
        balanceDelta(existing.type, existing.amount).negated(),
      );
    });

    await writeAuditLog({
      actorUserId,
      tenantId,
      action: AUDIT_ACTIONS.TRANSACTION_DELETED,
      targetType: AUDIT_TARGET_TYPES.TRANSACTION,
      targetId: transactionId,
    });

    return { ok: true };
  } catch (error) {
    if (error instanceof NotFoundError) {
      return { ok: false, status: 404, error: NOT_FOUND_ERROR };
    }
    throw error;
  }
}

/**
 * Transaction içinden fırlatılan domain hatalarını ortak result şekline çevirir.
 *
 * Tanımadığı hata için `null` döner — çağıran onu OLDUĞU GİBİ yukarı fırlatır. Bu bilinçlidir:
 * beklenmeyen bir hatayı 400/404 gibi tanımlı bir sonuca çevirmek gerçek arızayı gizlerdi.
 * `SerializationConflictError` burada ELE ALINMAZ; yalnızca `runSerializable()` kullanan
 * `updateTransaction()` onu 503'e çevirir (create/delete'te hiç oluşamaz).
 */
function mapDomainError(error: unknown): { ok: false; status: 400 | 404; error: string } | null {
  if (error instanceof NotFoundError) {
    return { ok: false, status: 404, error: NOT_FOUND_ERROR };
  }
  if (error instanceof AccountNotFoundError) {
    return { ok: false, status: 404, error: ACCOUNT_NOT_FOUND_ERROR };
  }
  if (error instanceof CategoryNotFoundError) {
    return { ok: false, status: 404, error: CATEGORY_NOT_FOUND_ERROR };
  }
  if (error instanceof CategoryTypeMismatchError) {
    return { ok: false, status: 400, error: CATEGORY_TYPE_MISMATCH_ERROR };
  }
  return null;
}
