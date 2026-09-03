import type { RateLimitInput, RateLimitResult, RateLimiter } from "./types";

/**
 * Paylaşılan (distributed) sliding-window `RateLimiter` — Upstash Redis REST (Issue #181).
 *
 * `RateLimiter` arayüzü DEĞİŞMEZ; route kodu ve `checkRateLimit()` sözleşmesi hiç bilmez hangi
 * store'un kullanıldığını. Arayüz zaten tam bu değişim için vardı (bkz. `types.ts`).
 *
 * ---
 *
 * ATOMİKLİK — BU DOSYANIN VAR OLMA SEBEBİ.
 *
 * `InMemoryRateLimiter.consume()` içinde hiç `await` yoktur: oku+hesapla+yaz tek senkron
 * bloktur ve JavaScript'in tek thread'li event loop'unda bu ATOMİKTİR. Redis'e geçerken bu
 * garanti KAYBOLUR — "oku → hesapla → yaz" üç ayrı ağ çağrısı olurdu ve eşzamanlı istekler
 * limiti aşabilirdi (klasik TOCTOU).
 *
 * Bu yüzden tüm mantık TEK bir Lua script'inde, Redis'in kendi tek thread'li yürütmesi altında
 * çalışır. Script çalışırken başka hiçbir komut araya giremez; atomiklik in-memory
 * implementasyondakiyle AYNI güçtedir. `MULTI/EXEC` alternatifi REDDEDİLDİ: koşullu yazma
 * (yalnızca izin verilirse `ZADD`) transaction içinde ifade edilemez — karar için önce `ZCARD`
 * sonucunu okumak, yani transaction'ı bölmek gerekirdi.
 *
 * ---
 *
 * NEDEN `@upstash/redis` PAKETİ DEĞİL, DÜZ `fetch`: paketin burada yaptığı tek şey tek bir POST
 * isteğini sarmalamak. `docs/conventions.md` → "Bağımlılıklar": bu repo şifre hash'i için
 * `bcrypt` yerine `node:crypto`, doğrulama için `zod` yerine elle yazılmış fonksiyonlar
 * kullanıyor. **Bu dosya hiçbir npm bağımlılığı eklemez.**
 *
 * NEDEN TCP DEĞİL HTTP: serverless'ta kalıcı TCP bağlantı havuzu her cold start'ta yeniden
 * kurulur ve bağlantı sayısı instance sayısıyla çarpılır; Upstash'in REST arayüzü bu sorunu
 * tamamen ortadan kaldırır.
 */

/**
 * Sliding-window sayaç — sorted set üzerinde.
 *
 * `KEYS[1]` bucket key'i. `ARGV`: `now` (ms), `windowMs`, `limit`, `member` (benzersiz üye adı).
 *
 * Adımlar:
 * 1. `ZREMRANGEBYSCORE` — pencere dışında kalan damgaları at. Bu aynı zamanda temizliktir:
 *    ayrı bir süpürme görevi gerekmez.
 * 2. `ZCARD` — pencere içinde kalan (izin verilmiş) istek sayısı.
 * 3. Sayı `limit`'e ULAŞMIŞSA hiçbir şey yazılmaz ve en eski damga döndürülür (retry hesabı
 *    için). REDDEDİLEN DENEME BUCKET'A YAZILMAZ — in-memory implementasyonun davranışı budur
 *    ve korunmak zorundadır: aksi halde limiti aşan bir saldırgan, her reddedilen denemeyle
 *    pencereyi uzatıp meşru kullanıcıyı süresiz kilitleyebilirdi.
 * 4. Değilse `ZADD` ile damga eklenir.
 * 5. `PEXPIRE` her çağrıda tazelenir: bucket, son isteğinden `windowMs` sonra kendiliğinden
 *    silinir — sınırsız key birikmesi olmaz.
 *
 * Dönüş: `{ allowed (0/1), count, oldestScore }`. Karar Redis'te verilir, çağıran yalnızca
 * çevirir.
 */
const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - windowMs)
local count = redis.call('ZCARD', key)

if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local oldestScore = 0
  if oldest[2] then oldestScore = tonumber(oldest[2]) end
  redis.call('PEXPIRE', key, windowMs)
  return {0, count, oldestScore}
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, windowMs)
return {1, count + 1, 0}
`;

/**
 * Redis komutunu çalıştıran taşıyıcı.
 *
 * NEDEN ENJEKTE EDİLEBİLİR: gerçek Upstash credential'ı olmadan bu sınıfın sözleşmesini test
 * edebilmek için — özellikle "TEK bir round-trip yapılıyor mu" (atomiklik iddiasının kanıtı)
 * ve "yanıt doğru çevriliyor mu". Bu bir test-only bypass DEĞİLDİR: limit mantığını atlamaz,
 * yalnızca ağ sınırını değiştirilebilir kılar (`requestPasswordReset`'in `emailSender`
 * seçeneğiyle aynı desen).
 */
export type RedisCommandRunner = (command: readonly string[]) => Promise<unknown>;

export type RedisRateLimiterOptions = {
  restUrl: string;
  restToken: string;
  runCommand?: RedisCommandRunner;
  now?: () => number;
  /** Ağ zaman aşımı — askıda kalan bir limiter, isteği süresiz bekletirdi. */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 2_000;

/** Upstash REST: tek bir POST, gövdesi komut dizisi. */
function createFetchRunner(
  restUrl: string,
  restToken: string,
  timeoutMs: number,
): RedisCommandRunner {
  return async (command) => {
    const response = await fetch(restUrl, {
      method: "POST",
      headers: {
        // Token YALNIZCA burada kullanılır; hiçbir log satırına girmez.
        authorization: `Bearer ${restToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      // Gövde OKUNMAZ ve loglanmaz: sağlayıcı hata gövdesinde isteğin bir kısmını (yani bucket
      // key'ini, dolayısıyla istemci IP'sini) yankılayabilir.
      throw new Error(`upstash responded with status ${response.status}`);
    }

    const payload = (await response.json()) as { result?: unknown; error?: string };
    if (payload.error) {
      throw new Error("upstash returned an error");
    }
    return payload.result;
  };
}

/** Lua'nın döndürdüğü diziyi güvenli biçimde okur. */
function parseScriptResult(raw: unknown): { allowed: boolean; count: number; oldest: number } | null {
  if (!Array.isArray(raw) || raw.length < 3) {
    return null;
  }
  const [allowed, count, oldest] = raw.map((value) => Number(value));
  if (!Number.isFinite(allowed) || !Number.isFinite(count) || !Number.isFinite(oldest)) {
    return null;
  }
  return { allowed: allowed === 1, count, oldest };
}

export class RedisRateLimiter implements RateLimiter {
  private readonly runCommand: RedisCommandRunner;
  private readonly now: () => number;

  constructor(options: RedisRateLimiterOptions) {
    this.now = options.now ?? Date.now;
    this.runCommand =
      options.runCommand ??
      createFetchRunner(options.restUrl, options.restToken, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  }

  /**
   * FAIL-OPEN: store'a ulaşılamazsa istek GEÇİRİLİR ve hata loglanır.
   *
   * Bu kayda geçmiş bir karardır (Issue #181 + README). Gerekçe: rate limiter yardımcı bir
   * korumadır; Redis kesintisinde tüm giriş/kayıt akışını kilitlemek, engellediği riskten daha
   * büyük bir hasar üretir — tek bir üçüncü taraf servis, uygulamanın tamamını erişilemez
   * kılardı. KABUL EDİLEN KALAN RİSK: Redis kesintisi süresince brute-force koruması yoktur.
   * Fail-closed istenirse bu AYRI bir karardır ve README'deki bu satırın değiştirilmesini
   * gerektirir.
   */
  async consume(input: RateLimitInput): Promise<RateLimitResult> {
    const now = this.now();
    // Üye adı benzersiz olmalı: aynı milisaniyede gelen iki istek aynı score'a sahip olur ve
    // üye adı da aynı olsaydı `ZADD` ikincisini YENİ bir giriş saymaz, üzerine yazardı — yani
    // iki istek bir sayılır ve limit sessizce gevşerdi.
    const member = `${now}-${Math.random().toString(36).slice(2, 10)}`;

    try {
      const raw = await this.runCommand([
        "EVAL",
        SLIDING_WINDOW_SCRIPT,
        "1",
        input.key,
        String(now),
        String(input.windowMs),
        String(input.limit),
        member,
      ]);

      const parsed = parseScriptResult(raw);
      if (!parsed) {
        // Beklenmeyen bir yanıt şekli de bir kesintidir; aynı fail-open kararı geçerli.
        console.error("[rate-limit] unexpected store response shape");
        return { allowed: true, remaining: input.limit };
      }

      if (parsed.allowed) {
        return { allowed: true, remaining: Math.max(0, input.limit - parsed.count) };
      }

      // En eski damga pencereden çıktığında yeniden hak doğar. `oldest` okunamadıysa (0) tam
      // pencere kadar beklenir — eksik bilgiyle KISA bir süre vermek limiti gevşetirdi.
      const retryAfterMs =
        parsed.oldest > 0 ? Math.max(0, parsed.oldest + input.windowMs - now) : input.windowMs;

      return { allowed: false, remaining: 0, retryAfterMs };
    } catch (error) {
      // Bucket key'i (istemci IP'sini içerir) LOGLANMAZ (invariant #7).
      console.error("[rate-limit] store unavailable, failing open", {
        error: error instanceof Error ? error.message : "unknown error",
      });
      return { allowed: true, remaining: input.limit };
    }
  }
}
