/**
 * İstek kimliği (Issue #183).
 *
 * NEDEN VAR: bugün production'da bir şey patladığında elimizde yalnızca `console.error` var ve
 * hangi isteğe ait olduğunu bilmenin yolu yok. Kullanıcı "saat 14:32'de hata aldım" dediğinde
 * log'da o isteği bulmak imkânsız. `x-request-id`, destek talebiyle log satırı arasındaki tek
 * bağdır: kullanıcı yanıttaki id'yi verir, biz log'da onu ararız.
 */

export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Dışarıdan gelen bir id kabul edilir, yoksa üretilir.
 *
 * NEDEN GELEN DEĞER KABUL EDİLİYOR: uygulamanın önündeki proxy/load balancer zaten bir id
 * üretiyor olabilir; onu ezmek, iki sistemin loglarını birbirine bağlamayı imkânsız kılardı.
 *
 * NEDEN BİÇİM SINIRLANIYOR: bu değer log satırlarına yazılıyor. Doğrulamasız kabul etmek,
 * saldırganın log'a satır sonu enjekte edip sahte kayıt üretmesine (log injection) izin verirdi.
 * Sadece güvenli karakterler ve makul bir uzunluk kabul edilir; uymayan değer YOK SAYILIR ve
 * yerine yenisi üretilir — reddetmek yerine sessizce düzeltmek doğru davranıştır, çünkü bu
 * başlık bir yetkilendirme aracı değil, bir izleme kolaylığıdır.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function resolveRequestId(incoming: string | null | undefined): string {
  if (incoming && SAFE_REQUEST_ID.test(incoming)) {
    return incoming;
  }
  return crypto.randomUUID();
}
