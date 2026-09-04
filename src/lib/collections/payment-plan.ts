import { Prisma, PaymentMethod, PaymentPlanStatus, InstallmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tenantScoped } from "@/lib/tenancy/scope";
import { runSerializable, SerializationConflictError } from "@/lib/db/serializable";

const PAYMENT_INSTALLMENT_SELECT = {
  id: true,
  sequence: true,
  dueDate: true,
  amount: true,
  paidAmount: true,
  status: true,
  paidAt: true,
  method: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  tenantId: true,
  planId: true,
  transactionId: true,
} satisfies Prisma.PaymentInstallmentSelect;

const PAYMENT_PLAN_SELECT = {
  id: true,
  totalAmount: true,
  currency: true,
  method: true,
  downPayment: true,
  installmentCount: true,
  status: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  tenantId: true,
  dealId: true,
} satisfies Prisma.PaymentPlanSelect;

const PAYMENT_PLAN_WITH_INSTALLMENTS_SELECT = {
  ...PAYMENT_PLAN_SELECT,
  installments: {
    select: PAYMENT_INSTALLMENT_SELECT,
    orderBy: { sequence: "asc" },
  },
} satisfies Prisma.PaymentPlanSelect;

const PAYMENT_INSTALLMENT_WITH_PLAN_SELECT = {
  ...PAYMENT_INSTALLMENT_SELECT,
  plan: { select: PAYMENT_PLAN_SELECT },
} satisfies Prisma.PaymentInstallmentSelect;

type PaymentPlanWithInstallments = Prisma.PaymentPlanGetPayload<{
  select: typeof PAYMENT_PLAN_WITH_INSTALLMENTS_SELECT;
}>;
type PaymentPlanRecord = Prisma.PaymentPlanGetPayload<{
  select: typeof PAYMENT_PLAN_SELECT;
}>;
type PaymentInstallmentWithPlan = Prisma.PaymentInstallmentGetPayload<{
  select: typeof PAYMENT_INSTALLMENT_WITH_PLAN_SELECT;
}>;
type PaymentInstallmentRecord = Prisma.PaymentInstallmentGetPayload<{
  select: typeof PAYMENT_INSTALLMENT_SELECT;
}>;

/**
 * Ödeme planı oluşturma girdi parametreleri.
 */
export type CreatePaymentPlanParams = {
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

/**
 * Servis katmanı yanıt tipi.
 * Uygulama genelinde throw edilmez; discriminated union dönülür.
 */
export type CollectionServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: 400 | 403 | 404 | 409 | 500 | 503; error: string };

/**
 * Vade tarihine takvim ayı ekler.
 *
 * AYIN SON GÜNÜNE SIKIŞTIRILIR: `setMonth` tek başına taşar — 31 Ocak + 1 ay, Şubat 31
 * çekmediği için 3 Mart olur. Aylık bir planda ilk vade ayın 29/30/31'i ise bütün vadeler
 * sessizce kayar ve bir taksit bir öncekinin ayına düşebilir.
 *
 * HESAP UTC ÜZERİNDEN YAPILIR, sunucunun yerel saat dilimiyle DEĞİL. `firstDueDate` istemciden
 * ISO-8601 olarak gelir ve bir AN olarak saklanır; yerel alanlarla (`getDate`/`setMonth`)
 * hesaplamak, aynı girdinin UTC-5'teki bir sunucuda başka bir vade üretmesi demekti — yani
 * dağıtım ortamına göre değişen bir ödeme planı. Tenant saat dilimine göre GÖSTERİM ayrı bir
 * katmandır (Issue #134, `src/lib/time/tenant-time.ts`); burada belirleyici olan, aynı girdinin
 * her yerde aynı vadeyi üretmesidir.
 */
function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/**
 * Yeni ödeme planı ve bağlı taksitlerini sunucu tarafında oluşturur.
 *
 * NEDEN `runSerializable()`, NEDEN DOĞRUDAN `$transaction` DEĞİL: "aynı deal için tek ACTIVE
 * plan" kuralı bir OKUMAYA dayanıyor (önce aktif plan var mı diye bakılıyor, sonra yazılıyor).
 * Bu, "önce kontrol et sonra yaz" desenidir ve iki isteğin arasına giren üçüncü bir istek
 * invariant'ı bozar — `docs/architecture.md` bunun için `Serializable` izolasyon + retry
 * öngörür. `prisma.$transaction(..., { isolationLevel: Serializable })`'ı doğrudan çağırmak
 * retry'ı ATLAR: o durumda serialization hatası (`P2034`) kullanıcıya **500** olarak yansırdı
 * (Issue #122'de tam olarak bu oldu). Retry'ın TEK giriş noktası `runSerializable()`tır.
 *
 * NEDEN `dealId` ÜZERİNDE `@unique` YOK: unique kısıt duruma bakmaz — iptal edilmiş bir planın
 * bulunduğu deal'e ikinci bir plan açmayı da imkânsız kılardı. Kural "aynı anda tek AKTİF plan";
 * iptal edilenler geçmiş kayıt olarak durur.
 *
 * Retry'lar tükenirse `503` dönülür, `409` DEĞİL: bu kod tabanında `409` bir iş kuralı
 * ihlalidir ("zaten aktif plan var"), `503` ise "şu an olmadı, tekrar dene" demektir. İkisini
 * karıştırmak, geçici bir çakışmayı kullanıcıya kalıcı bir hata gibi gösterirdi.
 */
export async function createPaymentPlan(
  tenantId: string,
  params: CreatePaymentPlanParams
): Promise<CollectionServiceResult<PaymentPlanWithInstallments>> {
  try {
    const result = await runSerializable(async (tx) => {
    // 1. Sürecin (Deal) bu tenant'a ait olup olmadığını kontrol et.
    const deal = await tx.deal.findFirst({
      where: tenantScoped(tenantId, { id: params.dealId }),
      select: { id: true },
    });

    if (!deal) {
      return { ok: false as const, status: 404 as const, error: "İlişkili süreç (deal) bulunamadı." };
    }

    // 2. Aynı sürecin aktif (ACTIVE) bir planı var mı kontrol et.
    const existingActivePlan = await tx.paymentPlan.findFirst({
      where: tenantScoped(tenantId, {
        dealId: params.dealId,
        status: PaymentPlanStatus.ACTIVE,
      }),
      select: { id: true },
    });

    if (existingActivePlan) {
      return {
        ok: false as const,
        status: 409 as const,
        error: "Bu süreç için hali hazırda aktif bir ödeme planı bulunmaktadır.",
      };
    }

    // 3. Taksit tutarlarının Prisma.Decimal ile hesaplanması.
    const totalDec = new Prisma.Decimal(params.totalAmount);
    const downDec = new Prisma.Decimal(params.downPayment);
    const netDec = totalDec.sub(downDec);

    // TAKSİT DAĞITIMI: aşağı yuvarla, ARTIĞI SON TAKSİTE EKLE.
    //
    // NEDEN AŞAĞI YUVARLAMA: yukarı yuvarlamak taksitler toplamını net tutarın ÜZERİNE çıkarır
    // ve müşteriden borcundan fazlası istenir. Aşağı yuvarlamada eksik kalan kısım bilinir ve
    // tek bir yere — son taksite — eklenerek kapatılır; toplam DAİMA `totalAmount - downPayment`
    // eder. "Her taksite eşit dağıt" alternatifi reddedildi: kalan, taksit sayısına tam
    // bölünmediğinde aynı sorunu bir alt basamakta tekrar üretirdi.
    //
    // NEDEN SON TAKSİT, NEDEN İLK DEĞİL: kuruş farkı ödemenin EN GEÇ noktasına bırakılır;
    // ilk taksite eklemek, planın hemen başında "neden 1 kuruş fazla" sorusunu doğururdu.
    //
    // NEDEN 4 BASAMAK: sütun `Decimal(19,4)`. Daha fazlası veritabanında zaten kesilirdi ve
    // kesilen kısım hiçbir yerde toplanmadığı için toplam tutmazdı.
    const baseInstallmentDec = netDec.div(params.installmentCount).toDecimalPlaces(4, Prisma.Decimal.ROUND_DOWN);
    if (baseInstallmentDec.lte(0)) {
      return {
        ok: false as const,
        status: 400 as const,
        error: "Taksit sayısı net tutar için çok yüksek (taksit tutarı 0 olamaz).",
      };
    }
    const sumBaseDec = baseInstallmentDec.mul(params.installmentCount);
    const remainderDec = netDec.sub(sumBaseDec);

    // Taksit kayıtlarının hazırlanması
    const installmentsData: Array<{
      sequence: number;
      dueDate: Date;
      amount: Prisma.Decimal;
      paidAmount: Prisma.Decimal;
      status: InstallmentStatus;
      tenantId: string;
    }> = [];

    for (let i = 1; i <= params.installmentCount; i++) {
      const isLast = i === params.installmentCount;
      const installmentAmount = isLast ? baseInstallmentDec.add(remainderDec) : baseInstallmentDec;
      const dueDate = addMonths(params.firstDueDate, (i - 1) * params.intervalMonths);

      installmentsData.push({
        sequence: i,
        dueDate,
        amount: installmentAmount,
        paidAmount: new Prisma.Decimal(0),
        status: InstallmentStatus.PENDING,
        tenantId,
      });
    }

    // 4. Plan ve taksitlerin veritabanına kaydedilmesi
    const newPlan = await tx.paymentPlan.create({
      data: {
        tenantId,
        dealId: params.dealId,
        totalAmount: totalDec,
        currency: params.currency,
        method: params.method,
        downPayment: downDec,
        installmentCount: params.installmentCount,
        status: PaymentPlanStatus.ACTIVE,
        notes: params.notes,
        installments: {
          createMany: {
            data: installmentsData,
          },
        },
      },
      select: PAYMENT_PLAN_WITH_INSTALLMENTS_SELECT,
    });

    return { ok: true as const, data: newPlan };
    });

    if (!result.ok) {
      return result;
    }

    return { ok: true, data: result.data };
  } catch (error) {
    if (error instanceof SerializationConflictError) {
      return { ok: false, status: 503, error: "İşlem çakışması nedeniyle plan oluşturulamadı, lütfen tekrar deneyin." };
    }
    throw error;
  }
}

/**
 * Belirtilen ödeme planını detayları ve taksitleriyle getirir.
 */
export async function getPaymentPlan(
  tenantId: string,
  planId: string
): Promise<CollectionServiceResult<PaymentPlanWithInstallments>> {
  const plan = await prisma.paymentPlan.findFirst({
    where: tenantScoped(tenantId, { id: planId }),
    select: PAYMENT_PLAN_WITH_INSTALLMENTS_SELECT,
  });

  if (!plan) {
    return { ok: false, status: 404, error: "Ödeme planı bulunamadı." };
  }

  return { ok: true, data: plan };
}

/**
 * Ödeme planı not alanını günceller.
 */
export async function updatePaymentPlan(
  tenantId: string,
  planId: string,
  notes: string | null
): Promise<CollectionServiceResult<PaymentPlanRecord>> {
  const updateResult = await prisma.paymentPlan.updateMany({
    where: tenantScoped(tenantId, { id: planId }),
    data: { notes },
  });

  if (updateResult.count === 0) {
    return { ok: false, status: 404, error: "Ödeme planı bulunamadı." };
  }

  const updatedPlan = await prisma.paymentPlan.findFirst({
    where: tenantScoped(tenantId, { id: planId }),
    select: PAYMENT_PLAN_SELECT,
  });

  return { ok: true, data: updatedPlan! };
}

/**
 * Ödeme planını ve henüz ödenmemiş taksitlerini iptal eder.
 */
export async function cancelPaymentPlan(
  tenantId: string,
  planId: string
): Promise<CollectionServiceResult<PaymentPlanWithInstallments>> {
  try {
    const result = await runSerializable(async (tx) => {
    const plan = await tx.paymentPlan.findFirst({
      where: tenantScoped(tenantId, { id: planId }),
      select: {
        ...PAYMENT_PLAN_SELECT,
        installments: { select: PAYMENT_INSTALLMENT_SELECT },
      },
    });

    if (!plan) {
      return { ok: false as const, status: 404 as const, error: "Ödeme planı bulunamadı." };
    }

    if (plan.status === PaymentPlanStatus.CANCELLED) {
      return { ok: false as const, status: 409 as const, error: "Ödeme planı zaten iptal edilmiş." };
    }

    // Plan durumunu CANCELLED yap
    await tx.paymentPlan.updateMany({
      where: tenantScoped(tenantId, { id: planId }),
      data: { status: PaymentPlanStatus.CANCELLED },
    });

    // PENDING durumdaki taksitleri CANCELLED yap
    await tx.paymentInstallment.updateMany({
      where: tenantScoped(tenantId, {
        planId,
        status: InstallmentStatus.PENDING,
      }),
      data: { status: InstallmentStatus.CANCELLED },
    });

    const updated = await tx.paymentPlan.findFirst({
      where: tenantScoped(tenantId, { id: planId }),
      select: PAYMENT_PLAN_WITH_INSTALLMENTS_SELECT,
    });

    return { ok: true as const, data: updated! };
    });

    if (!result.ok) {
      return result;
    }

    return { ok: true, data: result.data };
  } catch (error) {
    if (error instanceof SerializationConflictError) {
      return { ok: false, status: 503, error: "İşlem çakışması nedeniyle plan iptal edilemedi." };
    }
    throw error;
  }
}

/**
 * Taksitleri filtre parametrelerine göre getirir.
 */
export async function listInstallments(
  tenantId: string,
  params: {
    planId?: string;
    from?: Date;
    to?: Date;
    status?: InstallmentStatus;
    overdue?: boolean;
  }
): Promise<CollectionServiceResult<PaymentInstallmentWithPlan[]>> {
  const whereClause: Prisma.PaymentInstallmentWhereInput = {};

  if (params.planId) {
    whereClause.planId = params.planId;
  }

  if (params.status) {
    whereClause.status = params.status;
  }

  if (params.from || params.to) {
    whereClause.dueDate = {};
    if (params.from) whereClause.dueDate.gte = params.from;
    if (params.to) whereClause.dueDate.lte = params.to;
  }

  // OVERDUE dinamik olarak türetilir: dueDate < now() ve status IN (PENDING, PARTIAL)
  if (params.overdue) {
    whereClause.dueDate = { lt: new Date() };
    whereClause.status = { in: [InstallmentStatus.PENDING, InstallmentStatus.PARTIAL] };
  }

  const installments = await prisma.paymentInstallment.findMany({
    where: tenantScoped(tenantId, whereClause),
    select: PAYMENT_INSTALLMENT_WITH_PLAN_SELECT,
    orderBy: { dueDate: "asc" },
  });

  return { ok: true, data: installments };
}

/**
 * Tekil bir taksidin bilgilerini (vade, tutar, ödeme yöntemi, not) günceller.
 */
export async function updateInstallment(
  tenantId: string,
  installmentId: string,
  params: {
    dueDate?: Date;
    amount?: string;
    method?: PaymentMethod | null;
    notes?: string | null;
  }
): Promise<CollectionServiceResult<PaymentInstallmentRecord>> {
  try {
    const result = await runSerializable(async (tx) => {
      const installment = await tx.paymentInstallment.findFirst({
        where: tenantScoped(tenantId, { id: installmentId }),
        select: { status: true, paidAmount: true },
      });

      if (!installment) {
        return { ok: false as const, status: 404 as const, error: "Taksit bulunamadı." };
      }
      if (installment.status === InstallmentStatus.PAID || installment.status === InstallmentStatus.CANCELLED) {
        return { ok: false as const, status: 409 as const, error: "Bu durumdaki taksit düzenlenemez." };
      }

      const updateData: Prisma.PaymentInstallmentUpdateInput = {};
      if (params.dueDate !== undefined) updateData.dueDate = params.dueDate;
      if (params.amount !== undefined) {
        const amount = new Prisma.Decimal(params.amount);
        if (amount.lt(installment.paidAmount)) {
          return { ok: false as const, status: 409 as const, error: "Taksit tutarı ödenen tutardan düşük olamaz." };
        }
        updateData.amount = amount;
      }
      if (params.method !== undefined) updateData.method = params.method;
      if (params.notes !== undefined) updateData.notes = params.notes;

      const updateResult = await tx.paymentInstallment.updateMany({
        where: tenantScoped(tenantId, { id: installmentId }),
        data: updateData,
      });
      if (updateResult.count !== 1) {
        return { ok: false as const, status: 404 as const, error: "Taksit bulunamadı." };
      }

      const updated = await tx.paymentInstallment.findFirst({
        where: tenantScoped(tenantId, { id: installmentId }),
        select: PAYMENT_INSTALLMENT_SELECT,
      });
      return { ok: true as const, data: updated! };
    });
    return result;
  } catch (error) {
    if (error instanceof SerializationConflictError) {
      return { ok: false, status: 503, error: "İşlem çakışması nedeniyle taksit güncellenemedi." };
    }
    throw error;
  }
}
