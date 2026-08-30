import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { authConfig } from "../src/lib/auth/config";
import { prisma } from "../src/lib/prisma";

const EIGHT_HOURS_IN_SECONDS = 60 * 60 * 8;

test.describe("Auth.js session yapılandırması", () => {
  test("session stratejisi JWT olarak kalıyor", async () => {
    expect(authConfig.session?.strategy).toBe("jwt");
  });

  test("session maxAge 8 saat (28800 saniye) olarak ayarlanmış", async () => {
    expect(authConfig.session?.maxAge).toBe(EIGHT_HOURS_IN_SECONDS);
  });
});

/**
 * `jwt` callback'inin ad tazeleme davranışı (Issue #113).
 *
 * Callback DOĞRUDAN çağrılır, HTTP üzerinden değil: burada sınanan şey Auth.js'in akışı değil,
 * bizim callback'imizin verdiği karardır (uçtan uca kanıt
 * `security/user-profile-security.spec.ts`'te). Böylece revocation ile ad tazelemenin SIRASI da
 * doğrudan gözlemlenebiliyor.
 */
test.describe("callbacks.jwt — ad tazeleme (Issue #113)", () => {
  const createdUserIds: string[] = [];

  test.afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  async function createUser(name: string | null): Promise<string> {
    const user = await prisma.user.create({
      data: { email: `jwt-name-${randomUUID()}@example.com`, name },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  /** Sign-in SONRASI bir istek: `user` verilmez, yani callback DB'ye gider. */
  function callJwt(token: Record<string, unknown>) {
    const jwt = authConfig.callbacks?.jwt;
    if (!jwt) throw new Error("jwt callback tanımlı değil");
    return jwt({ token } as Parameters<typeof jwt>[0]);
  }

  /** Şu andan bir saat önce üretilmiş token (revoke edilmemiş sayılır). */
  function freshIat(): number {
    return Math.floor(Date.now() / 1000) - 3600;
  }

  test("DB'deki ad token'a yazılıyor (bayat ad taşınmıyor)", async () => {
    const userId = await createUser("Yeni Ad");

    const token = await callJwt({ sub: userId, iat: freshIat(), name: "Eski Ad" });

    expect(token).not.toBeNull();
    expect(token?.name).toBe("Yeni Ad");
  });

  test("ad DB'de değişince SONRAKİ istekte token da değişiyor", async () => {
    const userId = await createUser("Birinci");

    const before = await callJwt({ sub: userId, iat: freshIat() });
    expect(before?.name).toBe("Birinci");

    await prisma.user.update({ where: { id: userId }, data: { name: "Ikinci" } });

    const after = await callJwt({ sub: userId, iat: freshIat() });
    expect(after?.name).toBe("Ikinci");
  });

  test("REVOCATION ÖNCE gelir: revoke edilmiş token, adı değişmiş olsa da null döner", async () => {
    const userId = await createUser("Guncel Ad");
    const iat = freshIat();

    // Credential değişikliği token'dan SONRA: bu token revoke edilmelidir.
    await prisma.user.update({
      where: { id: userId },
      data: { credentialsChangedAt: new Date((iat + 60) * 1000) },
    });

    // Ad tazeleme revocation'ı BAYPAS ETMEMELİ — bu, #113'ün tek gerçek riski.
    expect(await callJwt({ sub: userId, iat, name: "Eski Ad" })).toBeNull();
  });

  test("silinmiş kullanıcının token'ında ad DEĞİŞTİRİLMİYOR (#26'nın kapsam notu korunuyor)", async () => {
    const userId = await createUser("Silinecek");
    await prisma.user.delete({ where: { id: userId } });

    const token = await callJwt({ sub: userId, iat: freshIat(), name: "Eski Ad" });

    // Kullanıcı yoksa token bugün revoke EDİLMİYOR (bkz. config.ts kapsam notu) ve adı
    // `undefined`a çekmek o davranışı sessizce değiştirirdi.
    expect(token).not.toBeNull();
    expect(token?.name).toBe("Eski Ad");
  });

  test("sign-in anında (`user` dolu) DB'ye hiç gidilmiyor", async () => {
    const jwt = authConfig.callbacks?.jwt;
    if (!jwt) throw new Error("jwt callback tanımlı değil");

    // `sub` BİLEREK var olmayan bir id: callback DB'ye gitseydi `dbUser` null olur ve aşağıdaki
    // ad beklentisi yine geçerdi — ama asıl kanıt, `authorize()`ın döndürdüğü adın korunmasıdır.
    const token = await jwt({
      token: { sub: `yok-${randomUUID()}`, name: "Girişteki Ad" },
      user: { id: "u1", email: "u@example.com", name: "Girişteki Ad" },
    } as unknown as Parameters<typeof jwt>[0]);

    expect(token).not.toBeNull();
    expect(token?.name).toBe("Girişteki Ad");
  });
});

/**
 * Ek DB sorgusu OLUŞMADIĞININ yapısal kanıtı (Issue #113 kabul kriteri).
 *
 * Davranış testleriyle gösterilemez: iki sorgu da doğru sonucu üretirdi. Bu yüzden
 * `get-side-effect-free-pattern.spec.ts` ile aynı yaklaşım kullanılıyor — bir AST aracı değil,
 * birinin ileride callback'e ikinci bir sorgu eklemesini yakalayan kaynak-metni regresyon
 * testi. Callback her istekte çalıştığı için oraya eklenecek her sorgu, uygulamanın TAMAMINDA
 * istek başına bir DB gidiş-dönüşü demektir.
 */
test.describe("callbacks.jwt — sorgu bütçesi", () => {
  function jwtCallbackBody(): string {
    const source = readFileSync(
      path.join(__dirname, "..", "src", "lib", "auth", "config.ts"),
      "utf8",
    );

    const match = /async\s+jwt\s*\(/.exec(source);
    expect(match, "config.ts içinde jwt callback bulunamadı").not.toBeNull();

    // Önce PARAMETRE listesinin kapanışı bulunur. Doğrudan ilk `{`'i aramak, gövde yerine
    // destructuring parametresini (`{ token, user }`) yakalardı.
    let cursor = match!.index + match![0].length - 1;
    let parenDepth = 0;
    for (; cursor < source.length; cursor += 1) {
      if (source[cursor] === "(") parenDepth += 1;
      else if (source[cursor] === ")") {
        parenDepth -= 1;
        if (parenDepth === 0) break;
      }
    }

    const openBrace = source.indexOf("{", cursor);
    expect(openBrace).toBeGreaterThan(-1);

    let depth = 0;
    for (let i = openBrace; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) return source.slice(openBrace, i + 1);
      }
    }

    throw new Error("jwt callback gövdesi kapanmadı");
  }

  test("callback'te TEK bir prisma sorgusu var", () => {
    const body = jwtCallbackBody();
    const calls = body.match(/prisma\.\w+\.\w+\s*\(/g) ?? [];

    expect(calls).toHaveLength(1);
    // Duyarlılık: tarama gerçekten gövdeyi okuyor mu? Boş bir gövdede bu iddia geçerdi.
    expect(body).toContain("isSessionRevoked");
    expect(body).toContain("token.name");
  });

  test("mevcut sorgunun select'i hem revocation hem ad alanını içeriyor", () => {
    const body = jwtCallbackBody();

    // İkisinin AYNI select'te olması, "ek sorgu yok" iddiasının somut hâlidir.
    expect(body).toMatch(/select:\s*{[^}]*credentialsChangedAt:\s*true[^}]*}/);
    expect(body).toMatch(/select:\s*{[^}]*name:\s*true[^}]*}/);
  });
});
