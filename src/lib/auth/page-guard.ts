import { redirect } from "next/navigation";
import { cache } from "react";

import { getCurrentUser, type CurrentUser } from "./current-user";

/**
 * Sunucu bileşenleri (sayfa/layout) için kimlik guard'ı (Issue #39).
 *
 * `guard.ts`'teki `requireUser()`'ın SAYFA karşılığıdır: orada sonuç bir 401 `NextResponse`'tur,
 * burada `/login`'e yönlendirmedir. API guard'ları gibi bu da `src/lib/**` içinden HTTP/rotalama
 * bilen tek istisna katmandır (bkz. `docs/architecture.md` → "Bağımlılık yönü").
 *
 * KRİTİK — bu guard SADECE layout'ta çağrılmaz, korunan HER sayfada da çağrılır.
 * Next.js'in kendi rehberi (`node_modules/next/dist/docs/01-app/02-guides/authentication.md`
 * → "Layouts and auth checks") layout'ta yapılan kontrole tek başına güvenilmemesini söyler:
 * partial rendering nedeniyle layout'lar istemci tarafı gezinmelerde yeniden RENDER EDİLMEZ ve
 * bir layout, alt segmentlerin render edilmesini (RSC payload'ında görünmesini) engellemez.
 *
 * Bu, savunmanın SON hattı da değildir: veriye erişen her API route'u kendi
 * `requireUser()`/`requirePermission()` kontrolünü yapar (bkz. `docs/security-invariants.md`).
 * Buradaki yönlendirme bir UX kararıdır — yetkilendirme değil.
 */

/**
 * `getCurrentUser()`, JWT'yi çözerken session revocation kontrolü için bir DB sorgusu tetikler
 * (bkz. `src/lib/auth/config.ts` → `callbacks.jwt`). Aynı istekte hem layout hem sayfa guard'ı
 * çağırdığı için sonuç React'in `cache()`'i ile istek başına bir kez hesaplanır.
 */
const getCachedCurrentUser = cache(getCurrentUser);

/**
 * Oturum yoksa `/login`'e yönlendirir (fonksiyon dönmez — `redirect()` fırlatır).
 *
 * Yönlendirmeye `?next=<geldiği-yol>` gibi bir parametre BİLİNÇLİ olarak eklenmedi: kullanıcı
 * kontrolündeki bir hedefi yönlendirmede kullanmak, doğrulaması unutulduğu anda open redirect'e
 * dönüşen bir yüzeydir. "Giriş sonrası geldiği sayfaya dön" davranışı Issue #39'un kapsamında
 * değildir; gerektiğinde yalnızca `/` ile başlayan (ve `//` ile başlamayan) yollar kabul edilerek
 * eklenmelidir.
 */
export async function requirePageUser(): Promise<CurrentUser> {
  const user = await getCachedCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}
