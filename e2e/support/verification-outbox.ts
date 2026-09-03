import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";

const VERIFICATION_OUTBOX_DIR = path.join(process.cwd(), ".test-outbox-verifications");

function outboxFilePath(email: string): string {
  const safeName = Buffer.from(email.toLowerCase()).toString("hex");
  return path.join(VERIFICATION_OUTBOX_DIR, `${safeName}.json`);
}

type VerificationOutboxEntry = { to: string; verifyUrl: string; sentAt: string };

/**
 * `consoleEmailSender.sendEmailVerificationEmail()`in (dev/test ortamında) alıcıya özel yazdığı
 * dosyayı okur (Issue #190). Gerçek bir mail sunucusu olmadan e2e/security testlerinin
 * doğrulama URL'sini — ve dolayısıyla raw token'ı — deterministik okumasını sağlar.
 * `e2e/support/outbox.ts` ile birebir aynı desen.
 */
export function readVerificationOutboxEntry(email: string): VerificationOutboxEntry | null {
  const filePath = outboxFilePath(email);
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(readFileSync(filePath, "utf-8")) as VerificationOutboxEntry;
}

export function clearVerificationOutboxEntry(email: string): void {
  const filePath = outboxFilePath(email);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

/** `?token=` parametresini çıkarır. */
export function extractTokenFromVerifyUrl(verifyUrl: string): string {
  return new URL(verifyUrl).searchParams.get("token") ?? "";
}
