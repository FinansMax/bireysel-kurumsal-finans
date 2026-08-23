import { expect, test } from "@playwright/test";

import { InMemoryRateLimiter } from "../src/lib/rate-limit/in-memory-rate-limiter";

/**
 * `InMemoryRateLimiter`'ın çekirdek sliding-window/concurrency/cleanup davranışını doğrular
 * (Issue #27). Her test kendi TAZE `InMemoryRateLimiter` instance'ını oluşturur — paylaşılan
 * singleton (`src/lib/rate-limit/limiter.ts`'teki `rateLimiter`) KULLANILMAZ, böylece testler
 * arasında state sızmaz (bkz. issue'nun "injectable limiter instance" önerisi).
 */

test.describe("InMemoryRateLimiter — temel davranış", () => {
  test("limit altındaki istek allowed döner ve remaining doğru azalır", async () => {
    const limiter = new InMemoryRateLimiter();

    const first = await limiter.consume({ key: "core:a", limit: 3, windowMs: 1000 });
    expect(first.allowed).toBe(true);
    if (first.allowed) expect(first.remaining).toBe(2);

    const second = await limiter.consume({ key: "core:a", limit: 3, windowMs: 1000 });
    expect(second.allowed).toBe(true);
    if (second.allowed) expect(second.remaining).toBe(1);
  });

  test("limit aşıldığında rejected döner, remaining=0 ve retryAfterMs>0", async () => {
    const limiter = new InMemoryRateLimiter();

    for (let i = 0; i < 3; i++) {
      const result = await limiter.consume({ key: "core:b", limit: 3, windowMs: 1000 });
      expect(result.allowed).toBe(true);
    }

    const rejected = await limiter.consume({ key: "core:b", limit: 3, windowMs: 1000 });
    expect(rejected.allowed).toBe(false);
    if (!rejected.allowed) {
      expect(rejected.remaining).toBe(0);
      expect(rejected.retryAfterMs).toBeGreaterThan(0);
    }
  });

  test("reddedilen istekler kotayı TÜKETMEZ — pencere dolunca tam `limit` kadar yeni istek tekrar kabul edilir", async () => {
    let currentTime = 0;
    const limiter = new InMemoryRateLimiter({ now: () => currentTime });

    for (let i = 0; i < 2; i++) {
      await limiter.consume({ key: "core:no-consume-on-reject", limit: 2, windowMs: 1000 });
    }
    // Reddedilen 5 deneme — hiçbiri bucket'a EKLENMEMELİ.
    for (let i = 0; i < 5; i++) {
      const rejected = await limiter.consume({ key: "core:no-consume-on-reject", limit: 2, windowMs: 1000 });
      expect(rejected.allowed).toBe(false);
    }

    currentTime = 1001; // pencere tamamen dışına çık
    let allowedCount = 0;
    for (let i = 0; i < 2; i++) {
      const result = await limiter.consume({ key: "core:no-consume-on-reject", limit: 2, windowMs: 1000 });
      if (result.allowed) allowedCount++;
    }
    expect(allowedCount).toBe(2);
  });

  test("sliding window süresi dolunca tekrar allowed döner (injectable clock, gerçek süre beklenmez)", async () => {
    let currentTime = 0;
    const limiter = new InMemoryRateLimiter({ now: () => currentTime });

    await limiter.consume({ key: "core:c", limit: 2, windowMs: 1000 });
    await limiter.consume({ key: "core:c", limit: 2, windowMs: 1000 });
    const blocked = await limiter.consume({ key: "core:c", limit: 2, windowMs: 1000 });
    expect(blocked.allowed).toBe(false);

    currentTime = 1001;
    const allowedAgain = await limiter.consume({ key: "core:c", limit: 2, windowMs: 1000 });
    expect(allowedAgain.allowed).toBe(true);
  });

  test("fixed-window DEĞİLDİR: pencere sınırında ani reset yerine sürekli kayan bir pencere kullanılır", async () => {
    let currentTime = 0;
    const limiter = new InMemoryRateLimiter({ now: () => currentTime });

    await limiter.consume({ key: "core:sliding", limit: 2, windowMs: 1000 }); // t=0
    currentTime = 500;
    await limiter.consume({ key: "core:sliding", limit: 2, windowMs: 1000 }); // t=500

    currentTime = 900;
    // t=900: t=0 VE t=500'deki istekler hâlâ pencerede (900-1000=-100'den büyükler) -> dolu.
    const blocked = await limiter.consume({ key: "core:sliding", limit: 2, windowMs: 1000 });
    expect(blocked.allowed).toBe(false);

    currentTime = 1001;
    // t=0'daki istek artık pencerenin (1001-1000=1) dışında kaldı; sadece t=500 hâlâ geçerli.
    const allowed = await limiter.consume({ key: "core:sliding", limit: 2, windowMs: 1000 });
    expect(allowed.allowed).toBe(true);
    if (allowed.allowed) expect(allowed.remaining).toBe(0); // t=500 + yeni istek = 2/2 dolu
  });

  test("farklı key'ler tamamen izole — bir key'in limiti diğerini etkilemez", async () => {
    const limiter = new InMemoryRateLimiter();

    await limiter.consume({ key: "core:iso-a", limit: 2, windowMs: 1000 });
    await limiter.consume({ key: "core:iso-a", limit: 2, windowMs: 1000 });
    const aBlocked = await limiter.consume({ key: "core:iso-a", limit: 2, windowMs: 1000 });
    expect(aBlocked.allowed).toBe(false);

    const bAllowed = await limiter.consume({ key: "core:iso-b", limit: 2, windowMs: 1000 });
    expect(bAllowed.allowed).toBe(true);
  });

  test("concurrent consume çağrıları limiti bypass edemiyor (limit=5, 10 eşzamanlı istek)", async () => {
    const limiter = new InMemoryRateLimiter();

    const results = await Promise.all(
      Array.from({ length: 10 }, () => limiter.consume({ key: "core:concurrency", limit: 5, windowMs: 1000 })),
    );

    const allowedCount = results.filter((r) => r.allowed).length;
    expect(allowedCount).toBe(5);
  });

  test("reddedilen istek bucket expiry'sini erkene çekmiyor — sweep sonrası kota SIFIRLANMIYOR", async () => {
    let currentTime = 0;
    // maxTrackedBuckets=1 → her consume() bir sweep tetikler (production'da map 10.000
    // bucket'a ulaştığında olan durum: yani tam da dağıtık bir saldırı sırasında).
    const limiter = new InMemoryRateLimiter({ now: () => currentTime, maxTrackedBuckets: 1 });
    const policy = { limit: 10, windowMs: 300_000 }; // gerçek SIGNIN policy'si

    await limiter.consume({ key: "core:sweep-reset", ...policy }); // t=0
    currentTime = 290_000;
    for (let i = 0; i < 9; i++) {
      await limiter.consume({ key: "core:sweep-reset", ...policy }); // kota doldu (10/10)
    }

    currentTime = 291_000;
    const rejected = await limiter.consume({ key: "core:sweep-reset", ...policy });
    expect(rejected.allowed).toBe(false);

    // t=300.001'de yalnızca EN ESKİ deneme (t=0) pencereden çıkmıştır; t=290.000'dekiler
    // hâlâ aktiftir. Doğru sliding-window cevabı: tam olarak 1 yeni istek kabul edilir.
    //
    // REGRESYON: reddetme yolu `expiresAt`'i en eski timestamp'ten hesapladığında bucket
    // erkenden süpürülüyor ve buradaki sayı 1 yerine 10 oluyordu (limiti aşan istemciye
    // tam kota iadesi).
    currentTime = 300_001;
    let allowedAfterSweep = 0;
    for (let i = 0; i < 12; i++) {
      const result = await limiter.consume({ key: "core:sweep-reset", ...policy });
      if (result.allowed) allowedAfterSweep++;
    }
    expect(allowedAfterSweep).toBe(1);
  });

  test("limit=0 (endpoint tamamen kapalı) her isteği reddeder ve geçerli bir retryAfterMs üretir", async () => {
    const limiter = new InMemoryRateLimiter();

    const result = await limiter.consume({ key: "core:closed", limit: 0, windowMs: 1000 });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      // REGRESYON: `active` boş olduğu için eskiden `active[0]` undefined'dı ve retryAfterMs
      // NaN oluyordu — bu da guard'da geçersiz bir `Retry-After: NaN` header'ı üretiyordu.
      expect(Number.isFinite(result.retryAfterMs)).toBe(true);
      expect(result.retryAfterMs).toBe(1000);
      expect(Number.isNaN(Math.ceil(result.retryAfterMs / 1000))).toBe(false);
    }
  });

  test("stale bucket cleanup çalışıyor: maxTrackedBuckets eşiği aşılınca tamamen expire olmuş bucket'lar temizlenir", async () => {
    let currentTime = 0;
    const limiter = new InMemoryRateLimiter({ now: () => currentTime, maxTrackedBuckets: 2 });

    await limiter.consume({ key: "core:sweep-a", limit: 1, windowMs: 100 });
    await limiter.consume({ key: "core:sweep-b", limit: 1, windowMs: 100 });
    expect(limiter.size).toBe(2);

    currentTime = 200; // a ve b'nin bucket'ları artık tamamen expire (windowMs=100 geçti)

    // Map boyutu (2) maxTrackedBuckets'a (2) ulaştığı için bu çağrı bir sweep tetikler.
    await limiter.consume({ key: "core:sweep-c", limit: 1, windowMs: 100 });

    // a ve b süpürüldü; sadece yeni eklenen c kaldı.
    expect(limiter.size).toBe(1);
  });
});
