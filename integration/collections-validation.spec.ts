import { PaymentMethod } from "@prisma/client";
import { expect, test } from "@playwright/test";

import {
  validateCreatePaymentPlan,
  validateUpdateInstallment,
  validateUpdatePaymentPlan,
} from "../src/lib/collections/validation";

/**
 * Tahsilat doğrulama katmanı (Issue #165, testler Issue #205).
 *
 * NEDEN BU TESTLER VAR: `validation.ts` kullanıcı girdisinin sisteme girdiği TEK kapıdır ve
 * 200'den fazla satırı vardı — sıfır testle. Bir doğrulamanın gevşetilmesi (ör. `typeof`
 * kontrolünün `String()` coercion'ına dönmesi) hiçbir yerde yakalanmazdı: servis katmanı zaten
 * doğrulanmış veri beklediği için hata, ancak veritabanına yanlış bir satır yazıldığında
 * görünürdü.
 *
 * Fonksiyonlar SAF: DB, HTTP ve zaman yok. Bu yüzden sınır durumlarını tek tek denemek ucuz.
 */

/** Geçerli bir plan isteği — her test bunun BİR alanını bozar. */
function validPlanInput(): Record<string, unknown> {
  return {
    dealId: "deal-1",
    totalAmount: "1200.00",
    currency: "TRY",
    method: PaymentMethod.CARD,
    downPayment: "200.00",
    installmentCount: 10,
    firstDueDate: "2026-10-01",
    intervalMonths: 1,
    notes: "not",
  };
}

/** Hatalı alanların adları — hangi alanın reddedildiğini de doğrularız, yalnızca "reddedildi"yi değil. */
function errorFields(result: ReturnType<typeof validateCreatePaymentPlan>): string[] {
  return result.valid ? [] : result.errors.map((error) => error.field);
}

test.describe("validateCreatePaymentPlan() — kontrol grubu", () => {
  test("geçerli girdi kabul ediliyor ve alanlar normalize dönüyor", () => {
    // KONTROL GRUBU ÖNCE: aşağıdaki reddetme testlerinin hepsi, "her şeyi reddeden" bir
    // doğrulayıcıda da geçerdi. Bu test onu imkânsız kılar.
    const result = validateCreatePaymentPlan(validPlanInput());

    expect(result.valid).toBe(true);
    if (!result.valid) return;

    expect(result.data.currency).toBe("TRY");
    expect(result.data.installmentCount).toBe(10);
    expect(result.data.firstDueDate.getTime()).not.toBeNaN();
  });

  test("gövde nesne değilse tek bir 'body' hatası döner", () => {
    for (const input of [null, undefined, "metin", 42, true]) {
      expect(errorFields(validateCreatePaymentPlan(input))).toEqual(["body"]);
    }
  });
});

test.describe("validateCreatePaymentPlan() — tutarlar", () => {
  test("0 ve negatif toplam tutar reddediliyor", () => {
    for (const totalAmount of ["0", "0.00", "-1", "-0.01"]) {
      expect(errorFields(validateCreatePaymentPlan({ ...validPlanInput(), totalAmount })))
        .toContain("totalAmount");
    }
  });

  test("tutar STRING olmalı — sayı olarak gönderilemez", () => {
    // Para invariant'ı (#10): JSON'da string. Sayı kabul etmek, IEEE-754 yuvarlama hatasını
    // sisteme sokan ilk kapı olurdu.
    expect(errorFields(validateCreatePaymentPlan({ ...validPlanInput(), totalAmount: 1200 })))
      .toContain("totalAmount");
  });

  test("dört basamaktan fazla ondalık reddediliyor (Decimal(19,4) sınırı)", () => {
    expect(errorFields(validateCreatePaymentPlan({ ...validPlanInput(), totalAmount: "10.12345" })))
      .toContain("totalAmount");
  });

  test("peşinat negatif olamaz ama 0 olabilir", () => {
    expect(errorFields(validateCreatePaymentPlan({ ...validPlanInput(), downPayment: "-1" })))
      .toContain("downPayment");

    const sifirPesinat = validateCreatePaymentPlan({ ...validPlanInput(), downPayment: "0" });
    expect(sifirPesinat.valid).toBe(true);
  });

  test("peşinat toplam tutara EŞİT ya da ondan büyük olamaz", () => {
    // Eşitlik de reddedilir: net tutar 0 olurdu ve "0 TL'lik taksitler" anlamsızdır.
    for (const downPayment of ["1200.00", "1500.00"]) {
      expect(errorFields(validateCreatePaymentPlan({ ...validPlanInput(), downPayment })))
        .toContain("downPayment");
    }
  });
});

test.describe("validateCreatePaymentPlan() — para birimi", () => {
  test("geçersiz ISO 4217 kodu reddediliyor", () => {
    for (const currency of ["TR", "TRYX", "XYZ", "try1", ""]) {
      expect(errorFields(validateCreatePaymentPlan({ ...validPlanInput(), currency })))
        .toContain("currency");
    }
  });

  test("küçük harf kabul edilir ve büyük harfe normalize edilir", () => {
    const result = validateCreatePaymentPlan({ ...validPlanInput(), currency: "usd" });

    expect(result.valid).toBe(true);
    if (result.valid) expect(result.data.currency).toBe("USD");
  });

  test("dizi olarak gönderilen kod KABUL EDİLMİYOR (coercion yok)", () => {
    // `String(["TRY"])` = "TRY" olurdu. Tip daraltması olmadan bu girdi geçerdi.
    expect(errorFields(validateCreatePaymentPlan({ ...validPlanInput(), currency: ["TRY"] })))
      .toContain("currency");
  });
});

test.describe("validateCreatePaymentPlan() — taksit sayısı ve aralık", () => {
  test("1'den küçük, kesirli ve sayı olmayan taksit sayısı reddediliyor", () => {
    for (const installmentCount of [0, -3, 2.5, "10", true, null]) {
      expect(errorFields(validateCreatePaymentPlan({ ...validPlanInput(), installmentCount })))
        .toContain("installmentCount");
    }
  });

  test("taksit tutarını 0'a düşüren taksit sayısı reddediliyor", () => {
    // Net tutar 1 kuruş, taksit sayısı 100 → her taksit 0.0000 olurdu.
    const result = validateCreatePaymentPlan({
      ...validPlanInput(),
      totalAmount: "0.01",
      downPayment: "0",
      installmentCount: 1000,
    });

    expect(errorFields(result)).toContain("installmentCount");
  });

  test("aralık verilmezse 1 ay varsayılır, geçersizse reddedilir", () => {
    const varsayilan = validateCreatePaymentPlan({
      ...validPlanInput(),
      intervalMonths: undefined,
    });
    expect(varsayilan.valid).toBe(true);
    if (varsayilan.valid) expect(varsayilan.data.intervalMonths).toBe(1);

    for (const intervalMonths of [0, -1, 1.5, "2"]) {
      expect(errorFields(validateCreatePaymentPlan({ ...validPlanInput(), intervalMonths })))
        .toContain("intervalMonths");
    }
  });
});

test.describe("validateCreatePaymentPlan() — tarih ve yöntem", () => {
  test("geçersiz tarih reddediliyor", () => {
    for (const firstDueDate of ["", "  ", "gecersiz", "2026-13-45", 12345, null]) {
      expect(errorFields(validateCreatePaymentPlan({ ...validPlanInput(), firstDueDate })))
        .toContain("firstDueDate");
    }
  });

  test("bilinmeyen ödeme yöntemi reddediliyor", () => {
    for (const method of ["BITCOIN", "cash", "", 1, null]) {
      expect(errorFields(validateCreatePaymentPlan({ ...validPlanInput(), method })))
        .toContain("method");
    }
  });

  test("tanımlı her yöntem kabul ediliyor", () => {
    // KONTROL GRUBU: yukarıdaki test, hiçbir yöntemi kabul etmeyen bir doğrulayıcıda da geçerdi.
    for (const method of Object.values(PaymentMethod)) {
      expect(validateCreatePaymentPlan({ ...validPlanInput(), method }).valid).toBe(true);
    }
  });

  test("dealId boş ya da string değilse reddediliyor", () => {
    for (const dealId of ["", "   ", 42, null, undefined, {}]) {
      expect(errorFields(validateCreatePaymentPlan({ ...validPlanInput(), dealId })))
        .toContain("dealId");
    }
  });

  test("birden fazla alan bozuksa HEPSİ bildiriliyor", () => {
    // Tek tek denemek zorunda kalmak, formda alan bazlı hata gösterimini imkânsız kılardı.
    const result = validateCreatePaymentPlan({
      dealId: "",
      totalAmount: "-1",
      currency: "XX",
      method: "YOK",
      installmentCount: 0,
      firstDueDate: "hayir",
    });

    expect(errorFields(result).sort()).toEqual(
      ["currency", "dealId", "firstDueDate", "installmentCount", "method", "totalAmount"].sort(),
    );
  });
});

test.describe("validateUpdatePaymentPlan() — yalnızca not", () => {
  test("boş/whitespace not null'a normalize ediliyor", () => {
    for (const notes of ["", "   ", null, undefined, 42]) {
      const result = validateUpdatePaymentPlan({ notes });
      expect(result.valid).toBe(true);
      if (result.valid) expect(result.data.notes).toBeNull();
    }
  });

  test("not kırpılarak saklanıyor", () => {
    const result = validateUpdatePaymentPlan({ notes: "  ödeme ertelendi  " });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.data.notes).toBe("ödeme ertelendi");
  });

  test("gövde nesne değilse reddediliyor", () => {
    const result = validateUpdatePaymentPlan("metin");
    expect(result.valid).toBe(false);
  });
});

test.describe("validateUpdateInstallment() — kısmi güncelleme", () => {
  test("boş gövde geçerli: hiçbir alan zorunlu değil", () => {
    const result = validateUpdateInstallment({});
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.data).toEqual({});
  });

  test("0 ve negatif taksit tutarı reddediliyor", () => {
    for (const amount of ["0", "-5.00", 100, ""]) {
      const result = validateUpdateInstallment({ amount });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.map((error) => error.field)).toContain("amount");
    }
  });

  test("geçersiz vade reddediliyor", () => {
    for (const dueDate of ["gecersiz", 12345, null]) {
      const result = validateUpdateInstallment({ dueDate });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.map((error) => error.field)).toContain("dueDate");
    }
  });

  test("yöntem açıkça null'a çekilebilir ama uydurma değer reddedilir", () => {
    // `null` ANLAMLI bir değerdir: "bu taksit için yöntem belirtilmedi". `undefined` ile aynı
    // şey değildir — o "dokunma" demektir.
    const temizle = validateUpdateInstallment({ method: null });
    expect(temizle.valid).toBe(true);
    if (temizle.valid) expect(temizle.data.method).toBeNull();

    const uydurma = validateUpdateInstallment({ method: "BITCOIN" });
    expect(uydurma.valid).toBe(false);
  });

  test("verilmeyen alan sonuçta HİÇ yer almıyor (kısmi güncelleme sözleşmesi)", () => {
    const result = validateUpdateInstallment({ notes: "sadece not" });

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(Object.keys(result.data)).toEqual(["notes"]);
  });
});
