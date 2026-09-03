import { sanitizeMetadata } from "@/lib/audit/sanitize";

/**
 * Sentry'ye giden olayların temizlenmesi (Issue #183).
 *
 * NEDEN AYRI BİR MODÜL: bu mantık üç ayrı Sentry yapılandırma dosyasından (sunucu, istemci,
 * edge) çağrılır. Kopyalamak, birinde unutulan bir redaksiyonun sessizce kişisel veri
 * göndermesi demekti — hata raporları en az audit log kadar hassastır ve üçüncü bir tarafa
 * gider.
 *
 * BU MODÜL `@sentry/nextjs` IMPORT ETMEZ: saf fonksiyonlardır, bu yüzden Sentry hiç
 * yapılandırılmamışken bile test edilebilirler (`integration/sentry-scrub.spec.ts`).
 */

/**
 * URL'nin sorgu dizesini atar.
 *
 * NEDEN: şifre sıfırlama ve davet linkleri raw token'ı `?token=` içinde taşır
 * (`/reset-password?token=...`, `/invitations/accept?token=...`, `/verify-email?token=...`).
 * Bir hata raporunda tam URL'in görünmesi, o token'ı Sentry'yi görebilen herkese vermek
 * demektir — README'deki "raw token production loglarına yazılmaz" kuralının aynısı burada da
 * geçerlidir.
 *
 * Sorgu dizesinin TAMAMI atılır, yalnızca `token` parametresi değil: hangi parametrenin
 * hassas olduğunu tek tek saymak, ileride eklenen bir parametrenin unutulması demektir.
 * Kaybedilen hata ayıklama bilgisi, sızan bir token'ın bedeline değmez.
 */
export function stripQueryString(url: string): string {
  if (typeof url !== "string" || url.length === 0) {
    return url;
  }

  const queryStart = url.search(/[?#]/);
  return queryStart === -1 ? url : url.slice(0, queryStart);
}

/** Sentry olayının ilgilendiğimiz alanları. SDK tipine bağlanmamak için yapısal tanım. */
export type ScrubbableEvent = {
  request?: {
    url?: string;
    query_string?: unknown;
    headers?: Record<string, unknown>;
    cookies?: unknown;
    data?: unknown;
  };
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  breadcrumbs?: Array<{ data?: unknown; message?: string }>;
};

/**
 * Bir Sentry olayını gönderilmeden önce temizler.
 *
 * `sendDefaultPii: false` zaten çoğu şeyi engeller, ama YETMEZ: uygulama kodunun kendi
 * eklediği `extra`/`contexts` alanları ve hata mesajlarına gömülmüş URL'ler o ayarın kapsamı
 * dışındadır. Bu fonksiyon ikinci savunma katmanıdır — `writeAuditLog()`'un
 * `sanitizeMetadata()` çağırmasıyla birebir aynı gerekçe.
 *
 * Cookie ve `authorization` başlığı KOŞULSUZ atılır: bir session cookie'si, hata raporunu
 * görebilen herkese hesap devri imkânı verir.
 */
export function scrubEvent<T extends object>(input: T): T {
  const event = input as T & ScrubbableEvent;
  if (event.request) {
    if (typeof event.request.url === "string") {
      event.request.url = stripQueryString(event.request.url);
    }

    // Sorgu dizesi ayrı bir alanda da gelebilir; URL'i kırpıp burayı bırakmak anlamsız olurdu.
    delete event.request.query_string;
    delete event.request.cookies;

    if (event.request.headers) {
      for (const key of Object.keys(event.request.headers)) {
        const lower = key.toLowerCase();
        if (lower === "cookie" || lower === "authorization" || lower === "x-forwarded-for") {
          delete event.request.headers[key];
        }
      }
    }

    if (event.request.data !== undefined) {
      event.request.data = sanitizeMetadata(event.request.data);
    }
  }

  if (event.extra) {
    event.extra = sanitizeMetadata(event.extra) as Record<string, unknown>;
  }

  if (event.contexts) {
    event.contexts = sanitizeMetadata(event.contexts) as Record<string, unknown>;
  }

  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs.map((crumb) => ({
      ...crumb,
      ...(crumb.data !== undefined ? { data: sanitizeMetadata(crumb.data) } : {}),
      ...(typeof crumb.message === "string" ? { message: stripQueryString(crumb.message) } : {}),
    }));
  }

  return event;
}
