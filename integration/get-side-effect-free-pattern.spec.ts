import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

/**
 * CSRF invariant koruması (Issue #28): `GET` handler'ları yan etkisiz (side-effect free)
 * kalmalıdır.
 *
 * Bu bir stil kuralı DEĞİL, güvenlik gereğidir. Projede özel bir CSRF token sistemi yoktur;
 * koruma `SameSite=Lax` cookie'lere dayanır ve `SameSite=Lax`, top-level cross-site **GET**
 * isteklerini ENGELLEMEZ (bkz. README "CSRF Duruşu"; gerçek tarayıcı kanıtı
 * `e2e/csrf-samesite.spec.ts`). Yani state değiştiren tek bir GET endpoint'i eklemek, CSRF
 * korumasını o endpoint için tamamen ortadan kaldırır.
 *
 * `tenant-scope-pattern.spec.ts` ile aynı yaklaşım: bir lint/AST aracı DEĞİLDİR — birinin
 * ileride bir GET handler'ına yazma işlemi eklemesini yakalayan basit bir kaynak-metni
 * regresyon testidir.
 */

const API_ROOT = path.join(__dirname, "..", "src", "app", "api");

/** Prisma'nın state değiştiren metodları — bir GET handler'ında bulunmamalıdır. */
const MUTATING_CALL_PATTERN =
  /\.(create|createMany|update|updateMany|upsert|delete|deleteMany|executeRaw|executeRawUnsafe)\s*\(/;

function collectRouteFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectRouteFiles(full));
    } else if (entry === "route.ts") {
      files.push(full);
    }
  }
  return files;
}

/**
 * `export async function GET(...) { ... }` gövdesini kaba ama yeterli bir şekilde çıkarır:
 * imzadan başlayıp süslü parantezleri sayarak eşleşen kapanışa kadar okur.
 */
function extractGetHandlerBody(source: string): string | null {
  const match = /export\s+async\s+function\s+GET\s*\(/.exec(source);
  if (!match) return null;

  const openBrace = source.indexOf("{", match.index + match[0].length);
  if (openBrace === -1) return null;

  let depth = 0;
  for (let i = openBrace; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(openBrace, i + 1);
    }
  }
  return null;
}

const ROUTE_FILES = collectRouteFiles(API_ROOT);

test.describe("CSRF invariant koruması — GET handler'ları yan etkisiz", () => {
  test("api route dosyaları taranabiliyor (test kendi kendini doğruluyor)", () => {
    // Bu kontrol olmadan, tarama bozulup 0 dosya bulsa bile aşağıdaki test sessizce geçerdi.
    expect(ROUTE_FILES.length).toBeGreaterThanOrEqual(5);
  });

  test("hiçbir GET handler'ı state değiştiren bir Prisma çağrısı içermiyor", () => {
    const violations: string[] = [];
    let inspectedGetHandlers = 0;

    for (const file of ROUTE_FILES) {
      const body = extractGetHandlerBody(readFileSync(file, "utf-8"));
      if (!body) continue;

      inspectedGetHandlers++;
      if (MUTATING_CALL_PATTERN.test(body)) {
        violations.push(path.relative(API_ROOT, file));
      }
    }

    // En az birkaç GET handler'ı gerçekten incelenmiş olmalı; aksi halde regex'in bozulması
    // testi yanlışlıkla yeşile çevirirdi.
    expect(inspectedGetHandlers).toBeGreaterThanOrEqual(3);
    expect(violations).toEqual([]);
  });
});
