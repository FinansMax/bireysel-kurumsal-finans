import { expect, test } from "@playwright/test";

import {
  buildSentryOptions,
  getSentryDsn,
} from "../src/lib/observability/sentry-config";
import { scrubEvent, stripQueryString } from "../src/lib/observability/sentry-scrub";

/**
 * Sentry'ye giden olayların temizlenmesi (Issue #183).
 *
 * NEDEN BU TESTLER VAR: hata raporları ÜÇÜNCÜ BİR TARAFA gider ve en az audit log kadar
 * hassastır. `sendDefaultPii: false` çoğu şeyi engeller ama uygulama kodunun kendi eklediği
 * alanları ve mesajlara gömülü URL'leri kapsamaz. Bu dosya, ikinci savunma katmanının
 * gerçekten çalıştığını sabitler — özellikle raw token taşıyan linklerin kırpıldığını.
 *
 * Testler `@sentry/nextjs` IMPORT ETMEZ ve DSN gerektirmez: temizleme mantığı saf
 * fonksiyonlardadır, bu yüzden Sentry hiç yapılandırılmamışken bile doğrulanabilir.
 */

const mutableEnv = process.env as Record<string, string | undefined>;
const originalDsn = mutableEnv.SENTRY_DSN;

test.afterEach(() => {
  if (originalDsn === undefined) {
    delete mutableEnv.SENTRY_DSN;
  } else {
    mutableEnv.SENTRY_DSN = originalDsn;
  }
});

test.describe("stripQueryString()", () => {
  test("raw token taşıyan linklerin sorgu dizesi ATILIR", () => {
    /**
     * Şifre sıfırlama, davet ve e-posta doğrulama linklerinin hepsi token'ı `?token=` içinde
     * taşır. Bir hata raporunda tam URL, o token'ı Sentry'yi görebilen herkese verir.
     */
    expect(stripQueryString("https://app.example.com/reset-password?token=abc123")).toBe(
      "https://app.example.com/reset-password",
    );
    expect(stripQueryString("https://app.example.com/invitations/accept?token=xyz")).toBe(
      "https://app.example.com/invitations/accept",
    );
    expect(stripQueryString("https://app.example.com/verify-email?token=q1w2")).toBe(
      "https://app.example.com/verify-email",
    );
  });

  test("fragment de atılır ve sorgusuz URL bozulmaz", () => {
    expect(stripQueryString("https://app.example.com/x#token=abc")).toBe(
      "https://app.example.com/x",
    );
    expect(stripQueryString("https://app.example.com/dashboard")).toBe(
      "https://app.example.com/dashboard",
    );
    expect(stripQueryString("")).toBe("");
  });

  test("SORGU DİZESİNİN TAMAMI atılır, yalnızca token parametresi değil", () => {
    // Hangi parametrenin hassas olduğunu tek tek saymak, ileride eklenen birini unutmaktır.
    expect(stripQueryString("https://app.example.com/x?page=2&token=abc&q=deneme")).toBe(
      "https://app.example.com/x",
    );
  });
});

test.describe("scrubEvent() — istek verisi", () => {
  test("cookie, authorization ve x-forwarded-for başlıkları ATILIR", () => {
    const event = scrubEvent({
      request: {
        url: "https://app.example.com/api/tenants?token=secret",
        headers: {
          Cookie: "authjs.session-token=eyJ...",
          Authorization: "Bearer super-secret",
          "X-Forwarded-For": "203.0.113.7",
          "user-agent": "Mozilla/5.0",
        },
        cookies: { "authjs.session-token": "eyJ..." },
        query_string: "token=secret",
      },
    });

    const raw = JSON.stringify(event);
    // Bir session cookie'si, hata raporunu görebilen herkese hesap devri imkânı verir.
    expect(raw).not.toContain("eyJ...");
    expect(raw).not.toContain("super-secret");
    expect(raw).not.toContain("203.0.113.7");
    expect(raw).not.toContain("token=secret");

    // Zararsız bağlam KORUNUR — aksi halde hata ayıklama imkânsız olurdu.
    expect(event.request?.headers?.["user-agent"]).toBe("Mozilla/5.0");
    expect(event.request?.url).toBe("https://app.example.com/api/tenants");
  });

  test("istek gövdesi sanitizeMetadata'dan geçer", () => {
    const event = scrubEvent({
      request: { data: { email: "a@b.com", password: "hunter2", token: "raw-token" } },
    });

    const raw = JSON.stringify(event);
    expect(raw).not.toContain("hunter2");
    expect(raw).not.toContain("raw-token");
  });
});

test.describe("scrubEvent() — extra ve contexts", () => {
  test("uygulama kodunun eklediği hassas alanlar redakte edilir", () => {
    /**
     * `sendDefaultPii: false` bu alanları KAPSAMAZ — ikinci savunma katmanının var olma
     * sebebi tam olarak budur.
     */
    const event = scrubEvent({
      extra: { resetToken: "abc", nested: { secret: "s3cr3t", safe: "ok" } },
      contexts: { custom: { apiKey: "re_live_123" } },
    });

    const raw = JSON.stringify(event);
    expect(raw).not.toContain("s3cr3t");
    expect(raw).not.toContain("re_live_123");
    // Hassas olmayan alan korunur.
    expect(raw).toContain("ok");
  });

  test("breadcrumb mesajlarındaki URL'ler de kırpılır", () => {
    const event = scrubEvent({
      breadcrumbs: [
        { message: "GET https://app.example.com/verify-email?token=leak", data: { password: "x" } },
      ],
    });

    const raw = JSON.stringify(event);
    expect(raw).not.toContain("token=leak");
    expect(raw).not.toContain('"x"');
  });

  test("boş/ilgisiz olay bozulmaz", () => {
    expect(scrubEvent({ message: "boom" })).toEqual({ message: "boom" });
  });
});

test.describe("getSentryDsn() / buildSentryOptions()", () => {
  test("DSN yoksa null döner — SDK hiç başlatılmaz", () => {
    // Issue #183: lokal geliştirme ve testler SDK'nın global hook'larından bile etkilenmemeli.
    delete mutableEnv.SENTRY_DSN;
    expect(getSentryDsn()).toBeNull();

    mutableEnv.SENTRY_DSN = "   ";
    expect(getSentryDsn()).toBeNull();
  });

  test("DSN varsa okunur", () => {
    mutableEnv.SENTRY_DSN = "https://abc@o1.ingest.sentry.io/2";
    expect(getSentryDsn()).toBe("https://abc@o1.ingest.sentry.io/2");
  });

  test("sendDefaultPii DAİMA false ve performans izleme kapalı", () => {
    const options = buildSentryOptions("https://abc@o1.ingest.sentry.io/2");

    // Bu iki değer bir güvenlik/maliyet kararıdır; değişirlerse test kırmızıya döner.
    expect(options.sendDefaultPii).toBe(false);
    expect(options.tracesSampleRate).toBe(0);
  });

  test("beforeSend gerçekten temizliyor (bağlanma noktası kanıtı)", () => {
    /**
     * Yukarıdaki `scrubEvent` testleri fonksiyonun kendisini doğrular; bu test onun
     * Sentry seçeneklerine GERÇEKTEN bağlandığını doğrular. İkisi ayrı iddialardır: biri
     * doğru çalışan ama hiç çağrılmayan bir temizleyici, hiç yokmuş gibidir.
     */
    const options = buildSentryOptions("https://abc@o1.ingest.sentry.io/2");
    const cleaned = options.beforeSend({
      request: { url: "https://app.example.com/reset-password?token=leaked" },
    });

    expect(JSON.stringify(cleaned)).not.toContain("leaked");
  });
});
