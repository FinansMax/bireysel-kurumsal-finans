import { MembershipRole, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { isValidName, isValidSlug, slugify } from "./validation";

const PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE = "P2002";

export type CreateTenantInput = { name: unknown; slug?: unknown };

export type CreatedTenant = { id: string; name: string; slug: string };

export type CreateTenantResult =
  | { ok: true; tenant: CreatedTenant }
  | { ok: false; status: 400 | 409; error: string };

/**
 * Authenticated bir kullanıcı için yeni bir `Tenant` oluşturur ve aynı kullanıcıyı
 * OWNER rolünde `Membership` olarak ekler (Issue #8).
 *
 * - Tenant + Membership tek bir `$transaction` içinde oluşturulur: biri başarısız
 *   olursa diğeri de kalıcı hale gelmez (yarım kayıt kalmaz).
 * - `slug` verilmezse `name`'den türetilir; verilirse de aynı şekilde normalize edilir.
 * - Duplicate slug, race condition'a açık bir "önce kontrol et" adımı yerine doğrudan
 *   transaction içindeki unique constraint (P2002) hatasının yakalanmasıyla ele alınır.
 */
export async function createTenant(
  userId: string,
  input: CreateTenantInput,
): Promise<CreateTenantResult> {
  if (typeof input.name !== "string") {
    return { ok: false, status: 400, error: "Name is required" };
  }

  const name = input.name.trim();
  if (!isValidName(name)) {
    return { ok: false, status: 400, error: "Name must be between 2 and 100 characters" };
  }

  const slugSource = typeof input.slug === "string" && input.slug.trim().length > 0
    ? input.slug
    : name;
  const slug = slugify(slugSource);

  if (!isValidSlug(slug)) {
    return { ok: false, status: 400, error: "Invalid slug" };
  }

  try {
    const tenant = await prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: { name, slug },
        select: { id: true, name: true, slug: true },
      });

      await tx.membership.create({
        data: { userId, tenantId: created.id, role: MembershipRole.OWNER },
      });

      return created;
    });

    return { ok: true, tenant };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE
    ) {
      return { ok: false, status: 409, error: "Slug is already taken" };
    }

    throw error;
  }
}
