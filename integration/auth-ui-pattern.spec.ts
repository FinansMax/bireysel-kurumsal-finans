import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

/**
 * Auth ekranlarının rate limit'i baypas etmesini engelleyen pattern koruması (Issue #36).
 *
 * `next-auth`'un SUNUCU tarafı `signIn()`/`signOut()`'u (bkz.
 * `node_modules/next-auth/lib/actions.js`) bellekte bir `Request` üretip `Auth()`'u DOĞRUDAN
 * çağırır ve `skipCSRFCheck` geçer — istek HTTP üzerinden gitmediği için
 * `src/app/api/auth/[...nextauth]/route.ts` hiç çalışmaz. O route ise sign-in rate limitinin
 * (Issue #27) uygulandığı TEK yerdir.
 *
 * Yani auth ekranlarını "sadeleştirip" bir Server Action'a taşımak, brute-force korumasını ve
 * Auth.js'in kendi CSRF kontrolünü SESSİZCE devre dışı bırakır — hiçbir test kırılmadan.
 * Bu dosya tam olarak o sessiz regresyonu yakalamak için vardır.
 *
 * `tenant-scope-pattern.spec.ts` ve `get-side-effect-free-pattern.spec.ts` ile aynı yaklaşım:
 * bir lint/AST aracı DEĞİL, basit bir kaynak-metni regresyon testidir.
 */

const APP_ROOT = path.join(__dirname, "..", "src", "app");
const COMPONENTS_ROOT = path.join(__dirname, "..", "src", "components");

/**
 * Kimlik doğrulama akışlarını çalıştıran İSTEMCİ dosyaları.
 *
 * `reset-password/page.tsx` bilerek listede DEĞİLDİR: o bir sunucu bileşenidir ve yalnızca
 * URL'deki token'ı çözüp client forma prop olarak geçer (hiçbir auth isteği atmaz). Asıl
 * istek `reset-password-form.tsx`'ten gider, o yüzden kontrol edilen dosya odur.
 */
const AUTH_PAGES = [
  path.join(APP_ROOT, "login", "page.tsx"),
  path.join(APP_ROOT, "signup", "page.tsx"),
  path.join(APP_ROOT, "forgot-password", "page.tsx"),
  path.join(APP_ROOT, "reset-password", "reset-password-form.tsx"),
  // Bir sayfa değil, kabuktaki çıkış düğmesidir (Issue #39) — ama aynı tuzağa açıktır:
  // sunucu tarafı `signOut()` de `Auth()`'u doğrudan çağırıp HTTP route'unu atlar.
  path.join(COMPONENTS_ROOT, "sign-out-button.tsx"),
];

/**
 * Her ekranın HANGİ HTTP endpoint'ini çağırması ve hangi servis fonksiyonunu doğrudan
 * ÇAĞIRMAMASI gerektiği. Servisi doğrudan çağırmak (bir Server Action üzerinden) o
 * endpoint'in rate limitini baypas eder — her satırın varlık sebebi budur.
 */
const ENDPOINT_EXPECTATIONS = [
  {
    file: path.join(APP_ROOT, "signup", "page.tsx"),
    mustCall: "/api/auth/signup",
    mustNotCall: "registerUser",
  },
  {
    file: path.join(APP_ROOT, "forgot-password", "page.tsx"),
    mustCall: "/api/auth/forgot-password",
    mustNotCall: "requestPasswordReset",
  },
  {
    file: path.join(APP_ROOT, "reset-password", "reset-password-form.tsx"),
    mustCall: "/api/auth/reset-password",
    mustNotCall: "resetPassword(",
  },
  {
    // Bir AUTH ekranı değildir (Issue #42) ama korunan invariant birebir aynıdır: tenant
    // oluşturma rate limiti (Issue #27) route seviyesinde uygulanır, `createTenant()`
    // servisinde değil — servisi bir Server Action'dan doğrudan çağırmak otomatik tenant
    // üretimine karşı korumayı sessizce baypas ederdi.
    label: "tenant oluşturma",
    file: path.join(APP_ROOT, "(app)", "tenants", "new", "create-tenant-form.tsx"),
    mustCall: "/api/tenants",
    mustNotCall: "createTenant(",
  },
];

/**
 * Kaynağı yorumlardan arındırır.
 *
 * Bu şart: bu dosyadaki kontroller "yasak sembol geçmesin" biçiminde olduğu için, yasak
 * şeyin NEDEN yapılmadığını anlatan bir yorum (ki bu repo'da böyle yorumlar teşvik edilir)
 * testi yanlışlıkla kırardı. Aranan şey metnin kendisi değil, KODDAKİ kullanımıdır.
 *
 * Sınır: satır-içi `//` yorumları, yalnızca satırın tamamı yorumsa silinir — böylece kod
 * içindeki `"https://..."` gibi string'ler yanlışlıkla kırpılmaz. Bu kod tabanının yorum
 * biçimi (JSDoc blokları + tam satır `//`) için yeterlidir.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

function readPage(filePath: string): string {
  return readFileSync(filePath, "utf-8");
}

/** Yalnızca çalıştırılabilir kod — yorumlar hariç. */
function readPageCode(filePath: string): string {
  return stripComments(readPage(filePath));
}

test.describe("Auth ekranları — rate limit baypasına karşı koruma", () => {
  test("beklenen auth sayfaları gerçekten mevcut (test kendi kendini doğruluyor)", () => {
    // Bu kontrol olmadan, dosyalar taşınsa/silinse aşağıdaki testler sessizce geçerdi.
    for (const page of AUTH_PAGES) {
      expect(() => readPage(page), `${page} okunamadı`).not.toThrow();
      expect(readPage(page).length).toBeGreaterThan(500);
    }
  });

  test("auth sayfaları client component (server action yolu kullanılamaz)", () => {
    for (const page of AUTH_PAGES) {
      expect(readPage(page), `${page} "use client" ile başlamalı`).toContain('"use client"');
    }
  });

  test("auth sayfaları sunucu tarafı signIn/signOut'u (@/lib/auth) import ETMİYOR", () => {
    for (const page of AUTH_PAGES) {
      const code = readPageCode(page);

      // `@/lib/auth` bu projede NextAuth()'un sunucu tarafı `signIn`/`signOut`'unu export eder
      // (bkz. src/lib/auth/index.ts). Bir auth ekranından import edilmesi, HTTP yolunu ve
      // dolayısıyla rate limiti atlamak anlamına gelir.
      expect(code, `${page} sunucu tarafı auth modülünü import etmemeli`).not.toMatch(
        /from\s+["']@\/lib\/auth["']/,
      );
      expect(code, `${page} içinde "use server" olmamalı`).not.toContain('"use server"');
    }
  });

  test("login ekranı istemci tarafı signIn'i (next-auth/react) kullanıyor", () => {
    const code = readPageCode(path.join(APP_ROOT, "login", "page.tsx"));

    // Kontrol grubu: yalnızca "yasak import yok" demek yetmez — doğru olanın kullanıldığı da
    // doğrulanmalı, aksi halde sayfa hiç sign-in yapmıyor olsa da test geçerdi.
    expect(code).toMatch(/from\s+["']next-auth\/react["']/);
    expect(code).toContain("signIn(");
  });

  test("çıkış düğmesi istemci tarafı signOut'u (next-auth/react) kullanıyor", () => {
    const code = readPageCode(path.join(COMPONENTS_ROOT, "sign-out-button.tsx"));

    // Kontrol grubu: "yasak import yok" tek başına yetmez — düğmenin GERÇEKTEN çıkış yaptığı
    // da doğrulanmalı, aksi halde hiçbir şey yapmayan bir düğme testi geçerdi.
    expect(code).toMatch(/from\s+["']next-auth\/react["']/);
    expect(code).toContain("signOut(");
  });

  for (const expectation of ENDPOINT_EXPECTATIONS) {
    const { file, mustCall, mustNotCall } = expectation;
    // Klasör adı ekranı anlatmaya yetmediğinde (`.../tenants/new/`) açık bir etiket verilir.
    const label = "label" in expectation ? expectation.label : path.basename(path.dirname(file));

    test(`${label} ekranı servisi doğrudan değil HTTP üzerinden çağırıyor`, () => {
      const code = readPageCode(file);

      expect(code, `${file} servis fonksiyonunu doğrudan çağırmamalı`).not.toContain(mustNotCall);
      expect(code, `${file} ${mustCall} endpoint'ini çağırmalı`).toContain(mustCall);
    });
  }
});
