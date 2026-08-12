import { MembershipRole, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { isValidRole } from "./validation";

class NotFoundError extends Error {}
class LastOwnerError extends Error {}

const memberSelect = {
  id: true,
  role: true,
  createdAt: true,
  userId: true,
  user: { select: { id: true, email: true, name: true } },
} satisfies Prisma.MembershipSelect;

export type MemberView = Prisma.MembershipGetPayload<{ select: typeof memberSelect }>;

type ForbiddenResult = { ok: false; status: 403; error: string };

/**
 * Bu issue kapsamında kullanılan minimum/geçici yetkilendirme: aktörün, hedef tenant'ta
 * OWNER rolünde bir membership'i olmalı. Formal RBAC altyapısı kapsam dışıdır (bkz. Issue #9).
 */
async function requireOwnerOfTenant(
  tenantId: string,
  actorUserId: string,
): Promise<{ ok: true } | ForbiddenResult> {
  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: actorUserId, tenantId } },
    select: { role: true },
  });

  if (!membership || membership.role !== MembershipRole.OWNER) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  return { ok: true };
}

export type ListMembersResult =
  | { ok: true; members: MemberView[] }
  | ForbiddenResult;

/** Sadece `tenantId`'ye ait membership'leri döndürür — sorgu her zaman tenantId ile scope'lanır. */
export async function listMembers(tenantId: string, actorUserId: string): Promise<ListMembersResult> {
  const authCheck = await requireOwnerOfTenant(tenantId, actorUserId);
  if (!authCheck.ok) return authCheck;

  const members = await prisma.membership.findMany({
    where: { tenantId },
    select: memberSelect,
    orderBy: { createdAt: "asc" },
  });

  return { ok: true, members };
}

export type UpdateRoleResult =
  | { ok: true; member: MemberView }
  | ForbiddenResult
  | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * Rolü günceller. Hedef membership + son-OWNER kontrolü + update, tek bir Serializable
 * transaction içinde yapılır: iki eşzamanlı istek aynı anda "son OWNER" durumunu okuyup
 * ikisi de downgrade edemez (Prisma/Postgres serialization hatası, kaybeden isteği reddeder).
 */
export async function updateMemberRole(
  tenantId: string,
  membershipId: string,
  actorUserId: string,
  newRole: unknown,
): Promise<UpdateRoleResult> {
  if (!isValidRole(newRole)) {
    return { ok: false, status: 400, error: "Invalid role" };
  }

  const authCheck = await requireOwnerOfTenant(tenantId, actorUserId);
  if (!authCheck.ok) return authCheck;

  try {
    const member = await prisma.$transaction(
      async (tx) => {
        // Hem id hem tenantId birlikte filtrelenir: başka tenant'a ait bir membershipId
        // burada asla eşleşmez (tenant isolation).
        const target = await tx.membership.findFirst({
          where: { id: membershipId, tenantId },
          select: { role: true },
        });
        if (!target) {
          throw new NotFoundError();
        }

        if (target.role === MembershipRole.OWNER && newRole !== MembershipRole.OWNER) {
          const ownerCount = await tx.membership.count({
            where: { tenantId, role: MembershipRole.OWNER },
          });
          if (ownerCount <= 1) {
            throw new LastOwnerError();
          }
        }

        return tx.membership.update({
          where: { id: membershipId },
          data: { role: newRole },
          select: memberSelect,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return { ok: true, member };
  } catch (error) {
    if (error instanceof NotFoundError) {
      return { ok: false, status: 404, error: "Membership not found" };
    }
    if (error instanceof LastOwnerError) {
      return { ok: false, status: 409, error: "Cannot change role of the last remaining OWNER" };
    }
    throw error;
  }
}

export type RemoveMemberResult =
  | { ok: true }
  | ForbiddenResult
  | { ok: false; status: 404 | 409; error: string };

/** Üyeyi tenant'tan çıkarır; aynı Serializable transaction + son-OWNER koruması deseni. */
export async function removeMember(
  tenantId: string,
  membershipId: string,
  actorUserId: string,
): Promise<RemoveMemberResult> {
  const authCheck = await requireOwnerOfTenant(tenantId, actorUserId);
  if (!authCheck.ok) return authCheck;

  try {
    await prisma.$transaction(
      async (tx) => {
        const target = await tx.membership.findFirst({
          where: { id: membershipId, tenantId },
          select: { role: true },
        });
        if (!target) {
          throw new NotFoundError();
        }

        if (target.role === MembershipRole.OWNER) {
          const ownerCount = await tx.membership.count({
            where: { tenantId, role: MembershipRole.OWNER },
          });
          if (ownerCount <= 1) {
            throw new LastOwnerError();
          }
        }

        await tx.membership.delete({ where: { id: membershipId } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return { ok: true };
  } catch (error) {
    if (error instanceof NotFoundError) {
      return { ok: false, status: 404, error: "Membership not found" };
    }
    if (error instanceof LastOwnerError) {
      return { ok: false, status: 409, error: "Cannot remove the last remaining OWNER" };
    }
    throw error;
  }
}
