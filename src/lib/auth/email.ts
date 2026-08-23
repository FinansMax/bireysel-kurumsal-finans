import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export type PasswordResetEmailPayload = {
  to: string;
  resetUrl: string;
};

/**
 * Gerçek bir e-posta sağlayıcısı entegrasyonu Issue #7'nin kapsamı dışındadır. Bu interface,
 * ileride gerçek bir sağlayıcının (ör. SMTP/SES) mevcut şifre sıfırlama mantığına dokunmadan
 * takılabilmesi için minimum bir abstraction sağlar.
 */
export interface EmailSender {
  sendPasswordResetEmail(payload: PasswordResetEmailPayload): Promise<void>;
}

const TEST_OUTBOX_DIR = path.join(process.cwd(), ".test-outbox");

function outboxFilePath(email: string): string {
  // E-posta adresini dosya sistemi için güvenli, çakışmasız bir dosya adına çevirir.
  const safeName = Buffer.from(email.toLowerCase()).toString("hex");
  return path.join(TEST_OUTBOX_DIR, `${safeName}.json`);
}

/**
 * Varsayılan (ve şu an tek) `EmailSender` implementasyonu: gerçek bir e-posta göndermek yerine
 * loglar. `NODE_ENV !== "production"` durumunda, e2e/security testlerinin reset URL'sini
 * deterministik şekilde okuyabilmesi için alıcıya özel bir dosyaya da yazar (gerçek SMTP
 * credential'a veya ücretli bir servise ihtiyaç duymadan). Bu dosya yazma davranışı, gerçek
 * bir sağlayıcı entegre edilirken kaldırılmalıdır.
 */
export const consoleEmailSender: EmailSender = {
  async sendPasswordResetEmail({ to, resetUrl }) {
    // GÜVENLİK: `resetUrl` raw reset token'ını İÇERİR. Production loglarına asla yazılmaz —
    // log erişimi olan biri, son 30 dakika içinde şifre sıfırlama talebinde bulunmuş herhangi
    // bir hesabı devralabilirdi. (Bkz. `src/lib/tenants/invitation-email.ts`'teki aynı kural
    // ve README "Şifre sıfırlama": raw token saklanmaz ve production loglarına yazılmaz.)
    if (process.env.NODE_ENV === "production") {
      console.log(`[email:password-reset] to=${to}`);
      return;
    }

    console.log(`[email:password-reset] to=${to} resetUrl=${resetUrl}`);

    try {
      mkdirSync(TEST_OUTBOX_DIR, { recursive: true });
      writeFileSync(
        outboxFilePath(to),
        JSON.stringify({ to, resetUrl, sentAt: new Date().toISOString() }),
      );
    } catch {
      // Outbox yazımı best-effort'tur; ana akışı asla bloklamamalı/kırmamalı.
    }
  },
};
