import { defineConfig } from "@playwright/test";

// Security suite hem gerçek HTTP endpoint'lerine karşı (webServer gerekli) hem de
// doğrudan DB'ye karşı (Prisma) testler içerir; browser/page fixture'ı kullanılmadığı
// için tarayıcı kurulumuna ihtiyaç yoktur. Paylaşılan test veritabanında çakışmayı
// önlemek için tek worker'da, sıralı çalışır.
export default defineConfig({
  testDir: "./security",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    // `Connection: close` — gerekçesi `playwright.config.ts`'te (Issue #129, keep-alive
    // yarışı). Bu suite tek worker'da koştuğu için bugüne kadar ECONNRESET görmedi, ama aynı
    // Node HTTP istemcisini aynı `next dev` sunucusuna karşı kullanıyor: mekanizma burada da
    // mevcut, yalnızca olasılığı düşük. Aynı çareyi iki yerde tutmak, suite büyüdüğünde
    // "neden orada var burada yok" sorusunu doğurmamak için.
    extraHTTPHeaders: { Connection: "close" },
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
