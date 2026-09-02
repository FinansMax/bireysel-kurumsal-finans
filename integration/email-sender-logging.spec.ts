import { randomUUID } from "node:crypto";

import { MembershipRole } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { consoleEmailSender, resendEmailSender } from "../src/lib/auth/email";
import { consoleInvitationSender, resendInvitationSender } from "../src/lib/tenants/invitation-email";

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

/**
 * Aynı log kuralının GERÇEK sağlayıcı implementasyonunda da geçerli olduğunu doğrular
 * (Issue #180).
 *
 * NEDEN `fetch` STUB'LANIYOR: `docs/testing.md` #3 güvenlik mekanizmalarının mock'lanmasını
 * yasaklar (hash, token üretimi, JWT, rate limiter gerçek çalışır). Burada stub'lanan şey bir
 * güvenlik mekanizması DEĞİL, üçüncü taraf bir HTTP sınırıdır: alternatif, her CI koşusunda
 * Resend'e gerçek e-posta göndermek olurdu — ücretli, ağa bağımlı ve kararsız. Test edilen
 * davranış (raw token'ın loglanmaması) stub'ın arkasında değil, ÖNÜNDE gerçekleşir.
 */
const originalFetch = globalThis.fetch;
const emailEnvKeys = ["EMAIL_PROVIDER", "EMAIL_API_KEY", "EMAIL_FROM"] as const;
const originalEmailEnv = Object.fromEntries(emailEnvKeys.map((k) => [k, mutableEnv[k]]));

function useResendConfig(apiKey: string): void {
  mutableEnv.EMAIL_PROVIDER = "resend";
  mutableEnv.EMAIL_API_KEY = apiKey;
  mutableEnv.EMAIL_FROM = "FinansMax <no-reply@example.com>";
}

function restoreEmailEnv(): void {
  for (const key of emailEnvKeys) {
    const original = originalEmailEnv[key];
    if (original === undefined) {
      delete mutableEnv[key];
    } else {
      mutableEnv[key] = original;
    }
  }
}

/** Gönderimi yakalayan sahte `fetch`; isteği kaydeder ve başarı döner. */
function stubFetch(ok = true) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit });
    return new Response(JSON.stringify({ id: "stub" }), {
      status: ok ? 200 : 422,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

test.describe("resendEmailSender / resendInvitationSender — log kuralı", () => {
  test.afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreEmailEnv();
  });

  test("resetUrl HİÇBİR ortamda loglanmaz (production dışında bile)", async () => {
    const rawToken = randomUUID();
    useResendConfig("re_stub_key");
    const fetchStub = stubFetch();
    const capture = captureConsoleLog();

    try {
      await resendEmailSender.sendPasswordResetEmail({
        to: "user@example.com",
        resetUrl: `https://app.example.com/reset-password?token=${rawToken}`,
      });
    } finally {
      capture.restore();
      fetchStub.restore();
    }

    const logged = capture.lines.join("\n");
    // `consoleEmailSender` dev'de token'ı loglar (outbox için); gerçek sağlayıcıda bunun
    // meşru bir gerekçesi yok, o yüzden burada kural DAHA katı.
    expect(logged).not.toContain(rawToken);
    expect(logged).not.toContain("resetUrl");
    expect(logged).toContain("[email:password-reset]");
    expect(logged).toContain("provider=resend");
  });

  test("API key loglanmaz ama isteğin Authorization başlığına konur", async () => {
    const apiKey = `re_stub_${randomUUID()}`;
    useResendConfig(apiKey);
    const fetchStub = stubFetch();
    const capture = captureConsoleLog();

    try {
      await resendEmailSender.sendPasswordResetEmail({
        to: "user@example.com",
        resetUrl: "https://app.example.com/reset-password?token=abc",
      });
    } finally {
      capture.restore();
      fetchStub.restore();
    }

    expect(capture.lines.join("\n")).not.toContain(apiKey);

    // Kontrol grubu: anahtar gerçekten KULLANILIYOR. Bu olmasaydı "loglanmıyor" iddiası,
    // anahtarın hiç okunmamasından da kaynaklanabilirdi.
    expect(fetchStub.calls).toHaveLength(1);
    const headers = fetchStub.calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${apiKey}`);
  });

  test("gönderim başarısız olsa bile THROW ETMEZ (enumeration koruması bozulmaz)", async () => {
    useResendConfig("re_stub_key");
    const fetchStub = stubFetch(false);
    const capture = captureConsoleLog();
    const originalError = console.error;
    console.error = () => {};

    try {
      // Sağlayıcı 422 dönüyor; çağıran akışın yanıtı DEĞİŞMEMELİ.
      await expect(
        resendEmailSender.sendPasswordResetEmail({
          to: "user@example.com",
          resetUrl: "https://app.example.com/reset-password?token=abc",
        }),
      ).resolves.toBeUndefined();
    } finally {
      console.error = originalError;
      capture.restore();
      fetchStub.restore();
    }

    expect(capture.lines.join("\n")).toContain("delivered=false");
  });

  test("acceptUrl loglanmaz (davet tarafı)", async () => {
    const rawToken = randomUUID();
    useResendConfig("re_stub_key");
    const fetchStub = stubFetch();
    const capture = captureConsoleLog();

    try {
      await resendInvitationSender.sendInvitationEmail({
        to: "invitee@example.com",
        tenantId: "tenant-1",
        role: MembershipRole.MEMBER,
        acceptUrl: `https://app.example.com/invitations/accept?token=${rawToken}`,
      });
    } finally {
      capture.restore();
      fetchStub.restore();
    }

    const logged = capture.lines.join("\n");
    expect(logged).not.toContain(rawToken);
    expect(logged).not.toContain("acceptUrl");
    expect(logged).toContain("[email:tenant-invitation]");
  });
});
