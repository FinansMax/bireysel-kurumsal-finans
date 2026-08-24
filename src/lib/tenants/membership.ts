import { MembershipRole, Prisma } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "@/lib/audit/actions";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { runSerializable, SerializationConflictError } from "@/lib/db/serializable";
import { prisma } from "@/lib/prisma";
import { tenantScoped } from "@/lib/tenancy/scope";

import { isValidRole } from "./validation";

class NotFoundError extends Error {}
class LastOwnerError extends Error {}
class ForbiddenOwnershipError extends Error {}

const memberSelect = {
  id: true,
  role: true,
  createdAt: true,
  userId: true,
  user: { select: { id: true, email: true, name: true } },
} satisfies Prisma.MembershipSelect;

export type MemberView = Prisma.MembershipGetPayload<{ select: typeof memberSelect }>;

/**
 * Sadece `tenantId`'ye ait membership'leri döndürür — sorgu her zaman tenantId ile scope'lanır
 * (`tenantScoped()`, Issue #13 — bkz. `src/lib/tenancy/scope.ts`).
 *
 * NOT: Bu fonksiyon artık authorization kararı VERMEZ (Issue #9'daki geçici `requireOwnerOfTenant()`
 * kaldırıldı). Kimin bu fonksiyonu çağırabileceği, çağrıdan ÖNCE route seviyesinde merkezi
 * `requirePermission(PERMISSIONS.VIEW_MEMBERS, tenantId)` (Issue #12, `src/lib/authz/`) ile
 * belirlenir. `tenantId` parametresi çağıran route'ta o guard'dan gelen trusted active tenant
 * context'i (`context.tenant.id`) olmalıdır — client input'u DEĞİL.
 */
export async function listMembers(tenantId: string): Promise<MemberView[]> {
  return prisma.membership.findMany({
    where: tenantScoped(tenantId, {}),
    select: memberSelect,
    orderBy: { createdAt: "asc" },
  });
}

export type UpdateRoleResult =
  | { ok: true; member: MemberView }
  // 503: eşzamanlı yükte transaction serialize edilemedi ve yeniden denemeler tükendi
  // (Issue #122). GEÇİCİ bir durumdur — 409 (iş kuralı ihlali) ile karıştırılmamalıdır.
  | { ok: false; status: 400 | 403 | 404 | 409 | 503; error: string };

const SERIALIZATION_CONFLICT_ERROR = "Temporary write conflict, please retry";

/**
 * Rolü günceller. Permission kontrolü (kimin bu işlemi çağırabileceği) route seviyesinde
 * `requirePermission(PERMISSIONS.UPDATE_MEMBER_ROLE, tenantId)` ile yapılır; `actorRole` o
 * kontrolden gelen, DB'den canlı doğrulanmış roldür (client input DEĞİLDİR).
 *
 * Hedef membership + ownership/son-OWNER kontrolü + update, tek bir Serializable transaction
 * içinde yapılır: iki eşzamanlı istek aynı anda "son OWNER" durumunu okuyup ikisi de downgrade
 * edemez (Prisma/Postgres serialization hatası, kaybeden isteği reddeder). Kaybeden istek
 * `runSerializable()` tarafından OTOMATİK YENİDEN DENENİR (Issue #122) — serialization failure
 * geçici bir durumdur, kullanıcıya 500 olarak yansıtılmamalıdır. Denemeler tükenirse 503.
 *
 * Ownership/privilege-escalation koruması (Issue #12):
 * - ADMIN hiç kimseyi (kendisi dahil) OWNER yapamaz.
 * - ADMIN mevcut bir OWNER'ın rolünü değiştiremez.
 * (OWNER için bu kısıtlamalar geçerli değildir; OWNER yalnızca son-OWNER invariant'ına tabidir.)
 *
 * Başarılı bir rol değişikliği, transaction commit olduktan SONRA (Issue #15) `MEMBERSHIP_ROLE_CHANGED`
 * audit event'i olarak yazılır — `actorUserId` de tıpkı `actorRole` gibi çağıran route'taki
 * trusted authorization context'ten (`requirePermission()`) gelir, client input DEĞİLDİR. Audit
 * yazımı best-effort'tur (bkz. `writeAuditLog()`); başarısız olsa bile rol değişikliği kalıcı kalır.
 */
export async function updateMemberRole(
  tenantId: string,
  membershipId: string,
  actorUserId: string,
  actorRole: MembershipRole,
  newRole: unknown,
): Promise<UpdateRoleResult> {
  if (!isValidRole(newRole)) {
    return { ok: false, status: 400, error: "Invalid role" };
  }

  if (actorRole !== MembershipRole.OWNER && newRole === MembershipRole.OWNER) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  try {
    let previousRole: MembershipRole | undefined;

    const member = await runSerializable(
      async (tx) => {
        // Hem id hem tenantId birlikte filtrelenir (tenantScoped()): başka tenant'a ait
        // bir membershipId burada asla eşleşmez (tenant isolation, Issue #13).
        const target = await tx.membership.findFirst({
          where: tenantScoped(tenantId, { id: membershipId }),
          select: { role: true },
        });
        if (!target) {
          throw new NotFoundError();
        }

        if (actorRole !== MembershipRole.OWNER && target.role === MembershipRole.OWNER) {
          throw new ForbiddenOwnershipError();
        }

        if (target.role === MembershipRole.OWNER && newRole !== MembershipRole.OWNER) {
          const ownerCount = await tx.membership.count({
            where: { tenantId, role: MembershipRole.OWNER },
          });
          if (ownerCount <= 1) {
            throw new LastOwnerError();
          }
        }

        previousRole = target.role;

        // `update({ where: { id } })` KULLANILMAZ: id tek başına unique olduğundan Prisma
        // bunu kabul eder, ama bu güvenli-görünen-ama-yalnız-id sorgusu (bkz.
        // `src/lib/tenancy/scope.ts`) tenant scope'unu mutasyonun kendisinde taşımaz.
        // Bunun yerine `updateMany` + `tenantScoped()` ile id VE tenantId birlikte
        // filtrelenir; `count` beklenmedik şekilde 0 ise (örn. concurrent silme) NotFound.
        const { count } = await tx.membership.updateMany({
          where: tenantScoped(tenantId, { id: membershipId }),
          data: { role: newRole },
        });
        if (count !== 1) {
          throw new NotFoundError();
        }

        return tx.membership.findFirstOrThrow({
          where: tenantScoped(tenantId, { id: membershipId }),
          select: memberSelect,
        });
      },
    );

    // Audit yazımı BİLEREK transaction'ın DIŞINDA ve sadece commit olduktan SONRA yapılır
    // (Issue #15) — best-effort'tur, rol değişikliğinin kendisini rollback ETMEMELİDİR.
    await writeAuditLog({
      actorUserId,
      tenantId,
      action: AUDIT_ACTIONS.MEMBERSHIP_ROLE_CHANGED,
      targetType: AUDIT_TARGET_TYPES.MEMBERSHIP,
      targetId: member.id,
      metadata: { previousRole, newRole: member.role },
    });

    return { ok: true, member };
  } catch (error) {
    if (error instanceof NotFoundError) {
      return { ok: false, status: 404, error: "Membership not found" };
    }
    if (error instanceof ForbiddenOwnershipError) {
      return { ok: false, status: 403, error: "Forbidden" };
    }
    if (error instanceof LastOwnerError) {
      return { ok: false, status: 409, error: "Cannot change role of the last remaining OWNER" };
    }
    if (error instanceof SerializationConflictError) {
      return { ok: false, status: 503, error: SERIALIZATION_CONFLICT_ERROR };
    }
    throw error;
  }
}

export type RemoveMemberResult =
  | { ok: true }
  | { ok: false; status: 403 | 404 | 409 | 503; error: string };

/**
 * Üyeyi tenant'tan çıkarır; aynı Serializable transaction + ownership/son-OWNER koruması
 * deseni. Permission kontrolü route seviyesinde yapılır (bkz. `updateMemberRole` dokümantasyonu).
 *
 * ADMIN mevcut bir OWNER'ı çıkaramaz (ownership koruması, Issue #12).
 */
export async function removeMember(
  tenantId: string,
  membershipId: string,
  actorRole: MembershipRole,
): Promise<RemoveMemberResult> {
  try {
    await runSerializable(
      async (tx) => {
        const target = await tx.membership.findFirst({
          where: tenantScoped(tenantId, { id: membershipId }),
          select: { role: true, userId: true },
        });
        if (!target) {
          throw new NotFoundError();
        }

        if (actorRole !== MembershipRole.OWNER && target.role === MembershipRole.OWNER) {
          throw new ForbiddenOwnershipError();
        }

        if (target.role === MembershipRole.OWNER) {
          const ownerCount = await tx.membership.count({
            where: { tenantId, role: MembershipRole.OWNER },
          });
          if (ownerCount <= 1) {
            throw new LastOwnerError();
          }
        }

        // `delete({ where: { id } })` yerine `deleteMany` + `tenantScoped()`: silme
        // sorgusunun kendisi de id + tenantId ile scope'lanır (bkz. updateMemberRole).
        const { count } = await tx.membership.deleteMany({
          where: tenantScoped(tenantId, { id: membershipId }),
        });
        if (count !== 1) {
          throw new NotFoundError();
        }

        // GÜVENLİK: Bir üyeyi tenant'tan çıkarmak, o üyenin AÇTIĞI erişimi de kapatmalıdır.
        // Aksi halde çıkarılan bir ADMIN'in daha önce oluşturduğu bekleyen davet, TTL'i
        // (7 gün) boyunca geçerli kalır ve kabul edildiğinde davetliye gerçek bir üyelik
        // (ör. ADMIN) verir — yani içeriden birini çıkarmak, onun bıraktığı arka kapıyı
        // kapatmaz. Bu yüzden bu üyenin BU tenant için oluşturduğu, henüz kullanılmamış ve
        // iptal edilmemiş davetler, üyelik silinmesiyle AYNI transaction içinde iptal edilir
        // (atomik: üyelik silinip davetler açıkta kalamaz).
        //
        // KAPSAM: Yalnızca üyeliğin SONA ERMESİ davetleri iptal eder. Rol düşürme
        // (ör. ADMIN -> MEMBER) davetlere KASITLI olarak dokunmaz; o, ayrı bir politika
        // kararıdır. İptal `cancelledAt` ile yapılır — `createInvitation`'ın aynı
        // tenant+email sweep'iyle aynı mekanizma (bkz. `invitation.ts`), böylece
        // `acceptInvitation` bu davetleri diğer geçersiz durumlarla AYNI genel 400'e düşürür
        // ve yeni bir bilgi sızdırmaz.
        await tx.tenantInvitation.updateMany({
          where: { tenantId, invitedByUserId: target.userId, usedAt: null, cancelledAt: null },
          data: { cancelledAt: new Date() },
        });
      },
    );

    return { ok: true };
  } catch (error) {
    if (error instanceof NotFoundError) {
      return { ok: false, status: 404, error: "Membership not found" };
    }
    if (error instanceof ForbiddenOwnershipError) {
      return { ok: false, status: 403, error: "Forbidden" };
    }
    if (error instanceof LastOwnerError) {
      return { ok: false, status: 409, error: "Cannot remove the last remaining OWNER" };
    }
    if (error instanceof SerializationConflictError) {
      return { ok: false, status: 503, error: SERIALIZATION_CONFLICT_ERROR };
    }
    throw error;
  }
}
