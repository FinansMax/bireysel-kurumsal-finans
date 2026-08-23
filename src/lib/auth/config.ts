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
     * SESSION REVOCATION (Issue #26): Kritik credential (şifre) değişikliğinden ÖNCE üretilmiş
     * JWT'ler burada, tek bir DB sorgusuyla `credentialsChangedAt` okunup `token.iat` ile
     * karşılaştırılarak reddedilir (bkz. `isSessionRevoked()` — hassasiyet/precision detayları
     * orada belgelenmiştir).
     *
     * KRİTİK — kontrol neden `session` callback'inde DEĞİL, TAM BURADA yapılmalı: Auth.js'in
     * session action'ı (`node_modules/@auth/core/lib/actions/session.js`) `GET /api/auth/session`
     * isteğinde token'ı HER ZAMAN yeniden imzalar ("Refresh JWT expiry by re-signing it") ve
     * yeni cookie'yi response'a ekler. `jwt.encode()` jose'nin `setIssuedAt()`'ini argümansız
     * çağırdığı için yeni token TAZE bir `iat` alır. `session` callback'i yalnızca response
     * GÖVDESİNİ şekillendirir; token'ın yeniden imzalanmasını engelleyemez. Dolayısıyla
     * revocation'ı orada uygulamak, çalınmış bir cookie'nin tek bir `GET /api/auth/session`
     * ile "tazelenip" tekrar geçerli hale gelmesini ENGELLEMEZ (revocation tamamen bypass
     * edilirdi; ayrıca `exp` de ilerlediği için token süresiz yenilenebilirdi).
     *
     * Aynı dosyadaki kontrol akışı, `callbacks.jwt` `null` DÖNDÜĞÜNDE token'ı yeniden imzalamak
     * yerine session cookie'sini TEMİZLER (`sessionStore.clean()`) ve response gövdesini `null`
     * bırakır. Bu yüzden revoke kararı burada verilir ve `null` döndürülür — bu, hem cookie
     * tazelemesini engeller hem de revoke edilmiş bir cookie'nin `GET /api/auth/session`
     * üzerinden kullanıcının e-postasını okumaya devam etmesini önler.
     *
     * Sign-in anında (`user` dolu) kontrol ATLANIR: credential'lar o istekte zaten doğrulanmıştır
     * ve token henüz encode edilmediği için `token.iat` yoktur — gereksiz bir DB sorgusundan da
     * kaçınılır.
     *
     * KAPSAM NOTU: `token.sub`'a karşılık gelen `User` satırı yoksa (silinmiş kullanıcı) revoke
     * EDİLMEZ — `isSessionRevoked()` `credentialsChangedAt`'i `undefined` alır. Silinmiş kullanıcı
     * ele alımı #26'nın kapsamı dışındadır ve bu davranış önceki implementasyonla birebir aynıdır.
     */
    async jwt({ token, user }) {
      if (user || !token.sub) {
        return token;
      }

      const dbUser = await prisma.user.findUnique({
        where: { id: token.sub },
        select: { credentialsChangedAt: true },
      });

      if (isSessionRevoked(token.iat, dbUser?.credentialsChangedAt)) {
        return null;
      }

      return token;
    },

    /**
     * Auth.js, JWT stratejisinde `token.sub` alanını sign-in sırasında otomatik olarak
     * `user.id`'ye eşitler; bunu `session.user.id`'ye taşımak dışında bir işe gerek yoktur.
     *
     * Bu callback'e ulaşıldığında token'ın revoke EDİLMEDİĞİ garantidir: yukarıdaki `jwt`
     * callback'i revoke durumunda `null` döndüğü için Auth.js `session` callback'ini hiç
     * çağırmaz (bkz. session action'daki `if (token !== null)` dalı).
     */
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
};
