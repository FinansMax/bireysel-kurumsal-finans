import { Prisma, PaymentMethod } from "@prisma/client";

export type ValidationError = {
  field: string;
  message: string;
};

const MONEY_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;
/**
 * ISO 4217 kodları — platformun ICU verisinden, BAĞIMLILIK EKLEMEDEN (Issue #205 kararı).
 *
 * TUTARSIZLIK BİLİNİYOR: `Account.currency` bugün yalnızca BİÇİMSEL olarak doğrulanıyor
 * (üç büyük harf) ve `prisma/schema.prisma` bunu "tam ISO listesi bir bağımlılık gerektirir"
 * diye gerekçelendiriyor. O gerekçe artık geçerli değil: `Intl.supportedValuesOf("currency")`
 * listeyi bağımlılıksız veriyor ve liste tzdata gibi platformla birlikte güncelleniyor.
 *
 * KARAR — TAHSİLAT TARAFI GEVŞETİLMEDİ. Reddedilen alternatifler:
 *
 * - **Burayı biçimsel doğrulamaya indirmek:** çalışan ve daha SIKI bir kontrolü, yalnızca
 *   başka bir yerdeki daha zayıf kontrole benzesin diye zayıflatmak olurdu. Tutarlılık,
 *   doğruluğun önüne geçmez.
 * - **`Account` tarafını da ICU listesine çekmek:** DOĞRU yön, ama bu bir DAVRANIŞ
 *   değişikliğidir (bugün kabul edilen "XYZ" gibi kodlar reddedilmeye başlar) ve mevcut
 *   kayıtları etkileyebilir; #205'in kapsamı olan "yorum ve gerekçe" işinin içine sığmaz.
 *
 * Yön belli, adım ayrı: hizalama kendi issue'sunda yapılır ve şemadaki eskimiş gerekçe orada
 * güncellenir. Bu yorum, o adıma kadar tutarsızlığın SEBEBİNİ kayda geçirir — bilinmeyen bir
 * tutarsızlık ile kayda geçmiş bir tutarsızlık aynı şey değildir.
 */
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
  const currencyStr = typeof raw.currency === "string" ? raw.currency.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(currencyStr) || !ISO_4217_CODES.has(currencyStr)) {
    errors.push({ field: "currency", message: "Para birimi 3 harfli geçerli ISO 4217 kodu olmalıdır (ör. TRY, USD)." });
  }

  // method
  const validMethods = Object.values(PaymentMethod);
  if (typeof raw.method !== "string" || !validMethods.includes(raw.method as PaymentMethod)) {
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
  const installmentCountNum = typeof raw.installmentCount === "number" ? raw.installmentCount : NaN;
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
  const firstDueDateStr = typeof raw.firstDueDate === "string" ? raw.firstDueDate.trim() : "";
  const firstDueDateParsed = new Date(firstDueDateStr);
  if (!firstDueDateStr || isNaN(firstDueDateParsed.getTime())) {
    errors.push({ field: "firstDueDate", message: "İlk taksit vadesi geçerli bir tarih olmalıdır." });
  }

  // intervalMonths
  let intervalMonthsNum = 1;
  if (raw.intervalMonths !== undefined && raw.intervalMonths !== null) {
    intervalMonthsNum = typeof raw.intervalMonths === "number" ? raw.intervalMonths : NaN;
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
    if (typeof raw.dueDate !== "string") {
      errors.push({ field: "dueDate", message: "Geçersiz tarih formatı." });
    } else {
      const parsed = new Date(raw.dueDate);
      if (isNaN(parsed.getTime())) {
        errors.push({ field: "dueDate", message: "Geçersiz tarih formatı." });
      } else {
        result.dueDate = parsed;
      }
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
      if (typeof raw.method !== "string" || !validMethods.includes(raw.method as PaymentMethod)) {
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
