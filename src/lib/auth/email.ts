import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { EMAIL_PROVIDERS, resolveEmailConfig } from "@/lib/config/email";
import { sendViaResend } from "@/lib/email/resend";
import { passwordResetEmail } from "@/lib/email/templates";

export type PasswordResetEmailPayload = {
  to: string;
  resetUrl: string;
};

/**
 * Gerçek bir e-posta sağlayıcısı entegrasyonu Issue #7'nin kapsamı dışındaydı; Issue #180 ile
 * `resendEmailSender` eklendi. Bu interface DEĞİŞMEDİ — zaten tam bu iş için tasarlanmıştı ve
 * çağıran taraf (`requestPasswordReset`) hangi sağlayıcının kullanıldığını bilmez.
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

/**
 * Gerçek gönderim yapan implementasyon (Issue #180).
 *
 * `consoleEmailSender`'daki raw-token log kuralı BURADA DA GEÇERLİDİR ve aslında daha katıdır:
 * `resetUrl` hiçbir ortamda loglanmaz. Dev'de token'a ihtiyaç duyan testler zaten `console`
 * sağlayıcısıyla (ve dosya tabanlı outbox ile) çalışır; gerçek sağlayıcı seçildiğinde token'ı
 * loga yazmanın hiçbir meşru gerekçesi kalmaz.
 *
 * Gönderim başarısız olursa THROW ETMEZ: `sendViaResend()` `false` döner, biz de akışı
 * bozmadan devam ederiz. Nedeni `resend.ts`'te yazılı — `forgot-password` kayıtlı/kayıtsız
 * e-posta için aynı yanıtı dönmek zorundadır (invariant #7).
 */
export const resendEmailSender: EmailSender = {
  async sendPasswordResetEmail({ to, resetUrl }) {
    const sent = await sendViaResend(passwordResetEmail(to, resetUrl));
    console.log(`[email:password-reset] to=${to} provider=resend delivered=${sent}`);
  },
};

/**
 * Yapılandırmaya göre kullanılacak sender'ı seçer (Issue #180).
 *
 * ÇAĞRI SIRASI KRİTİK: bu fonksiyon yanlış yapılandırılmış production'da THROW EDER
 * (bkz. `src/lib/config/email.ts`). Bu yüzden e-posta gönderen akışlarda her DB erişiminden
 * ÖNCE çağrılmalıdır — aksi halde "kayıtlı e-posta → 500, kayıtsız → 200" farkı oluşur ve
 * Issue #7'de kapatılan user-enumeration oracle'ı geri gelir. `requestPasswordReset()` bu
 * çağrıyı ilk satırında yapar; regresyon testi `integration/email-config.spec.ts`.
 */
export function getEmailSender(): EmailSender {
  const config = resolveEmailConfig();
  return config.provider === EMAIL_PROVIDERS.RESEND ? resendEmailSender : consoleEmailSender;
}
