import type { APIRequestContext, APIResponse } from "@playwright/test";

import { uniqueTestClientIp } from "./rate-limit";

/**
 * Auth.js'in gerçek credentials sign-in HTTP akışı: önce CSRF token alınır,
 * sonra `csrfToken` ile birlikte credentials callback'ine POST edilir. Bu bir
 * mock değildir — tarayıcının `signIn()` çağrısında yaptığının aynısıdır.
 */
async function getCsrfToken(request: APIRequestContext): Promise<string> {
  const response = await request.get("/api/auth/csrf");
  const body = (await response.json()) as { csrfToken: string };
  return body.csrfToken;
}

/**
 * `ip` verilmezse her çağrı kendi benzersiz sahte istemci IP'sini üretir (bkz.
 * `./rate-limit.ts`) — Issue #27'nin sign-in rate limitine (bkz.
 * `src/app/api/auth/[...nextauth]/route.ts`) çok sayıda ardışık çağrı yapan mevcut testlerin
 * birbirini (yanlışlıkla) rate-limit'lememesi için. Rate limiter'ın KENDİSİNİ test eden yerler
 * (bkz. `security/rate-limit-security.spec.ts`) aynı bucket'ı kasıtlı tüketmek için `ip`'yi
 * açıkça sabit geçer.
 */
export async function signInWithCredentials(
  request: APIRequestContext,
  email: string,
  password: string,
  ip: string = uniqueTestClientIp(),
) {
  const csrfToken = await getCsrfToken(request);

  return request.post("/api/auth/callback/credentials", {
    form: { email, password, csrfToken, json: "true" },
    maxRedirects: 0,
    headers: { "x-forwarded-for": ip },
  });
}

export async function signOut(request: APIRequestContext) {
  const csrfToken = await getCsrfToken(request);

  return request.post("/api/auth/signout", {
    form: { csrfToken },
    maxRedirects: 0,
  });
}

/**
 * Bir response'taki tüm `Set-Cookie` değerlerini ayrı ayrı döndürür. `response.headers()`
 * kullanmıyoruz çünkü birden fazla Set-Cookie header'ı varsa bunları tek bir string'te
 * virgülle birleştirebilir, bu da (Expires tarihindeki virgül nedeniyle) ayrıştırmayı
 * belirsiz hale getirir.
 */
export function getSetCookieValues(response: APIResponse): string[] {
  return response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => header.value);
}
