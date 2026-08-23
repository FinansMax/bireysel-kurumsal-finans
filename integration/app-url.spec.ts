import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  DEFAULT_DEV_BASE_URL,
  getAppBaseUrl,
  INVALID_APP_BASE_URL_ERROR,
  MISSING_APP_BASE_URL_ERROR,
} from "../src/lib/config/app-url";
import { registerUser } from "../src/lib/auth/signup";
import { requestPasswordReset } from "../src/lib/auth/password-reset";
import { prisma } from "../src/lib/prisma";

/**
 * `APP_BASE_URL` çözümlemesi.
 *
 * Bu değişken kullanıcıya E-POSTA ile gönderilen mutlak linkleri üretir. Önceki davranış,
 * değişken yoksa sessizce `http://localhost:3000`'e düşmekti — yani production'da gönderilen
 * her şifre sıfırlama / davet linki çalışmaz hale geliyordu ve bu HİÇBİR hata üretmediği için
 * fark edilmiyordu. Bu testler yeni "production'da gürültülü başarısızlık" davranışını ve
 * bunun user enumeration'a kapı açmadığını doğrular.
 */

const mutableEnv = process.env as Record<string, string | undefined>;
const originalNodeEnv = mutableEnv.NODE_ENV;
const originalAppBaseUrl = mutableEnv.APP_BASE_URL;

/**
 * DİKKAT: Node'da `process.env.X = undefined` değişkeni SİLMEZ — değeri `"undefined"`
 * STRING'ine çevirir. Bu spec paylaşılan bir process'te (workers: 1) çalıştığı için, böyle
 * bir "geri yükleme" sonraki spec'lere bozuk bir `APP_BASE_URL` bırakır ve onları kırar.
 * Bu yüzden geri yükleme her zaman bu yardımcı üzerinden yapılır.
 */
function restoreEnv(key: string, original: string | undefined): void {
  if (original === undefined) {
    delete mutableEnv[key];
  } else {
    mutableEnv[key] = original;
  }
}

function restoreAllEnv(): void {
  restoreEnv("NODE_ENV", originalNodeEnv);
  restoreEnv("APP_BASE_URL", originalAppBaseUrl);
}

test.afterEach(() => {
  restoreAllEnv();
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe("getAppBaseUrl() — değer ayarlıysa", () => {
  test("ayarlı değeri kullanır", () => {
    mutableEnv.APP_BASE_URL = "https://app.example.com";
    expect(getAppBaseUrl()).toBe("https://app.example.com");
  });

  test("sondaki eğik çizgiler atılır (çift slash'lı link üretilmez)", () => {
    mutableEnv.APP_BASE_URL = "https://app.example.com///";
    expect(getAppBaseUrl()).toBe("https://app.example.com");

    // Gerçek kullanım biçimi: `${baseUrl}/reset-password` tek slash üretmeli.
    expect(`${getAppBaseUrl()}/reset-password`).toBe("https://app.example.com/reset-password");
  });

  test("production'da ayarlıysa hata fırlatmaz", () => {
    mutableEnv.NODE_ENV = "production";
    mutableEnv.APP_BASE_URL = "https://app.example.com";
    expect(getAppBaseUrl()).toBe("https://app.example.com");
  });

  test("geçersiz değer HER ortamda reddedilir", () => {
    for (const invalid of ["app.example.com", "ftp://app.example.com", "javascript:alert(1)", "/relative"]) {
      mutableEnv.APP_BASE_URL = invalid;
      expect(() => getAppBaseUrl()).toThrow(INVALID_APP_BASE_URL_ERROR);
    }
  });
});

test.describe("getAppBaseUrl() — değer yoksa", () => {
  test("production DIŞINDA localhost varsayılanına düşer", () => {
    delete mutableEnv.APP_BASE_URL;
    expect(process.env.NODE_ENV).not.toBe("production");
    expect(getAppBaseUrl()).toBe(DEFAULT_DEV_BASE_URL);
  });

  test("production'da hata fırlatır (sessizce localhost linki ÜRETMEZ)", () => {
    mutableEnv.NODE_ENV = "production";
    delete mutableEnv.APP_BASE_URL;

    expect(() => getAppBaseUrl()).toThrow(MISSING_APP_BASE_URL_ERROR);
  });

  test("boş/whitespace değer 'ayarlanmamış' sayılır", () => {
    mutableEnv.NODE_ENV = "production";
    for (const blank of ["", "   "]) {
      mutableEnv.APP_BASE_URL = blank;
      expect(() => getAppBaseUrl()).toThrow(MISSING_APP_BASE_URL_ERROR);
    }
  });
});

test.describe("Yapılandırma hatası user enumeration oracle'ı YARATMAZ", () => {
  /**
   * KRİTİK regresyon koruması: `getAppBaseUrl()` kullanıcı DB'den okunduktan SONRA çağrılsaydı,
   * yanlış yapılandırılmış bir production ortamında kayıtlı e-posta hata (500), kayıtsız
   * e-posta ise normal yanıt (200) üretirdi — Issue #7'de kapatılan user-enumeration oracle'ı
   * geri gelirdi. Bu test, iki durumun da AYNI şekilde başarısız olduğunu doğrular.
   */
  test("kayıtlı ve kayıtsız e-posta, yanlış yapılandırmada AYNI hatayı verir", async () => {
    const registeredEmail = `app-url-${randomUUID()}@example.com`;
    const result = await registerUser({ email: registeredEmail, password: "S3curePassw0rd!" });
    if (!result.ok) throw new Error("test setup failed: registerUser");

    try {
      mutableEnv.NODE_ENV = "production";
      delete mutableEnv.APP_BASE_URL;

      const registeredError = await requestPasswordReset(registeredEmail).catch((e: Error) => e);
      const unknownError = await requestPasswordReset(
        `nobody-${randomUUID()}@example.com`,
      ).catch((e: Error) => e);

      expect(registeredError).toBeInstanceOf(Error);
      expect(unknownError).toBeInstanceOf(Error);
      expect((registeredError as Error).message).toBe((unknownError as Error).message);
    } finally {
      restoreEnv("NODE_ENV", originalNodeEnv);
      restoreEnv("APP_BASE_URL", originalAppBaseUrl);
      await prisma.user.deleteMany({ where: { email: registeredEmail } });
    }
  });

  test("hata, hiçbir token DB'ye yazılmadan önce oluşur", async () => {
    const email = `app-url-notoken-${randomUUID()}@example.com`;
    const result = await registerUser({ email, password: "S3curePassw0rd!" });
    if (!result.ok) throw new Error("test setup failed: registerUser");

    try {
      mutableEnv.NODE_ENV = "production";
      delete mutableEnv.APP_BASE_URL;

      await expect(requestPasswordReset(email)).rejects.toThrow(MISSING_APP_BASE_URL_ERROR);

      restoreEnv("NODE_ENV", originalNodeEnv);
      restoreEnv("APP_BASE_URL", originalAppBaseUrl);

      // Yarım kalmış bir reset token'ı oluşmamış olmalı.
      const tokens = await prisma.passwordResetToken.count({
        where: { userId: result.user.id },
      });
      expect(tokens).toBe(0);
    } finally {
      restoreEnv("NODE_ENV", originalNodeEnv);
      restoreEnv("APP_BASE_URL", originalAppBaseUrl);
      await prisma.user.deleteMany({ where: { email } });
    }
  });
});
