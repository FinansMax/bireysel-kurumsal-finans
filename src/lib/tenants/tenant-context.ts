import { cookies } from "next/headers";
import type { MembershipRole } from "@prisma/client";
import { NextResponse } from "next/server";

import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";

import { ACTIVE_TENANT_COOKIE_NAME, resolveActiveTenant, type ActiveTenant } from "./active-tenant";

export type ActiveTenantContext = {
  user: CurrentUser;
  tenant: ActiveTenant;
  role: MembershipRole;
};

/**
 * Sunucu tarafında (Server Component, Route Handler) aktif tenant context'ini okur.
 * Sonraki #11/#12/#13 issue'larının yetkilendirme kararları için üzerine kuracağı temel
 * helper budur. Rol bazlı yetkilendirme kararı VERMEZ — sadece context sağlar.
 *
 * Bu fonksiyon `next/headers` kullandığı için sadece gerçek bir Next.js request context'inde
 * (route handler, server component) çalışır — integration testlerinde doğrudan çağrılamaz.
 * Saf/test edilebilir doğrulama mantığı için `./active-tenant.ts`'teki `resolveActiveTenant()`e
 * bakın.
 */
export async function getActiveTenant(): Promise<ActiveTenantContext | null> {
  const user = await getCurrentUser();
  if (!user) {
    return null;
  }

  const resolved = await resolveActiveTenantForUser(user.id);
  if (!resolved) {
    return null;
  }

  return { user, tenant: resolved.tenant, role: resolved.role };
}

/**
 * Kullanıcı ZATEN elimizdeyken (ör. `requirePageUser()` çağrılmış bir sunucu bileşeninde)
 * aktif tenant'ı çözer (Issue #40).
 *
 * `getActiveTenant()` ile aynı işi yapar; farkı, oturumu YENİDEN çözmemesidir. `getCurrentUser()`
 * her çağrıldığında Auth.js JWT callback'i session revocation için bir DB sorgusu tetikler
 * (bkz. `src/lib/auth/config.ts`); kabuk zaten kullanıcıyı okumuşken `getActiveTenant()`
 * çağırmak aynı istekte bu maliyeti gereksiz yere ikiye katlardı.
 *
 * `userId` DAİMA trusted bir kaynaktan (session) gelmelidir — client'ın gönderdiği bir değer
 * buraya geçirilemez; aksi halde başkasının aktif tenant'ı çözülebilirdi.
 */
export async function resolveActiveTenantForUser(
  userId: string,
): Promise<{ tenant: ActiveTenant; role: MembershipRole } | null> {
  const store = await cookies();
  const raw = store.get(ACTIVE_TENANT_COOKIE_NAME)?.value;

  return resolveActiveTenant(userId, raw);
}

type RequireActiveTenantResult =
  | { context: ActiveTenantContext; response: null }
  | { context: null; response: NextResponse };

/**
 * Route handler'larda aktif tenant context'ini zorunlu kılan tekrar kullanılabilir guard
 * (mevcut `requireUser()` deseniyle aynı). Rol bazlı yetkilendirme kararı VERMEZ.
 *
 * Kullanım:
 *   const { context, response } = await requireActiveTenant();
 *   if (!context) return response;
 */
export async function requireActiveTenant(): Promise<RequireActiveTenantResult> {
  const context = await getActiveTenant();

  if (!context) {
    return {
      context: null,
      response: NextResponse.json({ error: "No active tenant" }, { status: 400 }),
    };
  }

  return { context, response: null };
}
