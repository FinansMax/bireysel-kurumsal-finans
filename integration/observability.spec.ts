import { expect, test } from "@playwright/test";

import { logger } from "../src/lib/observability/logger";
import { REQUEST_ID_HEADER, resolveRequestId } from "../src/lib/observability/request-id";

/**
 * Yapılandırılmış loglama ve istek kimliği (Issue #183).
 *
 * NEDEN BU TESTLER VAR: log satırının ŞEKLİ bir sözleşmedir. İleride bir log platformuna
 * yönlendirildiğinde alan bazlı arama ("şu tenant'ta son bir saatte hata alan istekler") ancak
 * satırlar makine okunabilir kaldığı sürece mümkündür. Biri "okunması kolay olsun" diye düz
 * metne dönerse bu testler kırmızıya döner.
 */

function captureConsole() {
  const originalLog = console.log;
  const originalError = console.error;
  const out: string[] = [];
  const err: string[] = [];
  console.log = (...args: unknown[]) => out.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => err.push(args.map(String).join(" "));
  return {
    out,
    err,
    restore() {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}

test.describe("logger — satır şekli", () => {
  test("her satır tek bir JSON nesnesidir", () => {
    const capture = captureConsole();
    try {
      logger.info("something happened", { requestId: "abc", route: "/api/tenants" });
    } finally {
      capture.restore();
    }

    expect(capture.out).toHaveLength(1);
    const parsed = JSON.parse(capture.out[0]) as Record<string, unknown>;
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("something happened");
    expect(parsed.requestId).toBe("abc");
    expect(parsed.route).toBe("/api/tenants");
    expect(typeof parsed.time).toBe("string");
  });

  test("error seviyesi stderr'e, diğerleri stdout'a yazar", () => {
    /**
     * Log toplayıcıların uyarı/hata filtrelemesi bu ayrıma dayanır; tek akışa yazmak
     * alarmlamayı imkânsız kılardı.
     */
    const capture = captureConsole();
    try {
      logger.error("boom");
      logger.warn("careful");
      logger.info("fyi");
      logger.debug("details");
    } finally {
      capture.restore();
    }

    expect(capture.err).toHaveLength(1);
    expect(JSON.parse(capture.err[0]).level).toBe("error");
    expect(capture.out).toHaveLength(3);
  });

  test("bağlam alanları verilmezse satıra hiç yazılmaz (gürültü yok)", () => {
    const capture = captureConsole();
    try {
      logger.info("bare");
    } finally {
      capture.restore();
    }

    const parsed = JSON.parse(capture.out[0]) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["level", "msg", "time"]);
  });
});

test.describe("resolveRequestId()", () => {
  test("geçerli bir gelen id KORUNUR (proxy'nin id'siyle bağ kurulabilsin)", () => {
    // Ezmek, uygulamanın ve proxy'nin loglarını birbirine bağlamayı imkânsız kılardı.
    expect(resolveRequestId("req-12345_ABC.def")).toBe("req-12345_ABC.def");
  });

  test("id yoksa üretilir", () => {
    const generated = resolveRequestId(null);
    expect(generated).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId(undefined)).not.toBe(generated);
  });

  test("LOG INJECTION denemesi yok sayılır ve yeni id üretilir", () => {
    /**
     * Bu değer log satırlarına yazılıyor. Doğrulamasız kabul etmek, saldırganın satır sonu
     * enjekte edip sahte log kaydı üretmesine izin verirdi.
     */
    for (const hostile of [
      'evil"\n{"level":"info","msg":"fake"}',
      "with space",
      "a".repeat(129),
      "",
      "semi;colon",
    ]) {
      const resolved = resolveRequestId(hostile);
      expect(resolved, `reddedilmeliydi: ${hostile.slice(0, 20)}`).not.toBe(hostile);
      expect(resolved).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  test("başlık adı sabit", () => {
    expect(REQUEST_ID_HEADER).toBe("x-request-id");
  });
});
