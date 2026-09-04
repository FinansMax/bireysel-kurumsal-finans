import { scrubEvent } from "./sentry-scrub";

/**
 * Sentry başlatma yapılandırmasının TEK kaynağı (Issue #183).
 *
 * NEDEN TEK YERDE: Next.js üç ayrı runtime için üç ayrı başlatma dosyası ister (istemci,
 * sunucu, edge). Aynı ayarları üç kez yazmak, birinde `sendDefaultPii`'yi veya `beforeSend`'i
 * unutmak demektir — ve o unutma SESSİZDİR: Sentry çalışmaya devam eder, sadece kişisel veri
 * göndermeye başlar.
 */

/**
 * DSN tanımlı değilse SDK HİÇ BAŞLATILMAZ.
 *
 * Issue #183 bunu açıkça şart koşuyor; gerekçesi lokal geliştirme ve testlerin
 * etkilenmemesidir. `Sentry.init({ dsn: undefined })` çağırmak da "kapalı" davranır ama SDK'nın
 * global hook'larını (unhandled rejection, fetch sarmalayıcıları) yine de kurar; hiç
 * çağırmamak test ortamını gerçekten dokunulmamış bırakır.
 */
export function getSentryDsn(): string | null {
  const dsn = process.env.SENTRY_DSN?.trim();
  return dsn && dsn.length > 0 ? dsn : null;
}

/**
 * Üç runtime'ın da paylaştığı seçenekler.
 *
 * Dönüş tipi BİLEREK çıkarıma bırakılır (`Sentry.NodeOptions` gibi runtime'a özgü bir tipe
 * bağlanmaz): aynı nesne Node, edge ve tarayıcı `init()` çağrılarına veriliyor ve üçünün
 * seçenek tipleri birebir aynı değil. `beforeSend` içindeki olay tipi de SDK'nın kendi
 * tipinden ÇIKARILIR — böylece `sentry-scrub.ts` SDK'ya hiç bağlanmadan saf ve test edilebilir
 * kalır.
 *
 * `sendDefaultPii: false as const` — `false` literal'i olarak sabitlenir ki biri ileride
 * `true` yazmak isterse bunun bilinçli bir değişiklik olduğu diff'te görünsün.
 *
 * `tracesSampleRate: 0` — performans izleme KAPALI. Bu issue hata izleme hakkındadır;
 * trace'ler ayrı bir maliyet ve ayrı bir veri akışıdır (URL'ler, sorgu süreleri) ve açılması
 * ayrı bir karardır.
 */
export function buildSentryOptions(dsn: string) {
  return {
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0,
    sendDefaultPii: false as const,
    /**
     * İKİNCİ SAVUNMA KATMANI. `sendDefaultPii: false` çoğu şeyi engeller ama YETMEZ:
     * uygulama kodunun kendi eklediği `extra`/`contexts` alanları ve hata mesajlarına gömülü
     * URL'ler o ayarın kapsamı dışındadır (`writeAuditLog()`'un `sanitizeMetadata()` çağırma
     * gerekçesiyle birebir aynı).
     */
    beforeSend<T extends object>(event: T): T {
      return scrubEvent(event);
    },
  };
}
