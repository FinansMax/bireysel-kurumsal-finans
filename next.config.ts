import type { NextConfig } from "next";

/**
 * Tüm yanıtlara uygulanan temel güvenlik header'ları.
 *
 * Bunlar mevcut korumaların YERİNE geçmez, üzerine eklenir: authorization backend'de
 * (`requirePermission()`), CSRF koruması `SameSite=Lax` + CORS'a dayanır (bkz. README
 * "CSRF Duruşu"). Buradaki header'lar tarayıcı tarafındaki saldırı yüzeyini daraltır.
 */
const SECURITY_HEADERS = [
  {
    // MIME sniffing kapatılır: tarayıcı, Content-Type'ı "tahmin ederek" bir yanıtı
    // script gibi çalıştırmaya kalkmaz.
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    // Clickjacking koruması. CSP `frame-ancestors` bunun modern karşılığıdır; ikisi birden
    // gönderilir çünkü `X-Frame-Options` bazı eski tarayıcılarda hâlâ tek geçerli sinyaldir.
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    // Referrer'da cross-origin isteklerde yalnızca origin gönderilir — URL'de taşınan
    // hassas değerlerin (ör. reset/davet token'ları) üçüncü taraflara sızmasını engeller.
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    // Kullanılmayan güçlü tarayıcı API'leri kapatılır (finansal bir uygulamanın kameraya,
    // mikrofona veya konuma ihtiyacı yoktur).
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  {
    // HSTS. HTTP üzerinden gönderildiğinde tarayıcılar tarafından yok sayılır, bu yüzden
    // lokal geliştirmeyi etkilemez. `preload` BİLEREK eklenmemiştir: preload listesine
    // girmek geri alınması çok zor, alan adı genelinde bir taahhüttür ve ayrı bir karar
    // olarak (production deployment issue'su #91) verilmelidir.
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  {
    /**
     * Kısıtlı bir CSP. `script-src`/`style-src` BİLİNÇLİ olarak burada TANIMLANMAZ:
     * Next.js'te güvenli bir script politikası nonce tabanlı olmalıdır ve nonce'lar
     * statik bir config'ten değil, istek başına üretilmelidir (bkz.
     * `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`).
     * Yanlış bir `script-src` uygulamayı sessizce kırar; bu yüzden tam CSP, gerçek
     * frontend (Epic 4) geldiğinde ayrı bir issue olarak eklenmelidir.
     *
     * Buradaki üç direktif ise frontend'den bağımsızdır ve bugün güvenle uygulanabilir:
     * - `frame-ancestors 'none'`: clickjacking (X-Frame-Options'ın modern karşılığı).
     * - `base-uri 'self'`: enjekte edilen bir `<base>` etiketiyle göreli URL'lerin
     *   saldırgan sunucusuna yönlendirilmesini engeller.
     * - `form-action 'self'`: bir form POST'unun dış origin'e gönderilmesini engeller.
     * - `object-src 'none'`: eklenti tabanlı (Flash vb.) saldırı yüzeyini kapatır.
     */
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
];

const nextConfig: NextConfig = {
  /**
   * `next dev`, dev-only varlıklara (`/_next/static/*`, HMR) yapılan cross-origin istekleri
   * varsayılan olarak ENGELLER ve sunucu `localhost` ile başlatıldığı için `127.0.0.1`
   * farklı bir origin sayılır. Playwright ise `baseURL` olarak `http://127.0.0.1:3000`
   * kullanır (bkz. `playwright.config.ts`) — bu yüzden tarayıcı testlerinde JS chunk'ları
   * 403 alır, sayfa hydrate OLMAZ ve client component'lerdeki form handler'ları hiç çalışmaz
   * (form native GET'e düşer). Bu mismatch, client-side JS'e ihtiyaç duyan ilk ekranlar
   * (Issue #36) eklenene kadar görünmüyordu.
   *
   * YALNIZCA development'ı etkiler; production build'de bu ayarın hiçbir karşılığı yoktur.
   */
  allowedDevOrigins: ["127.0.0.1"],

  // `X-Powered-By: Next.js` header'ı kaldırılır — saldırgana framework/sürüm ipucu vermenin
  // hiçbir işlevsel karşılığı yoktur.
  poweredByHeader: false,

  async headers() {
    return [
      {
        // Tüm yollar: sayfalar ve `/api/*` dahil.
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
