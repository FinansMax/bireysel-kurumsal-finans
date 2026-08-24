# Mimari

Bu dosya, kodun **nereye** yazılacağını ve katmanların birbirine nasıl bağlandığını anlatır.
Güvenlik kuralları için `docs/security-invariants.md`, kod stili için `docs/conventions.md`.

## Katmanlar

```
HTTP isteği
   │
   ▼
src/app/api/**/route.ts        ← İNCE katman: guard + parse + delegate + response map
   │                              (iş kuralı, DB sorgusu, hesaplama YOK)
   ▼
src/lib/<domain>/*.ts          ← İş mantığı: doğrulama, transaction, invariant'lar, audit
   │                              (NextResponse, Request, cookie bilmez)
   ▼
src/lib/prisma.ts (PrismaClient singleton) → PostgreSQL
```

**Bağımlılık yönü tek yönlüdür.** `src/lib/**` içinden `next/server` import edilmez; iş mantığı
HTTP'den habersizdir. Tek istisna, HTTP'nin kendisi olan guard'lardır (`src/lib/auth/guard.ts`,
`src/lib/authz/authorize.ts`, `src/lib/rate-limit/guard.ts`) — bunlar bilinçli olarak hazır
`NextResponse` döndürür ve route'larda tek satırda kullanılır. Aynı istisnanın sayfa tarafındaki
karşılığı `src/lib/auth/page-guard.ts`'tir (`requirePageUser()`): 401 yerine `/login`'e
`redirect()` eder ve yalnızca sunucu bileşenlerinden çağrılır.

Bu ayrımın pratik faydası: iş mantığı `integration/` testlerinde HTTP sunucusu ayağa
kaldırmadan doğrudan çağrılabilir.

## Dizin haritası

| Yol | Sorumluluk |
| --- | --- |
| `src/app/api/**/route.ts` | HTTP endpoint'leri (App Router Route Handlers) |
| `src/app/*.tsx`, `globals.css` | Public ekranlar (`/login`, `/signup`, şifre sıfırlama) + root layout |
| `src/app/(app)/` | Korumalı route group: kabuk layout'u + authenticated ekranlar (Issue #39) |
| `src/components/` | Ekranların paylaştığı saf sunum bileşenleri (design system DEĞİL) |
| `src/lib/auth/` | Auth.js yapılandırması, credentials, şifre hash, reset, session revocation |
| `src/lib/authz/` | Permission sabitleri, rol→izin matrisi, `requirePermission()` guard'ı |
| `src/lib/tenancy/scope.ts` | `tenantScoped()` — tenant izolasyonunun tek helper'ı |
| `src/lib/tenants/` | Tenant, membership, davet, aktif tenant context'i, doğrulama |
| `src/lib/finance/` | Finansal modeller (`Account`, sonraki issue'larda `Transaction`, ...) |
| `src/lib/audit/` | Audit action sabitleri, sanitization, `writeAuditLog()` |
| `src/lib/rate-limit/` | `RateLimiter` interface'i, in-memory limiter, policy kataloğu, guard |
| `src/lib/prisma.ts` | PrismaClient singleton (dev'de hot-reload güvenli) |
| `prisma/schema.prisma` | Veri modeli; `prisma/migrations/` versiyonlu şema geçmişi |
| `e2e/`, `integration/`, `security/` | Üç ayrı test suite'i (bkz. `docs/testing.md`) |

## Route handler anatomisi

Her state değiştiren handler aynı sırayı izler. Sıra rastgele değildir — her adım kendinden
sonrakini korur:

```ts
export async function PATCH(request: Request, { params }: RouteParams) {
  // 1) Ucuz shape kontrolü (DB'ye ve pahalı işe girmeden)
  const ids = await resolveParams(params);
  if (!ids) return NextResponse.json({ error: "Invalid tenant or membership id" }, { status: 400 });

  // 2) Rate limit — public/pahalı endpoint'lerde, her şeyden önce (bkz. signup/tenants POST)
  // 3) Authentication + authorization (trusted context buradan gelir)
  const { context, response } = await requirePermission(PERMISSIONS.UPDATE_MEMBER_ROLE, ids.tenantId);
  if (!context) return response;

  // 4) Body parse — daima try/catch + tip kontrolü
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { role } = body as Record<string, unknown>;

  // 5) İş mantığına devret — trusted değerler context'ten, ham input olduğu gibi (unknown)
  const result = await updateMemberRole(context.tenant.id, ids.membershipId, context.user.id, context.role, role);

  // 6) Result union'ı HTTP'ye çevir
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ member: result.member });
}
```

Referans dosyalar: `src/app/api/tenants/[tenantId]/members/[membershipId]/route.ts`,
`src/app/api/tenants/route.ts`, `src/app/api/auth/signup/route.ts`.

> **Next.js 16 notu:** `params` bir `Promise`'tir ve `await` edilmelidir. Bu sürümde API'ler
> eğitim verinizdekinden farklı olabilir — kod yazmadan önce
> `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` gibi ilgili
> rehberi okuyun.

## Servis katmanı sözleşmesi

İş mantığı fonksiyonları **throw etmez**; ayrıştırılmış (discriminated) bir union döner:

```ts
export type UpdateRoleResult =
  | { ok: true; member: MemberView }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };
```

- `status` literal union'dır — rastgele bir kod dönmek derleme hatası verir.
- `error` **client'a gösterilecek genel** mesajdır; iç durum sızdırmaz.
- Beklenmeyen hatalar (DB down gibi) yakalanmaz; Next.js 500'e çevirir. Bu bilinçlidir —
  beklenen hataları result union'ı, beklenmeyenleri framework taşır.
- Transaction **içindeki** akış kontrolü için dosya-lokal `Error` sınıfları kullanılır
  (`class NotFoundError extends Error {}`), dışarı sızmadan result union'a map'lenir.

### Status kodu sözlüğü

| Kod | Ne zaman |
| --- | --- |
| 400 | Geçersiz input, geçersiz/expired token, aktif tenant yok |
| 401 | Kimlik doğrulanmamış (`requireUser`) |
| 403 | Kimlik var ama yetki yok / tenant eşleşmiyor / privilege escalation girişimi |
| 404 | Kaynak yok **veya** başka tenant'a ait (ikisi ayrıştırılmaz) |
| 409 | Çakışma (duplicate slug, zaten üye, son OWNER) |
| 429 | Rate limit (`Retry-After` header'ı ile) |

## Eşzamanlılık (concurrency) desenleri

Bu repo'da "önce kontrol et, sonra yaz" deseni **kabul edilmez**; iki istek arasına giren üçüncü
bir istek invariant'ı bozar. Kullanılan üç desen:

1. **Unique constraint'e güven.** Duplicate slug kontrolü `findFirst` ile değil, `create`'in
   `P2002` hatasını yakalayarak yapılır (`src/lib/tenants/create-tenant.ts`).
2. **Serializable transaction + retry.** Okuma sonucuna bağlı bir invariant varsa (son OWNER
   koruması, "eskisini iptal et + yenisini oluştur") transaction `Serializable` izolasyonda
   çalışır ve serialization hatası alan istek yeniden denenir
   (`src/lib/tenants/membership.ts`, `src/lib/tenants/invitation.ts`).
3. **Koşullu atomik `updateMany`.** Tek kullanımlık token tüketimi tek bir SQL ifadesiyle
   yapılır; `count` sonucu kimin kazandığını söyler (`src/lib/auth/password-reset.ts`).

## Yeni tenant-scoped model eklerken

`Account`, `Transaction`, `Category`, `Budget`, `Invoice` gibi bir model eklerken izlenecek yol
(`Membership` referans implementasyondur):

1. **Şema:** `prisma/schema.prisma`'ya modeli ekle — zorunlu `tenantId` + `tenant` ilişkisi,
   `onDelete: Cascade`, `@@index([tenantId])`, gerekiyorsa bileşik unique. Parasal alanlar
   `Decimal @db.Decimal(19, 4)`. Alanların anlamını (özellikle nullable'ların ne demek
   olduğunu) şemada yorumla belirt — mevcut modellerdeki gibi.
2. **Migration:** `npm run prisma:migrate` ile açıklayıcı isimli bir migration üret. Migration
   dosyaları elle düzenlenmez; üretilen SQL gözden geçirilir.
3. **Servis:** `src/lib/<domain>/<model>.ts` — somut `list/get/create/update/delete`
   fonksiyonları. Generic repository soyutlaması **yazma**. Her sorgu `tenantScoped()`
   üzerinden geçer; update/delete `updateMany`/`deleteMany` + `count === 1` ile yapılır.
4. **İzinler:** Gerekli permission'ları `src/lib/authz/permissions.ts`'e ekle ve rol matrisini
   güncelle.
5. **Route:** `src/app/api/...` altında ince handler; `requirePermission()` ile korunur.
6. **Audit:** State değiştiren işlemler için `AUDIT_ACTIONS`'a event ekle, commit sonrası
   `writeAuditLog()` çağır.
7. **Testler:** `integration/` (iş kuralları) + `security/` (cross-tenant erişim, yetkisiz
   mutation) + gerekiyorsa `integration/tenant-scope-pattern.spec.ts`'e yeni modelin pattern
   kontrolü.
8. **Dokümantasyon:** Yeni bir güvenlik/mimari karar verdiysen `README.md`'ye gerekçesiyle yaz.

## Kimlik doğrulama akışı (özet)

Ayrıntı ve gerekçeler `README.md`'de; burada sadece harita:

- **Session:** Auth.js v5, **JWT** stratejisi (Credentials provider database session ile
  çalışmaz), `maxAge` 8 saat. DB adapter ve `Session`/`Account` tabloları yoktur.
- **Revocation:** `jwt` callback'i her istekte `User.credentialsChangedAt` ile `token.iat`'i
  karşılaştırır; şifre değişiminden önceki token'lar geçersizdir. Kontrol bilinçli olarak
  `session` callback'inde **değil** `jwt` callback'indedir (`GET /api/auth/session` token'ı
  yeniden imzalar ve kontrolü bypass ederdi).
- **Aktif tenant:** `active-tenant` cookie'si (`HttpOnly`, `SameSite=Lax`) yalnızca bir
  *ipucu*dur; `requireActiveTenant()` her istekte membership'i DB'den doğrular.

## Kasıtlı olarak yapılmayanlar

Bunlar eksik değil, karar verilmiş kapsam sınırlarıdır. "Eksik" diye tamamlamaya çalışma; ayrı
bir issue gerektirir:

- Özel CSRF token katmanı (bkz. invariant #4 ve README).
- Distributed rate limiting (Redis vb.) — `RateLimiter` interface'i tam da bunun için var.
- Gerçek e-posta sağlayıcısı — `EmailSender`/`InvitationSender` arkasında dosya tabanlı outbox.
- Generic repository/service framework'ü, DI container, karmaşık soyutlamalar.
- Doğrulama kütüphanesi (zod vb.) — doğrulama `src/lib/*/validation.ts` içinde elle yazılır.
