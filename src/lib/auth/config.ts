import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { authenticateUser } from "./authenticate";

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
    // Auth.js, JWT stratejisinde `token.sub` alanını sign-in sırasında otomatik olarak
    // `user.id`'ye eşitler; bunu session.user.id'ye taşımak dışında ek bir jwt callback'e
    // gerek yoktur.
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
};
