import { expect, test } from "@playwright/test";

import {
  MISSING_REDIS_CREDENTIALS_ERROR,
  RATE_LIMIT_STORES,
  resolveRateLimitStore,
  unknownRateLimitStoreError,
} from "../src/lib/config/rate-limit-store";
import { RedisRateLimiter, type RedisCommandRunner } from "../src/lib/rate-limit/redis-rate-limiter";

/**
 * Paylaşılan (distributed) rate limiter (Issue #181).
 *
 * NE TEST EDİLİYOR, NE EDİLMİYOR — DÜRÜST SINIR:
 *
 * Bu testler gerçek bir Upstash hesabı GEREKTİRMEZ ve dolayısıyla Lua script'inin Redis
 * içindeki davranışını (sliding-window'un gerçekten kayması, `ZADD`'in gerçekten yazması)
 * DOĞRULAYAMAZ. Doğrulanan şey, bu sınıfın kendi sözleşmesidir:
 *
 * 1. TEK bir round-trip yapılıyor mu — atomiklik iddiasının doğrudan kanıtı. "Oku → hesapla →
 *    yaz" üç ayrı çağrıya bölünseydi, eşzamanlı istekler limiti aşabilirdi (TOCTOU).
 * 2. Script'e doğru argümanlar gidiyor mu.
 * 3. Store'un yanıtı `RateLimitResult`'a doğru çevriliyor mu.
 * 4. Store erişilemezken FAIL-OPEN davranılıyor mu (kayda geçmiş karar).
 *
 * Lua semantiğinin uçtan uca doğrulanması gerçek bir Redis gerektirir; bu, credential
 * sağlandıktan sonra yapılacak manuel/entegrasyon doğrulamasıdır (bkz. PR açıklaması).
 */

const mutableEnv = process.env as Record<string, string | undefined>;
const ENV_KEYS = [
  "RATE_LIMIT_STORE",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, mutableEnv[key]]));

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

function clearEnv(): void {
  for (const key of ENV_KEYS) delete mutableEnv[key];
}

test.afterEach(() => {
  restoreEnv();
});

/** Komutları kaydeden ve sabit bir yanıt döndüren taşıyıcı. */
function recordingRunner(response: unknown) {
  const calls: (readonly string[])[] = [];
  const runner: RedisCommandRunner = async (command) => {
    calls.push(command);
    return response;
  };
  return { calls, runner };
}

function limiterWith(runner: RedisCommandRunner, now = 1_000_000) {
  return new RedisRateLimiter({
    restUrl: "https://example.upstash.io",
    restToken: "test-token",
    runCommand: runner,
    now: () => now,
  });
}

test.describe("resolveRateLimitStore()", () => {
  test("değişken yoksa memory'ye düşer (bugünkü davranış korunur)", () => {
    clearEnv();
    expect(resolveRateLimitStore()).toEqual({ store: RATE_LIMIT_STORES.MEMORY });
  });

  test("tanınmayan değer HER ortamda reddedilir", () => {
    // `RATE_LIMIT_STORE=rediss` gibi bir yazım hatasının sessizce in-memory'ye düşmesi, tam da
    // bu issue'nun kapatmak istediği "koruma var sanılıyor ama yok" durumudur.
    clearEnv();
    mutableEnv.RATE_LIMIT_STORE = "rediss";
    expect(() => resolveRateLimitStore()).toThrow(unknownRateLimitStoreError("rediss"));
  });

  test("redis seçiliyken credential eksikse FIRLATIR, sessizce memory'ye düşmez", () => {
    clearEnv();
    mutableEnv.RATE_LIMIT_STORE = "redis";
    expect(() => resolveRateLimitStore()).toThrow(MISSING_REDIS_CREDENTIALS_ERROR);

    mutableEnv.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    expect(() => resolveRateLimitStore()).toThrow(MISSING_REDIS_CREDENTIALS_ERROR);
  });

  test("credential tamsa redis yapılandırması döner", () => {
    clearEnv();
    mutableEnv.RATE_LIMIT_STORE = "redis";
    mutableEnv.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    mutableEnv.UPSTASH_REDIS_REST_TOKEN = "token";

    expect(resolveRateLimitStore()).toEqual({
      store: RATE_LIMIT_STORES.REDIS,
      restUrl: "https://example.upstash.io",
      restToken: "token",
    });
  });
});

test.describe("RedisRateLimiter — atomiklik sözleşmesi", () => {
  test("TEK bir komut gönderir (oku/hesapla/yaz bölünmez)", async () => {
    /**
     * Bu testin tamamı bir güvenlik iddiasıdır: mantık üç ayrı çağrıya bölünürse eşzamanlı
     * istekler limiti aşar. Komut sayısı 1'den büyükse implementasyon atomikliğini kaybetmiştir.
     */
    const { calls, runner } = recordingRunner([1, 1, 0]);
    await limiterWith(runner).consume({ key: "auth:sign-in:203.0.113.7", limit: 5, windowMs: 60_000 });

    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("EVAL");
  });

  test("script'e doğru KEYS/ARGV gider", async () => {
    const { calls, runner } = recordingRunner([1, 1, 0]);
    await limiterWith(runner, 1_700_000_000_000).consume({
      key: "auth:sign-up:198.51.100.4",
      limit: 5,
      windowMs: 600_000,
    });

    const [command, script, numKeys, key, now, windowMs, limit, member] = calls[0];
    expect(command).toBe("EVAL");
    expect(script).toContain("ZREMRANGEBYSCORE");
    expect(script).toContain("ZCARD");
    expect(script).toContain("ZADD");
    expect(numKeys).toBe("1");
    expect(key).toBe("auth:sign-up:198.51.100.4");
    expect(now).toBe("1700000000000");
    expect(windowMs).toBe("600000");
    expect(limit).toBe("5");
    // Üye adı benzersiz olmalı: aynı ms'deki iki istek aynı üye adını paylaşsaydı `ZADD`
    // ikincisini yeni giriş saymaz, üzerine yazardı — iki istek bir sayılır, limit gevşerdi.
    expect(member).toContain("1700000000000-");
  });

  test("aynı milisaniyedeki iki çağrı FARKLI üye adı üretir", async () => {
    const { calls, runner } = recordingRunner([1, 1, 0]);
    const limiter = limiterWith(runner, 1_700_000_000_000);

    await limiter.consume({ key: "k", limit: 5, windowMs: 60_000 });
    await limiter.consume({ key: "k", limit: 5, windowMs: 60_000 });

    expect(calls[0][7]).not.toBe(calls[1][7]);
  });
});

test.describe("RedisRateLimiter — yanıt çevrimi", () => {
  test("izin verildiğinde kalan hak doğru hesaplanır", async () => {
    // Script: [allowed, count, oldest] — count, bu istek DAHİL pencere içindeki sayı.
    const { runner } = recordingRunner([1, 2, 0]);
    const result = await limiterWith(runner).consume({ key: "k", limit: 5, windowMs: 60_000 });

    expect(result).toEqual({ allowed: true, remaining: 3 });
  });

  test("reddedildiğinde retryAfterMs en eski damgadan hesaplanır", async () => {
    const now = 1_000_000;
    // En eski damga 40 sn önce; pencere 60 sn → 20 sn sonra hak doğar.
    const { runner } = recordingRunner([0, 5, now - 40_000]);
    const result = await limiterWith(runner, now).consume({ key: "k", limit: 5, windowMs: 60_000 });

    expect(result).toEqual({ allowed: false, remaining: 0, retryAfterMs: 20_000 });
  });

  test("en eski damga okunamazsa TAM pencere beklenir (limit gevşetilmez)", async () => {
    // Eksik bilgiyle kısa bir süre vermek, limiti sessizce gevşetirdi.
    const { runner } = recordingRunner([0, 5, 0]);
    const result = await limiterWith(runner).consume({ key: "k", limit: 5, windowMs: 60_000 });

    expect(result).toEqual({ allowed: false, remaining: 0, retryAfterMs: 60_000 });
  });
});

test.describe("RedisRateLimiter — store erişilemezken FAIL-OPEN", () => {
  /**
   * Kayda geçmiş karar (Issue #181 + README): rate limiter yardımcı bir korumadır; Redis
   * kesintisinde tüm giriş/kayıt akışını kilitlemek, engellediği riskten daha büyük hasar
   * üretirdi. KABUL EDİLEN KALAN RİSK: kesinti süresince brute-force koruması yoktur.
   */
  function silenceConsoleError() {
    const original = console.error;
    console.error = () => {};
    return () => {
      console.error = original;
    };
  }

  test("ağ hatasında istek GEÇİRİLİR", async () => {
    const restore = silenceConsoleError();
    try {
      const failing: RedisCommandRunner = async () => {
        throw new Error("network unreachable");
      };
      const result = await limiterWith(failing).consume({ key: "k", limit: 5, windowMs: 60_000 });
      expect(result).toEqual({ allowed: true, remaining: 5 });
    } finally {
      restore();
    }
  });

  test("beklenmeyen yanıt şekli de kesinti sayılır ve geçirilir", async () => {
    const restore = silenceConsoleError();
    try {
      const { runner } = recordingRunner({ unexpected: true });
      const result = await limiterWith(runner).consume({ key: "k", limit: 5, windowMs: 60_000 });
      expect(result).toEqual({ allowed: true, remaining: 5 });
    } finally {
      restore();
    }
  });

  test("hata logu bucket key'ini (dolayısıyla istemci IP'sini) SIZDIRMAZ", async () => {
    // invariant #7: rate limit ile ilgili hiçbir çıktı IP/bucket taşımaz.
    const original = console.error;
    const lines: string[] = [];
    console.error = (...args: unknown[]) => {
      lines.push(args.map((a) => JSON.stringify(a)).join(" "));
    };

    try {
      const failing: RedisCommandRunner = async () => {
        throw new Error("network unreachable");
      };
      await limiterWith(failing).consume({
        key: "auth:sign-in:203.0.113.7",
        limit: 5,
        windowMs: 60_000,
      });
    } finally {
      console.error = original;
    }

    const logged = lines.join("\n");
    expect(logged).not.toContain("203.0.113.7");
    expect(logged).not.toContain("auth:sign-in");
    // Operasyonel iz tamamen kaybolmamalı.
    expect(logged).toContain("failing open");
  });
});
