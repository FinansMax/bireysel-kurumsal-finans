import { encode } from "next-auth/jwt";

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
