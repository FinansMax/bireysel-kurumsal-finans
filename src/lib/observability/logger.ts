/**
 * Yapılandırılmış (JSON) loglama (Issue #183).
 *
 * NEDEN BAĞIMLILIK YOK: `pino`/`winston` gibi bir kütüphane, burada ihtiyaç duyulan şeyin
 * (tek satır JSON üretmek) çok ötesinde bir yüzey getirir. `docs/conventions.md` →
 * "Bağımlılıklar": bu repo `bcrypt` yerine `node:crypto`, `zod` yerine elle yazılmış doğrulama
 * kullanıyor. Bu modül `console`'un ince bir sarmalayıcısıdır.
 *
 * NEDEN JSON: `console.error("[audit] failed", { ... })` insan okur, makine okuyamaz. Tek satır
 * JSON, ileride bir log platformuna (sink) yönlendirildiğinde alan bazlı arama/filtreleme
 * sağlar — "şu tenant'ta son bir saatte 5xx alan istekler" sorusu ancak böyle yanıtlanır.
 *
 * SENTRY'YE BAĞIMLI DEĞİLDİR (Issue #183 açıkça bunu şart koşuyor): `SENTRY_DSN` tanımlı
 * olmasa da yapılandırılmış loglama TAM olarak çalışır. Log, hata izlemenin bir parçası değil,
 * ondan bağımsız bir katmandır.
 *
 * BU MODÜL `next/server` IMPORT ETMEZ (`docs/architecture.md` → bağımlılık yönü).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Log satırına eklenebilecek bağlam.
 *
 * Alanlar issue'da sabitlenmiştir. Serbest bir `Record<string, unknown>` yerine açık alanlar
 * kullanılır: hangi bilginin loglanabilir olduğu tip düzeyinde belli olsun ve kimse
 * yanlışlıkla oraya bir token koymasın.
 */
export type LogContext = {
  requestId?: string;
  tenantId?: string;
  userId?: string;
  route?: string;
  durationMs?: number;
  /**
   * Serbest ek alanlar. HASSAS VERİ KOYULMAZ — bu, çağıranın sorumluluğudur; `sanitize.ts`
   * gibi ikinci bir savunma katmanı BURADA YOKTUR ve olmaması bilinçlidir: log yazımı sıcak
   * yolda çalışır, her satırda derin bir nesne taraması yapmak ölçülebilir bir maliyettir.
   */
  extra?: Record<string, string | number | boolean | null>;
};

function emit(level: LogLevel, msg: string, context: LogContext = {}): void {
  const line = JSON.stringify({
    level,
    msg,
    time: new Date().toISOString(),
    ...context,
  });

  // `console.error` yalnızca error seviyesinde: stdout/stderr ayrımı, log toplayıcıların
  // uyarı/hata filtrelemesinin dayandığı şeydir.
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (msg: string, context?: LogContext) => emit("debug", msg, context),
  info: (msg: string, context?: LogContext) => emit("info", msg, context),
  warn: (msg: string, context?: LogContext) => emit("warn", msg, context),
  error: (msg: string, context?: LogContext) => emit("error", msg, context),
};
