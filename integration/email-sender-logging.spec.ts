import { randomUUID } from "node:crypto";

import { MembershipRole } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { consoleEmailSender } from "../src/lib/auth/email";
import { consoleInvitationSender } from "../src/lib/tenants/invitation-email";

/**
 * Raw token'ların production loglarına sızmaması (bkz. README "Şifre sıfırlama" ve
 * `docs/security-invariants.md` #6).
 *
 * NEDEN BU TEST VAR: `consoleEmailSender` bir dönem `resetUrl`'i — yani raw reset token'ını —
 * production dahil HER ortamda `console.log`'a yazıyordu. Log erişimi olan biri (veya bir log
 * toplama servisi), son 30 dakika içinde şifre sıfırlama talebinde bulunmuş HERHANGİ bir
 * hesabı devralabilirdi. Bu, kod incelemesinde kolayca gözden kaçan bir satırdı; test tam
 * olarak o satırın geri gelmesini engellemek için var.
 */

const mutableEnv = process.env as Record<string, string | undefined>;
const originalNodeEnv = mutableEnv.NODE_ENV;

/** `console.log` çağrılarını toplayan minimal bir yakalayıcı. */
function captureConsoleLog() {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return {
    lines,
    restore() {
      console.log = original;
    },
  };
}

test.afterEach(() => {
  mutableEnv.NODE_ENV = originalNodeEnv;
});

test.describe("consoleEmailSender — password reset", () => {
  test("production'da raw token loglanMAZ", async () => {
    mutableEnv.NODE_ENV = "production";
    const rawToken = randomUUID();
    const capture = captureConsoleLog();

    try {
      await consoleEmailSender.sendPasswordResetEmail({
        to: "user@example.com",
        resetUrl: `https://app.example.com/reset-password?token=${rawToken}`,
      });
    } finally {
      capture.restore();
    }

    const logged = capture.lines.join("\n");
    expect(logged).not.toContain(rawToken);
    expect(logged).not.toContain("resetUrl");
    // Operasyonel iz tamamen kaybolmamalı: e-posta gönderildiği hâlâ görülebilmeli.
    expect(logged).toContain("[email:password-reset]");
  });

  test("production DIŞINDA resetUrl loglanır (testin duyarlı olduğunun kanıtı)", async () => {
    expect(process.env.NODE_ENV).not.toBe("production");
    const rawToken = randomUUID();
    const capture = captureConsoleLog();

    try {
      await consoleEmailSender.sendPasswordResetEmail({
        to: `dev-${randomUUID()}@example.com`,
        resetUrl: `http://localhost:3000/reset-password?token=${rawToken}`,
      });
    } finally {
      capture.restore();
    }

    // Kontrol grubu: aynı kod yolu dev'de token'ı GERÇEKTEN logluyor. Bu olmasaydı,
    // yukarıdaki "loglanmıyor" iddiası sender'ın hiç log yazmamasından da kaynaklanabilirdi.
    expect(capture.lines.join("\n")).toContain(rawToken);
  });
});

test.describe("consoleInvitationSender — tenant daveti", () => {
  test("production'da raw token loglanMAZ", async () => {
    mutableEnv.NODE_ENV = "production";
    const rawToken = randomUUID();
    const capture = captureConsoleLog();

    try {
      await consoleInvitationSender.sendInvitationEmail({
        to: "invitee@example.com",
        tenantId: "tenant-1",
        role: MembershipRole.MEMBER,
        acceptUrl: `https://app.example.com/invitations/accept?token=${rawToken}`,
      });
    } finally {
      capture.restore();
    }

    const logged = capture.lines.join("\n");
    expect(logged).not.toContain(rawToken);
    expect(logged).not.toContain("acceptUrl");
    expect(logged).toContain("[email:tenant-invitation]");
  });

  test("production DIŞINDA acceptUrl loglanır (kontrol grubu)", async () => {
    expect(process.env.NODE_ENV).not.toBe("production");
    const rawToken = randomUUID();
    const capture = captureConsoleLog();

    try {
      await consoleInvitationSender.sendInvitationEmail({
        to: `dev-${randomUUID()}@example.com`,
        tenantId: "tenant-1",
        role: MembershipRole.MEMBER,
        acceptUrl: `http://localhost:3000/invitations/accept?token=${rawToken}`,
      });
    } finally {
      capture.restore();
    }

    expect(capture.lines.join("\n")).toContain(rawToken);
  });
});
