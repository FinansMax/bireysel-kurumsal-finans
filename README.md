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
  **Bilinen sınırlama:** Reset sonrası, reset'ten önce üretilmiş JWT session'ları stateless JWT
  mimarisi nedeniyle otomatik iptal edilmez (bkz. final rapor — ayrı bir security issue önerilir).
- **Kapsam dışı:** Route/endpoint bazlı yetkilendirme (RBAC) ve tenant seçimi ayrı issue'ların
  kapsamındadır.

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
