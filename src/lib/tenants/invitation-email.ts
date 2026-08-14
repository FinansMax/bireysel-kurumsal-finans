import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { MembershipRole } from "@prisma/client";

export type InvitationEmailPayload = {
  to: string;
  tenantId: string;
  role: MembershipRole;
  acceptUrl: string;
};

/**
 * Gerçek bir e-posta sağlayıcısı entegrasyonu Issue #14'ün kapsamı dışındadır. Bu interface,
 * ileride gerçek bir sağlayıcının (ör. SMTP/SES) davet mantığına dokunmadan takılabilmesi
 * için minimum bir abstraction sağlar (bkz. `src/lib/auth/email.ts`'teki aynı desen).
 */
export interface InvitationSender {
  sendInvitationEmail(payload: InvitationEmailPayload): Promise<void>;
}

// Password reset outbox'ından (`.test-outbox`) BİLEREK ayrı bir dizin kullanılır: aynı e-posta
// adresi aynı testte hem şifre sıfırlama hem davet alabilir; ayrı namespace bu ikisinin
// birbirinin dosyasını ezmesini engeller.
const TEST_OUTBOX_DIR = path.join(process.cwd(), ".test-outbox-invitations");

function outboxFilePath(email: string): string {
  const safeName = Buffer.from(email.toLowerCase()).toString("hex");
  return path.join(TEST_OUTBOX_DIR, `${safeName}.json`);
}

/**
 * Varsayılan (ve şu an tek) `InvitationSender` implementasyonu: gerçek bir e-posta göndermek
 * yerine loglar. `NODE_ENV !== "production"` durumunda, e2e/security testlerinin accept URL'sini
 * (ve dolayısıyla raw token'ı) deterministik şekilde okuyabilmesi için alıcıya özel bir dosyaya
 * da yazar. Raw token PRODUCTION loglarına asla yazılmaz.
 */
export const consoleInvitationSender: InvitationSender = {
  async sendInvitationEmail({ to, tenantId, role, acceptUrl }) {
    if (process.env.NODE_ENV === "production") {
      console.log(`[email:tenant-invitation] to=${to} tenantId=${tenantId} role=${role}`);
      return;
    }

    console.log(`[email:tenant-invitation] to=${to} tenantId=${tenantId} role=${role} acceptUrl=${acceptUrl}`);

    try {
      mkdirSync(TEST_OUTBOX_DIR, { recursive: true });
      writeFileSync(
        outboxFilePath(to),
        JSON.stringify({ to, tenantId, role, acceptUrl, sentAt: new Date().toISOString() }),
      );
    } catch {
      // Outbox yazımı best-effort'tur; ana akışı asla bloklamamalı/kırmamalı.
    }
  },
};
