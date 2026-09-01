import { DebtCreditStatus, DebtCreditType, Prisma } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "@/lib/audit/actions";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { prisma } from "@/lib/prisma";
import { tenantScoped } from "@/lib/tenancy/scope";

import {
  isValidCounterparty,
  isValidCurrency,
  isValidDebtCreditStatus,
  isValidDebtCreditType,
  normalizeCurrency,
  parseCalendarDate,
  parsePositiveMoney,
  MAX_COUNTERPARTY_LENGTH,
  MIN_COUNTERPARTY_LENGTH,
} from "./validation";

/**
 * Tenant'ın borç/alacak kayıtları (Issue #70).
 *
 * TENANT İZOLASYONU: `account.ts`/`category.ts`/`transaction.ts` ile BİREBİR aynı desen — her
 * sorgu `tenantScoped()` üzerinden geçer, mutation'lar `updateMany`/`deleteMany` +
 * `count === 1` ile yapılır, yalnız-ID ile `update`/`delete` KULLANILMAZ. `tenantId` daima
 * çağıran route'taki `requirePermission()` context'inden gelir — URL parametresi veya body
 * DEĞİL.
 *
 * Bu fonksiyonlar authorization kararı VERMEZ; kimin çağırabileceği route seviyesinde
 * `requirePermission(PERMISSIONS.VIEW_DEBT_CREDITS | MANAGE_DEBT_CREDITS, tenantId)` ile
 * belirlenir.
 *
 * ---
 *
 * `Transaction`DAN FARKI — PARA HENÜZ HAREKET ETMEMİŞTİR. Bir borç/alacak kaydı hiçbir hesabın
 * bakiyesini değiştirmez ve `Account` ile ilişkisi yoktur; bu yüzden burada `transaction.ts`in
 * bakiye/`Serializable` karmaşıklığı YOKTUR.
 *
 * "KAPANDI" İŞARETİ OTOMATİK BİR İŞLEM ÜRETMEZ. Bir borcu `SETTLED` yapmak, o ödemeyi
 * kaydetmez — kullanıcı ödemeyi ayrıca işlem olarak girer. Otomatik üretmek kulağa yardımcı
 * gelir ama hangi hesaptan, hangi tarihte ve hangi kategoriyle sorularının cevabı yoktur;
 * uydurulmuş bir işlem, bakiyeyi sessizce bozardı. Bu bilinçli bir sınırdır (bkz. README).
 */

const debtCreditSelect = {
  id: true,
  type: true,
  counterparty: true,
  amount: true,
  currency: true,
  dueDate: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DebtCreditSelect;

type DebtCreditRow = Prisma.DebtCreditGetPayload<{ select: typeof debtCreditSelect }>;

/**
 * Dışarı verilen gösterim. `amount` BİLEREK `string`tir — `AccountView.balance` ve
 * `TransactionView.amount` ile aynı gerekçe (invariant #10).
 */
export type DebtCreditView = Omit<DebtCreditRow, "amount"> & { amount: string };

function toView(row: DebtCreditRow): DebtCreditView {
  return { ...row, amount: row.amount.toString() };
}

/**
 * Kayıtları listeler: önce AÇIK olanlar, sonra vadesi yakın olanlar.
 *
 * SIRALAMA BİR TERCİH DEĞİL, EKRANIN İŞİDİR: bu listeye bakan kişi "neyi ödemem/tahsil etmem
 * gerek" sorusunu sorar. Kapanmış kayıtlar listenin sonunda kalır, vadesizler ise vadelilerin
 * ARDINDA (`nulls: "last"`) — tarihi olmayan bir kayıt, tarihi geçmiş bir kaydın önüne
 * geçmemeli.
 *
 * SAYFALAMA YOKTUR (`account.ts`/`category.ts` ile aynı duruş): borç/alacak listesi işlem
 * listesi gibi sınırsız büyüyen bir kayıt akışı değil, elle tutulan kısa bir listedir.
 * Gerekirse `transaction.ts`teki keyset deseni (#135) buraya da uygulanır.
 */
export async function listDebtCredits(tenantId: string): Promise<DebtCreditView[]> {
  const rows = await prisma.debtCredit.findMany({
    where: tenantScoped(tenantId, {}),
    select: debtCreditSelect,
    orderBy: [
      { status: "asc" },
      { dueDate: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
    ],
  });

  return rows.map(toView);
}

export type CreateDebtCreditInput = {
  type: unknown;
  counterparty: unknown;
  amount: unknown;
  currency: unknown;
  dueDate?: unknown;
  status?: unknown;
};

export type CreateDebtCreditResult =
  | { ok: true; debtCredit: DebtCreditView }
  | { ok: false; status: 400; error: string };

const INVALID_TYPE_ERROR = "Type must be one of DEBT, CREDIT";
const INVALID_COUNTERPARTY_ERROR = `Counterparty must be between ${MIN_COUNTERPARTY_LENGTH} and ${MAX_COUNTERPARTY_LENGTH} characters`;
const INVALID_AMOUNT_ERROR =
  "Amount must be a positive decimal string with at most 4 decimal places";
const INVALID_CURRENCY_ERROR = "Currency must be a 3-letter ISO 4217 code";
const INVALID_DUE_DATE_ERROR = "dueDate must be a date in YYYY-MM-DD format";
const INVALID_STATUS_ERROR = "Status must be one of OPEN, SETTLED";
const NOT_FOUND_ERROR = "Debt/credit record not found";
const NO_FIELDS_ERROR = "No updatable fields provided";

/** Doğrulanmış, servis içinde üretilmiş alanlar — istemci nesnesi ASLA Prisma'ya geçirilmez. */
type ValidatedFields = {
  type?: DebtCreditType;
  counterparty?: string;
  amount?: Prisma.Decimal;
  currency?: string;
  dueDate?: Date | null;
  status?: DebtCreditStatus;
};

/**
 * Ortak alan doğrulaması.
 *
 * `partial` modunda yalnızca GÖNDERİLEN alanlar doğrulanır (PATCH); tam modda zorunlular da
 * aranır (POST). Tek bir yerde tutulur ki oluşturma ile güncelleme aynı kuralları uygulasın —
 * iki kopya, zamanla "oluştururken reddedilen ama güncellerken kabul edilen" bir değer üretir.
 */
function validate(
  input: CreateDebtCreditInput | UpdateDebtCreditInput,
  partial: boolean,
): { ok: true; fields: ValidatedFields } | { ok: false; error: string } {
  const fields: ValidatedFields = {};

  if (input.type !== undefined || !partial) {
    if (!isValidDebtCreditType(input.type)) {
      return { ok: false, error: INVALID_TYPE_ERROR };
    }
    fields.type = input.type;
  }

  if (input.counterparty !== undefined || !partial) {
    if (typeof input.counterparty !== "string") {
      return { ok: false, error: INVALID_COUNTERPARTY_ERROR };
    }
    const counterparty = input.counterparty.trim();
    if (!isValidCounterparty(counterparty)) {
      return { ok: false, error: INVALID_COUNTERPARTY_ERROR };
    }
    fields.counterparty = counterparty;
  }

  if (input.amount !== undefined || !partial) {
    // KESİN POZİTİF: tutarın yönünü `type` taşır (#53'ün kuralının borç/alacaktaki karşılığı).
    // Negatif bir `DEBT`, kılık değiştirmiş bir alacak olurdu; sıfır ise kayıt değil gürültü.
    const amount = parsePositiveMoney(input.amount);
    if (!amount) {
      return { ok: false, error: INVALID_AMOUNT_ERROR };
    }
    fields.amount = amount;
  }

  if (input.currency !== undefined || !partial) {
    if (typeof input.currency !== "string") {
      return { ok: false, error: INVALID_CURRENCY_ERROR };
    }
    const currency = normalizeCurrency(input.currency);
    if (!isValidCurrency(currency)) {
      return { ok: false, error: INVALID_CURRENCY_ERROR };
    }
    fields.currency = currency;
  }

  if (input.dueDate !== undefined) {
    // Vade OPSİYONELDİR ve `null` "vadesi yok" demektir — `balance`taki katı `null` reddinin
    // aksine, çünkü vadesiz bir borç meşru bir kayıttır.
    if (input.dueDate === null) {
      fields.dueDate = null;
    } else {
      const dueDate = parseCalendarDate(input.dueDate);
      if (!dueDate) {
        return { ok: false, error: INVALID_DUE_DATE_ERROR };
      }
      fields.dueDate = dueDate;
    }
  }

  if (input.status !== undefined) {
    if (!isValidDebtCreditStatus(input.status)) {
      return { ok: false, error: INVALID_STATUS_ERROR };
    }
    fields.status = input.status;
  }

  return { ok: true, fields };
}

export async function createDebtCredit(
  tenantId: string,
  actorUserId: string,
  input: CreateDebtCreditInput,
): Promise<CreateDebtCreditResult> {
  const validated = validate(input, false);
  if (!validated.ok) {
    return { ok: false, status: 400, error: validated.error };
  }

  const { type, counterparty, amount, currency, dueDate, status } = validated.fields;

  const debtCredit = await prisma.debtCredit.create({
    // `tenantId` AÇIKÇA yazılır; istemci nesnesi Prisma'ya geçirilmez (bkz. `account.ts`).
    data: {
      tenantId,
      type: type!,
      counterparty: counterparty!,
      amount: amount!,
      currency: currency!,
      dueDate: dueDate ?? null,
      // Varsayılan `OPEN` şemadadır; "kapandı" olarak açmak yine de meşrudur (geçmişe dönük
      // kayıt girmek).
      ...(status ? { status } : {}),
    },
    select: debtCreditSelect,
  });

  // Audit yazımı işlem tamamlandıktan SONRA ve best-effort'tur (Issue #15).
  await writeAuditLog({
    actorUserId,
    tenantId,
    action: AUDIT_ACTIONS.DEBT_CREDIT_CREATED,
    targetType: AUDIT_TARGET_TYPES.DEBT_CREDIT,
    targetId: debtCredit.id,
    // Tutar audit'e YAZILMAZ: audit log finansal değerlerin ikinci bir kopyasını tutmak için
    // değil, "kim neyi ne zaman değiştirdi" sorusunu yanıtlamak için vardır (`account.ts`teki
    // aynı karar).
    metadata: {
      type: debtCredit.type,
      counterparty: debtCredit.counterparty,
      currency: debtCredit.currency,
    },
  });

  return { ok: true, debtCredit: toView(debtCredit) };
}

export type UpdateDebtCreditInput = {
  type?: unknown;
  counterparty?: unknown;
  amount?: unknown;
  currency?: unknown;
  dueDate?: unknown;
  status?: unknown;
};

export type UpdateDebtCreditResult =
  | { ok: true; debtCredit: DebtCreditView }
  | { ok: false; status: 400 | 404; error: string };

/**
 * Kaydı günceller. Yalnızca GÖNDERİLEN alanlar değişir (partial update).
 *
 * DURUM GEÇİŞİ İKİ YÖNLÜDÜR: `OPEN → SETTLED` ve `SETTLED → OPEN`. Geri dönüşü yasaklamak,
 * yanlışlıkla "kapandı" işaretlenen bir kaydı düzeltmenin tek yolunu SİLİP YENİDEN OLUŞTURMAK
 * yapardı — kaydın oluşturulma tarihi ve audit izi kaybolurdu. Bunun yerine her iki geçiş de
 * serbesttir ve ikisi de audit log'a düşer; "kim ne zaman kapattı/geri açtı" sorusunun cevabı
 * orada durur.
 */
export async function updateDebtCredit(
  tenantId: string,
  debtCreditId: string,
  actorUserId: string,
  input: UpdateDebtCreditInput,
): Promise<UpdateDebtCreditResult> {
  const validated = validate(input, true);
  if (!validated.ok) {
    return { ok: false, status: 400, error: validated.error };
  }

  const data: Prisma.DebtCreditUpdateManyMutationInput = { ...validated.fields };
  if (Object.keys(data).length === 0) {
    return { ok: false, status: 400, error: NO_FIELDS_ERROR };
  }

  // `update({ where: { id } })` KULLANILMAZ: id tek başına unique olduğu için Prisma bunu
  // kabul ederdi, ama o zaman tenant scope'u mutation'ın KENDİSİNDE taşınmazdı.
  const { count } = await prisma.debtCredit.updateMany({
    where: tenantScoped(tenantId, { id: debtCreditId }),
    data,
  });

  if (count !== 1) {
    // Başka tenant'ın kaydı ile hiç var olmayan kayıt AYNI yanıtı alır (enumeration engeli).
    return { ok: false, status: 404, error: NOT_FOUND_ERROR };
  }

  const debtCredit = await prisma.debtCredit.findFirstOrThrow({
    where: tenantScoped(tenantId, { id: debtCreditId }),
    select: debtCreditSelect,
  });

  await writeAuditLog({
    actorUserId,
    tenantId,
    action: AUDIT_ACTIONS.DEBT_CREDIT_UPDATED,
    targetType: AUDIT_TARGET_TYPES.DEBT_CREDIT,
    targetId: debtCredit.id,
    // Hangi ALANLARIN değiştiği kaydedilir. `status` AYRICA değeriyle yazılır: "kapandı"
    // işareti bu modelin en hesap sorulabilir olayıdır ve hangi yöne geçildiği, alan adından
    // okunamaz.
    metadata: {
      updatedFields: Object.keys(data),
      ...(validated.fields.status ? { status: validated.fields.status } : {}),
    },
  });

  return { ok: true, debtCredit: toView(debtCredit) };
}

export type DeleteDebtCreditResult = { ok: true } | { ok: false; status: 404; error: string };

/**
 * Kaydı siler.
 *
 * `Account`taki "işlemi olan hesap silinemez" kısıtının BURADA KARŞILIĞI YOKTUR: borç/alacak
 * kaydının kendisine bağlı başka bir kayıt yoktur, dolayısıyla silmek hiçbir geçmişi yok
 * etmez. Yanlış girilmiş bir kaydı silmek meşru ve sık bir eylemdir.
 */
export async function deleteDebtCredit(
  tenantId: string,
  debtCreditId: string,
  actorUserId: string,
): Promise<DeleteDebtCreditResult> {
  const { count } = await prisma.debtCredit.deleteMany({
    where: tenantScoped(tenantId, { id: debtCreditId }),
  });

  if (count !== 1) {
    return { ok: false, status: 404, error: NOT_FOUND_ERROR };
  }

  await writeAuditLog({
    actorUserId,
    tenantId,
    action: AUDIT_ACTIONS.DEBT_CREDIT_DELETED,
    targetType: AUDIT_TARGET_TYPES.DEBT_CREDIT,
    targetId: debtCreditId,
  });

  return { ok: true };
}
