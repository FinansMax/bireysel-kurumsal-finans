import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Bakım (maintenance) endpoint'lerinin paylaşılan gizli anahtarı (Issue #188).
 *
 * NEDEN OTURUM DEĞİL: bu endpoint'i bir KULLANICI değil, platformun zamanlanmış işi (Vercel
 * Cron / GitHub Actions schedule) çağırır. Zamanlanmış bir işin oturumu yoktur; ona bir
 * kullanıcı hesabı açmak, o hesabın çalınması hâlinde çok daha geniş bir yetki verirdi.
 * Paylaşılan anahtar, yetkiyi TEK bir işleme sınırlar.
 *
 * NEDEN UYGULAMA İÇİ ZAMANLAYICI YOK: `setInterval` ile kalıcı bir zamanlayıcı kurmak
 * serverless/çok instance'lı bir deployment'ta ya hiç çalışmaz (süreç uykuya alınır) ya da
 * her instance'ta ayrı ayrı çalışır. Tetikleme platformun işidir (Issue #188 açıkça bunu
 * söylüyor).
 */

export const MAINTENANCE_SECRET_ENV = "MAINTENANCE_SECRET";

/**
 * Anahtarı okur. Tanımsız/boşsa `null` döner.
 *
 * TANIMSIZLIK BİR HATA DEĞİL, "ÖZELLİK KAPALI"DIR ve çağıran route bunu `404` ile yanıtlar.
 * `APP_BASE_URL`/`TRUSTED_PROXY` gibi production'da FIRLATMAZ; sebebi farklı: o değişkenler
 * her isteği etkiler, bu ise yalnızca bakım işini. Bir 500 üretmek, kimliksiz bir çağırana
 * "burada bir özellik var ama yapılandırılmamış" bilgisini sızdırırdı (invariant #7).
 *
 * Yanlış yapılandırma yine de GÖRÜNÜRDÜR: zamanlanmış iş 404 alır ve platformun cron
 * kayıtlarında başarısız olarak görünür.
 */
export function getMaintenanceSecret(): string | null {
  const configured = process.env[MAINTENANCE_SECRET_ENV]?.trim();
  return configured && configured.length > 0 ? configured : null;
}

/**
 * `Authorization: Bearer <secret>` başlığını sabit zamanda doğrular.
 *
 * NEDEN SABİT ZAMAN: `a === b` ilk farklı karakterde döner ve karşılaştırma süresi, kaç
 * karakterin tuttuğunu sızdırır — anahtar karakter karakter tahmin edilebilir hale gelir.
 *
 * NEDEN ÖNCE SHA-256: `timingSafeEqual` uzunlukları farklı olan tamponlarda FIRLATIR ve bu
 * fırlatmanın kendisi "uzunluk tutmadı" bilgisini sızdırır. İki değeri de sabit uzunlukta
 * (32 bayt) bir özete indirgemek, uzunluk farkını da karşılaştırmanın içine alır.
 */
export function isValidMaintenanceSecret(authorizationHeader: string | null): boolean {
  const expected = getMaintenanceSecret();
  if (!expected) {
    return false;
  }

  const prefix = "Bearer ";
  if (!authorizationHeader || !authorizationHeader.startsWith(prefix)) {
    return false;
  }

  const provided = authorizationHeader.slice(prefix.length);

  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();

  return timingSafeEqual(providedDigest, expectedDigest);
}
