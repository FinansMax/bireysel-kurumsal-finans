import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";

const TEST_OUTBOX_DIR = path.join(process.cwd(), ".test-outbox-invitations");

function outboxFilePath(email: string): string {
  const safeName = Buffer.from(email.toLowerCase()).toString("hex");
  return path.join(TEST_OUTBOX_DIR, `${safeName}.json`);
}

type InvitationOutboxEntry = {
  to: string;
  tenantId: string;
  role: string;
  acceptUrl: string;
  sentAt: string;
};

/**
 * `src/lib/tenants/invitation-email.ts`'teki `consoleInvitationSender`'ın (test/dev ortamında)
 * alıcıya özel yazdığı dosyayı okur. Gerçek bir mail sunucusu olmadan e2e/security testlerinin
 * davet oluşturma akışının ürettiği accept URL'sini (ve dolayısıyla raw token'ı) deterministik
 * şekilde okuyabilmesini sağlar (bkz. `e2e/support/outbox.ts`'teki aynı desen).
 */
export function readInvitationOutboxEntry(email: string): InvitationOutboxEntry | null {
  const filePath = outboxFilePath(email);
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(readFileSync(filePath, "utf-8")) as InvitationOutboxEntry;
}

export function extractTokenFromAcceptUrl(acceptUrl: string): string {
  const url = new URL(acceptUrl);
  const token = url.searchParams.get("token");
  if (!token) {
    throw new Error(`accept URL'de token bulunamadı: ${acceptUrl}`);
  }
  return token;
}

/** Test verisini temizlemek için outbox dosyasını siler (yoksa no-op). */
export function clearInvitationOutboxEntry(email: string): void {
  const filePath = outboxFilePath(email);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}
