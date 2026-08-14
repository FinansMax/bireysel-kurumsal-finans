import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { prisma } from "@/lib/prisma";

import { authenticateUser } from "./authenticate";
import { isSessionRevoked } from "./session-revocation";

// Credentials provider Auth.js'te sadece JWT session stratejisiyle desteklenir
// (database-backed session credentials provider ile çalışmaz), bu yüzden
// session stratejisi olarak "jwt" seçildi. Bu, Account/Session/VerificationToken
// Prisma modellerine ve bir DB adapter paketine ihtiyacı da ortadan kaldırır.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8; // 8 saat

export const authConfig: NextAuthConfig = {
  session: {
    strategy: "jwt",
    // Finansal bir SaaS için Auth.js'in varsayılan 30 günlük JWT ömrü çok geniş; stateless
    // JWT mimarisinde sign-out sadece istemci cookie'sini temizlediğinden (bkz. README),
    // yakalanmış bir token'ın geçerlilik penceresini daraltmak için 8 saate düşürüldü.
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  trustHost: true,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "E-posta", type: "email" },
        password: { label: "Şifre", type: "password" },
      },
      async authorize(credentials) {
        return authenticateUser({
          email: credentials?.email,
          password: credentials?.password,
        });
      },
    }),
  ],
  callbacks: {
    /**
     * Auth.js, JWT stratejisinde `token.sub` alanını sign-in sırasında otomatik olarak
     * `user.id`'ye eşitler; bunu session.user.id'ye taşımak dışında ek bir jwt callback'e
     * gerek yoktur.
     *
     * SESSION REVOCATION (Issue #26): Bu callback her `auth()`/`getCurrentUser()` çağrısında
     * çalışır — kritik credential (şifre) değişikliğinden ÖNCE üretilmiş JWT'lerin artık kabul
     * edilmemesi için tam burada, tek bir DB sorgusuyla `credentialsChangedAt` okunup
     * `token.iat` ile karşılaştırılır (bkz. `isSessionRevoked()` — hassasiyet/precision
     * detayları orada belgelenmiştir).
     *
     * Revoke edilmiş bir session için BİLEREK `session.user.id` set EDİLMEZ — mevcut public
     * contract'ı (`getCurrentUser() => null`, `GET /api/auth/me => 401`) hiçbir ek kod
     * değişikliği gerekmeden korur: `getCurrentUser()` zaten `!session.user.id` durumunda
     * `null` döner (bkz. `current-user.ts`). Hata fırlatılmaz.
     *
     * KAPSAM NOTU: Bu callback `token.sub`'a karşılık gelen bir `User` satırı bulamazsa (`user`
     * `null`), bu #26'nın kapsamı DIŞINDADIR (silinmiş kullanıcı ele alımı, ayrı bir konu) — bu
     * callback ÖNCEDEN hiçbir DB sorgusu yapmadığından mevcut davranış aynen korunur: yalnızca
     * `credentialsChangedAt` bilgisi varsa (kullanıcı gerçekten mevcutsa) revocation kararına
     * dahil edilir; `user` `null` ise `isSessionRevoked()` `credentialsChangedAt`'i `undefined`
     * olarak alır ve revoke etmez (mevcut davranışla bire bir aynı).
     *
     * DB maliyeti: bu callback ÖNCEDEN hiçbir sorgu yapmıyordu; eklenen TEK sorgu (`select` ile
     * sadece `credentialsChangedAt`) aynı request içinde tekrarlanmaz.
     */
    async session({ session, token }) {
      if (!session.user || !token.sub) {
        return session;
      }

      const user = await prisma.user.findUnique({
        where: { id: token.sub },
        select: { credentialsChangedAt: true },
      });

      if (isSessionRevoked(token.iat, user?.credentialsChangedAt)) {
        return session;
      }

      session.user.id = token.sub;
      return session;
    },
  },
};
