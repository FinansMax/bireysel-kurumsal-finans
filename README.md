# bireysel-kurumsal-finans
Kurumsal ve bireysel kullanıma yönelik; çok kiracılı (multi-tenant), faturalandırma, çek takibi, otomatik cron hatırlatıcıları, rol tabanlı erişim kontrolü ve kapsamlı Excel/CSV veri içe/dışa aktarma özelliklerine sahip bulut tabanlı finansal yönetim SaaS platformu.

Kanban: https://github.com/orgs/21072026/projects/2

## Teknoloji Stack'i

- [Next.js](https://nextjs.org/) (App Router) + TypeScript
- [Tailwind CSS](https://tailwindcss.com/)
- [PostgreSQL](https://www.postgresql.org/) + [Prisma ORM](https://www.prisma.io/)
- [Auth.js](https://authjs.dev/) v5 (next-auth) — kayıt, giriş/çıkış, şifre sıfırlama hazır; RBAC henüz implement edilmedi
- Docker / Docker Compose (lokal PostgreSQL)
- [Playwright](https://playwright.dev/) (E2E testler)
- ESLint

## Prerequisites

- Node.js 20+ ve npm
- Docker Desktop (lokal PostgreSQL için)

## Environment Setup

Proje kökünde `.env.example` dosyasını `.env` olarak kopyalayın:

```bash
cp .env.example .env
```

`.env` dosyası Git'e girmez; gerçek secret içermeden sadece lokal geliştirme değerlerini tutar.

## PostgreSQL'i Docker ile Çalıştırma

```bash
docker compose up -d
```

Bu komut `.env` dosyasındaki `POSTGRES_*` değişkenlerini kullanarak lokal bir PostgreSQL container'ı ayağa kaldırır.

## Local Development

```bash
npm install
npm run prisma:migrate   # veritabanı şemasını uygular
npm run dev              # http://localhost:3000
```

## Prisma Komutları

```bash
npm run prisma:generate  # Prisma Client üretir
npm run prisma:migrate   # migration oluşturur/uygular (dev)
npm run prisma:studio    # Prisma Studio'yu açar
```

## Test Komutları

```bash
npm run lint       # ESLint
npm run typecheck  # TypeScript tip kontrolü
npm run build      # production build
npm run test:e2e   # Playwright E2E smoke testleri
```

## Health Check

Uygulama ayaktayken `GET /api/health` endpoint'i `{ "status": "ok" }` döner.

## Authentication

Kimlik doğrulama altyapısı [Auth.js](https://authjs.dev/) v5 (`next-auth`) ile kurulmuştur (`src/lib/auth/`).

- **Session stratejisi: JWT.** Credentials provider Auth.js'te yalnızca JWT session stratejisiyle
  desteklenir (database-backed session ile çalışmaz); bu yüzden `session.strategy = "jwt"` seçildi.
  Bu seçim ayrıca `Account`/`Session`/`VerificationToken` Prisma modellerine ve bir DB adapter
  paketine ihtiyacı ortadan kaldırır.
- Şifreler Node'un yerleşik `crypto` modülü (`scrypt`) ile hash'lenir (`src/lib/auth/password.ts`);
  ek bir hashing paketi eklenmemiştir.
- `getCurrentUser()` (`src/lib/auth/current-user.ts`) sunucu tarafında mevcut oturumu okur;
  `requireUser()` (`src/lib/auth/guard.ts`) API route handler'larında kimlik doğrulamayı
  zorunlu kılan tekrar kullanılabilir bir guard'dır.
- `AUTH_SECRET` ortam değişkeni JWT'leri imzalamak için gereklidir. Lokal bir değer üretmek için:
  ```bash
  npx auth secret
  ```
- **Kayıt (sign-up):** `POST /api/auth/signup` (`{ email, password }`) e-posta + şifre ile yeni
  bir `User` oluşturur (`src/lib/auth/signup.ts`). Şifre `hashPassword` ile hash'lenir, e-posta
  normalize edilir (trim + lowercase) ve zaten kayıtlı bir e-postayla tekrar kayıt denemesi
  `409` ile reddedilir. Bu adım herhangi bir `Tenant`/`Membership` oluşturmaz.
- **Giriş (sign-in) / Çıkış (sign-out):** Credentials provider'ın `authorize` fonksiyonu
  (`src/lib/auth/authenticate.ts`) e-posta + şifreyi mevcut `verifyPassword`'a karşı doğrular.
  Giriş, Auth.js'in kendi `/api/auth/callback/credentials` endpoint'i üzerinden yapılır; çıkış
  için yine Auth.js'in kendi `/api/auth/signout` endpoint'i kullanılır (her ikisi de
  `src/app/api/auth/[...nextauth]/route.ts`'teki mevcut catch-all handler'dan otomatik
  sağlanır, ek route eklenmemiştir). Bilinmeyen e-posta ile yanlış şifre AYNI genel hatayı
  verir ve aynı hesaplama maliyetine sahiptir (user enumeration / timing side-channel'a karşı).
  **Session süresi: 8 saat.** Finansal bir SaaS için Auth.js'in varsayılan 30 günlük JWT
  ömrü fazla geniş olduğundan `session.maxAge` 8 saate düşürüldü (`src/lib/auth/config.ts`).
  **Mimari not:** Stateless JWT session kullanıldığı için sign-out sadece istemcinin cookie'sini
  temizler; sign-out'tan önce yakalanmış bir JWT, kendi `exp`'ine (artık en fazla 8 saat) kadar
  teorik olarak hâlâ geçerlidir — sunucu tarafında bir revocation listesi yoktur ve bu bilinçli
  olarak ayrı bir issue'ya bırakılmıştır (bkz. `security/signin-signout-security.spec.ts`).
- **Şifre sıfırlama:** `POST /api/auth/forgot-password` (`{ email }`) ve `POST /api/auth/reset-password`
  (`{ token, password }`) (`src/lib/auth/password-reset.ts`). Reset token'ı `crypto.randomBytes(32)`
  (256 bit) ile üretilir; DB'de (`PasswordResetToken.tokenHash`) SADECE SHA-256 hash'i saklanır,
  raw token hiçbir zaman saklanmaz. Token 30 dakika sonra geçersiz olur ve tek kullanımlıktır —
  tüketim, race condition'a kapalı tek bir atomik `updateMany` (`WHERE tokenHash = ? AND usedAt
  IS NULL AND expiresAt > now()`) ile yapılır. `forgot-password`, kayıtlı/kayıtsız e-posta için
  her zaman aynı genel mesajı döner (user enumeration engeli). Gerçek e-posta gönderimi kapsam
  dışıdır; `EmailSender` interface'i (`src/lib/auth/email.ts`) arkasında, production'da gerçek
  bir sağlayıcıyla değiştirilebilecek minimal bir konsol/dosya tabanlı implementasyon kullanılır.
  Reset sonrası, reset'ten önce üretilmiş JWT session'ları artık otomatik iptal edilir — bkz.
  aşağıdaki "Session Revocation".
- **Kapsam dışı:** Route/endpoint bazlı yetkilendirme (RBAC) ve tenant seçimi ayrı issue'ların
  kapsamındadır.

### Session Revocation (Issue #26)

Kritik bir credential (şifre) değişikliğinden ÖNCE üretilmiş JWT session'ları, sonraki istekte
otomatik olarak geçersiz sayılır. Database session / refresh token / blacklist YOKTUR —
stateless Auth.js JWT mimarisi korunur.

- **Nasıl çalışır:** `User.credentialsChangedAt` (nullable `DateTime`) her şifre değişikliğinde
  güncellenir (`src/lib/auth/credentials.ts`'teki `updateUserPassword()` — passwordHash ile AYNI
  UPDATE ifadesinde, atomik olarak). Auth.js'in `session` callback'i (`src/lib/auth/config.ts`)
  her `auth()`/`getCurrentUser()` çağrısında, `token.sub` ile TEK bir DB sorgusu yapıp
  `credentialsChangedAt`'i okur ve `token.iat` (JWT üretim zamanı) ile karşılaştırır
  (`isSessionRevoked()`, `src/lib/auth/session-revocation.ts`).
- **Precision:** JWT `iat` Unix SANİYE hassasiyetinde, `credentialsChangedAt` ise milisaniye
  hassasiyetindedir. Yanlışlıkla yeni (geçerli) bir session'ı revoke etmemek için, bir token'ın
  `iat` saniyesinin TAMAMI hâlâ geçerli kabul edilir — sadece `credentialsChangedAt`, o saniye
  tamamen bittikten SONRA ise revoke edilir (en fazla ~1 saniyelik bilinçli bir "grace window").
- **Revoke edilen bir session için** `getCurrentUser()` yine `null`, `GET /api/auth/me` yine
  `401` döner — public contract değişmez, `500`/exception üretilmez.
- **Migration güvenliği:** `credentialsChangedAt` nullable'dır; `null` = hiç credential
  değiştirilmedi, hiçbir session revoke edilmez (mevcut kullanıcılar migration sonrası
  etkilenmez).
- **Rol/membership değişiklikleri bu mekanizmayı TETİKLEMEZ** — sadece credential (şifre)
  değişiklikleri.
- **Bağımlılık notu:** Authenticated (login sonrası, mevcut şifreyi bilerek) password change
  endpoint'i bu repo'da HENÜZ mevcut değil (Epic 3 kapsamında beklemektedir). Password reset
  (#7) akışı bu issue kapsamında tam entegre edilmiştir; `updateUserPassword()` reusable bir
  primitive olarak tasarlanmıştır ve authenticated password change eklendiğinde AYNI fonksiyon
  kullanılmalıdır.

## Rate Limiting (Issue #27)

Auth ve tenant-creation endpoint'leri, brute-force / otomatik spam trafiğine karşı IP + endpoint
bazlı bir sliding-window rate limiter ile korunur (`src/lib/rate-limit/`).

- **Korunan endpoint'ler ve limitler** (`src/lib/rate-limit/policies.ts` — tek kaynak, magic
  number route'lara dağıtılmaz):

  | Endpoint | Limit | Bucket prefix |
  | --- | --- | --- |
  | `POST /api/auth/callback/credentials` (sign-in) | 10 / 5 dk | `auth:sign-in` |
  | `POST /api/auth/signup` | 5 / 10 dk | `auth:sign-up` |
  | `POST /api/auth/forgot-password` | 5 / 15 dk | `auth:forgot-password` |
  | `POST /api/tenants` (tenant oluşturma) | 10 / 10 dk | `tenant:create` |

- **Kullanım:** `checkRateLimit(request, bucket, policy)` (`src/lib/rate-limit/guard.ts`) mevcut
  `requireUser()` / `requirePermission()` guard'larıyla AYNI deseni izler: limit aşılmışsa hazır
  bir `NextResponse` (429), aşılmamışsa `null` döner. Kontrol her zaman business logic'ten
  (body parse, DB erişimi, `requireUser()` dahil) ÖNCE yapılır — 429 durumunda hiçbir side-effect
  tetiklenmez.
- **429 response'u:** Sabit, bilgi sızdırmayan bir gövde (`{ "error": "Too many requests. Please
  try again later." }`) ve saniye cinsinden bir `Retry-After` header'ı döner. IP, bucket key,
  kullanıcı kimliği veya deneme sayısı response'a ASLA yazılmaz.
- **Sliding window (fixed window DEĞİL):** Her `consume()` çağrısında "şu andan `windowMs`
  öncesine kadar" olan pencere yeniden değerlendirilir; pencere sınırında ani bir reset yoktur.
  Reddedilen denemeler bucket'a kaydedilmez — yani başarısız istekler kotayı tüketmez ve pencereyi
  uzatmaz.
- **Concurrency:** `InMemoryRateLimiter.consume()` içinde hiç `await` yoktur; okuma + hesaplama +
  yazma tek senkron blokta yapıldığı için tek process içinde atomiktir (aynı key'e eşzamanlı
  `Promise.all` istekleri limiti bypass edemez).
- **Bellek:** Bucket başına timestamp sayısı kendi `limit`'i ile sınırlıdır; boşalan bucket'lar
  Map'ten silinir ve `maxTrackedBuckets` (varsayılan 10.000) eşiği aşılınca gerçek bir `consume()`
  çağrısına "binen" lazy bir sweep tamamen expire olmuş bucket'ları temizler. Background
  worker/timer kurulmaz.
- **Sign-in neden route seviyesinde?** Auth.js Credentials provider'ının `authorize()` callback'i
  yalnızca `User | null` döndürebilir; özel bir 429 status'u veya `Retry-After` header'ı
  üretemez. Bu yüzden sign-in limiti, NextAuth yapılandırmasına hiç dokunmadan, credentials
  callback POST'u `handlers.POST`'a devredilmeden ÖNCE
  (`src/app/api/auth/[...nextauth]/route.ts`) uygulanır — pahalı scrypt doğrulaması hiç
  çalışmaz. Diğer auth action'ları (signout, csrf, vb.) etkilenmez.
- **User enumeration:** `forgot-password` limiti yalnızca IP + endpoint'e bakar, e-postaya hiç
  bakmaz; kayıtlı/kayıtsız e-posta arasında davranış farkı yaratmaz (Issue #7 koruması korunur).
- **⚠️ Proxy trust varsayımı:** İstemci IP'si `x-forwarded-for` header'ının İLK segmentinden
  okunur (`src/lib/rate-limit/request-key.ts`). Bu, uygulamanın önünde bu header'ı kendisi set
  eden güvenilir bir reverse-proxy / load balancer (ör. Vercel, nginx) olduğunu varsayar — tıpkı
  `authConfig.trustHost: true`'nun zaten varsaydığı gibi. **Güvenilir bir proxy olmadan doğrudan
  internete açılırsa**, istemci bu header'ı sahteleyerek kendi bucket'ını değiştirebilir ve rate
  limit'i etkisiz kılabilir. Header eksik veya malformed ise tüm bu istekler ortak bir `unknown`
  bucket'ını paylaşır — IP bulunamaması limiter'ı bypass ETMEZ.
- **Kapsam dışı:** Limiter process-local'dir; çok instance'lı bir deployment'ta her instance kendi
  sayacını tutar. Distributed rate limiting (Redis vb.) bu issue'nun kapsamı dışındadır —
  `RateLimiter` interface'i (`src/lib/rate-limit/types.ts`) tam da bu yüzden vardır: route
  kodu hiç değişmeden `src/lib/rate-limit/limiter.ts`'teki tek satır shared-store bir
  implementasyonla değiştirilebilir.

## Tenant Davetleri (Invitations)

Bir tenant'a yeni kullanıcı davet etme akışı (`src/lib/tenants/invitation.ts`).

- **Davet oluşturma:** `POST /api/tenants/[tenantId]/invitations` (`{ email, role }`). Sadece
  `OWNER`/`ADMIN` davet oluşturabilir (`PERMISSIONS.SEND_INVITE`, Issue #12); `MEMBER` `403` alır.
  `tenantId` her zaman `requirePermission()`'ın DB'den doğruladığı trusted active tenant
  context'inden gelir (Issue #13) — URL/body'deki değerler kaynak değildir. E-posta normalize
  edilir (trim + lowercase). **Least privilege:** `updateMemberRole`'daki ("ADMIN kimseyi OWNER
  yapamaz") ile AYNI kural — sadece `OWNER`, `OWNER` rolüyle davet gönderebilir; `ADMIN`'in
  denemesi `403` ile reddedilir.
- **Duplicate pending invitation politikası:** aynı tenant + aynı email için zaten aktif
  (kullanılmamış, iptal edilmemiş) bir davet varsa, yeni davet oluşturulmadan önce eskisi
  `cancelledAt` ile geçersiz kılınır — böylece her zaman en fazla bir aktif davet bulunur ve eski
  token'ın kabul edilmesi mümkün olmaz. Bu "eskisini iptal et + yenisini oluştur" adımı, aynı
  tenant+email için eşzamanlı iki isteğe karşı Serializable bir transaction içinde yapılır (bkz.
  `src/lib/tenants/membership.ts`'teki last-OWNER korumasıyla aynı teknik); bir yazma çakışması
  oluşursa otomatik olarak yeniden denenir.
- **Token güvenliği:** `PasswordResetToken` (Issue #7) ile AYNI yaklaşım — `crypto.randomBytes(32)`
  (256 bit) ile üretilir, DB'de (`TenantInvitation.tokenHash`) SADECE SHA-256 hash'i saklanır, raw
  token hiçbir zaman saklanmaz veya production loglarına yazılmaz. Token 7 gün sonra geçersiz olur
  ve tek kullanımlıktır.
- **Davet kabul etme:** `POST /api/invitations/accept` (`{ token }`). Authentication zorunludur
  (`requireUser()`); signup/login bu issue'nun kapsamında yeniden implement edilmez. Kontroller:
  token bulunuyor mu, süresi dolmuş mu, kullanılmış mı, iptal edilmiş mi (hepsi için AYNI genel
  `400` hatası — enumeration'a karşı), authenticated kullanıcının e-postası davetteki email ile
  eşleşiyor mu (`403`, e-posta kontrolü token TÜKETİLMEDEN önce yapılır ki yanlış hesap daveti
  kalıcı olarak yakmasın), kullanıcı zaten tenant member mı (`409`, duplicate membership/privilege
  escalation OLUŞTURULMAZ). Başarılı kabul, membership oluşturma + invitation'ı `usedAt` ile
  tüketme işlemini TEK bir atomic transaction içinde yapar; eşzamanlı iki kabul isteğinden yalnızca
  biri kazanır.
- Gerçek e-posta gönderimi kapsam dışıdır; `InvitationSender` interface'i
  (`src/lib/tenants/invitation-email.ts`) arkasında, `EmailSender` (şifre sıfırlama) ile AYNI
  desende minimal bir konsol/dosya tabanlı implementasyon kullanılır.
