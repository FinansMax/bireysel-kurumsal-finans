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

**Kasıtlı olarak anılmayanlar:** finansal özet/rapor ve grafikler (`/dashboard` henüz boş —
#62/#63), bildirimler, içe/dışa aktarma, fatura ve borç/alacak takibi. Hepsi backlog'dadır.
Bir açılış sayfasını doldurmak için verilen söz, ürünün kendisinden önce güveni tüketir.

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
