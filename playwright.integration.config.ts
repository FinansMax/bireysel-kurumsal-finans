import { defineConfig } from "@playwright/test";

// DB entegrasyon testleri tarayıcı veya webServer gerektirmez;
// paylaşılan test veritabanı üzerinde çakışmayı önlemek için tek worker'da çalışır.
export default defineConfig({
  testDir: "./integration",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
});
