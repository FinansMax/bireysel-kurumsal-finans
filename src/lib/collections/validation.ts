import { Prisma, PaymentMethod } from "@prisma/client";

export type ValidationError = {
  field: string;
  message: string;
};

const MONEY_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;
const ISO_4217_CODES = new Set(Intl.supportedValuesOf("currency"));

function parseMoney(value: unknown, allowZero: boolean): { raw: string; decimal: Prisma.Decimal } | null {
  if (typeof value !== "string") return null;

  const raw = value.trim();
  if (!MONEY_PATTERN.test(raw)) return null;

  const decimal = new Prisma.Decimal(raw);
  if (!decimal.isFinite() || (!allowZero && decimal.lte(0)) || (allowZero && decimal.lt(0))) {
    return null;
  }

  return { raw, decimal };
}

/**
 * Plan oluşturma isteği verilerini doğrular.
 * Aritmetik tutarlılık ve tip kontrollerini içerir.
 */
export function validateCreatePaymentPlan(input: unknown): {
  valid: true;
  data: {
    dealId: string;
    totalAmount: string;
    currency: string;
    method: PaymentMethod;
    downPayment: string;
    installmentCount: number;
    firstDueDate: Date;
    intervalMonths: number;
    notes: string | null;
  };
} | {
  valid: false;
  errors: ValidationError[];
} {
  if (!input || typeof input !== "object") {
    return { valid: false, errors: [{ field: "body", message: "Geçersiz istek gövdesi." }] };
  }

  const raw = input as Record<string, unknown>;
  const errors: ValidationError[] = [];

  // dealId
  if (typeof raw.dealId !== "string" || !raw.dealId.trim()) {
    errors.push({ field: "dealId", message: "Gerekli bir süreç (deal) seçilmelidir." });
  }

  // totalAmount
  const totalAmount = parseMoney(raw.totalAmount, false);
  if (!totalAmount) {
    errors.push({ field: "totalAmount", message: "Toplam tutar 0'dan büyük olmalıdır." });
  }

  // currency
  const currencyStr = String(raw.currency ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyStr) || !ISO_4217_CODES.has(currencyStr)) {
    errors.push({ field: "currency", message: "Para birimi 3 harfli geçerli ISO 4217 kodu olmalıdır (ör. TRY, USD)." });
  }

  // method
  const validMethods = Object.values(PaymentMethod);
  if (!raw.method || !validMethods.includes(raw.method as PaymentMethod)) {
    errors.push({ field: "method", message: "Geçersiz ödeme yöntemi seçildi." });
  }

  // downPayment
  const downPayment = parseMoney(raw.downPayment ?? "0", true);
  if (!downPayment) {
    errors.push({ field: "downPayment", message: "Peşinat 0 veya daha büyük olmalıdır." });
  } else if (totalAmount && downPayment.decimal.gte(totalAmount.decimal)) {
    errors.push({ field: "downPayment", message: "Peşinat toplam tutardan küçük olmalıdır." });
  }

  // installmentCount
  const installmentCountNum = Number(raw.installmentCount);
  if (!Number.isInteger(installmentCountNum) || installmentCountNum < 1) {
    errors.push({ field: "installmentCount", message: "Taksit sayısı en az 1 olmalıdır." });
  } else if (totalAmount && downPayment) {
    const net = totalAmount.decimal.sub(downPayment.decimal);
    const base = net.div(installmentCountNum).toDecimalPlaces(4, Prisma.Decimal.ROUND_DOWN);
    if (base.lte(0)) {
      errors.push({ field: "installmentCount", message: "Taksit sayısı net tutar için çok yüksek (taksit tutarı 0 olamaz)." });
    }
  }

  // firstDueDate
  const firstDueDateStr = String(raw.firstDueDate ?? "").trim();
  const firstDueDateParsed = new Date(firstDueDateStr);
  if (!firstDueDateStr || isNaN(firstDueDateParsed.getTime())) {
    errors.push({ field: "firstDueDate", message: "İlk taksit vadesi geçerli bir tarih olmalıdır." });
  }

  // intervalMonths
  let intervalMonthsNum = 1;
  if (raw.intervalMonths !== undefined && raw.intervalMonths !== null) {
    intervalMonthsNum = Number(raw.intervalMonths);
    if (!Number.isInteger(intervalMonthsNum) || intervalMonthsNum < 1) {
      errors.push({ field: "intervalMonths", message: "Taksit aralığı en az 1 ay olmalıdır." });
    }
  }

  // notes
  let notesClean: string | null = null;
  if (typeof raw.notes === "string" && raw.notes.trim()) {
    notesClean = raw.notes.trim();
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      dealId: (raw.dealId as string).trim(),
      totalAmount: totalAmount!.raw,
      currency: currencyStr,
      method: raw.method as PaymentMethod,
      downPayment: downPayment!.raw,
      installmentCount: installmentCountNum,
      firstDueDate: firstDueDateParsed,
      intervalMonths: intervalMonthsNum,
      notes: notesClean,
    },
  };
}

/**
 * Plan güncelleme verilerini doğrular.
 */
export function validateUpdatePaymentPlan(input: unknown): {
  valid: true;
  data: { notes: string | null };
} | {
  valid: false;
  errors: ValidationError[];
} {
  if (!input || typeof input !== "object") {
    return { valid: false, errors: [{ field: "body", message: "Geçersiz istek gövdesi." }] };
  }

  const raw = input as Record<string, unknown>;
  let notesClean: string | null = null;
  if (typeof raw.notes === "string" && raw.notes.trim()) {
    notesClean = raw.notes.trim();
  }

  return { valid: true, data: { notes: notesClean } };
}

/**
 * Taksit güncelleme verilerini doğrular.
 */
export function validateUpdateInstallment(input: unknown): {
  valid: true;
  data: {
    dueDate?: Date;
    amount?: string;
    method?: PaymentMethod | null;
    notes?: string | null;
  };
} | {
  valid: false;
  errors: ValidationError[];
} {
  if (!input || typeof input !== "object") {
    return { valid: false, errors: [{ field: "body", message: "Geçersiz istek gövdesi." }] };
  }

  const raw = input as Record<string, unknown>;
  const errors: ValidationError[] = [];
  const result: {
    dueDate?: Date;
    amount?: string;
    method?: PaymentMethod | null;
    notes?: string | null;
  } = {};

  if (raw.dueDate !== undefined) {
    const parsed = new Date(String(raw.dueDate));
    if (isNaN(parsed.getTime())) {
      errors.push({ field: "dueDate", message: "Geçersiz tarih formatı." });
    } else {
      result.dueDate = parsed;
    }
  }

  if (raw.amount !== undefined) {
    const amount = parseMoney(raw.amount, false);
    if (!amount) {
      errors.push({ field: "amount", message: "Taksit tutarı 0'dan büyük olmalıdır." });
    } else {
      result.amount = amount.raw;
    }
  }

  if (raw.method !== undefined) {
    if (raw.method === null) {
      result.method = null;
    } else {
      const validMethods = Object.values(PaymentMethod);
      if (!validMethods.includes(raw.method as PaymentMethod)) {
        errors.push({ field: "method", message: "Geçersiz ödeme yöntemi." });
      } else {
        result.method = raw.method as PaymentMethod;
      }
    }
  }

  if (raw.notes !== undefined) {
    if (typeof raw.notes === "string" && raw.notes.trim()) {
      result.notes = raw.notes.trim();
    } else {
      result.notes = null;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, data: result };
}
