import { MembershipRole } from "@prisma/client";

// Temel, bağımlılıksız input validasyonu (bkz. src/lib/auth/validation.ts deseni).

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const MIN_NAME_LENGTH = 2;
export const MAX_NAME_LENGTH = 100;
export const MIN_SLUG_LENGTH = 2;
export const MAX_SLUG_LENGTH = 60;

export function isValidName(name: string): boolean {
  return name.length >= MIN_NAME_LENGTH && name.length <= MAX_NAME_LENGTH;
}

/** İsimden (veya kullanıcı verdiği slug'dan) URL-güvenli bir slug üretir. */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isValidSlug(slug: string): boolean {
  return (
    SLUG_PATTERN.test(slug) && slug.length >= MIN_SLUG_LENGTH && slug.length <= MAX_SLUG_LENGTH
  );
}

const MEMBERSHIP_ROLES = Object.values(MembershipRole);

export function isValidRole(role: unknown): role is MembershipRole {
  return typeof role === "string" && (MEMBERSHIP_ROLES as string[]).includes(role);
}

/** Route param'ları (tenantId/membershipId) için temel şekil kontrolü. */
export function isValidId(id: unknown): id is string {
  return typeof id === "string" && id.trim().length > 0 && id.length <= 191;
}
