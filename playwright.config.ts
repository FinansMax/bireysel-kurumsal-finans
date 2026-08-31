import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
    // `Connection: close` — e2e kararsızlığının ikinci kök sebebi (Issue #129).
    //
    // SEMPTOM: tam suite koşusunda rastgele testler `apiRequestContext.get/post/patch: read
    // ECONNRESET` ile düşüyordu; aynı test tek başına daima geçiyordu.
    //
    // MEKANİZMA — keep-alive yarışı: Playwright'ın `request` context'i (Node tarafı, tarayıcı
    // değil) soketleri keep-alive ile yeniden kullanır. `next dev`in altındaki Node HTTP
    // sunucusu ise boşta kalan bağlantıları `keepAliveTimeout` dolunca kapatır. İstemci tam
    // o anda kapanmakta olan soketi yeniden kullanırsa istek ECONNRESET ile ölür. Bu bir
    // uygulama hatası DEĞİLDİR — sunucu doğru davranıyor, istemci ölü bir sokete yazıyor.
    // Hata paralel worker sayısı ve istek hacmiyle birlikte artar; #135'in sayfalama testleri
    // (50+ kayıt seed'i) yükü artırınca koşu başına 6-27 teste kadar çıktı.
    //
    // Bu başlık, her isteğin kendi bağlantısını açıp kapatmasını sağlar; yeniden kullanılacak
    // boşta soket kalmaz. Tarayıcı isteklerini ETKİLEMEZ (Chromium `Connection`'ı yasaklı
    // başlık sayıp yok sayar) — zaten hatalar da yalnızca API isteklerindeydi.
    //
    // ÖLÇÜM (yerel, `--retries=0`, 9 tam koşu): düzeltmesiz 6 koşuda 0/1/6/18/19/27 hata;
    // düzeltmeyle 6 ardışık koşuda 0 hata + 3 doğrulama koşusu. Reddedilen alternatifler:
    // worker sayısını 4'e düşürmek (3 koşuda 1'i yine düştü — olasılığı azaltıyor, sebebi
    // ortadan kaldırmıyor) ve `webServer`ı `npm run build && npm run start` ile koşturmak
    // (uygulama prod modunda farklı davranıyor — ör. `secure` cookie'ler — ve suite toplu
    // düştü; ayrı bir araştırma gerektirir, bkz. docs/testing.md).
    extraHTTPHeaders: { Connection: "close" },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
