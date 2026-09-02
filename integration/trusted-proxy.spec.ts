import { expect, test } from "@playwright/test";

import {
  invalidTrustedProxyError,
  isTrustedProxy,
  MISSING_TRUSTED_PROXY_ERROR,
} from "../src/lib/config/trusted-proxy";
import { buildRateLimitKey, getClientIp } from "../src/lib/rate-limit/request-key";

/**
 * Güvenilir proxy yapılandırması ve IP biçim doğrulaması (Issue #182).
 *
 * NEDEN BU TESTLER VAR: rate limit'in tamamı `getClientIp()`'in ürettiği bucket key'ine
 * dayanır. Bu fonksiyon `x-forwarded-for`'u koşulsuz ve doğrulamasız okuduğu sürece, header'ı
 * yazabilen herhangi biri her istekte yeni bir bucket'a düşüp limiti tamamen etkisiz
 * kılabiliyordu. Buradaki testler iki korumayı da sabitler: (1) header'a güvenilip
 * güvenilmeyeceği açık bir karardır, (2) geçersiz biçimli değerler bucket üretemez.
 */

const mutableEnv = process.env as Record<string, string | undefined>;
const ENV_KEYS = ["NODE_ENV", "TRUSTED_PROXY"] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, mutableEnv[key]]));

/**
 * DİKKAT: Node'da `process.env.X = undefined` değişkeni SİLMEZ — değeri `"undefined"`
 * STRING'ine çevirir ve `isTrustedProxy()` bunu geçersiz değer sayıp fırlatır. Bu spec
 * paylaşılan bir process'te (`workers: 1`) çalıştığından, böyle bir geri yükleme SONRAKİ tüm
 * spec'leri kırardı. (Aynı tuzak: `integration/app-url.spec.ts`.)
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

/** `x-forwarded-for` header'ı ile minimal bir `Request` kurar. */
function requestWithForwardedFor(value?: string): Request {
  const headers = new Headers();
  if (value !== undefined) {
    headers.set("x-forwarded-for", value);
  }
  return new Request("https://app.example.com/api/auth/signup", { method: "POST", headers });
}

test.afterEach(() => {
  restoreEnv();
});

test.describe("isTrustedProxy() — yapılandırma çözümlemesi", () => {
  test("production DIŞINDA varsayılan true'dur", () => {
    delete mutableEnv.TRUSTED_PROXY;
    expect(process.env.NODE_ENV).not.toBe("production");
    expect(isTrustedProxy()).toBe(true);
  });

  test("production'da tanımsızsa hata fırlatır", () => {
    // Sessiz bir varsayılan tam da bu issue'nun engellemek istediği durum: proxy'siz bir
    // deployment "korumalı" görünür, proxy'li bir deployment ise tüm trafiği tek bucket'a
    // sıkıştırırdı. İkisi de sessizce yanlış.
    delete mutableEnv.TRUSTED_PROXY;
    mutableEnv.NODE_ENV = "production";
    expect(() => isTrustedProxy()).toThrow(MISSING_TRUSTED_PROXY_ERROR);
  });

  test("production'da boş string de 'tanımsız' sayılır", () => {
    mutableEnv.NODE_ENV = "production";
    for (const blank of ["", "   "]) {
      mutableEnv.TRUSTED_PROXY = blank;
      expect(() => isTrustedProxy()).toThrow(MISSING_TRUSTED_PROXY_ERROR);
    }
  });

  test("'true' / 'false' değerleri okunur (production dahil)", () => {
    mutableEnv.NODE_ENV = "production";

    mutableEnv.TRUSTED_PROXY = "true";
    expect(isTrustedProxy()).toBe(true);

    mutableEnv.TRUSTED_PROXY = "false";
    expect(isTrustedProxy()).toBe(false);
  });

  test("başka her değer HER ortamda reddedilir", () => {
    // Gevşek ayrıştırma (`value !== "false"`) yazım hatası olan bir yapılandırmayı sessizce
    // "güveniyoruz"a çevirirdi — bu modülün var olma sebebinin tam tersi.
    for (const invalid of ["1", "0", "yes", "TRUE", "False", "on"]) {
      mutableEnv.TRUSTED_PROXY = invalid;
      expect(() => isTrustedProxy()).toThrow(invalidTrustedProxyError(invalid));

      mutableEnv.NODE_ENV = "production";
      expect(() => isTrustedProxy()).toThrow(invalidTrustedProxyError(invalid));
      mutableEnv.NODE_ENV = originalEnv.NODE_ENV;
    }
  });
});

test.describe("getClientIp() — TRUSTED_PROXY=true", () => {
  test.beforeEach(() => {
    mutableEnv.TRUSTED_PROXY = "true";
  });

  test("geçerli IPv4 okunur", () => {
    expect(getClientIp(requestWithForwardedFor("203.0.113.7"))).toBe("203.0.113.7");
  });

  test("geçerli IPv6 okunur", () => {
    expect(getClientIp(requestWithForwardedFor("2001:db8::1"))).toBe("2001:db8::1");
  });

  test("zincirde İLK segment kullanılır ve whitespace temizlenir", () => {
    // Format: `client, proxy1, proxy2, ...`
    expect(getClientIp(requestWithForwardedFor("  203.0.113.7 , 198.51.100.4, 192.0.2.9"))).toBe(
      "203.0.113.7",
    );
  });

  test("geçersiz biçimli değerler ortak 'unknown' bucket'ına düşer", () => {
    // Düzeltme öncesi bunların HER BİRİ ayrı bir bucket key'i üretiyordu.
    const invalidValues = [
      "not-an-ip",
      "test-3f2a1b",
      "aaaa1",
      "999.999.999.999",
      "203.0.113.7.8",
      "<script>",
      "203.0.113.7:8080", // port'lu biçim: bilinen sınır, aşağıdaki nota bak
      "",
      "   ",
    ];

    for (const value of invalidValues) {
      expect(getClientIp(requestWithForwardedFor(value)), `değer: ${value}`).toBe("unknown");
    }
  });

  test("header hiç yoksa 'unknown'", () => {
    expect(getClientIp(requestWithForwardedFor())).toBe("unknown");
  });

  test("geçersiz IP'ler SINIRSIZ bucket üretemez", () => {
    /**
     * Bu, issue'nun asıl kabul kriteri. 1000 farklı uydurma değer, 1000 farklı bucket değil
     * TEK bir bucket üretmeli.
     */
    const keys = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      keys.add(buildRateLimitKey("auth:sign-up", getClientIp(requestWithForwardedFor(`fake-${i}`))));
    }
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe("auth:sign-up:unknown");
  });

  test("KONTROL GRUBU: geçerli IP'ler hâlâ ayrı bucket üretiyor", () => {
    /**
     * Yukarıdaki "tek bucket" iddiası, `getClientIp()`'in her şeyi `unknown` yapmasından da
     * kaynaklanabilirdi. Bu test, meşru istemcilerin hâlâ birbirinden ayrıldığını kanıtlar —
     * yani düzeltme rate limiter'ı topyekûn tek bucket'a çökertmiyor.
     */
    const keys = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const ip = `2001:db8::${i.toString(16)}`;
      keys.add(buildRateLimitKey("auth:sign-up", getClientIp(requestWithForwardedFor(ip))));
    }
    expect(keys.size).toBe(1000);
  });
});

test.describe("getClientIp() — TRUSTED_PROXY=false", () => {
  test.beforeEach(() => {
    mutableEnv.TRUSTED_PROXY = "false";
  });

  test("geçerli bir IP gönderilse bile header YOK SAYILIR", () => {
    // Proxy yoksa header'ı istemcinin kendisi yazıyordur; okumak, saldırgana kendi bucket'ını
    // seçme hakkı vermek demektir.
    expect(getClientIp(requestWithForwardedFor("203.0.113.7"))).toBe("unknown");
    expect(getClientIp(requestWithForwardedFor("2001:db8::1"))).toBe("unknown");
  });

  test("farklı IP'ler bucket'ı DEĞİŞTİREMEZ — hepsi tek bucket'ı paylaşır", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const ip = `203.0.113.${i % 256}`;
      keys.add(buildRateLimitKey("auth:forgot-password", getClientIp(requestWithForwardedFor(ip))));
    }
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe("auth:forgot-password:unknown");
  });

  test("DUYARLILIK: aynı girdiler TRUSTED_PROXY=true iken 100 ayrı bucket üretiyor", () => {
    /**
     * Yukarıdaki testin gerçekten `TRUSTED_PROXY=false`'u ölçtüğünün kanıtı. Bu olmasaydı,
     * "tek bucket" sonucu IP'lerin geçersiz olmasından da kaynaklanabilirdi.
     */
    mutableEnv.TRUSTED_PROXY = "true";
    const keys = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const ip = `203.0.113.${i % 256}`;
      keys.add(buildRateLimitKey("auth:forgot-password", getClientIp(requestWithForwardedFor(ip))));
    }
    expect(keys.size).toBe(100);
  });
});

test.describe("Test yardımcısı gerçekten geçerli IP üretiyor", () => {
  test("uniqueTestClientIp() değerleri getClientIp() tarafından kabul edilir", async () => {
    /**
     * `e2e/support/rate-limit.ts` eskiden `test-<uuid>` üretiyordu — biçim doğrulaması
     * eklendiğinde bu değerlerin hepsi `unknown`'a düşerdi ve ~20 test dosyası birbirinin
     * bucket'ını tüketmeye başlardı. Bu test, helper ile doğrulayıcının ayrışmasını engeller.
     */
    const { uniqueTestClientIp } = await import("../e2e/support/rate-limit");
    mutableEnv.TRUSTED_PROXY = "true";

    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const ip = uniqueTestClientIp();
      expect(getClientIp(requestWithForwardedFor(ip)), `helper IP: ${ip}`).toBe(ip);
      seen.add(ip);
    }
    // Benzersizlik de korunmalı: helper'ın tek amacı buydu.
    expect(seen.size).toBe(200);
  });
});
