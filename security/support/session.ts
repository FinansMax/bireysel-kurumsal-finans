import { encode } from "next-auth/jwt";

import { ACTIVE_TENANT_COOKIE_NAME, encodeActiveTenantCookie } from "../../src/lib/tenants/active-tenant";

const SESSION_COOKIE_NAME = "authjs.session-token";

export type FakeSessionPayload = {
  sub: string;
  email: string;
  name?: string | null;
};

/**
 * Uygulamanın gerçek Auth.js JWT encode mekanizmasını (aynı AUTH_SECRET ile) kullanarak
 * geçerli, imzalı bir session cookie üretir. Kayıt/giriş akışı henüz implement edilmediği
 * için "authenticated" runtime yolunu (auth() -> session callback -> requireUser())
 * gerçek bir sign-in olmadan test edebilmek için kullanılır.
 *
 * Bu bir mock/stub DEĞİLDİR: server, bu cookie'yi normal bir kullanıcı oturumundan
 * gelmiş gibi gerçek kodla decode edip doğrular.
 */
export async function createSessionCookieHeader(payload: FakeSessionPayload): Promise<string> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET tanımlı değil - security testleri için gereklidir");
  }

  const value = await encode({
    secret,
    salt: SESSION_COOKIE_NAME,
    token: payload,
  });

  return `${SESSION_COOKIE_NAME}=${value}`;
}

/** Gerçek `encodeActiveTenantCookie`'yi (uygulamanın kendi kodu) kullanarak imzalı bir aktif-tenant cookie'si üretir. */
export async function createActiveTenantCookieHeader(tenantId: string): Promise<string> {
  const value = await encodeActiveTenantCookie(tenantId);
  return `${ACTIVE_TENANT_COOKIE_NAME}=${value}`;
}

/** Birden fazla `name=value` cookie header'ını tek bir `Cookie` header değerinde birleştirir. */
export function combineCookieHeaders(...headers: string[]): string {
  return headers.join("; ");
}
