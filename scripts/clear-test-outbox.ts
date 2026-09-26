import { rmSync } from "node:fs";
import path from "node:path";

/**
 * Playwright `globalSetup`. `consoleEmailSender` (src/lib/auth/email.ts) ve davet gönderimi
 * (src/lib/tenants/invitation-email.ts) NODE_ENV !== production'da alıcıya özel bir dosya
 * bırakır (e2e/security testlerinin token'ı deterministik okuyabilmesi için). Testler kendi
 * dosyasını temizlese de unutulan/yarıda kesilen koşular birikir — bir geliştirme makinesinde
 * haftalar içinde binlerce dosyaya çıkıp Turbopack'in glob taramasını yavaşlatabilir. Üç
 * suite'in de (integration/security/e2e) koşusu bu üç dizini TEMİZ bulsun diye çalıştırılır;
 * tekil testlerin temizliğini unutmasına bağımlı kalmadan birikimi kökten keser.
 */
export default function globalSetup(): void {
  const outboxDirs = [".test-outbox", ".test-outbox-invitations", ".test-outbox-verifications"];

  for (const dir of outboxDirs) {
    rmSync(path.join(process.cwd(), dir), { recursive: true, force: true });
  }
}
