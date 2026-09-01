import { PaymentMethod } from "@prisma/client";

export type ValidationError = {
  field: string;
  message: string;
};

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
  const totalAmountStr = String(raw.totalAmount ?? "").trim();
  const totalAmountNum = Number(totalAmountStr);
  if (!totalAmountStr || isNaN(totalAmountNum) || totalAmountNum <= 0) {
    errors.push({ field: "totalAmount", message: "Toplam tutar 0'dan büyük olmalıdır." });
  }

  // currency
  const currencyStr = String(raw.currency ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyStr)) {
    errors.push({ field: "currency", message: "Para birimi 3 harfli geçerli ISO 4217 kodu olmalıdır (ör. TRY, USD)." });
  }

  // method
  const validMethods = Object.values(PaymentMethod);
  if (!raw.method || !validMethods.includes(raw.method as PaymentMethod)) {
    errors.push({ field: "method", message: "Geçersiz ödeme yöntemi seçildi." });
  }

  // downPayment
  const downPaymentStr = String(raw.downPayment ?? "0").trim();
  const downPaymentNum = Number(downPaymentStr);
  if (isNaN(downPaymentNum) || downPaymentNum < 0) {
    errors.push({ field: "downPayment", message: "Peşinat 0 veya daha büyük olmalıdır." });
  } else if (!isNaN(totalAmountNum) && totalAmountNum > 0 && downPaymentNum >= totalAmountNum) {
    errors.push({ field: "downPayment", message: "Peşinat toplam tutardan küçük olmalıdır." });
  }

  // installmentCount
  const installmentCountNum = Number(raw.installmentCount);
  if (!Number.isInteger(installmentCountNum) || installmentCountNum < 1) {
    errors.push({ field: "installmentCount", message: "Taksit sayısı en az 1 olmalıdır." });
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
      totalAmount: totalAmountStr,
      currency: currencyStr,
      method: raw.method as PaymentMethod,
      downPayment: downPaymentStr,
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
    const amountStr = String(raw.amount).trim();
    const amountNum = Number(amountStr);
    if (!amountStr || isNaN(amountNum) || amountNum <= 0) {
      errors.push({ field: "amount", message: "Taksit tutarı 0'dan büyük olmalıdır." });
    } else {
      result.amount = amountStr;
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
