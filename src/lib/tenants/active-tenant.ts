import { decode, encode } from "next-auth/jwt";
import type { MembershipRole } from "@prisma/client";
import type { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

// NOT: Bu dosya BİLEREK `next/headers` veya `@/lib/auth/current-user` (dolayısıyla
// NextAuth) import ETMEZ. Böylece burada tanımlanan fonksiyonlar gerçek bir Next.js
// request context'i olmadan (integration testlerinde) doğrudan çağrılabilir. Request
// context'ine bağımlı olan `getActiveTenant()`/`requireActiveTenant()` için
// `./tenant-context.ts`'e bakın.

export const ACTIVE_TENANT_COOKIE_NAME = "active-tenant";

// Session cookie'siyle (authjs.session-token) FARKLI bir salt kullanılır: bu, iki cookie'nin
// şifreleme anahtarlarını kriptografik olarak ayırır — biri diğeri yerine replay edilemez.
const ACTIVE_TENANT_SALT = "active-tenant-token";

// Auth session ömrüyle (8 saat) tutarlı tutulur; aktif tenant seçimi session'dan daha uzun
// yaşamamalı.
export const ACTIVE_TENANT_MAX_AGE_SECONDS = 60 * 60 * 8;

type ActiveTenantPayload = { tenantId: string };

// `timeZone` BURADA taşınır (Issue #134): gün/dönem hesabı yapan her ekran zaten aktif
// tenant'ı çözüyor. Ayrı bir sorgu eklemek yerine mevcut select'e bir alan koymak, hem
// maliyetsizdir hem de referansın UNUTULMASINI zorlaştırır — tarih gösteren bir ekran
// yazan kişi elinde hazır bulur.
export type ActiveTenant = { id: string; name: string; slug: string; timeZone: string };

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET tanımlı değil");
  }
  return secret;
}

/** Verilen tenantId'yi imzalı+şifreli (JWE) bir cookie değerine kodlar. */
export async function encodeActiveTenantCookie(tenantId: string): Promise<string> {
  return encode({
    secret: getSecret(),
    salt: ACTIVE_TENANT_SALT,
    maxAge: ACTIVE_TENANT_MAX_AGE_SECONDS,
    token: { tenantId } satisfies ActiveTenantPayload,
  });
}

/** Cookie değerini çözer; eksik/geçersiz/kurcalanmış ise `null` döner (asla fırlatmaz). */
export async function decodeActiveTenantCookie(rawValue: string): Promise<string | null> {
  try {
    const payload = await decode<ActiveTenantPayload>({
      secret: getSecret(),
      salt: ACTIVE_TENANT_SALT,
      token: rawValue,
    });
    return payload?.tenantId ?? null;
  } catch {
    return null;
  }
}

/** Response'a aktif tenant cookie'sini set eder (route handler'lardan çağrılır). */
export async function setActiveTenantCookie(response: NextResponse, tenantId: string): Promise<void> {
  const value = await encodeActiveTenantCookie(tenantId);

  response.cookies.set(ACTIVE_TENANT_COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ACTIVE_TENANT_MAX_AGE_SECONDS,
  });
}

/**
 * Bir kullanıcı + ham (encode edilmiş) cookie değerinden aktif tenant context'ini çözer.
 * Next.js request context'ine bağımlı DEĞİLDİR — integration testlerinde doğrudan çağrılabilir.
 *
 * Cookie geçerli olsa bile, kullanıcının HÂLÂ o tenant'ın üyesi olduğu her çağrıda canlı
 * olarak DB'den doğrulanır — membership silinmişse (stale cookie) `null` döner.
 */
export async function resolveActiveTenant(
  userId: string,
  rawCookieValue: string | null | undefined,
): Promise<{ tenant: ActiveTenant; role: MembershipRole } | null> {
  if (!rawCookieValue) {
    return null;
  }

  const tenantId = await decodeActiveTenantCookie(rawCookieValue);
  if (!tenantId) {
    return null;
  }

  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    select: {
      role: true,
      tenant: { select: { id: true, name: true, slug: true, timeZone: true } },
    },
  });

  if (!membership) {
    return null;
  }

  return { tenant: membership.tenant, role: membership.role };
}
