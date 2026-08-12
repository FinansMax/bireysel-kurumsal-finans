import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";

const TEST_OUTBOX_DIR = path.join(process.cwd(), ".test-outbox");

function outboxFilePath(email: string): string {
  const safeName = Buffer.from(email.toLowerCase()).toString("hex");
  return path.join(TEST_OUTBOX_DIR, `${safeName}.json`);
}

type OutboxEntry = {
  to: string;
  resetUrl: string;
  sentAt: string;
};

/**
 * `src/lib/auth/email.ts`'teki `consoleEmailSender`'ın (test/dev ortamında) alıcıya özel
 * yazdığı dosyayı okur. Gerçek bir mail sunucusu olmadan e2e/security testlerinin
 * forgot-password akışının ürettiği reset URL'sini (ve dolayısıyla raw token'ı)
 * deterministik şekilde okuyabilmesini sağlar.
 */
export function readOutboxEntry(email: string): OutboxEntry | null {
  const filePath = outboxFilePath(email);
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(readFileSync(filePath, "utf-8")) as OutboxEntry;
}

export function extractTokenFromResetUrl(resetUrl: string): string {
  const url = new URL(resetUrl);
  const token = url.searchParams.get("token");
  if (!token) {
    throw new Error(`reset URL'de token bulunamadı: ${resetUrl}`);
  }
  return token;
}

/** Test verisini temizlemek için outbox dosyasını siler (yoksa no-op). */
export function clearOutboxEntry(email: string): void {
  const filePath = outboxFilePath(email);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}
