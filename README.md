# bireysel-kurumsal-finans
Kurumsal ve bireysel kullanıma yönelik; çok kiracılı (multi-tenant), faturalandırma, çek takibi, otomatik cron hatırlatıcıları, rol tabanlı erişim kontrolü ve kapsamlı Excel/CSV veri içe/dışa aktarma özelliklerine sahip bulut tabanlı finansal yönetim SaaS platformu.

Kanban: https://github.com/orgs/21072026/projects/2

## Geliştirme Rehberi

Bu README, ürün dokümantasyonunun yanı sıra bir **karar kaydıdır**: aşağıdaki bölümlerde her
güvenlik kararının gerekçesi ve kabul edilen kalan riski yazılıdır. Kod yazmadan önce ilgili
bölümü okuyun.

Katkı kuralları ayrı dosyalarda tutulur:

| Dosya | İçerik |
| --- | --- |
| [`docs/security-invariants.md`](docs/security-invariants.md) | Pazarlığa kapalı güvenlik kuralları ve nasıl zorlandıkları |
| [`docs/architecture.md`](docs/architecture.md) | Katmanlar, dizin haritası, route/servis anatomisi, yeni model ekleme |
| [`docs/conventions.md`](docs/conventions.md) | TypeScript, isimlendirme, yorum, Prisma ve hata yönetimi konvansiyonları |
| [`docs/testing.md`](docs/testing.md) | Üç test suite'i, ne nereye yazılır, bilinen tuzaklar |
| [`docs/workflow.md`](docs/workflow.md) | Branch, commit, PR ve Definition of Done |
| [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md) | Kodlama ajanları için aynı kuralların özeti |

## Teknoloji Stack'i

- [Next.js](https://nextjs.org/) (App Router) + TypeScript
- [Tailwind CSS](https://tailwindcss.com/)
- [PostgreSQL](https://www.postgresql.org/) + [Prisma ORM](https://www.prisma.io/)
- [Auth.js](https://authjs.dev/) v5 (next-auth) — kayıt, giriş/çıkış, şifre sıfırlama, session revocation; RBAC ve tenant izolasyonu backend'de zorlanır (bkz. `docs/security-invariants.md`)
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

### Ortam Değişkenleri

| Değişken | Zorunlu | Açıklama |
| --- | --- | --- |
| `DATABASE_URL` | Her ortamda | PostgreSQL bağlantı adresi (Prisma). |
| `AUTH_SECRET` | Her ortamda | JWT session token'larını imzalar/şifreler. `npx auth secret` ile üretilir. |
| `APP_BASE_URL` | **Production'da** | Uygulamanın dışarıya görünen kök adresi. |
| `POSTGRES_*` | Lokal | Yalnızca `docker-compose.yml`'in lokal PostgreSQL container'ını kurmak için. |

**`APP_BASE_URL` neden production'da zorunlu:** Şifre sıfırlama ve tenant daveti
**e-postalarındaki mutlak linkler** bu değerden üretilir. Değişken eskiden yoksa sessizce
`http://localhost:3000`'e düşüyordu — yani production'da gönderilen her reset/davet linki
çalışmıyor, üstelik hiçbir hata üretilmediği için bu fark edilmiyordu. Artık production'da
değişken yoksa (veya mutlak bir `http(s)` URL değilse) uygulama bilerek hata verir
(`src/lib/config/app-url.ts`).

Değer, e-posta gönderen akışlarda **herhangi bir DB erişiminden önce** çözülür. Bu bir detay
değil, gerekliliktir: aksi halde yanlış yapılandırılmış bir production'da "kayıtlı e-posta →
500, kayıtsız e-posta → 200" farkı oluşur ve Issue #7'de kapatılan user-enumeration oracle'ı
geri gelirdi. Regresyon testi: `integration/app-url.spec.ts`.

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
npm run lint              # ESLint
npm run typecheck         # TypeScript tip kontrolü
npm run build             # production build
npm run test:integration  # src/lib fonksiyonları, DB'ye karşı (tarayıcısız)
npm run test:security     # yetki / tenant izolasyonu / enumeration testleri
npm run test:e2e          # Playwright E2E (gerçek Chromium)
```

Üç test suite'inin ne zaman hangisinin kullanılacağı ve bilinen tuzaklar için
[`docs/testing.md`](docs/testing.md).

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

  **User enumeration — bilinçli bir tercih (Issue #106):** Bu `409`, kimlik doğrulaması
  gerektirmeden "bu e-postanın hesabı var mı?" sorusunu yanıtlar; yani signup, sign-in ve
  forgot-password'ün AKSİNE enumeration'a karşı sertleştirilmemiştir. Bu bir gözden kaçma
  değil, gözden geçirilmiş bir karardır:

  - Sign-in ve forgot-password'de bilgiyi sızdırmak GEREKSİZDİR — kullanıcıya "e-posta yanlış"
    demek hiçbir işlevsel değer katmaz, o yüzden oralarda yanıt (ve sign-in'de hesaplama
    maliyeti) eşitlenmiştir.
  - Signup'ta ise durum terstir: meşru bir kullanıcının çok sık karşılaştığı senaryo "hesabım
    olduğunu unutmuşum"dur ve ona bunu doğrudan söylemek akışın işleyişi için gereklidir.
  - Bilgiyi gizlemenin tek doğru yolu ("aynı genel yanıtı dön, gerçek durumu e-posta ile
    bildir") ÇALIŞAN bir e-posta kanalı gerektirir. Bu repo'da gerçek bir sağlayıcı yoktur
    (`EmailSender` arkasında konsol/dosya tabanlı bir implementasyon vardır), dolayısıyla o
    yaklaşım production'da meşru kullanıcıyı "e-postanı kontrol et" deyip hiçbir şey
    göndermeyen bir çıkmaza sokardı — sızıntıdan daha büyük bir zarar.

  Sızıntı, signup rate limit'i (IP başına 5/10dk, bkz. "Rate Limiting") ile sınırlanır ama
  ortadan KALKMAZ. Gerçek bir e-posta sağlayıcısı entegre edildiğinde bu karar yeniden
  değerlendirilmelidir.
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
  **Raw token production loglarına yazılmaz:** `consoleEmailSender` production'da yalnızca
  alıcıyı loglar, `resetUrl`'i (dolayısıyla raw token'ı) loglamaz — aksi halde log erişimi olan
  biri, son 30 dakika içinde reset talebinde bulunmuş herhangi bir hesabı devralabilirdi
  (regresyon testi: `integration/email-sender-logging.spec.ts`).
  Reset sonrası, reset'ten önce üretilmiş JWT session'ları artık otomatik iptal edilir — bkz.
  aşağıdaki "Session Revocation".
- **Şifre değiştirme (authenticated):** `POST /api/auth/change-password`
  (`{ currentPassword, newPassword }`) (`src/lib/auth/change-password.ts`, Issue #33). "Şifremi
  unuttum" akışından (#7) farklıdır: buradaki kanıt bir e-posta token'ı değil, kullanıcının
  MEVCUT şifresidir.

  - **Neden mevcut şifre doğrulanır:** Session cookie'si çalınmış bir saldırgan, bu adım
    olmadan şifreyi değiştirip hesabı kalıcı olarak devralabilirdi. Bu kontrol, session
    hırsızlığı ile tam hesap devralma arasındaki adımı kapatır (regresyon testi:
    `security/change-password-security.spec.ts` → "geçerli session + YANLIŞ mevcut şifre").
  - **Kontrol sırası:** Önce mevcut şifre doğrulanır, SONRA yeni şifre politikası kontrol
    edilir — mevcut şifresini kanıtlayamayan bir çağrıya hiçbir ek geri bildirim verilmez.
    (Password reset'te sıra terstir: orada erken doğrulama, tek kullanımlık token'ın zayıf bir
    şifre yüzünden boşa yanmasını engeller; burada yakılacak token yoktur.)
  - **Bilgi sızdırmama:** Yanlış şifre / eksik-boş girdi / şifresiz hesap (`passwordHash` null,
    ileride OAuth ile oluşturulmuş hesaplar) durumlarının HEPSİ aynı `401` ve aynı genel mesajı
    döner. Şifresiz bir hesaba bu akışla şifre BELİRLENEMEZ — doğrulanacak mevcut şifre yoktur.
  - **Yan etkisizlik:** Mevcut şifre yanlışsa veya yeni şifre politikaya takılıyorsa hiçbir
    yazma yapılmaz; özellikle `credentialsChangedAt` bumplanmaz. Aksi halde geçersiz bir istek,
    kullanıcının tüm oturumlarını düşürebilirdi.
  - **Audit:** Başarılı değişiklik `AUTH_PASSWORD_CHANGED`, başarısız deneme
    `AUTH_PASSWORD_CHANGE_FAILURE` olarak kaydedilir. Login failure'ın AKSİNE burada
    `actorUserId` doldurulur (istek zaten authenticated'dır, enumeration sinyali taşımaz); bir
    hesapta arka arkaya gelen failure kaydı, çalınmış session ile şifre tahmini girişiminin en
    doğrudan göstergesidir.
  - **Eşzamanlılık:** "Oku → scrypt ile doğrula → yaz" arasında teorik bir TOCTOU penceresi
    vardır (scrypt doğrulaması SQL'e indirgenemez). Bilinçli olarak kabul edilmiştir: bu
    pencereyi kullanabilecek tek senaryo eşzamanlı bir password reset veya ikinci bir
    change-password isteğidir; her ikisi de zaten hesap sahibinin kendi yetkisiyle yaptığı
    meşru credential değişiklikleridir, sonuç "son yazan kazanır" olur ve yetki yükselmesi
    doğmaz. Pahalı scrypt çağrısını bir DB transaction'ı içinde tutmak bu nedenle gereksiz
    maliyet olurdu.
  - **⚠️ Kullanıcı kendi oturumundan da düşer:** Değişiklik `credentialsChangedAt`'i bumpladığı
    için, isteği yapan kullanıcının KENDİ session'ı da geçersizleşir ve yeniden giriş yapması
    gerekir. Stateless JWT mimarisinde "bu isteği yapan token"ı ayrıcalıklı kılmanın bir yolu
    yoktur (sunucu tarafında token kaydı tutulmadığından, tek tek token'lar birbirinden ayırt
    edilemez); "diğer tüm oturumları kapat ama bunu açık tut" davranışı ancak session store
    eklenirse mümkün olur. Yanıt mesajı bu yüzden açıkça "Please sign in again." der.
  - **Kapsam dışı (bilinçli):** "Yeni şifre eskisiyle aynı olamaz" kuralı bu issue'nun kabul
    kriterlerinde yoktur ve eklenmemiştir; gerekirse ayrı bir issue ile değerlendirilir.
- **Kapsam dışı:** Route/endpoint bazlı yetkilendirme (RBAC) ve tenant seçimi ayrı issue'ların
  kapsamındadır.

### Session Revocation (Issue #26)

Kritik bir credential (şifre) değişikliğinden ÖNCE üretilmiş JWT session'ları, sonraki istekte
otomatik olarak geçersiz sayılır. Database session / refresh token / blacklist YOKTUR —
stateless Auth.js JWT mimarisi korunur.

- **Nasıl çalışır:** `User.credentialsChangedAt` (nullable `DateTime`) her şifre değişikliğinde
  güncellenir (`src/lib/auth/credentials.ts`'teki `updateUserPassword()` — passwordHash ile AYNI
  UPDATE ifadesinde, atomik olarak). Auth.js'in **`jwt` callback'i** (`src/lib/auth/config.ts`)
  her istekte, `token.sub` ile TEK bir DB sorgusu yapıp `credentialsChangedAt`'i okur ve
  `token.iat` (JWT üretim zamanı) ile karşılaştırır (`isSessionRevoked()`,
  `src/lib/auth/session-revocation.ts`). Revoke edilmişse callback `null` döner.
- **Kontrol neden `jwt` callback'inde (ve `session` callback'inde DEĞİL):** Auth.js'in session
  action'ı `GET /api/auth/session` isteğinde token'ı **her zaman yeniden imzalar** ("Refresh JWT
  expiry by re-signing it") ve tazelenmiş cookie'yi response'a ekler; yeni token TAZE bir `iat`
  alır. `session` callback'i yalnızca response GÖVDESİNİ şekillendirdiği için bu yeniden
  imzalamayı engelleyemez — kontrol orada yapılsaydı, çalınmış bir reset-öncesi cookie tek bir
  `GET /api/auth/session` çağrısıyla tazelenip tekrar geçerli hale gelir ve revocation tamamen
  bypass edilirdi (üstelik `exp` de ilerlediği için token süresiz yenilenebilirdi). `jwt`
  callback'i `null` döndüğünde ise Auth.js token'ı yeniden imzalamak yerine session cookie'sini
  TEMİZLER ve gövdeyi `null` bırakır — bu yüzden revoke kararı orada verilir. Regresyon testi:
  `security/session-revocation-security.spec.ts` içindeki "GET /api/auth/session üzerinden
  bypass edilemez" bloğu.
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
- **Şifre değiştiren tüm akışlar bu mekanizmaya bağlıdır:** Password reset (#7) ve authenticated
  password change (#33) — her ikisi de `updateUserPassword()` üzerinden yazar, dolayısıyla ikisi
  de session revocation'ı tetikler. Şifre hash'ini değiştiren yeni bir akış eklenirse kendi
  `prisma.user.update()` çağrısını YAZMAMALI, aynı fonksiyonu kullanmalıdır; aksi halde
  `credentialsChangedAt` bumplanmaz ve revocation o akış için sessizce devre dışı kalır.

## Kullanıcı Profili (Issue #31)

Authenticated kullanıcının kendi profilini görüntüleyip güncellemesi
(`src/lib/users/`, `src/app/api/users/me/route.ts`).

- **`GET /api/users/me`** → `{ user: { id, email, name, createdAt } }`.
- **`PATCH /api/users/me`** `{ name }` → güncellenmiş profili aynı biçimde döner.

Notlar:

- **Hangi kullanıcı?** Sorunun tek cevabı trusted session'dır (`requireUser()` → `user.id`).
  Endpoint başka bir kullanıcıyı hedefleyecek parametre KABUL ETMEZ; body'deki `userId`/`email`
  okunmaz bile.
- **Güncellenebilir tek alan `name`'dir** ve bu kısıtlama filtreleme ile değil YAPISAL olarak
  sağlanır: servis, gelen `input` nesnesini Prisma'ya geçirmez; yalnızca doğruladığı `name`
  değerini açıkça yazar. Body'ye `email`/`passwordHash`/`credentialsChangedAt` eklemek hiçbir
  etki yaratmaz (regresyon testi: `security/user-profile-security.spec.ts` → "body'deki ekstra
  alanlar YOK SAYILIR").
- **E-posta bu endpoint'ten değiştirilemez:** hem giriş kimliği hem `@unique` olduğu için
  değişimi yeni adrese onay maili gerektirir — ayrı bir issue'nun konusudur.
- **Yanıt alan allowlist'i dardır** (`profileSelect`): `passwordHash`, `credentialsChangedAt`,
  `emailVerified` yanıta ASLA girmez. Yeni bir alan eklenmeden önce "bu bilgi client'a gitmeli
  mi?" sorusu yanıtlanmalıdır.
- **Doğrulama:** `name` trim'lenir ve 2–100 karakter olmalıdır (`src/lib/users/validation.ts`).
  Uzunluk kontrolü trim SONRASI yapılır — aksi halde yalnızca boşluktan oluşan bir girdi geçerdi.
  Karakter kümesi bilinçli olarak kısıtlanmaz: isimler uluslararasıdır ve regex ile "geçerli
  isim" tanımlamaya çalışmak meşru kullanıcıları dışlar.
- **`/api/auth/me` ile farkı:** `/api/auth/me` oturumun (JWT'nin) içeriğini yansıtır;
  `/api/users/me` veritabanının güncel halini döner. ⚠️ **Bilinen tutarsızlık:** JWT'deki `name`
  sign-in anında sabitlendiği için, profil güncellendikten sonra `/api/auth/me` bir sonraki
  girişe kadar ESKİ adı göstermeye devam eder. Bu, bu issue'nun kapsamı dışında bırakıldı;
  çözümü, `jwt` callback'inin zaten her istekte yaptığı DB sorgusuna `name`'i eklemek olurdu
  (bkz. `src/lib/auth/config.ts`) — session revocation yolunu etkilediği için ayrı bir issue
  ile ele alınmalıdır.
- **Rate limit yoktur (bilinçli):** Endpoint authenticated'dır, credential doğrulamaz veya
  değiştirmez, e-posta göndermez ve pahalı bir hesaplama yapmaz — yani `change-password`'ün
  aksine burada brute-force edilebilecek bir sır yoktur. Gelecekte kötüye kullanım görülürse
  mevcut `checkRateLimit()` ile tek satırda eklenebilir.
- **Audit log yazılmaz (bilinçli):** İsim değişikliği güvenlik açısından kritik bir olay
  değildir; audit kataloğu (`src/lib/audit/actions.ts`) auth/tenant/membership olaylarına
  odaklıdır. Profil alanları hassaslaşırsa (ör. e-posta değişimi eklenirse) bu yeniden
  değerlendirilmelidir.

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
  | `POST /api/auth/reset-password` | 10 / 15 dk | `auth:reset-password` |
  | `POST /api/auth/change-password` | 10 / 15 dk | `auth:change-password` |
  | `POST /api/tenants` (tenant oluşturma) | 10 / 10 dk | `tenant:create` |

  `change-password`, listedeki tek **authenticated** credential-değiştirme endpoint'idir; limiti
  yine de authentication'dan ÖNCE uygulanır, çünkü korunmak istenen tehdit "çalınmış bir session
  cookie'siyle mevcut şifreyi online brute-force etmek"tir (bkz. Issue #33). Limit IP bazlıdır
  (kullanıcı bazlı değil) — mevcut `checkRateLimit()` sözleşmesiyle tutarlı kalmak için; kullanıcı
  bazlı bir bucket gerekirse ayrı bir issue ile eklenmelidir.

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

## Auth Ekranları (Issue #36)

İlk gerçek arayüz ekranları: `/login` ve `/signup` (`src/app/login`, `src/app/signup`;
paylaşılan sunum bileşenleri `src/components/auth-form.tsx`). Mock veri yoktur — formlar
mevcut API'lere gerçek HTTP istekleri atar.

### ⚠️ Neden client component, neden Server Action DEĞİL

Bu bir stil tercihi değil, **güvenlik gereğidir**:

`next-auth`'un **sunucu tarafı** `signIn()`'i (`node_modules/next-auth/lib/actions.js`)
bellekte bir `Request` nesnesi üretip `Auth()`'u **doğrudan** çağırır ve üstelik
`skipCSRFCheck` geçer. Yani istek hiçbir zaman HTTP üzerinden gitmez ve
`src/app/api/auth/[...nextauth]/route.ts` **çalışmaz** — oysa sign-in rate limitinin
(Issue #27) uygulandığı tek yer orasıdır. Bir Server Action'a geçmek, brute-force korumasını
ve Auth.js'in kendi CSRF kontrolünü **sessizce** devre dışı bırakırdı.

**İstemci tarafı** `signIn()` ise önce CSRF token'ı alır, sonra
`/api/auth/callback/credentials`'a gerçek bir HTTP POST atar — mevcut route'tan, dolayısıyla
rate limitten geçer. Aynı gerekçe signup için de geçerlidir: sayfa `registerUser()`'ı doğrudan
çağırmaz, `POST /api/auth/signup`'a istek atar.

Bu invariant `integration/auth-ui-pattern.spec.ts` ile otomatik olarak korunur.

### Diğer notlar

- **Hata mesajları Türkçedir ve status koduna göre eşlenir**; backend'in İngilizce iç metinleri
  (`"Password must be between 8 and 128 characters"`) kullanıcıya olduğu gibi gösterilmez.
- **Giriş hatası tek ve geneldir** ("E-posta veya şifre hatalı") — kayıtlı/kayıtsız e-posta
  ayrımı yapılmaz (user enumeration engeli). Signup'ta `409` ise açık bir mesaj gösterir; bu,
  Issue #106'da kayda geçmiş bilinçli kararın arayüze yansımasıdır.
- **429 ve ağ hatası aynı mesaja düşer.** İstemci `signIn()`, gövdesinde `url` alanı olmayan
  yanıtlarda (bizim 429 gövdemiz gibi) `new URL(undefined)` çağırıp **TypeError fırlatır** —
  hata döndürmez. Bu yüzden çağrı `try/catch` içindedir; blok kaldırılırsa rate limit'e takılan
  kullanıcı boş ekranla kalır.
- Başarılı kayıt sonrası otomatik giriş yapılmaz; kullanıcı `/login`'e yönlendirilir.
- Giriş sonrası `/dashboard`'a yönlendirilir (korumalı kabuk, Issue #39; bkz. aşağıdaki
  "Korumalı Kabuk" bölümü).

### Şifre sıfırlama ekranları (Issue #37)

`/forgot-password` ve `/reset-password?token=...`.

- **Genel mesaj arayüzde de korunur:** `/forgot-password`, e-posta kayıtlı olsun ya da
  olmasın **birebir aynı** mesajı gösterir. Backend zaten aynı 200'ü döner; arayüzün bunu
  "e-posta bulunamadı" gibi bir varyasyona çevirmesi, backend'de kapatılmış sızıntıyı UI
  katmanında yeniden açardı. Bu yüzden başarı durumunda status'a göre dallanma yapılmaz.
- **Token hataları ayrıştırılmaz:** "bulunamadı / süresi dolmuş / zaten kullanılmış" hepsi
  aynı mesaja düşer (backend duruşuyla aynı).
- **`/reset-password` bir sunucu bileşenidir**, form ise ayrı bir client component. Token'ı
  client'ta `useSearchParams()` ile okumak sayfayı bir `<Suspense>` sınırıyla sarmayı
  gerektirirdi; `searchParams`'ı sunucuda çözmek bu tuzağı tamamen ortadan kaldırır.
  (Next.js 16'da `searchParams` bir `Promise`'tir ve `await` edilir.)
- **URL'de token yoksa** form hiç render edilmez; kullanıcı doğrudan yeni bağlantı istemeye
  yönlendirilir — kesin başarısız olacak bir istek atılmaz.
- Token'ın prop olarak client'a geçmesi ek sızıntı değildir (değer zaten adres çubuğundadır);
  `Referrer-Policy: strict-origin-when-cross-origin` Referer üzerinden dışarı gitmesini
  engeller.

### `allowedDevOrigins` neden gerekli

`next dev`, dev-only varlıklara (`/_next/static/*`, HMR) yapılan cross-origin istekleri
varsayılan olarak engeller ve sunucu `localhost` ile başlatıldığından `127.0.0.1` farklı bir
origin sayılır. Playwright ise `baseURL` olarak `http://127.0.0.1:3000` kullanır — bu yüzden
tarayıcı testlerinde JS chunk'ları `403` alıyor, sayfa **hydrate olmuyor** ve client
component'lerdeki form handler'ları hiç çalışmıyordu (form native GET'e düşüp şifreyi URL'e
yazıyordu). Bu mismatch baştan beri vardı; client-side JS'e ihtiyaç duyan ilk ekranlar
eklenene kadar görünmedi. `next.config.ts`'teki `allowedDevOrigins` yalnızca development'ı
etkiler, production build'de karşılığı yoktur.

## Korumalı Kabuk (Issue #39)

Giriş yapmış kullanıcının gördüğü alan `(app)` route group'unun altındadır
(`src/app/(app)/layout.tsx` + `src/app/(app)/dashboard/page.tsx`; sunum
`src/components/app-shell.tsx`). Parantezli klasör adı URL'e yansımaz — `/login`, `/signup`
gibi public ekranlar root layout'un altında kalır ve kabuğu hiç almaz.

### Oturum kontrolü neden layout'ta "da", sadece layout'ta değil

`requirePageUser()` (`src/lib/auth/page-guard.ts`) hem layout'ta hem de korunan **her sayfada**
çağrılır. Next.js'in kendi rehberi (`node_modules/next/dist/docs/01-app/02-guides/authentication.md`
→ "Layouts and auth checks") layout kontrolüne tek başına güvenmemeyi söyler:

- **Partial rendering** nedeniyle layout'lar istemci tarafı gezinmelerde yeniden render
  **edilmez** — oturum her rota değişiminde kontrol edilmiş olmaz.
- Bir layout, alt segmentlerin render edilmesini (ve RSC payload'ında görünmesini)
  **engellemez**; "layout'ta `return null`" bir yetkilendirme mekanizması değildir.

Bu yönlendirme zaten savunmanın son hattı değildir: veriye erişen her API route'u kendi
`requireUser()`/`requirePermission()` kontrolünü yapar. Sayfa guard'ı bir **UX** kararıdır.

`getCurrentUser()` JWT'yi çözerken session revocation için bir DB sorgusu tetiklediğinden
(bkz. `callbacks.jwt`), layout + sayfa aynı istekte iki sorgu yapmasın diye sonuç React'in
`cache()`'i ile paylaşılır.

### Kayda geçen kararlar

- **`?next=<yol>` (callbackUrl) parametresi YOKTUR.** Kullanıcı kontrolündeki bir hedefi
  yönlendirmede kullanmak, doğrulaması unutulduğu anda **open redirect**'e dönüşen bir
  yüzeydir. "Giriş sonrası geldiği sayfaya dön" davranışı bu issue'nun kapsamında değildi;
  eklenirse yalnızca `/` ile başlayan (ve `//` ile başlamayan) yollar kabul edilmelidir.
- **Kabukta e-posta gösterilir, `session.user.name` değil.** JWT'deki `name` profil
  güncellemesinden sonra bayat kalıyor (açık hata: Issue #113); e-posta bu endpoint'lerle
  değiştirilemediği için aynı sorunu taşımaz.
- **Çıkış düğmesi istemci tarafı `signOut()` kullanır** (login/signup ile aynı gerekçe: sunucu
  tarafı `signOut()` `Auth()`'u doğrudan çağırıp `skipCSRFCheck` geçer, HTTP route'u hiç
  çalışmaz). Ayrıca `callbackUrl` ile **tam sayfa** yönlendirme yapılır: yumuşak bir gezinme,
  Next.js'in istemci router cache'indeki korumalı sayfaları ekranda bırakabilirdi. Regresyon
  koruması: `integration/auth-ui-pattern.spec.ts`.
- **Henüz var olmayan menü öğeleri link değildir** (`NAV_ITEMS` içinde `href: null`), devre dışı
  metin olarak render edilir — link olsalardı kullanıcıyı 404'e götürürlerdi.

E2E kanıtı: `e2e/app-shell.spec.ts` (oturumsuz erişimde yönlendirme + kabuğun hiç render
edilmemesi, oturumlu erişimde kabuk, çıkış sonrası oturumun gerçekten kapanması).

### Tenant switcher (Issue #40)

Kabuk header'ındaki çalışma alanı seçici (`src/components/tenant-switcher.tsx`). Seçenekler
**sunucuda**, oturum sahibinin membership'lerinden üretilir (`listTenantsForUser()`); seçim
mevcut `POST /api/tenants/active` endpoint'ine gider.

- **"Üyesi olmadığı tenant seçilemez" garantisi arayüzden gelmez.** Liste kullanıcıya yalnızca
  kendi tenant'larını gösterir, ama asıl kontrol backend'dedir: endpoint, membership'i her
  istekte DB'den doğrular ve üye değilse **403** döner ("tenant yok" ile "üye değilsin" aynı
  yanıta düşer — enumeration engeli). E2E, seçiciyi baypas edip doğrudan istek atarak bunu
  kanıtlar.
- **Aktif tenant otomatik SEÇİLMEZ.** Sayfa render'ı bir `GET`'tir; orada cookie yazmak
  "GET yan etkisizdir" invariant'ını (CSRF duruşunun dayanağı) ihlal ederdi. Aktif tenant yokken
  seçici bir placeholder gösterir ve seçimi kullanıcı yapar.
- **Başarılı geçişte tam sayfa yükleme yapılır, `router.refresh()` değil.** `refresh()` istemci
  cache'ini yalnızca **mevcut** route için temizler (Next.js `useRouter` dokümanı); çok kiracılı
  bir üründe diğer route'ların cache'inde eski tenant'ın verisi kalır ve kullanıcı oraya
  geçtiğinde yanlış çalışma alanının verisini görürdü.
- **Hata mesajı ayrıştırılmaz:** 403/404/ağ hatası tek bir Türkçe mesaja düşer; başarısız
  seçimde kutu sunucudan gelen gerçek duruma geri alınır.
- `resolveActiveTenantForUser()` (`src/lib/tenants/tenant-context.ts`), kullanıcı zaten
  elimizdeyken oturumu **yeniden çözmeden** aktif tenant'ı okur — `getActiveTenant()` aynı
  istekte ikinci bir session-revocation DB sorgusu tetiklerdi.

E2E kanıtı: `e2e/tenant-switcher.spec.ts`. Geçişin gerçekten sunucu tarafında olduğu, seçici
kutusundaki değere değil, aktif tenant'a bağlı gerçek bir endpoint'e bakılarak doğrulanır
(aktif tenant A iken A→200 / B→403, geçişten sonra tersi; hiç seçim yokken 400).

### Çalışma alanı oluşturma ekranı (Issue #42)

`/tenants/new` (`src/app/(app)/tenants/new/`). Kabuk menüsündeki "Yeni Çalışma Alanı"
bağlantısından erişilir; oluşturan kullanıcı OWNER olur (`createTenant()`).

- **Servis doğrudan çağrılmaz, `POST /api/tenants`'a HTTP isteği atılır.** Tenant oluşturma
  rate limiti (Issue #27) route seviyesindedir; `createTenant()`'ı bir Server Action'dan
  çağırmak otomatik tenant üretimine karşı korumayı sessizce baypas ederdi. Regresyon koruması:
  `integration/auth-ui-pattern.spec.ts` (auth ekranlarıyla aynı tabloya eklendi).
- **`409` (kullanılan adres) açık bir mesaj gösterir.** Bu, auth ekranlarındaki enumeration
  duruşuyla çelişmez: orada gizlenen şey bir **hesabın** varlığıydı; slug ise global ve
  kullanıcıya görünür bir adres parçasıdır, "bu ad alınmış" bilgisi zaten adresin kendisinden
  öğrenilir.
- **Boş adres alanı gönderilmez** (`undefined` ile alan tamamen düşer): backend slug'ı isimden
  türetir. Boş string göndermek "geçersiz slug" dalını tetiklerdi.
- **Yeni tenant otomatik olarak aktif yapılmaz.** Aktif tenant seçimi kullanıcının açık
  eylemidir (seçici, Issue #40); oluşturmanın ardından sessizce ikinci bir state değişikliği
  yapmak, başarısız olması hâlinde açıklaması zor bir yarı-durum bırakırdı.
- `src/components/auth-form.tsx`'teki `TextField` bu ekran için `type="text"`, opsiyonel alan
  (`required={false}`) ve açıklama (`hint`, `aria-describedby` ile bağlanır) destekleyecek
  şekilde genişletildi; auth ekranlarının davranışı değişmedi (varsayılanlar korundu).

E2E kanıtı: `e2e/tenant-create-ui.spec.ts`. Sonuç formun yönlendirmesine değil, bağımsız bir
okuma yoluna (`GET /api/tenants`) bakılarak doğrulanır: kayıt gerçekten oluştu mu, rol OWNER mı,
hata durumunda ikinci kayıt oluşmadı mı.

### Üye yönetimi ekranı (Issue #43)

`/members` (`src/app/(app)/members/`). Aktif çalışma alanının üyelerini listeler; yetkili
rollere rol değiştirme ve üyeyi çıkarma aksiyonlarını gösterir.

- **URL'de `tenantId` yoktur.** Hangi tenant'ın üyeleri gösterileceğinin tek kaynağı aktif
  tenant'tır (Issue #10 cookie'si, membership'i her istekte DB'den doğrulanır). URL'e tenantId
  koymak "adres çubuğunu değiştirip başka tenant'ı görme" denemelerine yüzey açardı; backend
  bunu zaten 403'le reddeder (`requirePermission()` → `expectedTenantId`), ama parametreyi hiç
  sunmamak daha temizdir.
- **Issue metninden bilinçli sapma.** #43'ün kabul kriteri "OWNER olmayan kullanıcı bu ekrana
  erişemiyor" der; ancak o metin izin matrisinden (#11/#12) öncedir ve **matris yetkili
  kaynaktır**: `MEMBER` rolü `VIEW_MEMBERS` iznine sahiptir. Bu yüzden ekran listeyi tüm
  üyelere gösterir, yönetim aksiyonlarını yalnızca `UPDATE_MEMBER_ROLE` / `REMOVE_MEMBER`
  iznine sahip role render eder. Matrisi gevşetmek yerine matrisi uygulamak tercih edildi.
- **UI'daki "devre dışı" kuralları güvenlik kontrolü değildir.** ADMIN'in bir OWNER'a
  dokunamaması, son OWNER'ın düşürülememesi/çıkarılamaması ve rol izinleri backend'de
  (`src/lib/tenants/membership.ts` + `src/lib/authz/`) Serializable transaction içinde
  zorlanır. Arayüzdeki kilitler yalnızca kesin başarısız olacak bir işlemi kullanıcıya
  denetmemek içindir; kaldırılsalar güvenlik değişmez (kanıt:
  `security/tenant-membership-authorization-security.spec.ts`).
- **Native `confirm()` yerine satır içi onay.** Tarayıcı diyaloğu sayfa akışını bloke eder,
  ekran okuyucularda ve testlerde daha kırılgandır.
- **Aksiyon sonrası `router.refresh()` yeterlidir** (tenant switcher'daki tam sayfa
  yüklemesinden farklı olarak): aktif tenant değişmiyor, yalnızca bu route'un verisi
  değişiyor.
- Prisma Client istemci paketine girmesin diye `MembershipRole` client bileşenine **yalnızca
  `type` olarak** import edilir; rol listesi string literal olarak yazılıp `satisfies` ile
  tipe bağlanır.

E2E kanıtı: `e2e/tenant-members-ui.spec.ts`. Her sonuç `GET /api/tenants/:id/members` ile
doğrulanır; ayrıca **duyarlılık kanıtı** olarak arayüz baypas edilip endpoint doğrudan çağrılır
(son OWNER → 409, MEMBER'ın rol değiştirme denemesi → 403).

## Güvenlik Header'ları

Tüm yanıtlara (sayfalar ve `/api/*`, hata yanıtları dahil) `next.config.ts` üzerinden temel
güvenlik header'ları eklenir. Bunlar mevcut korumaların yerine geçmez — authorization
backend'de, CSRF koruması `SameSite=Lax` + CORS'a dayanır — tarayıcı tarafındaki saldırı
yüzeyini daraltır. Doğrulama: `security/http-headers-security.spec.ts`.

| Header | Değer | Neden |
| --- | --- | --- |
| `X-Content-Type-Options` | `nosniff` | Tarayıcı, Content-Type'ı tahmin ederek bir yanıtı script gibi çalıştırmaz. |
| `X-Frame-Options` | `DENY` | Clickjacking (eski tarayıcılar için). |
| `Content-Security-Policy` | `frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'` | Clickjacking (modern), `<base>` enjeksiyonu, form action hijacking, eklenti yüzeyi. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | URL'de taşınan reset/davet token'larının üçüncü taraflara sızmaması. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` | Kullanılmayan güçlü tarayıcı API'leri kapatılır. |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | HTTPS zorunluluğu. HTTP üzerinden yok sayılır, lokal geliştirmeyi etkilemez. |
| `X-Powered-By` | *(kaldırıldı)* | Framework/sürüm ipucu vermenin işlevsel karşılığı yok. |

**Kapsam dışı (bilinçli):**

- **Tam CSP (`script-src`/`style-src`) yoktur.** Next.js'te güvenli bir script politikası
  nonce tabanlı olmalıdır ve nonce'lar statik config'ten değil istek başına üretilmelidir
  (bkz. `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`). Yanlış bir
  `script-src` uygulamayı sessizce kırar; gerçek frontend (Epic 4) geldiğinde ayrı bir issue
  olarak eklenmelidir. Yukarıdaki dört direktif frontend'den bağımsızdır ve bugün güvenle
  uygulanabilir.
- **HSTS `preload` yoktur.** Preload listesine girmek alan adı genelinde, geri alınması çok zor
  bir taahhüttür; production deployment kararıyla (Issue #91) birlikte verilmelidir.

## CSRF Duruşu (Issue #28)

**Bu projede özel bir CSRF token sistemi YOKTUR ve bu bilinçli bir tercihtir.** Custom JSON API
route'ları (tenant/membership/invitation endpoint'leri) iki bağımsız tarayıcı mekanizmasıyla
korunur. Aşağıdaki iddiaların tamamı gerçek Chromium ile test edilerek kanıtlanmıştır
(`e2e/csrf-samesite.spec.ts`), varsayım değildir.

### Koruma nasıl çalışıyor

Cross-site bir istek, türüne göre iki farklı katmanda durur:

| İstek türü | Durduran mekanizma | Sunucuya ulaşır mı? |
| --- | --- | --- |
| Form POST (`urlencoded`/`text-plain`, custom header yok) | **`SameSite=Lax`** — tarayıcı session cookie'sini eklemez | Evet, ama kimliksiz → `401` |
| JSON POST, `PATCH`, `DELETE`, custom header'lı istekler | **CORS preflight** — uygulama `Access-Control-Allow-Origin` döndürmez | Hayır, hiç gönderilmez |

- Hem `authjs.session-token` hem `active-tenant` cookie'si `HttpOnly` + `SameSite=Lax` olarak
  **açıkça** set edilir (`src/lib/tenants/active-tenant.ts`; Auth.js tarafı için
  `security/signin-signout-security.spec.ts`). Öznitelik açıkça verildiği için, Chromium'un
  yalnızca *SameSite özniteliği hiç olmayan* cookie'lere uyguladığı "Lax-allowing-unsafe"
  (Lax+POST) geçici muafiyeti bu cookie'ler için geçerli değildir — test, cross-site POST'u
  session kurulduktan hemen sonra, yani o muafiyetin geçerli olacağı zaman penceresi içinde
  yapar ve cookie yine gönderilmez.
- Sunucu tarafı zaten kimliksiz state-changing isteği reddeder ve **hiçbir yan etki
  üretmez** — bkz. `security/tenant-isolation-boundaries.spec.ts` içindeki "unauthenticated
  mutation" bloğu.
- Auth.js'in kendi sign-in akışı ayrıca kendi CSRF token mekanizmasına sahiptir; ona
  dokunulmamıştır.

Test bir **kontrol grubu** içerir: aynı-site isteğin `200` dönmesi, cross-site `401`'in sebebinin
"cookie zaten geçersizdi" değil "tarayıcı cookie'yi göndermedi" olduğunu kanıtlar. Ayrıca testin
duyarlılığı doğrulanmıştır: aynı senaryo cookie `SameSite=None` yapıldığında cookie'nin cross-site
gönderildiğini ve isteğin authentication'ı GEÇTİĞİNİ gösterir — yani koruma zayıflarsa test
kırmızıya döner.

### Kabul edilen residual risk

Bu duruş mutlak değildir. Bilinçli olarak kabul edilen sınırlar:

1. **`SameSite=Lax`, top-level cross-site GET isteklerini ENGELLEMEZ.** Dolayısıyla bu koruma,
   *"state değiştiren hiçbir işlem GET ile yapılmaz"* invariant'ına dayanır. Uygulamanın kendi
   GET endpoint'lerinin (`/api/health`, `/api/auth/me`, `/api/tenants`,
   `/api/tenants/[tenantId]/members`) tamamı salt-okunurdur; bu kural `CLAUDE.md`'de zorunlu bir
   proje kuralı olarak yazılıdır ve `integration/get-side-effect-free-pattern.spec.ts` ile
   otomatik olarak zorlanır (bir GET handler'ına yazma çağrısı eklenirse test kırmızıya döner).
   Tek istisna Auth.js'in kendi `GET /api/auth/session` endpoint'idir: bu endpoint session
   cookie'sini tazeler, ancak uygulama verisini değiştirmez ve revoke edilmiş bir session'ı
   diriltemez (bkz. "Session Revocation") — kurbanı bu adrese yönlendirmek saldırgana yalnızca
   kurbanın kendi oturumunun uzatılmasını sağlar, sömürülebilir bir yan etki üretmez.
   Bu invariant kırılırsa CSRF koruması da kırılır.
2. **`SameSite` site (eTLD+1) bazlıdır, origin bazlı DEĞİLDİR.** Ele geçirilmiş veya kötü niyetli
   bir alt alan adı (`evil.example.com` → `app.example.com`) *same-site* sayılır ve cookie'yi
   gönderebilir. Alt alan adları güvenilmeyen içerik barındıracaksa bu duruş yeniden
   değerlendirilmelidir.
3. **İkinci katman (CORS), permissive bir CORS yapılandırması eklenmediği sürece geçerlidir.**
   İleride `Access-Control-Allow-Origin` (özellikle `credentials` ile birlikte) eklenirse JSON/
   `PATCH`/`DELETE` koruması ortadan kalkar ve geriye yalnızca `SameSite` kalır.
4. **SameSite desteklemeyen çok eski tarayıcılar** korunmaz.

### Ne zaman gerçek CSRF token'ı gerekir

Yukarıdaki maddelerden biri değişirse — state değiştiren bir GET gerekirse, uygulama güvenilmeyen
alt alan adlarıyla aynı site altında dağıtılırsa veya cross-origin credentialed istekler
desteklenmek zorunda kalınırsa — `SameSite` tek başına yetmez ve ayrı bir issue ile gerçek bir
CSRF token katmanı eklenmelidir.

## Eşzamanlılık: Serializable + Retry (Issue #122)

Okumaya bağlı invariant'ları (son OWNER koruması, "eski daveti iptal et + yenisini oluştur")
koruyan transaction'lar `Serializable` izolasyonda çalışır. Bu izolasyonun sözleşmesi
**"hiç hata almazsın" değildir**: PostgreSQL, iki transaction birbirini geçersiz kılacak
şekilde çakıştığında birini **serialization failure** ile reddeder (Prisma `P2034`) ve
çağıranın **yeniden denemesini** bekler.

- **Tek giriş noktası `runSerializable()`** (`src/lib/db/serializable.ts`).
  `prisma.$transaction(..., { isolationLevel: Serializable })`'ı doğrudan çağırmak retry'ı
  atlamak demektir; o durumda serialization hatası kullanıcıya **500** olarak yansır.
  Issue #122'de tam olarak bu oluyordu: eşzamanlı bir rol değişikliğinde meşru kullanıcı 500
  alıyordu. (Hata CI'da görünmüyordu çünkü `playwright.config.ts`'teki `retries: 2` onu
  maskeliyordu — yani bu bir test gürültüsü değil, **maskelenmiş bir üretim hatasıydı**.)
- **Yalnızca `P2034` yeniden denenir.** Domain hataları (NotFound, LastOwner,
  ForbiddenOwnership) ve diğer Prisma hataları (ör. `P2002`) olduğu gibi yukarı çıkar —
  kalıcı bir durumu tekrar tekrar denemek hem gecikme üretir hem de gerçek hatayı maskeler.
- **5 deneme + kademeli, sapmalı bekleme** (`attempt * 10ms` + 0-10ms rastgele). Sabit bekleme
  yetmez: çakışan istemciler aynı süre bekleyip aynı anda tekrar dener ve çakışma birebir
  tekrarlanır (thundering herd). Önceki elle yazılmış implementasyon 3 denemeydi ve ölçüldüğünde
  5 eşzamanlı rol değişikliğinde yetersiz kaldı.
- **Denemeler tükenirse `503`**, `409` **değil**: `409` bu kod tabanında iş kuralı ihlalidir
  (ör. "son OWNER düşürülemez") ve arayüz ona göre mesaj gösterir. Retry tükenmesi geçici bir
  sunucu durumudur; doğru mesaj "biraz sonra tekrar deneyin"dir.
- **`runSerializable()`'a verilen fonksiyon yeniden çalıştırılabilir olmalıdır**: transaction
  DIŞINDAKİ yan etkiler (audit log yazımı, davet e-postası) içine konmaz. DB değişiklikleri
  rollback edilebilir, gönderilmiş bir e-posta edilemez.

Kanıt: `integration/serializable-retry.spec.ts` (neyin denendiği/denenmediği, rollback
semantiği) ve `integration/membership-concurrency.spec.ts` (gerçek eşzamanlı yük; retry
kaldırılırsa kırmızıya döner).

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
- **Üyelik bitince davetler iptal olur:** Bir üye tenant'tan çıkarıldığında (`removeMember()`), o
  üyenin O tenant için oluşturduğu bekleyen (kullanılmamış + iptal edilmemiş) davetler, üyeliğin
  silinmesiyle AYNI transaction içinde `cancelledAt` ile geçersiz kılınır. Gerekçe: aksi halde
  çıkarılan bir `ADMIN`'in daha önce gönderdiği davet 7 günlük TTL'i boyunca geçerli kalır ve
  kabul edildiğinde davetliye gerçek bir `ADMIN` üyeliği verirdi — yani içeriden birini çıkarmak,
  onun bıraktığı arka kapıyı kapatmazdı. **Rol düşürme (ör. `ADMIN` → `MEMBER`) davetlere
  KASITLI olarak dokunmaz**; yalnızca üyeliğin sona ermesi iptali tetikler. İptal edilen davet,
  kabul denemesinde diğer geçersiz durumlarla AYNI genel `400`'e düşer (yeni bilgi sızdırmaz).
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

## Finansal Hesaplar (Issue #46)

İlk finansal model: `Account` (banka hesabı / kasa). Şema `prisma/schema.prisma`, iş mantığı
`src/lib/finance/account.ts`, endpoint'ler `GET/POST /api/tenants/[tenantId]/accounts` ve
`PATCH/DELETE /api/tenants/[tenantId]/accounts/[accountId]`.

### Para nasıl taşınır ve saklanır

- **DB'de `Decimal(19, 4)`**, `Float`/`number` DEĞİL (invariant #10). `number` ikili kayan
  noktadır (`0.1 + 0.2 !== 0.3`); finansal bir üründe bu kabul edilemez.
- **API sözleşmesinde string.** Hem girdi hem çıktı: `"1234.5600"`. Girdide `number`
  **reddedilir** (`400`) — bir kez `number`'a dönüşen tutar `Decimal`e çevrilse bile
  yuvarlanmış olabilir. Çıktıda dönüşüm tek bir yerde (`toView()`) yapılır ki sözleşme
  Prisma'nın JSON serileştirme davranışına bağlı kalmasın.
- **Ondalık ayırıcı yalnızca `.`**; "1.234,56" gibi yerelleştirilmiş biçimler API'nin işi
  değildir (biçimlendirme sunum katmanına aittir).
- **Negatif bakiye serbesttir**: bir hesap eksiye düşebilir, kredi kartı zaten negatif taşır.
- **Para birimi ayrı alandır** (ISO 4217, 3 harf). Doğrulama biçimseldir; tam ISO listesi bir
  bağımlılık ya da elle bakımı gereken bir tablo gerektirirdi ve çoklu kur/dönüşüm bu issue'nun
  kapsamı dışıdır.

### Yetki ve izolasyon

- **`VIEW_ACCOUNTS` ile `MANAGE_ACCOUNTS` ayrı izinlerdir.** MEMBER hesapları **görür** ama
  oluşturamaz/güncelleyemez/silemez; ADMIN ve OWNER yönetebilir. Gerekçe: finansal kayıtları
  okumak ekibin günlük işidir, hesap açmak/silmek ve bakiyeyi elle değiştirmek yönetim işidir.
- **Her sorgu `tenantScoped()` üzerinden geçer**, mutation'lar `updateMany`/`deleteMany` +
  `count === 1` ile yapılır — yalnız-ID ile `update`/`delete` yoktur. Pattern koruması:
  `integration/tenant-scope-pattern.spec.ts` (artık `account.ts`'i de kapsıyor).
- **Cross-tenant ID ile var olmayan ID aynı yanıtı alır** (`404`, aynı gövde) — enumeration
  engeli.
- Trusted `tenantId` daima `requirePermission()` context'inden gelir; body'deki `tenantId`/`id`
  alanları yok sayılır (regresyon testi: `security/account-security.spec.ts`).

### Diğer kararlar

- **`@@unique([tenantId, name])`**: aynı tenant'ta aynı isimde iki hesap olamaz. "Önce kontrol
  et sonra yaz" yarışı yerine unique constraint'e güvenilir; P2002 → `409`. Kıyas büyük/küçük
  harfe duyarlıdır (case-insensitive unique ayrı bir index/collation gerektirir).
- **`AccountType` bir Prisma enum'ıdır** (`BANK`, `CASH`): küme küçük ve kararlı, yeni tür
  eklemek migration gerektirir. (Karşılaştır: `AuditLog.action` serbest `String`'tir çünkü o
  küme sürekli büyür.)
- **Audit:** `ACCOUNT_CREATED` / `ACCOUNT_UPDATED` / `ACCOUNT_DELETED`. Güncellemede metadata
  yalnızca **hangi alanların** değiştiğini tutar, yeni değerleri değil — audit log finansal
  tutarların ikinci bir kopyası değildir.
- **Rate limit yoktur:** bu endpoint'ler authenticated ve tenant-scoped'tur; mevcut politika
  kataloğu (`src/lib/rate-limit/policies.ts`) public/pahalı endpoint'ler içindir.

### Hesap ekranı (Issue #47)

`/accounts` (`src/app/(app)/accounts/`). Aktif çalışma alanının hesaplarını listeler ve yetkili
role oluşturma formunu gösterir. `/members` ile aynı desen: URL'de `tenantId` yoktur, kaynak
aktif tenant'tır.

- **Bakiye ham string olarak gösterilir, `Intl.NumberFormat` ile DEĞİL.** Biçimlendirme değeri
  önce `Number`'a çevirmeyi gerektirir; bu, para için yasak olan kayan nokta dönüşümünü
  (invariant #10) arayüz katmanından geri getirirdi. Yerelleştirilmiş gösterim, string üzerinde
  çalışan ayrı bir yardımcı ile ele alınmalıdır — bu issue'nun kapsamı değil.
- **Boş bakiye alanı gönderilmez** (`undefined`): backend o zaman şemadaki `@default(0)`'ı
  uygular. Boş string göndermek "geçersiz tutar" dalını tetiklerdi.
- **Oluşturma formu yalnızca `MANAGE_ACCOUNTS` iznine sahip role render edilir** — bu bir
  güvenlik kontrolü değil, MEMBER'a kesin 403 alacağı bir form göstermeme tercihidir; asıl
  kontrol route'taki `requirePermission()`'dır.
- **Kapsam:** liste + oluşturma. Güncelleme/silme API'si (#46) hazırdır ama arayüzü bilerek bu
  issue'da yapılmadı; ayrı bir issue gerektirir.

E2E kanıtı: `e2e/accounts-ui.spec.ts` — her sonuç `GET /api/tenants/:id/accounts` ile
doğrulanır (kayıt gerçekten oluştu mu, bakiye string ve hassasiyeti korunmuş mu, hata
durumunda kayıt oluşmamış mı); MEMBER için formun hiç render edilmediği ve baypas edilirse
`403` alındığı ayrıca test edilir.

## Gelir/Gider Kategorileri (Issue #49)

İkinci finansal model: `Category` — işlemlerin (#53) sınıflandırılacağı **düz** liste. Şema
`prisma/schema.prisma`, iş mantığı `src/lib/finance/category.ts`, endpoint'ler
`GET/POST /api/tenants/[tenantId]/categories` ve
`PATCH/DELETE /api/tenants/[tenantId]/categories/[categoryId]`.

Yetki, izolasyon ve hata sözleşmesi `Account` (#46) ile **aynıdır** ve burada tekrarlanmaz;
aşağıda yalnızca bu modele özgü kararlar vardır.

### Benzersizlik anahtarı türü de içerir

`@@unique([tenantId, type, name])` — `Account`taki `@@unique([tenantId, name])`'den **bilinçli
olarak farklı**. "Diğer", "Faiz", "Kira" gibi isimler hem gelir hem gider tarafında doğal
olarak bulunur; bunları tek bir isim uzayına sıkıştırmak kullanıcıyı "Diğer (Gelir)" gibi
kaçamak isimler yazmaya zorlardı. Belirsizlik doğmaz, çünkü kategori daima bir türün
bağlamında seçilir (gider işlemine gider kategorisi).

Yarış durumu yine DB'de kapatılır: "önce aynı isim var mı diye bak, sonra yaz" deseni iki
eşzamanlı isteğin ikisini de oluşturabilirdi; unique constraint'e güvenilir ve `P2002` → `409`
çevrilir. Kıyas büyük/küçük harfe duyarlıdır (`Account` ile aynı sınır: case-insensitive
unique, ayrı bir index/collation gerektirir).

### Tür değiştirmek serbesttir

`PATCH` ile `type` güncellenebilir. Alternatif — "türü değiştirilemez, silip yeniden oluştur" —
ileride kategoriye bağlanacak işlemleri (#53) koparacağı için daha kötüdür. Tür unique
anahtarın parçası olduğundan, hedef tarafta aynı isim varsa `409` döner; bu karar da önden
okuma yerine constraint'e bırakılmıştır.

### `?type` filtresi: geçersiz değer sessizce yok sayılmaz

`GET .../categories?type=INCOME|EXPENSE` opsiyonel bir filtredir ve işlem formu içindir (gider
işlemine yalnızca gider kategorisi seçilebilmelidir). Geçersiz bir değer **`400`** alır,
sessizce yok sayılmaz: yok saymak, filtrenin uygulandığını sanan bir istemciye TÜM listeyi
döndürürdü ve bunun ilk sonucu gider işlemine gelir kategorisi seçtirmek olurdu.

Filtre `where`'e doğrudan değil, `tenantScoped()`in **üzerine** eklenir — tenant filtresinin
yerine geçemez. Bu, `integration/tenant-scope-pattern.spec.ts`'te bu modele özgü ek bir
pattern testiyle korunur (`where: { type }` yazılmasını yakalar), HTTP tarafındaki karşılığı
`security/category-security.spec.ts`'tedir.

### Yetki

`VIEW_CATEGORIES` ile `MANAGE_CATEGORIES` ayrıdır (hesaplarla aynı ayrım): kategori listesini
görmek her üyenin işidir — işlem kaydederken seçecektir; kategori açmak/yeniden
adlandırmak/silmek ise tenant'ın sınıflandırma şemasını değiştirmektir, yani yönetim işi.
MEMBER görür, ADMIN ve OWNER yönetir.

### Audit

`CATEGORY_CREATED` / `CATEGORY_UPDATED` / `CATEGORY_DELETED`. Bir kategorinin yeniden
adlandırılması veya silinmesi **geçmiş raporların anlamını değiştirir**, bu yüzden iz tutulur.
Güncellemede metadata yalnızca hangi alanların değiştiğini taşır (`Account` ile aynı gerekçe).

### Bilinen sınır: silme, kullanımda olan kategoriyi kontrol etmez

`Transaction` modeli henüz yoktur (#53). "Kullanımda olan kategori silinmek istenirse ne olur"
(engelle / işlemleri kategorisiz bırak) o modelin kararıdır ve orada verilmelidir; bugün
kategoriye bağlanan hiçbir kayıt olmadığı için koşulsuz silme doğru davranıştır. Önceden bir
koruma yazmak, dayanacağı bir ilişki olmadığından ölü kod olurdu.

Kapsam dışı bırakılan diğer iki şey: **alt kategori hiyerarşisi** (issue'da açıkça kapsam
dışı; düz liste ilk sürüm için yeterli) ve **varsayılan kategori seti ile tenant tohumlama**
(yeni bir tenant'ın hangi kategorilerle açılacağı ürün kararıdır, bu issue'nun değil).
Kategori yönetimi arayüzü #50'dir.

### Kategori ekranı (Issue #50)

`/categories` (`src/app/(app)/categories/`). Aktif çalışma alanının kategorilerini listeler ve
yetkili role oluşturma formunu gösterir. `/accounts` ile aynı desen: URL'de `tenantId` yoktur,
kaynak aktif tenant'tır; form servis fonksiyonunu değil `POST /api/.../categories`'i çağırır
(yetki ve aktif tenant tutarlılığı route seviyesindedir).

- **`?type` filtresi bu ekranda kullanılmaz.** O filtre işlem formu içindir (#53); burada
  kullanıcı kategorilerinin tamamını tek listede görür. Liste API'den türe göre sıralı
  geldiği için zaten gruplu okunur — ayrı bir filtre kontrolü eklemek bu issue'nun kapsamını
  genişletirdi.
- **`409` mesajı türü de söyler:** "Bu **türde** bu isimde bir kategori zaten var". Benzersizlik
  tenant + tür + isim üzerinden olduğu için (bkz. yukarıdaki karar), "bu isimde bir kategori
  zaten var" demek yanıltıcı olurdu — kullanıcı aynı ismi diğer türde kullanabilir.
- **Başarılı kayıttan sonra ad temizlenir, tür seçimi korunur.** Kullanıcı genellikle arka
  arkaya aynı taraftan birkaç kategori girer; türü her kayıtta "Gider"e döndürmek onu her
  seferinde yeniden seçmeye zorlardı. Formun varsayılanı da bu yüzden **Gider**'dir.
- **Oluşturma formu yalnızca `MANAGE_CATEGORIES` iznine sahip role render edilir** — bu bir
  güvenlik kontrolü değil, MEMBER'a kesin 403 alacağı bir form göstermeme tercihidir; asıl
  kontrol route'taki `requirePermission()`'dır.
- **Kapsam:** liste + oluşturma. Güncelleme/silme API'si (#49) hazırdır ama arayüzü bilerek bu
  issue'da yapılmadı — hesap ekranında da aynı sınır var; ikisi tek bir "düzenle/sil"
  issue'sunda birlikte ele alınmalıdır.

E2E kanıtı: `e2e/categories-ui.spec.ts` — her sonuç `GET /api/tenants/:id/categories` ile
doğrulanır. Aynı ismin gelir ve gider tarafında ayrı ayrı kullanılabildiği (yani #49'un
`@@unique([tenantId, type, name])` kararı) uçtan uca ayrıca kanıtlanır; MEMBER için formun hiç
render edilmediği ve baypas edilirse `403` alındığı da test edilir.
