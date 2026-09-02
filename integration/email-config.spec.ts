import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { consoleEmailSender, getEmailSender, resendEmailSender } from "../src/lib/auth/email";
import { requestPasswordReset } from "../src/lib/auth/password-reset";
import { registerUser } from "../src/lib/auth/signup";
import {
  CONSOLE_PROVIDER_IN_PRODUCTION_ERROR,
  EMAIL_PROVIDERS,
  MISSING_EMAIL_API_KEY_ERROR,
  MISSING_EMAIL_FROM_ERROR,
  resolveEmailConfig,
  unknownEmailProviderError,
} from "../src/lib/config/email";
import { prisma } from "../src/lib/prisma";
import {
  consoleInvitationSender,
  getInvitationSender,
  resendInvitationSender,
} from "../src/lib/tenants/invitation-email";

/**
 * E-posta sağlayıcısı yapılandırması (Issue #180).
 *
 * NEDEN BU TESTLER VAR: bu değişkenler yanlışsa sistem "çalışıyor" görünür ama hiçbir şifre
 * sıfırlama e-postası gitmez — kullanıcı hesabına giremez ve biz hiçbir hata görmediğimiz için
 * durumu fark etmeyiz. `APP_BASE_URL`'de yaşanan tam olarak buydu (bkz. `integration/
 * app-url.spec.ts`); aynı sessiz başarısızlık sınıfını e-posta sağlayıcısı için de kapatıyoruz.
 */

const mutableEnv = process.env as Record<string, string | undefined>;
const ENV_KEYS = ["NODE_ENV", "APP_BASE_URL", "EMAIL_PROVIDER", "EMAIL_API_KEY", "EMAIL_FROM"] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, mutableEnv[key]]));

/**
 * DİKKAT: Node'da `process.env.X = undefined` değişkeni SİLMEZ — değeri `"undefined"`
 * STRING'ine çevirir. Bu spec paylaşılan bir process'te (`workers: 1`) çalıştığı için böyle
 * bir "geri yükleme" sonraki spec'lere bozuk bir ortam bırakırdı. (Aynı tuzak ve aynı çözüm:
 * `integration/app-url.spec.ts`.)
 */
function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const original = originalEnv[key];
    if (original === undefined) {
      delete mutableEnv[key];
    } else {
      mutableEnv[key] = original;
    }
  }
}

/** Testin kendi senaryosunu kurmadan önce ortamı bilinen bir başlangıca çeker. */
function clearEmailEnv(): void {
  delete mutableEnv.EMAIL_PROVIDER;
  delete mutableEnv.EMAIL_API_KEY;
  delete mutableEnv.EMAIL_FROM;
}

test.afterEach(() => {
  restoreEnv();
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe("resolveEmailConfig() — production DIŞINDA", () => {
  test("değişken yoksa console'a düşer", () => {
    clearEmailEnv();
    expect(process.env.NODE_ENV).not.toBe("production");
    expect(resolveEmailConfig()).toEqual({ provider: EMAIL_PROVIDERS.CONSOLE });
  });

  test("açıkça console yazılmışsa console döner", () => {
    clearEmailEnv();
    mutableEnv.EMAIL_PROVIDER = "console";
    expect(resolveEmailConfig()).toEqual({ provider: EMAIL_PROVIDERS.CONSOLE });
  });

  test("boş/whitespace değer 'ayarlanmamış' sayılır", () => {
    clearEmailEnv();
    for (const blank of ["", "   "]) {
      mutableEnv.EMAIL_PROVIDER = blank;
      expect(resolveEmailConfig()).toEqual({ provider: EMAIL_PROVIDERS.CONSOLE });
    }
  });
});

test.describe("resolveEmailConfig() — production'da console REDDEDİLİR", () => {
  /**
   * Issue #180'in çekirdek kabul kriteri. `APP_BASE_URL` ile aynı duruş: yanlış
   * yapılandırılmış production sessizce tolere edilmez.
   */
  test("değişken yoksa hata fırlatır", () => {
    clearEmailEnv();
    mutableEnv.NODE_ENV = "production";
    expect(() => resolveEmailConfig()).toThrow(CONSOLE_PROVIDER_IN_PRODUCTION_ERROR);
  });

  test("açıkça console yazılmışsa da hata fırlatır", () => {
    clearEmailEnv();
    mutableEnv.NODE_ENV = "production";
    mutableEnv.EMAIL_PROVIDER = "console";
    expect(() => resolveEmailConfig()).toThrow(CONSOLE_PROVIDER_IN_PRODUCTION_ERROR);
  });

  test("gerçek sağlayıcı tam yapılandırılmışsa production'da hata YOK (kontrol grubu)", () => {
    clearEmailEnv();
    mutableEnv.NODE_ENV = "production";
    mutableEnv.EMAIL_PROVIDER = "resend";
    mutableEnv.EMAIL_API_KEY = "re_test_key";
    mutableEnv.EMAIL_FROM = "FinansMax <no-reply@example.com>";

    // Kontrol grubu: yukarıdaki hatalar "production'da her şey patlıyor"dan DEĞİL, gerçekten
    // console sağlayıcısından kaynaklanıyor.
    expect(resolveEmailConfig()).toEqual({
      provider: EMAIL_PROVIDERS.RESEND,
      apiKey: "re_test_key",
      from: "FinansMax <no-reply@example.com>",
    });
  });
});

test.describe("resolveEmailConfig() — eksik/hatalı sağlayıcı yapılandırması", () => {
  test("tanınmayan sağlayıcı adı HER ortamda reddedilir", () => {
    clearEmailEnv();
    // Yazım hatası olan bir production yapılandırması sessizce console'a düşerse fark edilmez.
    mutableEnv.EMAIL_PROVIDER = "resned";
    expect(() => resolveEmailConfig()).toThrow(unknownEmailProviderError("resned"));

    mutableEnv.NODE_ENV = "production";
    expect(() => resolveEmailConfig()).toThrow(unknownEmailProviderError("resned"));
  });

  test("resend seçiliyken API key yoksa hata fırlatır", () => {
    clearEmailEnv();
    mutableEnv.EMAIL_PROVIDER = "resend";
    mutableEnv.EMAIL_FROM = "FinansMax <no-reply@example.com>";
    expect(() => resolveEmailConfig()).toThrow(MISSING_EMAIL_API_KEY_ERROR);
  });

  test("resend seçiliyken EMAIL_FROM yoksa hata fırlatır", () => {
    clearEmailEnv();
    mutableEnv.EMAIL_PROVIDER = "resend";
    mutableEnv.EMAIL_API_KEY = "re_test_key";
    expect(() => resolveEmailConfig()).toThrow(MISSING_EMAIL_FROM_ERROR);
  });

  test("hata mesajları API key'i SIZDIRMAZ", () => {
    clearEmailEnv();
    const secret = `re_secret_${randomUUID()}`;
    mutableEnv.EMAIL_PROVIDER = "resend";
    mutableEnv.EMAIL_API_KEY = secret;
    // EMAIL_FROM eksik → hata fırlar.

    const error = (() => {
      try {
        resolveEmailConfig();
        return null;
      } catch (e) {
        return e as Error;
      }
    })();

    expect(error).toBeInstanceOf(Error);
    // Hata mesajları loglara ve bazen hata izleme servisine gider; API key oraya girmemeli.
    expect(error!.message).not.toContain(secret);
    expect(`${error!.stack ?? ""}`).not.toContain(secret);
  });
});

test.describe("Sender seçimi yapılandırmayı izler", () => {
  test("console yapılandırmasında console sender'lar seçilir", () => {
    clearEmailEnv();
    expect(getEmailSender()).toBe(consoleEmailSender);
    expect(getInvitationSender()).toBe(consoleInvitationSender);
  });

  test("resend yapılandırmasında resend sender'lar seçilir", () => {
    clearEmailEnv();
    mutableEnv.EMAIL_PROVIDER = "resend";
    mutableEnv.EMAIL_API_KEY = "re_test_key";
    mutableEnv.EMAIL_FROM = "FinansMax <no-reply@example.com>";

    expect(getEmailSender()).toBe(resendEmailSender);
    expect(getInvitationSender()).toBe(resendInvitationSender);
  });
});

test.describe("Yapılandırma hatası user enumeration oracle'ı YARATMAZ", () => {
  /**
   * `integration/app-url.spec.ts`'teki aynı regresyon koruması, bu kez e-posta yapılandırması
   * için. `getEmailSender()` kullanıcı DB'den okunduktan SONRA çağrılsaydı, yanlış
   * yapılandırılmış bir production'da kayıtlı e-posta 500, kayıtsız e-posta 200 üretirdi.
   */
  test("kayıtlı ve kayıtsız e-posta, yanlış yapılandırmada AYNI hatayı verir", async () => {
    const registeredEmail = `email-config-${randomUUID()}@example.com`;
    const result = await registerUser({ email: registeredEmail, password: "S3curePassw0rd!" });
    if (!result.ok) throw new Error("test setup failed: registerUser");

    try {
      // APP_BASE_URL geçerli bırakılır ki hata GERÇEKTEN e-posta yapılandırmasından gelsin.
      mutableEnv.APP_BASE_URL = "https://app.example.com";
      mutableEnv.NODE_ENV = "production";
      clearEmailEnv();

      const registeredError = await requestPasswordReset(registeredEmail).catch((e: Error) => e);
      const unknownError = await requestPasswordReset(
        `nobody-${randomUUID()}@example.com`,
      ).catch((e: Error) => e);

      expect(registeredError).toBeInstanceOf(Error);
      expect(unknownError).toBeInstanceOf(Error);
      expect((registeredError as Error).message).toBe((unknownError as Error).message);
      expect((registeredError as Error).message).toBe(CONSOLE_PROVIDER_IN_PRODUCTION_ERROR);
    } finally {
      restoreEnv();
      await prisma.user.deleteMany({ where: { email: registeredEmail } });
    }
  });

  test("hata, hiçbir token DB'ye yazılmadan önce oluşur", async () => {
    const email = `email-config-notoken-${randomUUID()}@example.com`;
    const result = await registerUser({ email, password: "S3curePassw0rd!" });
    if (!result.ok) throw new Error("test setup failed: registerUser");

    try {
      mutableEnv.APP_BASE_URL = "https://app.example.com";
      mutableEnv.NODE_ENV = "production";
      clearEmailEnv();

      await expect(requestPasswordReset(email)).rejects.toThrow(
        CONSOLE_PROVIDER_IN_PRODUCTION_ERROR,
      );

      restoreEnv();

      // Yarım kalmış bir reset token'ı oluşmamış olmalı.
      const tokens = await prisma.passwordResetToken.count({ where: { userId: result.user.id } });
      expect(tokens).toBe(0);
    } finally {
      restoreEnv();
      await prisma.user.deleteMany({ where: { email } });
    }
  });
});
