import { expect, test } from "@playwright/test";
import { validateCreatePaymentPlan } from "../src/lib/collections/validation";

const base = { dealId: "deal", totalAmount: "100", currency: "TRY", method: "CASH", downPayment: "0", installmentCount: 2, firstDueDate: "2026-10-01" };
const invalid = (input: Record<string, unknown>, field: string) => {
  const result = validateCreatePaymentPlan({ ...base, ...input });
  return !result.valid && result.errors.some((error) => error.field === field);
};

test("tahsilat doğrulaması sınır durumlarını reddeder", () => {
  expect(invalid({ totalAmount: "0" }, "totalAmount")).toBe(true);
  expect(invalid({ totalAmount: "-1" }, "totalAmount")).toBe(true);
  expect(invalid({ downPayment: "100" }, "downPayment")).toBe(true);
  expect(invalid({ currency: "TR1" }, "currency")).toBe(true);
  expect(invalid({ installmentCount: 0 }, "installmentCount")).toBe(true);
  expect(invalid({ firstDueDate: "bad-date" }, "firstDueDate")).toBe(true);
  expect(invalid({ method: "UNKNOWN" }, "method")).toBe(true);
});
