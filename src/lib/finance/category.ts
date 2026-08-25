import { CategoryType, Prisma } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "@/lib/audit/actions";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { prisma } from "@/lib/prisma";
import { tenantScoped } from "@/lib/tenancy/scope";

import {
  isValidCategoryName,
  isValidCategoryType,
  MAX_CATEGORY_NAME_LENGTH,
  MIN_CATEGORY_NAME_LENGTH,
} from "./validation";

const PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE = "P2002";

/**
 * Tenant'ın gelir/gider kategorileri (Issue #49).
 *
 * TENANT İZOLASYONU: `src/lib/finance/account.ts` ile BİREBİR aynı desen — her sorgu
 * `tenantScoped()` üzerinden geçer, mutation'lar `updateMany`/`deleteMany` + `count === 1`
 * ile yapılır, yalnız-ID ile `update`/`delete` KULLANILMAZ. Buradaki `tenantId` daima çağıran
 * route'taki `requirePermission()` context'inden (`context.tenant.id`) gelir — URL parametresi
 * veya body DEĞİL.
 *
 * Bu fonksiyonlar authorization kararı VERMEZ; kimin çağırabileceği route seviyesinde
 * `requirePermission(PERMISSIONS.VIEW_CATEGORIES | MANAGE_CATEGORIES, tenantId)` ile
 * belirlenir.
 *
 * `Account`tan tek yapısal fark: kategori PARA TAŞIMAZ, dolayısıyla `Decimal` → string
 * dönüşümü (`toView()`) gerekmez; seçilen satır doğrudan dışarı verilebilir.
 */

const categorySelect = {
  id: true,
  name: true,
  type: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CategorySelect;

export type CategoryView = Prisma.CategoryGetPayload<{ select: typeof categorySelect }>;

/**
 * Kategorileri listeler. `type` verilirse yalnızca o yöndekiler döner.
 *
 * Filtre opsiyoneldir ve süsleme değildir: bir gider işlemine yalnızca gider kategorisi
 * seçilebilmelidir (#53). Filtre `tenantScoped()`in ÜZERİNE eklenir — tenant filtresinin
 * yerine geçemez.
 */
export async function listCategories(
  tenantId: string,
  type?: CategoryType,
): Promise<CategoryView[]> {
  return prisma.category.findMany({
    where: tenantScoped(tenantId, type ? { type } : {}),
    select: categorySelect,
    // Tür + isim sırası: gelir ve gider kategorileri arayüzde doğal olarak gruplu görünür.
    // (`Account` createdAt'e göre sıralanır; orada liste kısa ve eklenme sırası anlamlıdır,
    // kategori listesi ise zamanla uzayan ve alfabetik taranan bir listedir.)
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
}

export type CreateCategoryInput = {
  name: unknown;
  type: unknown;
};

export type CreateCategoryResult =
  | { ok: true; category: CategoryView }
  | { ok: false; status: 400 | 409; error: string };

const INVALID_NAME_ERROR = `Name must be between ${MIN_CATEGORY_NAME_LENGTH} and ${MAX_CATEGORY_NAME_LENGTH} characters`;
const INVALID_TYPE_ERROR = "Type must be one of INCOME, EXPENSE";
const DUPLICATE_NAME_ERROR = "A category with this name already exists for this type";
const NOT_FOUND_ERROR = "Category not found";

export async function createCategory(
  tenantId: string,
  actorUserId: string,
  input: CreateCategoryInput,
): Promise<CreateCategoryResult> {
  if (typeof input.name !== "string") {
    return { ok: false, status: 400, error: INVALID_NAME_ERROR };
  }
  const name = input.name.trim();
  if (!isValidCategoryName(name)) {
    return { ok: false, status: 400, error: INVALID_NAME_ERROR };
  }

  if (!isValidCategoryType(input.type)) {
    return { ok: false, status: 400, error: INVALID_TYPE_ERROR };
  }

  try {
    const category = await prisma.category.create({
      data: { tenantId, name, type: input.type },
      select: categorySelect,
    });

    // Audit yazımı işlem tamamlandıktan SONRA ve best-effort'tur (Issue #15): başarısız olsa
    // bile kategori oluşturma geri alınMAZ.
    await writeAuditLog({
      actorUserId,
      tenantId,
      action: AUDIT_ACTIONS.CATEGORY_CREATED,
      targetType: AUDIT_TARGET_TYPES.CATEGORY,
      targetId: category.id,
      metadata: { name: category.name, type: category.type },
    });

    return { ok: true, category };
  } catch (error) {
    // "Önce aynı isimde var mı diye bak, sonra yaz" YARIŞA AÇIKTIR (iki eşzamanlı istek
    // ikisini de oluşturabilir); unique constraint'e güvenilir (bkz. `createAccount()`).
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE
    ) {
      return { ok: false, status: 409, error: DUPLICATE_NAME_ERROR };
    }
    throw error;
  }
}

export type UpdateCategoryInput = {
  name?: unknown;
  type?: unknown;
};

export type UpdateCategoryResult =
  | { ok: true; category: CategoryView }
  | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * Kategoriyi günceller. Yalnızca GÖNDERİLEN alanlar değişir (partial update).
 *
 * `tenantId`/`id`/`createdAt` YAPISAL olarak güncellenemez: fonksiyon `input` nesnesini
 * Prisma'ya geçirmez, yalnızca doğruladığı alanları açıkça yazar (regresyon testi:
 * `security/category-security.spec.ts`).
 *
 * TÜR DEĞİŞTİRMEK SERBESTTİR: yanlış tarafa açılmış bir kategoriyi düzeltmenin tek alternatifi
 * silip yeniden oluşturmaktır ve bu, ileride kategoriye bağlanacak işlemler (#53) açısından
 * daha kötüdür. Tür unique anahtarın parçası olduğu için hedef tarafta aynı isim varsa `409`
 * döner — bu karar da constraint'e bırakılmıştır, önden okuma yapılmaz.
 */
export async function updateCategory(
  tenantId: string,
  categoryId: string,
  actorUserId: string,
  input: UpdateCategoryInput,
): Promise<UpdateCategoryResult> {
  const data: Prisma.CategoryUpdateManyMutationInput = {};

  if (input.name !== undefined) {
    if (typeof input.name !== "string") {
      return { ok: false, status: 400, error: INVALID_NAME_ERROR };
    }
    const name = input.name.trim();
    if (!isValidCategoryName(name)) {
      return { ok: false, status: 400, error: INVALID_NAME_ERROR };
    }
    data.name = name;
  }

  if (input.type !== undefined) {
    if (!isValidCategoryType(input.type)) {
      return { ok: false, status: 400, error: INVALID_TYPE_ERROR };
    }
    data.type = input.type;
  }

  if (Object.keys(data).length === 0) {
    return { ok: false, status: 400, error: "No updatable fields provided" };
  }

  try {
    // `update({ where: { id } })` KULLANILMAZ: id tek başına unique olduğu için Prisma bunu
    // kabul ederdi, ama o zaman tenant scope'u mutation'ın KENDİSİNDE taşınmazdı — başka bir
    // tenant'ın kategorisi güncellenebilirdi. `updateMany` + `tenantScoped()` bunu imkânsız
    // kılar.
    const { count } = await prisma.category.updateMany({
      where: tenantScoped(tenantId, { id: categoryId }),
      data,
    });

    if (count !== 1) {
      // Başka tenant'ın kategorisi ile hiç var olmayan kategori AYNI yanıtı alır
      // (enumeration engeli).
      return { ok: false, status: 404, error: NOT_FOUND_ERROR };
    }

    const category = await prisma.category.findFirstOrThrow({
      where: tenantScoped(tenantId, { id: categoryId }),
      select: categorySelect,
    });

    await writeAuditLog({
      actorUserId,
      tenantId,
      action: AUDIT_ACTIONS.CATEGORY_UPDATED,
      targetType: AUDIT_TARGET_TYPES.CATEGORY,
      targetId: category.id,
      // Hangi ALANLARIN değiştiği kaydedilir (bkz. `updateAccount()`'taki aynı gerekçe).
      metadata: { updatedFields: Object.keys(data) },
    });

    return { ok: true, category };
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

export type DeleteCategoryResult = { ok: true } | { ok: false; status: 404; error: string };

/**
 * Kategoriyi siler.
 *
 * BİLİNEN SINIR: `Transaction` modeli henüz yok (#53). "Kullanımda olan kategori silinmek
 * istenirse ne olur" (engelle / işlemleri kategorisiz bırak) o modelin kararıdır ve orada
 * verilmelidir. Bugün kategoriye bağlanan hiçbir kayıt olmadığı için koşulsuz silme doğru
 * davranıştır; önceden bir koruma yazmak, dayanacağı bir ilişki olmadığından ölü kod olurdu.
 */
export async function deleteCategory(
  tenantId: string,
  categoryId: string,
  actorUserId: string,
): Promise<DeleteCategoryResult> {
  // `delete({ where: { id } })` yerine `deleteMany` + `tenantScoped()`: silme sorgusunun
  // kendisi de tenant ile scope'lanır (bkz. `updateCategory()`'deki aynı gerekçe).
  const { count } = await prisma.category.deleteMany({
    where: tenantScoped(tenantId, { id: categoryId }),
  });

  if (count !== 1) {
    return { ok: false, status: 404, error: NOT_FOUND_ERROR };
  }

  await writeAuditLog({
    actorUserId,
    tenantId,
    action: AUDIT_ACTIONS.CATEGORY_DELETED,
    targetType: AUDIT_TARGET_TYPES.CATEGORY,
    targetId: categoryId,
  });

  return { ok: true };
}
