# bireysel-kurumsal-finans
Kurumsal ve bireysel kullanıma yönelik; çok kiracılı (multi-tenant), faturalandırma, çek takibi, otomatik cron hatırlatıcıları, rol tabanlı erişim kontrolü ve kapsamlı Excel/CSV veri içe/dışa aktarma özelliklerine sahip bulut tabanlı finansal yönetim SaaS platformu.

Kanban: https://github.com/orgs/21072026/projects/2

## Teknoloji Stack'i

- [Next.js](https://nextjs.org/) (App Router) + TypeScript
- [Tailwind CSS](https://tailwindcss.com/)
- [PostgreSQL](https://www.postgresql.org/) + [Prisma ORM](https://www.prisma.io/)
- [Auth.js](https://authjs.dev/) v5 (next-auth) — temel altyapı ve kayıt (sign-up) hazır, giriş/çıkış akışları henüz implement edilmedi
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
- **Kapsam dışı:** Giriş/çıkış ve şifre sıfırlama akışlarının kendisi henüz implement
  edilmemiştir (Credentials provider'ın `authorize` fonksiyonu şimdilik her denemeyi reddeder).
  Bu akışlar ayrı issue'larda eklenecektir.
