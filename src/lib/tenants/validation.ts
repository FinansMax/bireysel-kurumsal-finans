import { MembershipRole } from "@prisma/client";

const MEMBERSHIP_ROLES = Object.values(MembershipRole);

export function isValidRole(role: unknown): role is MembershipRole {
  return typeof role === "string" && (MEMBERSHIP_ROLES as string[]).includes(role);
}

/** Route param'ları (tenantId/membershipId) için temel şekil kontrolü. */
export function isValidId(id: unknown): id is string {
  return typeof id === "string" && id.trim().length > 0 && id.length <= 191;
}
