import { AccountType, Prisma } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "@/lib/audit/actions";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { prisma } from "@/lib/prisma";
import { tenantScoped } from "@/lib/tenancy/scope";

import {
  isValidAccountName,
  isValidAccountType,
  isValidCurrency,
  normalizeCurrency,
  parseMoney,
  MAX_ACCOUNT_NAME_LENGTH,
  MIN_ACCOUNT_NAME_LENGTH,
} from "./validation";

const PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE = "P2002";

/**
 * Tenant'ın finansal hesapları (Issue #46).
 *
 * TENANT İZOLASYONU: Bu modelin HER sorgusu `tenantScoped()` üzerinden geçer ve mutation'lar
 * `updateMany`/`deleteMany` + `count === 1` ile yapılır — yalnız-ID ile `update`/`delete`
 * KULLANILMAZ (bkz. `src/lib/tenancy/scope.ts`; `membership.ts` referans implementasyondur).
 * Buradaki `tenantId` daima çağıran route'taki `requirePermission()` context'inden
 * (`context.tenant.id`) gelir — URL parametresi veya body DEĞİL.
 *
 * Bu fonksiyonlar authorization kararı VERMEZ; kimin çağırabileceği route seviyesinde
 * `requirePermission(PERMISSIONS.VIEW_ACCOUNTS | MANAGE_ACCOUNTS, tenantId)` ile belirlenir.
 */

const accountSelect = {
  id: true,
  name: true,
  type: true,
  balance: true,
  currency: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AccountSelect;

type AccountRow = Prisma.AccountGetPayload<{ select: typeof accountSelect }>;

/**
 * Dışarı verilen hesap gösterimi.
 *
 * `balance` BİLEREK `string`tir: para JSON'da string olarak taşınır (invariant #10). Bu
 * dönüşüm tek bir yerde (`toView`) yapılır ki HTTP katmanı `Prisma.Decimal`in JSON
 * serileştirmesine (kütüphane davranışına) bağlı kalmasın — sözleşme burada açıkça yazılıdır.
 */
export type AccountView = {
  id: string;
  name: string;
  type: AccountType;
  balance: string;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
};

function toView(account: AccountRow): AccountView {
  return { ...account, balance: account.balance.toString() };
}

export async function listAccounts(tenantId: string): Promise<AccountView[]> {
  const accounts = await prisma.account.findMany({
    where: tenantScoped(tenantId, {}),
    select: accountSelect,
    orderBy: { createdAt: "asc" },
  });

  return accounts.map(toView);
}

export type CreateAccountInput = {
  name: unknown;
  type: unknown;
  currency: unknown;
  balance?: unknown;
};

export type CreateAccountResult =
  | { ok: true; account: AccountView }
  | { ok: false; status: 400 | 409; error: string };

const INVALID_NAME_ERROR = `Name must be between ${MIN_ACCOUNT_NAME_LENGTH} and ${MAX_ACCOUNT_NAME_LENGTH} characters`;
const INVALID_TYPE_ERROR = "Type must be one of BANK, CASH";
const INVALID_CURRENCY_ERROR = "Currency must be a 3-letter ISO 4217 code";
const INVALID_BALANCE_ERROR = "Balance must be a decimal string with at most 4 decimal places";
const DUPLICATE_NAME_ERROR = "An account with this name already exists";
const NOT_FOUND_ERROR = "Account not found";

export async function createAccount(
  tenantId: string,
  actorUserId: string,
  input: CreateAccountInput,
): Promise<CreateAccountResult> {
  if (typeof input.name !== "string") {
    return { ok: false, status: 400, error: INVALID_NAME_ERROR };
  }
  const name = input.name.trim();
  if (!isValidAccountName(name)) {
    return { ok: false, status: 400, error: INVALID_NAME_ERROR };
  }

  if (!isValidAccountType(input.type)) {
    return { ok: false, status: 400, error: INVALID_TYPE_ERROR };
  }

  if (typeof input.currency !== "string") {
    return { ok: false, status: 400, error: INVALID_CURRENCY_ERROR };
  }
  const currency = normalizeCurrency(input.currency);
  if (!isValidCurrency(currency)) {
    return { ok: false, status: 400, error: INVALID_CURRENCY_ERROR };
  }

  // Açılış bakiyesi opsiyoneldir; verilmezse şemadaki `@default(0)` geçerlidir. `undefined`
  // ile `null` AYRIMI korunur: `null` gönderen istemci bir hata yapıyordur, sessizce 0'a
  // düşürmek yerine 400 alır.
  let balance: Prisma.Decimal | undefined;
  if (input.balance !== undefined) {
    const parsed = parseMoney(input.balance);
    if (!parsed) {
      return { ok: false, status: 400, error: INVALID_BALANCE_ERROR };
    }
    balance = parsed;
  }

  try {
    const account = await prisma.account.create({
      data: { tenantId, name, type: input.type, currency, balance },
      select: accountSelect,
    });

    // Audit yazımı işlem tamamlandıktan SONRA ve best-effort'tur (Issue #15): başarısız olsa
    // bile hesap oluşturma geri alınMAZ.
    await writeAuditLog({
      actorUserId,
      tenantId,
      action: AUDIT_ACTIONS.ACCOUNT_CREATED,
      targetType: AUDIT_TARGET_TYPES.ACCOUNT,
      targetId: account.id,
      metadata: { name: account.name, type: account.type, currency: account.currency },
    });

    return { ok: true, account: toView(account) };
  } catch (error) {
    // "Önce aynı isimde var mı diye bak, sonra yaz" YARIŞA AÇIKTIR (iki eşzamanlı istek
    // ikisini de oluşturabilir). Bunun yerine unique constraint'e güvenilir (bkz.
    // `createTenant()`'taki aynı desen).
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE
    ) {
      return { ok: false, status: 409, error: DUPLICATE_NAME_ERROR };
    }
    throw error;
  }
}

export type UpdateAccountInput = {
  name?: unknown;
  type?: unknown;
  currency?: unknown;
  balance?: unknown;
};

export type UpdateAccountResult =
  | { ok: true; account: AccountView }
  | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * Hesabı günceller. Yalnızca GÖNDERİLEN alanlar değişir (partial update).
 *
 * `tenantId`, `id`, `createdAt` gibi alanlar YAPISAL olarak güncellenemez: fonksiyon `input`
 * nesnesini Prisma'ya geçirmez, yalnızca doğruladığı alanları açıkça yazar. Body'ye
 * `tenantId` eklemek hiçbir etki yaratmaz (regresyon testi:
 * `security/account-security.spec.ts`).
 */
export async function updateAccount(
  tenantId: string,
  accountId: string,
  actorUserId: string,
  input: UpdateAccountInput,
): Promise<UpdateAccountResult> {
  const data: Prisma.AccountUpdateManyMutationInput = {};

  if (input.name !== undefined) {
    if (typeof input.name !== "string") {
      return { ok: false, status: 400, error: INVALID_NAME_ERROR };
    }
    const name = input.name.trim();
    if (!isValidAccountName(name)) {
      return { ok: false, status: 400, error: INVALID_NAME_ERROR };
    }
    data.name = name;
  }

  if (input.type !== undefined) {
    if (!isValidAccountType(input.type)) {
      return { ok: false, status: 400, error: INVALID_TYPE_ERROR };
    }
    data.type = input.type;
  }

  if (input.currency !== undefined) {
    if (typeof input.currency !== "string") {
      return { ok: false, status: 400, error: INVALID_CURRENCY_ERROR };
    }
    const currency = normalizeCurrency(input.currency);
    if (!isValidCurrency(currency)) {
      return { ok: false, status: 400, error: INVALID_CURRENCY_ERROR };
    }
    data.currency = currency;
  }

  if (input.balance !== undefined) {
    const parsed = parseMoney(input.balance);
    if (!parsed) {
      return { ok: false, status: 400, error: INVALID_BALANCE_ERROR };
    }
    data.balance = parsed;
  }

  if (Object.keys(data).length === 0) {
    return { ok: false, status: 400, error: "No updatable fields provided" };
  }

  try {
    // `update({ where: { id } })` KULLANILMAZ: id tek başına unique olduğu için Prisma bunu
    // kabul ederdi, ama o zaman tenant scope'u mutation'ın KENDİSİNDE taşınmazdı — başka bir
    // tenant'ın hesabı güncellenebilirdi. `updateMany` + `tenantScoped()` bunu imkânsız kılar.
    const { count } = await prisma.account.updateMany({
      where: tenantScoped(tenantId, { id: accountId }),
      data,
    });

    if (count !== 1) {
      // Başka tenant'ın hesabı ile hiç var olmayan hesap AYNI yanıtı alır (enumeration engeli).
      return { ok: false, status: 404, error: NOT_FOUND_ERROR };
    }

    const account = await prisma.account.findFirstOrThrow({
      where: tenantScoped(tenantId, { id: accountId }),
      select: accountSelect,
    });

    await writeAuditLog({
      actorUserId,
      tenantId,
      action: AUDIT_ACTIONS.ACCOUNT_UPDATED,
      targetType: AUDIT_TARGET_TYPES.ACCOUNT,
      targetId: account.id,
      // Hangi ALANLARIN değiştiği kaydedilir, yeni değerlerin tamamı değil: audit log
      // finansal tutarların ikinci bir kopyasını tutmak için değil, "kim neyi ne zaman
      // değiştirdi" sorusunu yanıtlamak için vardır.
      metadata: { updatedFields: Object.keys(data) },
    });

    return { ok: true, account: toView(account) };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE
    ) {
      return { ok: false, status: 409, error: DUPLICATE_NAME_ERROR };
    }
    throw error;
  }
}

export type DeleteAccountResult = { ok: true } | { ok: false; status: 404; error: string };

export async function deleteAccount(
  tenantId: string,
  accountId: string,
  actorUserId: string,
): Promise<DeleteAccountResult> {
  // `delete({ where: { id } })` yerine `deleteMany` + `tenantScoped()`: silme sorgusunun
  // kendisi de tenant ile scope'lanır (bkz. `updateAccount()`'taki aynı gerekçe).
  const { count } = await prisma.account.deleteMany({
    where: tenantScoped(tenantId, { id: accountId }),
  });

  if (count !== 1) {
    return { ok: false, status: 404, error: NOT_FOUND_ERROR };
  }

  await writeAuditLog({
    actorUserId,
    tenantId,
    action: AUDIT_ACTIONS.ACCOUNT_DELETED,
    targetType: AUDIT_TARGET_TYPES.ACCOUNT,
    targetId: accountId,
  });

  return { ok: true };
}
