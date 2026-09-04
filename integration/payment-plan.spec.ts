import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { InstallmentStatus, Prisma, PaymentMethod, PaymentPlanStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import {
  createPaymentPlan,
  cancelPaymentPlan,
  listInstallments,
  updateInstallment,
} from "../src/lib/collections/payment-plan";

const createdTenantIds: string[] = [];
const createdDealIds: string[] = [];

test.afterAll(async () => {
  if (createdTenantIds.length > 0) {
    await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
  }
  await prisma.$disconnect();
});

async function seedTenant(): Promise<string> {
  const tenant = await prisma.tenant.create({
    data: { name: "Tahsilat Test Tenant", slug: `collections-${randomUUID()}` },
    select: { id: true },
  });
  createdTenantIds.push(tenant.id);
  return tenant.id;
}

async function seedDeal(tenantId: string): Promise<string> {
  const deal = await prisma.deal.create({
    data: {
      tenantId,
      title: `Test Süreci ${randomUUID()}`,
      status: "OPEN",
    },
    select: { id: true },
  });
  createdDealIds.push(deal.id);
  return deal.id;
}

test.describe("PaymentPlan + PaymentInstallment İş Kuralları", () => {
  test("12 taksitlik plan kurulunca 12 taksit oluşuyor ve kuruş artığı son taksite ekleniyor", async () => {
    const tenantId = await seedTenant();
    const dealId = await seedDeal(tenantId);

    // Total: 100.00, DownPayment: 0 -> 100 / 12 = 8.3333... -> kalan son taksite eklenir.
    const createResult = await createPaymentPlan(tenantId, {
      dealId,
      totalAmount: "100.00",
      currency: "TRY",
      method: PaymentMethod.CARD,
      downPayment: "0.00",
      installmentCount: 12,
      firstDueDate: new Date("2026-10-01"),
      intervalMonths: 1,
      notes: "Test Planı",
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const plan = createResult.data;
    expect(plan.installments.length).toBe(12);

    // Taksit tutarlarının toplamının net tutara (100.00) kuruşu kuruşuna eşit olduğunu doğrula
    const sum = plan.installments.reduce(
      (acc, inst) => acc.add(inst.amount),
      new Prisma.Decimal(0)
    );
    expect(sum.toFixed(4)).toBe("100.0000");

    // Son taksitin kuruş farkını aldığını doğrula
    expect(plan.installments.slice(0, 11).every((inst) => inst.amount.toString() === "8.3333")).toBe(true);
    expect(plan.installments[11].amount.toString()).toBe("8.3337");
  });

  test("Aynı deal için ikinci aktif plan kurulmaya çalışıldığında 409 döner", async () => {
    const tenantId = await seedTenant();
    const dealId = await seedDeal(tenantId);

    const firstPlan = await createPaymentPlan(tenantId, {
      dealId,
      totalAmount: "500.00",
      currency: "TRY",
      method: PaymentMethod.CASH,
      downPayment: "0.00",
      installmentCount: 2,
      firstDueDate: new Date("2026-11-01"),
      intervalMonths: 1,
      notes: "İlk Aktif Plan",
    });

    expect(firstPlan.ok).toBe(true);

    const secondPlan = await createPaymentPlan(tenantId, {
      dealId,
      totalAmount: "600.00",
      currency: "TRY",
      method: PaymentMethod.TRANSFER,
      downPayment: "0.00",
      installmentCount: 2,
      firstDueDate: new Date("2026-11-01"),
      intervalMonths: 1,
      notes: "İkinci Aktif Plan Çakışması",
    });

    expect(secondPlan.ok).toBe(false);
    if (!secondPlan.ok) {
      expect(secondPlan.status).toBe(409);
    }
  });

  test("İptal edilmiş planın ardından aynı deal için yeni plan kurulabilir", async () => {
    const tenantId = await seedTenant();
    const dealId = await seedDeal(tenantId);

    const plan1 = await createPaymentPlan(tenantId, {
      dealId,
      totalAmount: "400.00",
      currency: "TRY",
      method: PaymentMethod.CARD,
      downPayment: "0.00",
      installmentCount: 2,
      firstDueDate: new Date("2026-10-01"),
      intervalMonths: 1,
      notes: "İptal Edilecek Plan",
    });
    expect(plan1.ok).toBe(true);
    if (!plan1.ok) return;

    const cancelRes = await cancelPaymentPlan(tenantId, plan1.data.id);
    expect(cancelRes.ok).toBe(true);

    const plan2 = await createPaymentPlan(tenantId, {
      dealId,
      totalAmount: "450.00",
      currency: "TRY",
      method: PaymentMethod.CARD,
      downPayment: "50.00",
      installmentCount: 2,
      firstDueDate: new Date("2026-11-01"),
      intervalMonths: 1,
      notes: "Yeni Kurulan Plan",
    });

    expect(plan2.ok).toBe(true);
  });

  test("Eşzamanlı iki 'plan kur' isteği tek plan ürettiğini kanıtlar", async () => {
    const tenantId = await seedTenant();
    const dealId = await seedDeal(tenantId);

    const [res1, res2] = await Promise.all([
      createPaymentPlan(tenantId, {
        dealId,
        totalAmount: "1000.00",
        currency: "TRY",
        method: PaymentMethod.MIXED,
        downPayment: "100.00",
        installmentCount: 4,
        firstDueDate: new Date("2026-12-01"),
        intervalMonths: 1,
        notes: "Eşzamanlı Plan 1",
      }),
      createPaymentPlan(tenantId, {
        dealId,
        totalAmount: "1000.00",
        currency: "TRY",
        method: PaymentMethod.MIXED,
        downPayment: "100.00",
        installmentCount: 4,
        firstDueDate: new Date("2026-12-01"),
        intervalMonths: 1,
        notes: "Eşzamanlı Plan 2",
      }),
    ]);

    const successCount = (res1.ok ? 1 : 0) + (res2.ok ? 1 : 0);
    expect(successCount).toBe(1);

    const plans = await prisma.paymentPlan.findMany({
      where: { tenantId, dealId, status: PaymentPlanStatus.ACTIVE },
    });
    expect(plans.length).toBe(1);
  });

  test("overdue=true filtresi vadesi geçmiş PENDING/PARTIAL taksitleri döner", async () => {
    const tenantId = await seedTenant();
    const dealId = await seedDeal(tenantId);

    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 10);

    const planRes = await createPaymentPlan(tenantId, {
      dealId,
      totalAmount: "300.00",
      currency: "TRY",
      method: PaymentMethod.CASH,
      downPayment: "0.00",
      installmentCount: 1,
      firstDueDate: pastDate,
      intervalMonths: 1,
      notes: "Gecikmiş Taksit Planı",
    });

    expect(planRes.ok).toBe(true);
    if (!planRes.ok) return;

    const overdueList = await listInstallments(tenantId, { overdue: true });
    expect(overdueList.ok).toBe(true);
    if (overdueList.ok) {
      const createdPlanId = planRes.data.id;
      const match = overdueList.data.find((inst) => inst.planId === createdPlanId);
      expect(match).toBeDefined();
    }
  });

  test("taksit vadesi ay sonunda taşmadan hesaplanır", async () => {
    const tenantId = await seedTenant();
    const dealId = await seedDeal(tenantId);
    const result = await createPaymentPlan(tenantId, {
      dealId,
      totalAmount: "200.00",
      currency: "TRY",
      method: PaymentMethod.CASH,
      downPayment: "0.00",
      installmentCount: 2,
      firstDueDate: new Date("2026-01-31"),
      intervalMonths: 1,
      notes: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.installments[1].dueDate.toISOString().slice(0, 10)).toBe("2026-02-28");
    }
  });

  test("ödenen tutarın altına veya terminal durumdaki taksite güncelleme yapılamaz", async () => {
    const tenantId = await seedTenant();
    const dealId = await seedDeal(tenantId);
    const result = await createPaymentPlan(tenantId, {
      dealId,
      totalAmount: "200.00",
      currency: "TRY",
      method: PaymentMethod.CASH,
      downPayment: "0.00",
      installmentCount: 2,
      firstDueDate: new Date("2026-10-01"),
      intervalMonths: 1,
      notes: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const installmentId = result.data.installments[0].id;
    await prisma.paymentInstallment.updateMany({
      where: { id: installmentId, tenantId },
      data: { paidAmount: new Prisma.Decimal("60.00"), status: "PARTIAL" },
    });

    const belowPaid = await updateInstallment(tenantId, installmentId, { amount: "50.00" });
    expect(belowPaid.ok).toBe(false);
    if (!belowPaid.ok) expect(belowPaid.status).toBe(409);

    await prisma.paymentInstallment.updateMany({
      where: { id: installmentId, tenantId },
      data: { status: "PAID" },
    });
    const paidUpdate = await updateInstallment(tenantId, installmentId, { notes: "değişmemeli" });
    expect(paidUpdate.ok).toBe(false);
    if (!paidUpdate.ok) expect(paidUpdate.status).toBe(409);

    await prisma.paymentInstallment.updateMany({
      where: { id: installmentId, tenantId },
      data: { status: "CANCELLED" },
    });
    const cancelledUpdate = await updateInstallment(tenantId, installmentId, { notes: "değişmemeli" });
    expect(cancelledUpdate.ok).toBe(false);
    if (!cancelledUpdate.ok) expect(cancelledUpdate.status).toBe(409);
  });
});

/**
 * `listInstallments()` — filtrelerin BİRLEŞMESİ (Issue #205).
 *
 * NEDEN AYRI BİR BLOK: eski davranış hata VERMİYORDU, yalnızca yanlış cevap veriyordu.
 * `overdue=true`, `from`/`to`/`status` koşullarının üzerine yazıyordu; "son 30 günde vadesi
 * geçenler" sorusuna tüm zamanların gecikmiş taksitleri dönüyordu. Böyle bir hatayı yakalayan
 * tek şey, iki filtreyi BİRLİKTE kullanan bir testtir.
 */
test.describe("listInstallments() — filtreler birlikte çalışır", () => {
  /** Verilen gün sayısı kadar önce/sonra bir tarih. */
  function daysFromNow(days: number): Date {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date;
  }

  /**
   * Üç taksitli bir plan kurar: biri 60 gün önce, biri 10 gün önce, biri 20 gün sonra vadeli.
   * (Plan aylık kurulur, sonra vadeler doğrudan yazılır — kurulum testin konusu değil.)
   */
  async function seedPlanWithDueDates(): Promise<{
    tenantId: string;
    planId: string;
    installmentIds: [string, string, string];
  }> {
    const tenantId = await seedTenant();
    const dealId = await seedDeal(tenantId);

    const created = await createPaymentPlan(tenantId, {
      dealId,
      totalAmount: "300.00",
      currency: "TRY",
      method: PaymentMethod.CASH,
      downPayment: "0.00",
      installmentCount: 3,
      firstDueDate: new Date("2026-01-15"),
      intervalMonths: 1,
      notes: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("plan kurulamadi");

    const [first, second, third] = created.data.installments;
    await prisma.paymentInstallment.updateMany({
      where: { id: first.id, tenantId },
      data: { dueDate: daysFromNow(-60) },
    });
    await prisma.paymentInstallment.updateMany({
      where: { id: second.id, tenantId },
      data: { dueDate: daysFromNow(-10) },
    });
    await prisma.paymentInstallment.updateMany({
      where: { id: third.id, tenantId },
      data: { dueDate: daysFromNow(20) },
    });

    return { tenantId, planId: created.data.id, installmentIds: [first.id, second.id, third.id] };
  }

  test("KRİTİK REGRESYON: overdue + tarih aralığı BİRLİKTE uygulanır", async () => {
    const { tenantId, installmentIds } = await seedPlanWithDueDates();
    const [eskiGecikmis, yeniGecikmis] = installmentIds;

    // Kontrol grubu: aralıksız `overdue` İKİ gecikmiş taksiti de döner.
    const hepsi = await listInstallments(tenantId, { overdue: true });
    expect(hepsi.ok).toBe(true);
    if (!hepsi.ok) return;
    expect(hepsi.data.map((row) => row.id).sort()).toEqual([eskiGecikmis, yeniGecikmis].sort());

    // Deney: son 30 gün + overdue → YALNIZCA 10 gün önce vadesi geçen.
    const sonOtuzGun = await listInstallments(tenantId, {
      from: daysFromNow(-30),
      overdue: true,
    });
    expect(sonOtuzGun.ok).toBe(true);
    if (!sonOtuzGun.ok) return;

    // Eski davranışta `from` yok sayılıyordu ve bu liste İKİ kayıt dönüyordu.
    expect(sonOtuzGun.data.map((row) => row.id)).toEqual([yeniGecikmis]);
  });

  test("overdue + to: üst sınır da korunur", async () => {
    const { tenantId, installmentIds } = await seedPlanWithDueDates();
    const [eskiGecikmis] = installmentIds;

    const sonuc = await listInstallments(tenantId, { to: daysFromNow(-30), overdue: true });
    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;

    expect(sonuc.data.map((row) => row.id)).toEqual([eskiGecikmis]);
  });

  test("overdue + status: kesişim alınır, status EZİLMEZ", async () => {
    const { tenantId, installmentIds } = await seedPlanWithDueDates();
    const [eskiGecikmis, yeniGecikmis] = installmentIds;

    // Eski gecikmiş taksit PARTIAL yapılır; yeni olan PENDING kalır.
    await prisma.paymentInstallment.updateMany({
      where: { id: eskiGecikmis, tenantId },
      data: { status: InstallmentStatus.PARTIAL, paidAmount: new Prisma.Decimal("10.00") },
    });

    const sadecePending = await listInstallments(tenantId, {
      status: InstallmentStatus.PENDING,
      overdue: true,
    });
    expect(sadecePending.ok).toBe(true);
    if (!sadecePending.ok) return;
    expect(sadecePending.data.map((row) => row.id)).toEqual([yeniGecikmis]);

    // DUYARLILIK: aynı sorgu PARTIAL ile DİĞER kaydı döner — yani `status` gerçekten okunuyor.
    const sadecePartial = await listInstallments(tenantId, {
      status: InstallmentStatus.PARTIAL,
      overdue: true,
    });
    expect(sadecePartial.ok).toBe(true);
    if (!sadecePartial.ok) return;
    expect(sadecePartial.data.map((row) => row.id)).toEqual([eskiGecikmis]);
  });

  test("kesişimi boş olan filtre BOŞ liste döner (hata değil)", async () => {
    const { tenantId } = await seedPlanWithDueDates();

    // "Ödenmiş ve gecikmiş" diye bir taksit yoktur. Bunu 400 ile reddetmek, #165'te birlikte
    // kullanılabilir olarak tanımlanmış iki filtreyi keyfî biçimde yasaklamak olurdu.
    const sonuc = await listInstallments(tenantId, {
      status: InstallmentStatus.PAID,
      overdue: true,
    });

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    expect(sonuc.data).toEqual([]);
  });

  test("overdue olmadan status ve aralık eskisi gibi çalışıyor (regresyon yok)", async () => {
    const { tenantId, installmentIds } = await seedPlanWithDueDates();
    const [, , gelecek] = installmentIds;

    const sonuc = await listInstallments(tenantId, { from: daysFromNow(1) });
    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;

    expect(sonuc.data.map((row) => row.id)).toEqual([gelecek]);
  });
});
