import { NextResponse, type NextRequest } from "next/server";

import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/observability/request-id";

/**
 * Tek sorumluluğu istek kimliği olan proxy (Issue #183).
 *
 * NE YAPMAZ: kimlik doğrulama, yetkilendirme, yönlendirme. Bu bilinçlidir. Auth kontrolü
 * `requireUser()`/`requirePermission()` guard'larında ve sayfa guard'larındadır (invariant #3);
 * proxy'ye taşımak, korumayı iki yere bölüp hangisinin geçerli olduğunu belirsizleştirirdi.
 * Ayrıca proxy Edge runtime'da çalışır ve Prisma'ya erişemez — canlı membership doğrulaması
 * burada zaten mümkün değildir.
 *
 * NEDEN PROXY (eski adıyla middleware): `x-request-id`'nin HER yanıtta bulunması gerekiyor (Issue #183 kabul
 * kriteri). Alternatif — her route handler'a elle eklemek — 20+ dosyaya tekrar eden kod koyar
 * ve yeni bir route yazıldığında UNUTULUR. Tek bir yerde olması, kuralın kendiliğinden
 * uygulanmasını sağlar.
 *
 * DOSYA ADI `proxy.ts`, `middleware.ts` DEĞİL: Next.js 16'da `middleware` dosya
 * konvansiyonu KULLANIMDAN KALDIRILDI ve `proxy` olarak yeniden adlandırıldı (dev sunucusu
 * açık bir deprecation uyarısı veriyor; bkz.
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`).
 * Dışa aktarılan fonksiyonun adı da `proxy` olmak zorundadır.
 *
 * Kimlik hem İSTEĞE (route handler'ların loglarında kullanabilmesi için) hem YANITA (kullanıcı
 * destek talebinde verebilsin diye) yazılır.
 */
export function proxy(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  /**
   * Statik varlıklar HARİÇ her yol.
   *
   * `_next/static`, `_next/image` ve favicon gibi dosyalar için istek kimliği üretmek boşuna
   * iştir: onlar bir kullanıcı işlemine karşılık gelmez ve destek talebinde referans verilmez.
   * Ayrıca proxy'yi sıcak yoldan uzak tutmak, statik varlık servisini yavaşlatmamayı sağlar.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
