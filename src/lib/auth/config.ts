import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";

// Credentials provider Auth.js'te sadece JWT session stratejisiyle desteklenir
// (database-backed session credentials provider ile çalışmaz), bu yüzden
// session stratejisi olarak "jwt" seçildi. Bu, Account/Session/VerificationToken
// Prisma modellerine ve bir DB adapter paketine ihtiyacı da ortadan kaldırır.
export const authConfig: NextAuthConfig = {
  session: {
    strategy: "jwt",
  },
  trustHost: true,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "E-posta", type: "email" },
        password: { label: "Şifre", type: "password" },
      },
      // NOT IMPLEMENTED: Kimlik bilgisi doğrulama mantığı Issue #6 (kullanıcı giriş/çıkış
      // sistemi) kapsamında eklenecek. Bu foundation issue'su sadece provider'ın kurulu
      // olmasını sağlar; şimdilik her giriş denemesi reddedilir.
      async authorize() {
        return null;
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
