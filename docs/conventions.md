# Kod Konvansiyonları

Amaç: kod tabanının **tek bir kişi tarafından yazılmış gibi** okunması. Yeni bir konvansiyon
başlatmadan önce mevcut düzeni takip et; bir kural burada yoksa, en yakın mevcut dosyaya bak.

## TypeScript

- `strict: true` açıktır. `any` **kullanılmaz**; `as` ile tip zorlama son çare ve gerekçelidir.
  `@ts-ignore`/`@ts-expect-error` yazmadan önce tipi düzelt.
- **Dış dünyadan gelen her şey `unknown`'dur** (request body, params, env, JSON). Daraltma
  (narrowing) açık kontrollerle yapılır:

  ```ts
  const { role } = body as Record<string, unknown>;   // sadece shape, değer değil
  if (!isValidRole(role)) return { ok: false, status: 400, error: "Invalid role" };
  ```

  Doğrulanmamış bir değer Prisma'ya, ne de olsa "string gibi duruyor" diye geçilmez.
- Sabit kümeler `as const` + türetilmiş union ile tanımlanır (`PERMISSIONS`, `AUDIT_ACTIONS`,
  `RATE_LIMIT_BUCKETS`). Böylece rastgele string kabul edilmez.
- Bütünlük (exhaustiveness) tipe yaptırılır: `Record<MembershipRole, ...>`,
  `satisfies Record<string, RateLimitPolicy>`. Yeni bir enum değeri eklendiğinde derleyici
  eksik yeri gösterir — bu güvenlik açısından kritiktir.
- Fonksiyonların dönüş tipi, public API ise **açıkça** yazılır.

## Dosya ve isimlendirme

- Dosya adları `kebab-case.ts` (`write-audit-log.ts`, `session-revocation.ts`).
- Bir dosya bir sorumluluk; "utils.ts" gibi çöp kutusu modüller açılmaz.
- Fonksiyonlar `camelCase` ve fiille başlar (`createTenant`, `listMembers`, `isSessionRevoked`).
- Guard'lar `requireX()`, boolean üretenler `isX()`/`hasX()`, tip alias'ları `PascalCase`.
- Sabitler `SCREAMING_SNAKE_CASE`.

## Import düzeni

Üç grup, aralarında boş satır: (1) node/external, (2) `@/` mutlak, (3) `./` göreli.

```ts
import { readFileSync } from "node:fs";

import { MembershipRole, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { prisma } from "@/lib/prisma";

import { isValidRole } from "./validation";
```

Aynı modül içinden `./`, başka modülden `@/` kullanılır. Node builtin'leri `node:` önekiyle
import edilir.

## Biçim

- 2 boşluk girinti, çift tırnak, noktalı virgül, trailing comma, ~100 karakter satır.
- Dosyada Prettier yapılandırması yok — mevcut dosyaların biçimini birebir taklit et,
  formatlayıcı çalıştırıp alakasız satırları diff'e sokma.

## Yorumlar

Bu kod tabanının ayırt edici özelliği budur; kopyala:

- **Dil: Türkçe.** Kod/tanımlayıcılar İngilizce, yorumlar ve dokümantasyon Türkçe.
- **NE değil NEDEN yaz.** `// rolü günceller` değersizdir. Değerli olan: neden bu yaklaşım,
  hangi alternatif neden reddedildi, hangi saldırı/hata engelleniyor.
- **Tehlikeli görünmeyen tehlikeleri işaretle.** `update({ where: { id } })`'nin neden
  kullanılmadığı gibi. Bir sonraki geliştirici "bunu basitleştireyim" derse patlar.
- **Kararı issue numarasıyla bağla:** `(Issue #13)`, `(bkz. README "CSRF Duruşu")`.
- **İlgili dosyaya işaret et:** `bkz. src/lib/tenancy/scope.ts`.
- Public fonksiyonlarda JSDoc bloğu; kullanım örneği varsa kısa bir snippet ekle.
- Prisma şemasında da aynı kural geçerlidir — özellikle nullable alanların `null` anlamı
  yazılır.

Kötü/iyi örnek:

```ts
// KÖTÜ: membership'i bulur ve günceller
// İYİ:
// `update({ where: { id } })` KULLANILMAZ: id tek başına unique olduğundan Prisma bunu kabul
// eder, ama bu sorgu tenant scope'unu mutasyonun kendisinde taşımaz. Bunun yerine updateMany +
// tenantScoped() ile id VE tenantId birlikte filtrelenir (Issue #13).
```

## Prisma kullanımı

- Client tek yerden gelir: `import { prisma } from "@/lib/prisma"`. Yeni `new PrismaClient()`
  oluşturulmaz.
- **Her sorguda `select` allowlist'i** kullanılır; `include` ile geniş nesne çekilmez.
  `passwordHash`, `tokenHash`, `credentialsChangedAt` gibi alanlar response'a taşınan
  select'lere **asla** girmez.
- Select'ler `satisfies Prisma.XSelect` ile tiplenir, view tipleri
  `Prisma.XGetPayload<{ select: typeof xSelect }>` ile türetilir — elle yazılmış DTO tipleri
  şemadan kolayca sapar.
- Transaction gerektiren çok adımlı yazımlarda `prisma.$transaction(async (tx) => ...)`; içeride
  **daima** `tx` kullanılır (yanlışlıkla `prisma` kullanmak transaction'ı bozar).
- Ham SQL (`$queryRaw`/`$executeRaw`) kullanılmaz. Zorunlu hale gelirse parametreli template
  formu kullanılır, `...Unsafe` varyantları asla.
- N+1 sorgudan kaçın: listelerde ilişkili veri tek sorguda `select` ile alınır.

## Bağımlılıklar

**Yeni bir npm paketi eklemek, açık onay gerektiren bir karardır.** Bu repo bilinçli olarak
küçük bir bağımlılık yüzeyi taşır:

- Şifre hash'i için `bcrypt`/`argon2` değil, Node'un yerleşik `crypto.scrypt`'i.
- Doğrulama için `zod` değil, `src/lib/*/validation.ts` içinde elle yazılmış saf fonksiyonlar.
- Rate limit için hazır paket değil, `RateLimiter` interface'i + küçük bir implementasyon.

Bir paket önerecekseniz: neyi çözdüğünü, neden elle yazmanın yetmediğini ve bakım maliyetini
PR'da yazın.

## Hata yönetimi

- Servis katmanı beklenen hataları **result union** ile döner, throw etmez (bkz.
  `docs/architecture.md`).
- Transaction içi akış kontrolü için dosya-lokal `Error` sınıfları; dışarı sızmaz.
- `catch (error)` bloğunda hata **yutulmaz**: ya result'a çevrilir ya `console.error` ile
  loglanır. Boş catch yazılmaz.
- Best-effort işlemler (audit yazımı, outbox'a e-posta) asıl işlemi bozmaz — hata yakalanır,
  loglanır, akış devam eder.
- Log formatı mevcut desene uyar: `console.error("[audit] failed to write audit log", { ... })`.
  Log'a şifre, token, cookie, tam e-posta gövdesi yazılmaz.

## Next.js (App Router, v16)

- Bu sürüm eğitim verinizdeki Next.js'ten farklı olabilir. **Kod yazmadan önce**
  `node_modules/next/dist/docs/` altındaki ilgili rehberi okuyun (`01-app/01-getting-started/`,
  `01-app/02-guides/authentication.md`, `data-security.md`).
- Route Handler imzası: `export async function GET(request: Request, { params }: RouteParams)`.
  **`params` bir `Promise`'tir**, `await` edilir.
- Sunucu bileşenleri varsayılandır. `"use client"` yalnızca gerçekten gerekli olduğunda (state,
  event handler, tarayıcı API'si) ve mümkün olan en küçük yaprak bileşende kullanılır.
- Secret ve DB erişimi yalnızca sunucu tarafında. Client bileşenine gizli veri prop olarak
  geçilmez; sunucudan dönen nesnelerin yalnızca UI'ın ihtiyacı olan alanları taşınır.
- Yeni bir cookie set edilirken `HttpOnly` + `SameSite=Lax` + production'da `Secure` açık yazılır
  (`src/lib/tenants/active-tenant.ts` referans).

## Finansal veri

`docs/security-invariants.md` #10'a bakın: `Decimal`, asla `number`; JSON'da string; para birimi
ayrı alan.

## Kod incelemesi öz-kontrolü

Kod yazdıktan sonra kendi diff'ini oku ve şunları sor:

- Bu değişiklik istenen scope'un dışına taştı mı? (İlgisiz refactor, "yeri gelmişken" düzeltme)
- Yeni bir konvansiyon mu başlattım, yoksa mevcut deseni mi izledim?
- Bir invariant'a dokundum mu? Dokunduysam testi ve dokümantasyonu güncelledim mi?
- Yorumlarım NEDEN'i anlatıyor mu, yoksa kodu tekrar mı ediyor?
- Bu kodu 6 ay sonra okuyan biri yanlışlıkla bozabilir mi? Bozarsa test yakalar mı?
