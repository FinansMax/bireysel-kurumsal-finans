import { AccountType, Prisma } from "@prisma/client";

// Temel, bağımlılıksız input validasyonu (bkz. src/lib/tenants/validation.ts deseni).

export const MIN_ACCOUNT_NAME_LENGTH = 2;
export const MAX_ACCOUNT_NAME_LENGTH = 100;

export function isValidAccountName(name: string): boolean {
  return name.length >= MIN_ACCOUNT_NAME_LENGTH && name.length <= MAX_ACCOUNT_NAME_LENGTH;
}

const ACCOUNT_TYPES = Object.values(AccountType);

export function isValidAccountType(value: unknown): value is AccountType {
  return typeof value === "string" && (ACCOUNT_TYPES as string[]).includes(value);
}

/**
 * Para birimi: ISO 4217 biçimi (3 büyük harf). Tam ISO listesi bir bağımlılık (veya elle
 * bakımı gereken 180 satırlık bir tablo) gerektirirdi; buradaki kontrol BİÇİMSELDİR ve
 * bilinçlidir — bkz. `prisma/schema.prisma`'daki `Account.currency` notu.
 */
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function normalizeCurrency(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidCurrency(currency: string): boolean {
  return CURRENCY_PATTERN.test(currency);
}

/**
 * Parasal tutarın metinsel gösterimi.
 *
 * Tam sayı kısmı en fazla 15, ondalık kısmı en fazla 4 basamak — `Decimal(19, 4)` şemasının
 * birebir karşılığı. Ondalık ayırıcı yalnızca `.`'dır (yerelleştirilmiş "1.234,56" biçimi
 * KABUL EDİLMEZ; biçimlendirme sunum katmanının işidir, API sözleşmesinin değil).
 *
 * NEGATİF DEĞER SERBESTTİR: bir banka hesabı eksiye düşebilir, kredi kartı hesabı zaten
 * negatif bakiye taşır. "Bakiye negatif olamaz" bir iş kuralı olarak DAYATILMAZ.
 */
const MONEY_PATTERN = /^-?\d{1,15}(\.\d{1,4})?$/;

/**
 * Para değerini `Prisma.Decimal`e çevirir; geçersizse `null` döner (asla fırlatmaz).
 *
 * `number` KABUL EDİLMEZ — bu bir katılık gösterisi değil, invariant'ın kendisidir
 * (docs/security-invariants.md #10): JavaScript `number`'ı ikili kayan noktadır ve
 * `0.1 + 0.2 !== 0.3`; bir kez `number`'a dönüşen tutar, sonradan `Decimal`e çevrilse bile
 * yuvarlanmış olabilir. Bu yüzden tutarlar API sözleşmesinde DAİMA string'tir ve dönüşüm
 * yalnızca burada, string'den yapılır.
 */
export function parseMoney(value: unknown): Prisma.Decimal | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!MONEY_PATTERN.test(trimmed)) {
    return null;
  }

  return new Prisma.Decimal(trimmed);
}
