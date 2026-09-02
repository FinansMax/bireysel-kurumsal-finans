# FinansMax — Eksikler ve İyileştirmeler (kod denetimi çıktısı)

**Repo:** `FinansMax/bireysel-kurumsal-finans`
**Kaynak:** Şema, auth/authz/tenancy katmanları, rate limit, `transaction.ts`, modül guard'ı, CI,
güvenlik header'ları ve test suite'leri okunarak yapılan denetim.

Bu dosya iki bölümdür:

- **Bölüm A — Eksikler.** Bugün var olan boşluklar ve her birinin *nasıl* kapatılacağı. Hepsi
  öncelik sırasına (P0 → P1 → P2) dizilmiştir.
- **Bölüm B — "Şu olsa güzel".** Ürünü olgunlaştıran, ama olmadan da çalışan işler.

Issue'lar bu dosyadaki **sırayla** açılır; böylece issue listesi ve backlog'un kendisi öncelik
sırasını taşır.

---

## 0. Duplicate uyarısı — önce bunları oku

Denetimde bulunan üç konu için repo'da **zaten issue var**. Bunlar YENİDEN AÇILMAZ; mevcut
issue güçlendirilir (Bölüm A'nın sonundaki "Mevcut issue güncellemeleri" kısmı).

| Konu | Mevcut issue | Yapılacak |
| --- | --- | --- |
| Saat dilimi yönetimi | #134 | Karar netleştirilip P0'a çekilecek, yeni bağımlılık eklenecek |
| Monitoring/Logging | #92 (Epic 12 story) | Altına somut bir alt issue açılacak |
| Backup/DR | #94 (Epic 12 story) | Altına somut bir alt issue açılacak |

Ayrıca Epic 9 (#74) "e-posta/push bildirim entegrasyonu"nu açıkça **kapsam dışı** bırakıyor —
yani gerçek e-posta sağlayıcısı için repo'da hiçbir issue yok. B1 bu boşluğu kapatır.

---

## 1. MASTER PROMPT — Issue'ları aç ve önceliklendir

> Claude Code'a bu dosyayla birlikte aşağıdaki metni ver.

```
Bu repo `FinansMax/bireysel-kurumsal-finans`. Görevin KOD YAZMAK DEĞİL; ekteki
`finansmax-eksikler-ve-iyilestirmeler.md` dosyasındaki issue'ları GitHub'da açmak ve
önceliklendirmek.

ÖNCE OKU:
- Bu dosyanın tamamı, özellikle "0. Duplicate uyarısı" bölümü
- README.md, docs/architecture.md, docs/security-invariants.md, docs/workflow.md
- Referans issue formatı için: gh issue view 70

ADIM 1 — Öncelik label'larını oluştur (varsa dokunma):
  gh label create "P0-blocker"  --color B60205 --description "Launch blocker: bu bitmeden musteriye verilmez"
  gh label create "P1-yuksek"   --color D93F0B --description "Ilk musteriden once bitmeli"
  gh label create "P2-normal"   --description "Teknik borc / bakim"
  gh label create "epic-16"     --description "Epic 16: Urun Olgunlugu"
  gh label create "ops"         --description "Deployment, izleme, yedekleme, isletme"

ADIM 2 — Mevcut issue'ları güncelle (Bölüm A sonundaki "Mevcut issue güncellemeleri"):
  Önce `gh issue view <no>` ile canlı gövdeyi oku, sonra tarif edilen eki gövdeye EKLE
  (mevcut metni SİLME) ve label'ları uygula. Değişikliği canlı gövdeden doğrula.

ADIM 3 — Yeni issue'ları dosyadaki SIRAYLA aç:
  gh issue create --title "<title>" --body-file <gecici-dosya> --label "<labels>"
  Gövdeyi değiştirme, kısaltma, özetleme. Sıra öneme göredir; bozma.

ADIM 4 — Referansları düzelt:
  Gövdelerde [B1], [N3] gibi köşeli parantezli referanslar var. Tüm issue'lar açıldıktan
  SONRA bunları gerçek numaralarla (#123) değiştirip `gh issue edit --body-file` ile güncelle.
  Epic 16 issue'sunun (N0) "Alt Issue'lar" listesini de gerçek numaralarla doldur.

ADIM 5 — Projeye ekle ve önceliklendir (yetki yoksa zorlama, raporla):
  gh issue edit <no> --add-project "FinansMax Development"
  Projede bir "Priority" alanı varsa P0/P1/P2 label'ıyla tutarlı doldur.
  Yetki hatası alırsan `gh auth refresh -s project` gerektiğini not et ve devam et.

KURALLAR:
- Hiçbir kod dosyasına dokunma, branch açma, commit atma.
- "0. Duplicate uyarısı"ndaki konular için YENİ issue AÇMA.
- Bir issue'nun içeriğinde teknik hata görürsen açma, bana söyle.
- Sonunda: açılan issue numaraları + label + öncelik tablosu, güncellenen mevcut issue'lar,
  başarısız adımlar.
```

---

## 2. MASTER PROMPT — Implementasyon (her issue için)

```
Görev: bu repo'da #<ISSUE_NO> issue'sunu uçtan uca implemente et.

ÖNCE OKU: README.md, docs/architecture.md, docs/security-invariants.md,
docs/conventions.md, docs/testing.md, docs/workflow.md, CLAUDE.md.
Sonra `gh issue view <ISSUE_NO>`.

PAZARLIĞA KAPALI (docs/security-invariants.md 1-10): tenantScoped + updateMany/count===1;
trusted context tek kaynak; yetki backend'de; GET yan etkisiz; secret repoya girmez;
token hash+süreli+tek kullanımlık; hata yanıtı bilgi sızdırmaz; audit tek kapıdan commit
sonrası; rate limit iş mantığından önce; para Decimal(19,4) + currency ayrı + JSON'a string.

MİMARİ: route ince (guard+parse+delegate+map); `src/lib/**` içinden `next/server` import
edilmez (istisna: guard'lar); servis throw etmez, discriminated union döner; "önce kontrol
et sonra yaz" yasak — unique constraint / runSerializable() / koşullu updateMany;
generic repository, DI, zod YOK; Next.js 16'da `params` bir Promise.

AKIŞ: main'de çalışma; issue'daki branch adını kullan; Conventional Commits, başlık ASCII;
commit gövdesi Türkçe KARAR KAYDI (ne, neden, reddedilen alternatif, güvenlik/eşzamanlılık
etkisi, bilinen sınır, (Issue #<no>)); Definition of Done'ın tamamı.

DURUP SOR: bir invariant'ı gevşetmen gerekiyorsa; kapsam yetersizse.
Çalıştıramadığın doğrulamayı ASLA "geçti" diye raporlama.

Sonunda `Closes #<ISSUE_NO>` içeren PR aç.
```

---

# BÖLÜM A — EKSİKLER

## P0 — Launch blocker

Bunlar bitmeden ürün bir müşteriye verilmez. Sırası önemlidir.

---

### B1
**title:** `Gerçek e-posta sağlayıcısı entegrasyonu (EmailSender + InvitationSender)`
**labels:** `P0-blocker`, `epic-12`, `auth`, `ops`

**body:**

```markdown
## Amaç

Şifre sıfırlama ve tenant daveti akışları production'da **çalışmıyor**: `consoleEmailSender`
(`src/lib/auth/email.ts`) production'da yalnızca alıcıyı logluyor, `invitation-email.ts` de
aynı desende. Kullanıcı "e-postanı kontrol et" mesajını görüyor ve hiçbir şey gelmiyor.

Bu, ürünü tek başına satılamaz kılan tek teknik boşluktur. Epic 9 (#74) e-posta
entegrasyonunu açıkça kapsam dışı bıraktığı için repo'da bunu kapatan başka issue yok.

## Kapsam

- `EmailSender` (`src/lib/auth/email.ts`) ve `InvitationSender`
  (`src/lib/tenants/invitation-email.ts`) arayüzlerinin arkasına gerçek bir sağlayıcı
  implementasyonu. **Arayüzler değişmez** — zaten tam bu iş için tasarlanmışlar.
- Sağlayıcı seçimi ortam değişkeniyle yapılır; kod içinde sağlayıcıya doğrudan bağımlılık
  route'lara veya servislere sızmaz.
- Basit, düz metin + HTML gövdeli iki şablon: şifre sıfırlama, tenant daveti. Şablon motoru
  KURULMAZ (bağımlılık minimizasyonu — `docs/conventions.md`).
- Gönderim hatası, çağıran akışı **düşürmez**: `forgot-password` kayıtlı/kayıtsız e-posta için
  aynı yanıtı döndürmeye devam eder (invariant #7 korunur). Hata sunucuda loglanır.

## Teknik Gereksinimler

### Sağlayıcı seçimi

Önerilen: **Resend** (HTTP API, SMTP credential gerekmez, ücretsiz katman geliştirme için
yeterli). Alternatif: AWS SES. Karar README'ye gerekçesiyle yazılır.

```
EMAIL_PROVIDER=console|resend      # varsayılan: console
EMAIL_API_KEY=...                  # provider=resend ise zorunlu
EMAIL_FROM="FinansMax <no-reply@ornek.com>"
```

- `.env.example` placeholder değerlerle güncellenir (invariant #5).
- **Production'da `EMAIL_PROVIDER=console` ise uygulama bilerek hata verir** —
  `src/lib/config/app-url.ts`'teki `APP_BASE_URL` kontrolüyle **aynı desen**. Gerekçe aynıdır:
  yanlış yapılandırılmış bir production, sessizce "e-posta gönderdim" diyen ama göndermeyen
  bir sisteme dönüşür ve bu fark edilmez.
- `EMAIL_API_KEY` asla `NEXT_PUBLIC_` önekiyle tanımlanmaz, loglanmaz, audit metadata'sına
  girmez.

### Raw token log kuralı korunur

`consoleEmailSender`'daki production kuralı (raw `resetUrl` production loglarına yazılmaz)
yeni implementasyonda da geçerlidir. Regresyon testi
`integration/email-sender-logging.spec.ts` mevcut — yeni sağlayıcı için genişletilir.

### Test edilebilirlik

`.test-outbox` / `.test-outbox-invitations` dosya tabanlı davranışı **korunur** ve yalnızca
`NODE_ENV !== "production"` içindir; e2e/security testleri bugün bunu okuyor, kırılmamalı.
Gerçek sağlayıcı testlerde ÇAĞRILMAZ (`EMAIL_PROVIDER=console` ile çalışılır).

### Retry ve hata yönetimi

Gönderim tek denemeliktir; kuyruk/retry altyapısı KURULMAZ (kapsam dışı). Başarısız gönderim
`console.error` ile loglanır ve `false` döner; çağıran akış yanıtını değiştirmez.

## Scope Dışı

- E-posta kuyruğu, bounce/complaint yönetimi, gönderim istatistikleri.
- Bildirim e-postaları (Epic 9).
- E-posta doğrulama akışı — ayrı issue [B11].
- Özel alan adı ve DNS (SPF/DKIM/DMARC) kurulumu — bu bir deployment adımıdır, #90'a not düşülür.

## Acceptance Criteria

- `EMAIL_PROVIDER=resend` ile şifre sıfırlama e-postası gerçekten teslim ediliyor (manuel
  doğrulama PR'da belirtilir).
- Production ortamında `EMAIL_PROVIDER` eksik/`console` ise uygulama açıkça hata veriyor;
  bu davranışın integration testi var.
- `EMAIL_API_KEY` hiçbir log satırında, audit metadata'sında veya client bundle'ında yok.
- Gönderim başarısız olduğunda `forgot-password` yine 200 ve aynı genel mesajı dönüyor
  (enumeration koruması bozulmadı — `security/password-reset-security.spec.ts` yeşil).
- `.env.example` güncel; README'ye sağlayıcı kararı ve gerekçesi yazıldı.
- Mevcut e2e/security testleri (outbox okuyanlar dahil) yeşil.

## Bağımlılıklar

Yok. İlk yapılacak iş budur.

## Önerilen Branch

`feature/email-provider`
```

---

### B2
**title:** `Dağıtık rate limiting: in-memory limiter'ı paylaşılan store ile değiştir`
**labels:** `P0-blocker`, `epic-12`, `security`, `ops`

**body:**

```markdown
## Amaç

Mevcut `InMemoryRateLimiter` **process-local**'dir. Çok instance'lı veya serverless bir
deployment'ta:

- Her instance kendi sayacını tutar → gerçek limit, instance sayısıyla çarpılır.
- Serverless'ta cold start sayacı sıfırlar → saldırgan yeni instance'lara dağılarak limiti
  pratikte etkisiz kılar.

Yani brute-force koruması bugün kodda var ama production'da **yok sayılabilir**. Bu, README'de
"kapsam dışı" olarak dürüstçe yazılmış bir sınırdır; launch öncesi kapatılması gerekir.

## Kapsam

- `RateLimiter` arayüzünün (`src/lib/rate-limit/types.ts`) paylaşılan store'lu bir
  implementasyonu. **Route kodu ve `checkRateLimit()` sözleşmesi DEĞİŞMEZ** — arayüz tam bu
  değişim için var.
- Ortam değişkeniyle seçim: store yapılandırılmamışsa mevcut in-memory limiter kullanılır
  (lokal geliştirme ve testler bugünkü gibi çalışır).

## Teknik Gereksinimler

### Store seçimi

Önerilen: **Upstash Redis** (HTTP tabanlı; serverless'ta TCP bağlantı havuzu sorunu yaratmaz,
ücretsiz katman yeterli).

```
RATE_LIMIT_STORE=memory|redis      # varsayılan: memory
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

### Atomiklik — kritik nokta

Mevcut `InMemoryRateLimiter.consume()` içinde hiç `await` yoktur; oku+hesapla+yaz tek senkron
bloktadır ve bu yüzden atomiktir. Redis implementasyonunda bu garanti **kaybolur**:
"oku → hesapla → yaz" üç ayrı ağ çağrısı olur ve eşzamanlı istekler limiti aşabilir.

Bu yüzden sliding-window mantığı **tek bir atomik operasyonda** çalışmalıdır:

- `ZREMRANGEBYSCORE` (pencere dışını at) + `ZCARD` (say) + `ZADD` (kaydet) + `EXPIRE`,
  hepsi **tek bir Lua script'i** veya tek `MULTI/EXEC` içinde.
- Reddedilen deneme bucket'a **yazılmaz** (mevcut davranış korunur: başarısız istekler kotayı
  tüketmez ve pencereyi uzatmaz). Yani `ZADD` yalnızca izin verilen istekte yapılır.

### Store erişilemezse ne olur — açık karar

Redis'e ulaşılamadığında iki seçenek vardır ve **fail-open** seçilir: istek geçirilir ve
hata loglanır. Gerekçe: rate limiter bir yardımcı korumadır; Redis kesintisinde tüm giriş
akışını kilitlemek, engellediği riskten daha büyük bir hasardır. Bu karar ve kabul edilen
kalan risk README'ye yazılır. (Fail-closed isteniyorsa bu ayrı bir karardır.)

### Diğer

- Limit değerleri `src/lib/rate-limit/policies.ts`'te kalır; store implementasyonu politikayı
  bilmez.
- `429` yanıtı ve `Retry-After` header'ı aynen korunur; IP/bucket/deneme sayısı yanıta yazılmaz
  (invariant #7).
- `.env.example` güncellenir.

## Scope Dışı

- Kullanıcı bazlı (IP yerine userId) bucket — ayrı issue.
- Adaptif/otomatik limit ayarlama.

## Acceptance Criteria

- `RATE_LIMIT_STORE=memory` ile mevcut tüm testler (`integration/rate-limit.spec.ts`,
  `security/rate-limit-security.spec.ts`) değişmeden geçiyor.
- Redis implementasyonu için: 10 eşzamanlı `consume()` çağrısında limit **aşılmıyor**
  (integration testi; gerçek Redis veya bir test double ile).
- Reddedilen denemeler bucket'ı büyütmüyor.
- Store erişilemezken istek geçiyor, hata loglanıyor, uygulama çökmüyor (test edilmiş).
- README'deki "Rate Limiting" bölümündeki "process-local" sınırı güncellendi.

## Bağımlılıklar

Yok. [B3] ile birlikte planlanabilir.

## Önerilen Branch

`feature/distributed-rate-limit`
```

---

### B3
**title:** `Güvenilir proxy zorunluluğu: IP çıkarımını sertleştir ve deployment gate'i ekle`
**labels:** `P0-blocker`, `epic-12`, `security`, `ops`

**body:**

```markdown
## Amaç

`getClientIp()` (`src/lib/rate-limit/request-key.ts`) istemci IP'sini `x-forwarded-for`'un
**ilk** segmentinden okuyor. Bu, uygulamanın önünde bu header'ı kendisi set eden güvenilir bir
proxy olduğunu varsayar — `authConfig.trustHost: true`'nun zaten varsaydığı gibi.

Varsayım tutmazsa (nginx'siz bir VPS'e doğrudan açılırsa) istemci header'ı serbestçe uydurup
her istekte yeni bir bucket'a düşer ve **rate limit tamamen etkisiz kalır**. [B2] ile dağıtık
store kurulsa bile bu açık kapalı olmaz.

Bugün bu sınır yalnızca yorumlarda ve README'de yazılı; kod ve deployment tarafında hiçbir
zorlayıcı yok.

## Kapsam

### 1. Açık yapılandırma

```
TRUSTED_PROXY=true|false           # production'da açıkça set edilmek ZORUNDA
```

- `TRUSTED_PROXY=true`: `x-forwarded-for`'un ilk segmenti kullanılır (bugünkü davranış).
- `TRUSTED_PROXY=false`: `x-forwarded-for` **hiç okunmaz**; bağlantının kendi uzak adresi
  kullanılır, bulunamıyorsa ortak `unknown` bucket'ına düşülür.
- Production'da değişken tanımlı değilse uygulama **bilerek hata verir**
  (`src/lib/config/app-url.ts` deseni). Sessiz bir varsayılan, tam da bu issue'nun engellemek
  istediği durumdur.

### 2. IP biçim doğrulaması

İlk segment IPv4/IPv6 biçimine uymuyorsa `unknown` bucket'ına düşülür. Bugün rastgele bir
string (ör. `x-forwarded-for: aaaa1`, `aaaa2`, ...) geçerli bir bucket key'i üretiyor; biçim
kontrolü bu sonsuz bucket üretimini kırar. Doğrulama elle yazılır (bağımlılık eklenmez).

### 3. Deployment dokümanı

`docs/deployment.md` (yeni) veya #90'ın kapsamına: uygulamanın **doğrudan internete
açılmaması**, önünde header'ı kendisi set eden bir reverse proxy / platform (Vercel, nginx,
Cloudflare) bulunması gerektiği; nginx için örnek `proxy_set_header X-Forwarded-For $remote_addr;`
satırı. `README.md`'deki mevcut uyarı bu dokümana bağlanır.

## Teknik Gereksinimler

- Invariant #5, #7, #9.
- `unknown` bucket'ının paylaşılan olması korunur: IP bulunamaması limiter'ı BYPASS ETMEZ.

## Scope Dışı

- Proxy header'ının imzalanması/doğrulanması (Cloudflare Authenticated Origin Pulls vb.).
- Coğrafi/ASN tabanlı engelleme.

## Acceptance Criteria

- `TRUSTED_PROXY=false` iken uydurulmuş `x-forwarded-for` bucket'ı değiştirmiyor
  (security testi).
- Geçersiz biçimli IP `unknown` bucket'ına düşüyor ve sınırsız bucket üretilemiyor.
- Production'da `TRUSTED_PROXY` tanımsızsa uygulama açık bir hata ile başlamıyor
  (integration testi).
- Deployment dokümanında proxy zorunluluğu yazılı; README oraya bağlanmış.

## Bağımlılıklar

[B2] ile aynı dosyalara dokunur; ikisinden biri önce merge edilmeli.

## Önerilen Branch

`feature/trusted-proxy-hardening`
```

---

### B4
**title:** `Hata izleme ve yapılandırılmış loglama (Sentry + request-scoped log)`
**labels:** `P0-blocker`, `epic-12`, `ops`

**body:**

```markdown
## Amaç

Bugün production'da bir şey patladığında elimizde yalnızca `console.error` var. Hangi
kullanıcının, hangi tenant'ta, hangi istekte hata aldığını öğrenmenin yolu yok; hatalar
kullanıcı şikâyet edene kadar görünmez.

Epic 12'deki **#92 (Monitoring/Logging)** story'sinin somut, uygulanabilir ilk adımıdır.
Bu issue #92'nin altına alınır.

## Kapsam

### 1. Hata izleme

- Sentry (ücretsiz katman yeterli) — `@sentry/nextjs`, sunucu + istemci.
- `SENTRY_DSN` tanımlı değilse SDK hiç başlatılmaz; lokal geliştirme ve testler etkilenmez.
- **Kişisel veri gönderilmez:** `sendDefaultPii: false`. `beforeSend` içinde mevcut
  `sanitizeMetadata()` (`src/lib/audit/sanitize.ts`) mantığının aynısıyla
  password/token/secret/cookie alanları redakte edilir — audit log'da uygulanan kural,
  hata raporlarında da geçerlidir.
- Raw reset/davet token'ı içeren URL'ler kırpılır (query string atılır).

### 2. Yapılandırılmış loglama

- `src/lib/observability/logger.ts`: JSON satır üreten minimal bir logger (bağımlılık
  eklemeden `console` sarmalayıcısı). Alanlar: `level`, `msg`, `requestId`, `tenantId`,
  `userId`, `route`, `durationMs`.
- `requestId`: gelen `x-request-id` varsa kullanılır, yoksa `crypto.randomUUID()` üretilir ve
  yanıta `x-request-id` header'ı olarak eklenir. Kullanıcı destek talebinde bu id'yi verir.
- Mevcut `console.error` çağrıları bu logger'a taşınır.

### 3. Kritik olay uyarıları

Sentry'de basit alarm: 5xx oranı ve `SerializationConflictError` (503) sayısı eşiği aşarsa
e-posta bildirimi.

## Teknik Gereksinimler

- Invariant #5 (secret repoya girmez), #7 (bilgi sızdırmama — hata detayı client'a DÖNMEZ,
  yalnızca izleme sistemine gider).
- Logger `src/lib/**` içindedir ve `next/server` import etmez.

## Scope Dışı

- APM / dağıtık trace.
- Metrik toplama (Prometheus vb.).
- Log arşivleme — [B9] ile ilişkilidir.

## Acceptance Criteria

- `SENTRY_DSN` yokken uygulama ve tüm testler bugünkü gibi çalışıyor.
- Bilerek fırlatılan bir hata Sentry'de görünüyor ve içinde şifre/token/cookie **yok**
  (manuel doğrulama PR'da).
- Her API yanıtında `x-request-id` var; aynı id log satırlarında görünüyor.
- Client'a dönen hata gövdeleri değişmedi (mevcut security testleri yeşil).
- `.env.example` güncel.

## Bağımlılıklar

#92 (üst story).

## Önerilen Branch

`feature/observability`
```

---

### B5
**title:** `Health check gerçekten sağlık ölçsün (DB + migration durumu)`
**labels:** `P0-blocker`, `epic-12`, `ops`

**body:**

```markdown
## Amaç

`GET /api/health` bugün sabit bir `{ status: "ok" }` dönüyor. Veritabanı düşmüş, migration
uygulanmamış veya bağlantı havuzu tükenmiş olsa bile **yine "ok" der**. Yani load balancer ve
uptime izleme, gerçekte bozuk olan bir instance'a trafik göndermeye devam eder.

## Kapsam

- `GET /api/health` — sığ kontrol (mevcut davranış): süreç ayakta. Load balancer bunu kullanır.
- `GET /api/health/ready` — derin kontrol:
  - `SELECT 1` ile DB erişimi ve gecikmesi,
  - `_prisma_migrations` tablosundan uygulanmamış/başarısız migration kontrolü,
  - hepsi başarılıysa `200 { status: "ok", checks: { database: "ok", migrations: "ok" } }`,
    biri başarısızsa `503` ve hangi kontrolün düştüğü.
- Toplam zaman aşımı 2 saniye; aşılırsa `503` (askıda kalan bir health check, hiç olmamasından
  kötüdür).

## Teknik Gereksinimler

- **GET yan etkisizdir** (invariant #4): `SELECT 1` bir okuma sorgusudur, yazma yapılmaz.
- **Bilgi sızdırmaz** (invariant #7): yanıtta bağlantı dizesi, host adı, sürüm, stack trace
  veya SQL yer almaz — yalnızca kontrol adı ve `ok`/`fail`.
- Endpoint kimlik doğrulaması istemez (izleme sistemleri için) ama bu yüzden içeriği
  bilinçli olarak fakirdir.
- Rate limit gerekmez; ucuzdur ve state değiştirmez (gerekçe PR'da belirtilir — invariant #9
  bunu istiyor).

## Scope Dışı

- Bağımlı dış servislerin (e-posta, Redis) sağlığı — [B1]/[B2] tamamlandıktan sonra ayrı bir
  issue ile eklenir.

## Acceptance Criteria

- DB ayaktayken `/api/health/ready` 200, kapalıyken 503 dönüyor (integration testi).
- Uygulanmamış migration varken 503 dönüyor.
- Yanıt gövdesinde bağlantı bilgisi/stack trace yok (security testi).
- `/api/health` mevcut davranışını koruyor (mevcut testler kırılmıyor).

## Bağımlılıklar

Yok.

## Önerilen Branch

`feature/health-readiness`
```

---

### B6
**title:** `Yedekleme ve geri dönüş provası (backup + restore drill)`
**labels:** `P0-blocker`, `epic-12`, `ops`

**body:**

```markdown
## Amaç

Ürün müşterinin parasal verisini tutuyor ve bugün yedekleme politikası, geri dönüş prosedürü
ve "ne kadar veri kaybını göze alıyoruz" cevabı yok. Test edilmemiş bir yedek, yedek değildir.

Epic 12'deki **#94 (Backup/DR)** story'sinin somut ilk adımıdır; onun altına alınır.

## Kapsam

- **Hedeflerin yazılması:** RPO (kabul edilen veri kaybı, öneri: 24 saat) ve RTO (kabul edilen
  kesinti, öneri: 4 saat). Bu iki sayı yazılmadan yedekleme tasarımı yapılamaz.
- Yönetilen Postgres'in (Neon/Supabase/RDS — hangisi seçilirse) otomatik yedekleme ve
  point-in-time recovery ayarının açılması ve saklama süresinin belirlenmesi.
- Yedekten bağımsız, **haftalık mantıksal dökümün** (`pg_dump`) ayrı bir depolama alanına
  (ör. S3/R2) alınması. Gerekçe: sağlayıcının kendi yedeği, hesabın kilitlenmesi ya da yanlış
  bölgeye yayılan bir hata durumunda erişilemez olabilir.
- **Geri dönüş provası:** yedekten boş bir veritabanına geri dönülür, migration durumu ve
  birkaç kayıt doğrulanır, geçen süre ölçülür ve `docs/runbook-restore.md` olarak yazılır.
- Verinin kimde/nerede durduğu ve saklama süresi `docs/` altına yazılır (KVKK'ya hazırlık).

## Teknik Gereksinimler

- Yedekleme credential'ları repoya girmez; `.env.example`'a yalnızca placeholder eklenir
  (invariant #5).
- Döküm dosyaları şifrelenmiş depolamada tutulur ve erişim en az yetki ilkesine göre verilir.

## Scope Dışı

- Çoklu bölge replikasyonu.
- Otomatik failover.

## Acceptance Criteria

- RPO ve RTO yazılı ve README/docs'ta erişilebilir.
- Otomatik yedekleme açık ve saklama süresi belgelenmiş.
- Haftalık döküm işi çalışıyor ve son üç dökümün varlığı doğrulanmış.
- **Geri dönüş provası bir kez gerçekten yapılmış**, süresi ölçülmüş ve
  `docs/runbook-restore.md` adım adım yazılmış.

## Bağımlılıklar

#94 (üst story), #90 (deployment kararı — hangi sağlayıcı).

## Önerilen Branch

`docs/backup-and-restore`
```

---

## P1 — İlk müşteriden önce

---

### B7
**title:** `Oturum iptali: "tüm oturumları kapat" ve gerçek sign-out`
**labels:** `P1-yuksek`, `auth`, `security`

**body:**

```markdown
## Amaç

Stateless JWT mimarisinde sign-out yalnızca istemcinin cookie'sini temizliyor; **çalınmış bir
token 8 saat boyunca geçerli kalmaya devam ediyor**. Bu, README'de kayda geçmiş bilinçli bir
kabul — ama kullanıcının "şüpheli bir durum var, tüm oturumlarımı kapatayım" diyebileceği
hiçbir yol yok. Finansal bir üründe kurumsal müşterinin soracağı ilk sorulardan biridir.

Çözüm ucuzdur: session revocation altyapısı (#26) **zaten var**; tek eksik, şifre değişimi
dışında da tetiklenebilen bir zaman damgası.

## Kapsam

### Şema

`User` modeline `sessionsRevokedAt DateTime?` eklenir.
`null` = hiç toplu iptal yapılmadı (mevcut kullanıcılar migration'dan etkilenmez —
`credentialsChangedAt` ile aynı mantık).

### Revocation kontrolü

`isSessionRevoked()` (`src/lib/auth/session-revocation.ts`) artık **iki** zaman damgasının
en büyüğüyle karşılaştırır: `max(credentialsChangedAt, sessionsRevokedAt)`.

`jwt` callback'indeki (`src/lib/auth/config.ts`) sorgu zaten her istekte bu satırı okuyor —
`select`'e bir alan eklemekten ibarettir, **ek DB maliyeti yoktur** (#113'teki `name` ile
aynı gerekçe).

### Endpoint

`POST /api/auth/revoke-sessions` — authenticated, gövdesiz.
`sessionsRevokedAt = now()` yazar. Kullanıcı **kendi** oturumundan da düşer; yanıt bunu açıkça
söyler ("Tüm oturumlar kapatıldı, lütfen tekrar giriş yapın") — `change-password`'deki
davranışın aynısı ve aynı nedenle (stateless JWT'de "bu isteği yapan token"ı ayrıcalıklı
kılmanın yolu yoktur).

Rate limit: 5/15dk, `auth:revoke-sessions` bucket'ı, `policies.ts`'e eklenir.

### UI

Profil/güvenlik ekranında "Tüm cihazlardan çıkış yap" butonu ve onay adımı.

### Audit

`AUTH_SESSIONS_REVOKED`; `actorUserId` doldurulur (istek authenticated'dır, enumeration
sinyali taşımaz — `change-password` kararıyla aynı).

## Teknik Gereksinimler

- Invariant #3, #4 (POST), #8, #9.
- `sessionsRevokedAt` yazımı tek bir fonksiyondan geçer; şifre değiştiren akışlar
  `updateUserPassword()` kullanmaya devam eder (o fonksiyon değişmez).
- Hassasiyet kuralı korunur: `token.iat` saniye, zaman damgaları milisaniye —
  `isSessionRevoked()`'daki mevcut "grace window" mantığı aynen geçerlidir.

## Scope Dışı

- Aktif oturumların listelenmesi ("şu cihazlardan giriş yapıldı") — bu, sunucu tarafında
  oturum kaydı tutmayı gerektirir ve mimariyi değiştirir; ayrı bir karar.
- Yönetici tarafından başka bir kullanıcının oturumlarının düşürülmesi — ayrı issue.

## Acceptance Criteria

- Revoke sonrası, revoke'tan önce alınmış token ile `GET /api/auth/me` 401 dönüyor.
- `GET /api/auth/session` ile bypass edilemiyor (mevcut #26 testinin aynısı yeni yol için de
  yazılır).
- Şifre değişimi revocation'ı hâlâ çalışıyor (regresyon).
- Rate limit uygulanıyor.
- MEMBER dahil her authenticated kullanıcı kendi oturumlarını kapatabiliyor.

## Bağımlılıklar

Yok (#26 üzerine kurulur).

## Önerilen Branch

`feature/revoke-all-sessions`
```

---

### B8
**title:** `Veritabanı bağlantı yönetimi: havuzlama ve serverless davranışı`
**labels:** `P1-yuksek`, `epic-12`, `ops`

**body:**

```markdown
## Amaç

Her istekte session revocation için bir `User` sorgusu atılıyor (doğru bir karar). Ama bu,
uygulamanın en sıcak sorgusu demektir ve serverless bir deployment'ta Prisma + Postgres
bağlantı limiti klasik duvardır: her instance kendi bağlantı havuzunu açar, Postgres'in
`max_connections` limiti hızla dolar ve uygulama `too many connections` ile çöker.

Bu, trafik artınca **aniden** ortaya çıkan bir sorundur; önceden ölçülmezse ilk yoğun günde
yaşanır.

## Kapsam

- Deployment hedefine göre bağlantı havuzu: yönetilen bir pooler (Neon pooled connection,
  Supabase pgBouncer, RDS Proxy) veya Prisma Accelerate.
- `DATABASE_URL` (migration için doğrudan bağlantı) ile `DATABASE_POOL_URL` (uygulama için
  havuzlanmış bağlantı) ayrımı. **Migration'lar pooler üzerinden çalıştırılmaz** — prepared
  statement davranışı nedeniyle bozulur; bu ayrım açıkça belgelenir.
- `src/lib/prisma.ts` singleton'ının seçilen modele göre gözden geçirilmesi
  (`connection_limit` parametresi).
- Basit bir yük ölçümü: 50 eşzamanlı authenticated istek altında hata oranı ve p95 gecikme
  ölçülüp PR'a yazılır. Ölçüm yapılmadan "yeterli" denmez.

## Teknik Gereksinimler

- Invariant #5.
- `jwt` callback'indeki sorgu **değiştirilmez** (revocation'ın kritik yolu). Optimizasyon
  gerekirse bu ayrı bir karar ve ayrı bir issue'dur.

## Scope Dışı

- Sorgu önbellekleme / read replica.
- Session revocation sorgusunun cache'lenmesi.

## Acceptance Criteria

- Havuzlanmış bağlantı yapılandırılmış ve migration'ın doğrudan bağlantı kullandığı belgelenmiş.
- 50 eşzamanlı istek altında `too many connections` hatası alınmıyor; ölçüm sonucu PR'da.
- `.env.example` iki URL'yi de açıklamalarıyla içeriyor.

## Bağımlılıklar

#90 (deployment kararı).

## Önerilen Branch

`feature/db-connection-pooling`
```

---

### B9
**title:** `AuditLog saklama ve arşivleme politikası`
**labels:** `P1-yuksek`, `epic-12`, `security`

**body:**

```markdown
## Amaç

`AuditLog` her state değiştiren işlemde bir satır yazıyor ve **hiçbir zaman silinmiyor**. Bir
yıl içinde veritabanının en büyük tablosu o olur; `@@index([createdAt])`, `@@index([action])`
gibi index'ler de onunla büyür. Ayrıca "kişisel veriyi ne kadar süre tutuyorsunuz?" sorusunun
bugün bir cevabı yok.

## Kapsam

- **Saklama süresi kararı** (öneri: 12 ay sıcak, sonrası arşiv/silme) yazılır ve README'ye
  gerekçesiyle girer.
- Süresi dolan kayıtları toplu işleyen idempotent bir bakım görevi:
  - Sabit boyutlu partiler hâlinde çalışır (ör. 10.000 satır), tek dev `DELETE` atmaz —
    uzun kilit ve şişmiş WAL üretirdi.
  - Yeniden çalıştırılabilir; yarıda kesilirse kaldığı yerden devam eder.
  - Kaç satır işlediğini loglar.
- Silmeden önce arşiv: satırlar JSON/CSV olarak dışa aktarılıp soğuk depolamaya yazılır
  (yedekleme deposuyla aynı yer — [B6]).
- Tetikleme: platformun zamanlanmış işi (Vercel Cron / GitHub Actions schedule). Uygulama
  içinde kalıcı bir zamanlayıcı **kurulmaz**.

## Teknik Gereksinimler

- Görev bir HTTP endpoint'i ise **POST**'tur (invariant #4) ve paylaşılan bir gizli anahtarla
  korunur; anahtar `.env.example`'a placeholder olarak eklenir.
- Tenant silinmiş kayıtlar (`tenantId` null) de politikaya tabidir.
- Silme işlemi audit log'a **yazmaz** (kendi kendini besleyen döngü); yalnızca loglanır.

## Scope Dışı

- Audit log'un kullanıcıya gösterilmesi (#77, Epic 9).
- Değiştirilemezlik (append-only/WORM) garantileri.

## Acceptance Criteria

- Saklama süresi yazılı ve gerekçeli.
- Bakiye görevi iki kez çalıştırıldığında ikinci çalıştırma hiçbir şey silmiyor (idempotent).
- Parti boyutu aşıldığında görev bölünerek tamamlanıyor.
- Arşiv dosyası üretiliyor ve içeriği silinen satırlarla birebir eşleşiyor (integration testi).

## Bağımlılıklar

[B6] (arşiv deposu).

## Önerilen Branch

`feature/audit-log-retention`
```

---

### B10
**title:** `Bağımlılık güvenliği: Dependabot, npm audit CI job'ı ve next-auth beta riski`
**labels:** `P1-yuksek`, `epic-12`, `security`

**body:**

```markdown
## Amaç

Şu an bağımlılık açıklarını bildiren hiçbir mekanizma yok. Ayrıca kimlik doğrulama
kütüphanesi **beta** sürümde (`next-auth ^5.0.0-beta.32`) ve `^` ile açık bırakılmış: bir
`npm install` beta'nın yeni bir sürümünü çekip auth davranışını sessizce değiştirebilir.
Finansal bir üründe auth katmanının kontrolsüz güncellenmesi kabul edilebilir bir risk değil.

## Kapsam

- **Sürüm sabitleme:** `next-auth` tam sürüme sabitlenir (`5.0.0-beta.32`, `^` kaldırılır).
  Gerekçe README'ye yazılır: beta API'si sürümler arasında değişebilir ve bu repo'nun
  revocation/CSRF duruşu Auth.js'in iç davranışına (session action'ın token'ı yeniden
  imzalaması) dayanıyor.
- **Dependabot:** `.github/dependabot.yml` — npm ve github-actions için haftalık; güvenlik
  güncellemeleri açık; `next-auth` için otomatik PR **kapalı** (elle gözden geçirilir).
- **CI job'ı:** `npm audit --audit-level=high` çalıştıran yeni bir job. Yüksek/kritik açıkta
  CI kırmızıya döner. Mevcut altı job'un yanına eklenir.
- CI'daki disposable `AUTH_SECRET`'ın production secret'ı olmadığı yorumu korunur.

## Teknik Gereksinimler

- `npm audit` çıktısı bir bulgu verirse job açıklayıcı biçimde raporlar; `--force` ile
  otomatik düzeltme **yapılmaz**.
- `package-lock.json` her sabitleme sonrası güncellenir ve commit edilir.

## Scope Dışı

- SAST/DAST araçları.
- Lisans uyumluluk taraması.

## Acceptance Criteria

- `next-auth` sabit sürümde; `npm ci` deterministik.
- Dependabot yapılandırması repo'da ve ilk PR'ını üretmiş.
- `npm audit` job'ı CI'da çalışıyor ve yüksek seviyeli bir açıkta kırılıyor.
- README'ye beta sürüm kararı ve kabul edilen kalan risk yazıldı.

## Bağımlılıklar

Yok.

## Önerilen Branch

`chore/dependency-security`
```

---

### B11
**title:** `E-posta doğrulama akışı (emailVerified alanını kullan)`
**labels:** `P1-yuksek`, `auth`

**body:**

```markdown
## Amaç

`User.emailVerified` şemada var ama **hiçbir yerde yazılmıyor ve okunmuyor**. Bu yüzden
kullanıcı yanlış yazdığı bir e-postayla kayıt olabiliyor; şifre sıfırlama akışı o hesaba
sonsuza dek erişilemez hâle geliyor ve destek yükü doğuyor. Sahte hesap üretimi de serbest.

## Kapsam

- Kayıt sonrası doğrulama e-postası: `EmailVerificationToken` modeli —
  `PasswordResetToken` ile **birebir aynı desen**: `crypto.randomBytes(32)`, DB'de yalnız
  SHA-256 hash'i, `expiresAt` (24 saat), tek kullanımlık, tüketim tek atomik `updateMany`
  ile (invariant #6).
- `POST /api/auth/verify-email` `{ token }` → `emailVerified = now()`.
- `POST /api/auth/resend-verification` — rate limit 3/15dk.
- `/verify-email` sayfası: token URL'den okunur (sunucu bileşeninde `searchParams`,
  `/reset-password` deseniyle aynı).
- **Doğrulanmamış hesap ne yapabilir?** Karar: giriş yapabilir ve kendi profilini görebilir,
  ama **tenant oluşturamaz ve davet kabul edemez**. Gerekçe: doğrulama, hesabın sahibine
  ulaşılabildiğini kanıtlar; para ve ekip verisi ancak o noktadan sonra devreye girmelidir.
  Girişi tamamen engellemek, e-posta gecikmesinde kullanıcıyı kilitler.
- Doğrulanmamış kullanıcıya arayüzde kalıcı bir uyarı şeridi ve "tekrar gönder" bağlantısı.

## Teknik Gereksinimler

- Invariant #6, #7 (token hatası ayrıştırılmaz — bulunamadı/süresi doldu/kullanıldı hepsi aynı
  400), #9.
- Doğrulama e-postası gönderimi başarısız olsa da kayıt başarılı sayılır; kullanıcı "tekrar
  gönder" ile ilerleyebilir.

## Scope Dışı

- E-posta adresi değiştirme akışı (ayrı issue — `/api/users/me` bugün e-postayı bilerek
  değiştirmiyor).

## Acceptance Criteria

- Kayıt sonrası doğrulama e-postası gidiyor; bağlantı `emailVerified`'ı dolduruyor.
- Token tek kullanımlık ve 24 saat sonra geçersiz; eşzamanlı iki kullanımdan biri kazanıyor.
- Doğrulanmamış kullanıcı tenant oluşturmaya çalışınca anlaşılır bir hata alıyor.
- Raw token DB'de saklanmıyor ve production loglarına yazılmıyor.
- Security testi: başka kullanıcının token'ıyla doğrulama yapılamıyor.

## Bağımlılıklar

[B1] (gerçek e-posta sağlayıcısı olmadan anlamsızdır).

## Önerilen Branch

`feature/email-verification`
```

---

## P2 — Teknik borç / bakım

---

### B12
**title:** `README'yi ADR'lere böl (karar kaydını sürdürülebilir kıl)`
**labels:** `P2-normal`, `documentation`

**body:**

```markdown
## Amaç

`README.md` 150 KB'ı aştı. Bir karar kaydı olması bu projenin en değerli özelliği, ama tek
dosyada taşınamaz hâle geldi: yeni bir katkıcı (veya kodlama ajanı) hangi bölümü okuyacağını
bilemiyor, ilgili kararı bulmak için 150 KB metinde arama yapmak gerekiyor ve `docs/workflow.md`
"her güvenlik kararı README'ye yazılır" dediği için dosya büyümeye devam edecek.

## Kapsam

- `docs/decisions/` dizini; her karar için ayrı bir ADR dosyası:
  `NNNN-kisa-baslik.md` (ör. `0007-signup-enumeration-karari.md`).
- Sabit şablon: **Bağlam / Karar / Reddedilen alternatifler / Sonuçlar ve kalan risk /
  İlgili issue ve testler**. Mevcut README bölümleri zaten bu yapıda yazılmış; **metin
  yeniden yazılmaz, taşınır**.
- README yerinde kalır ama bir **dizine** dönüşür: ürün tanıtımı, kurulum, komutlar ve
  ADR'lere bağlantı tablosu.
- `docs/workflow.md`'deki "Dokümantasyonu güncel tutma" tablosu güncellenir: yeni güvenlik
  kararı artık yeni bir ADR dosyası açar.
- `CLAUDE.md` / `AGENTS.md` içindeki README göndermeleri ilgili ADR'lere yönlendirilir
  (ikisi aynı commit'te güncellenir — mevcut kural).

## Teknik Gereksinimler

- Hiçbir karar metni **kaybolmaz veya özetlenmez**; taşıma birebirdir. PR'da eski/yeni
  karakter sayısı karşılaştırması verilir.
- İçerik değişikliği ile taşıma **aynı commit'te karıştırılmaz**.

## Scope Dışı

- Doküman sitesi (Docusaurus vb.) kurulumu.

## Acceptance Criteria

- Her ADR tek bir kararı anlatıyor ve şablona uyuyor.
- README 20 KB altına indi ve tüm ADR'lere bağlantı veriyor.
- Hiçbir karar metni kaybolmadı (PR'da doğrulama).
- `CLAUDE.md`/`AGENTS.md` göndermeleri güncel.

## Bağımlılıklar

Yok.

## Önerilen Branch

`docs/split-readme-into-adrs`
```

---

## Mevcut issue güncellemeleri

> Bunlar **yeni issue değildir**. Claude Code önce `gh issue view <no>` ile canlı gövdeyi
> okur, sonra aşağıdaki eki gövdenin **sonuna ekler** (mevcut metni silmeden) ve label'ları
> uygular.

### U1 — Issue #134 (saat dilimi)

**Eklenecek label'lar:** `P0-blocker`

**Gövdeye eklenecek bölüm:**

```markdown
---

## Güncelleme: karar ve aciliyet (kod denetimi, Eylül 2026)

Bu issue şu an açık bıraktığı üç soruyu netleştiriyor ve önceliği **P0'a** çekiyor.

**Karar — referans tenant'ın saat dilimidir.** `Tenant` modeline `timeZone String
@default("Europe/Istanbul")` alanı eklenir (tenant ayarları #86 ile birlikte). Tüm "bugün",
"bu ay", "vadesi geçti" hesapları bu alana göre yapılır. Kullanıcının tarayıcısı referans
alınmaz: aynı tenant'ın iki üyesi farklı şehirlerde olduğunda aynı raporun farklı çıkması,
çözdüğünden büyük bir sorun yaratır.

**Karar — `occurredAt` bir AN olarak kalır** (`@db.Date`'e çevrilmez). Gün hassasiyetine
indirgemek geri dönüşü olmayan bir migration'dır ve ileride saatli kayıt (ör. tahsilat anı)
gerektiğinde yolu kapatır. Gün hesabı, saklanan anın tenant zaman diliminde yorumlanmasıyla
yapılır.

**Mevcut kayıtlar:** bugüne kadarki tüm kayıtlar tek saat diliminde (Europe/Istanbul)
girildiği için varsayılan değer geçmişi doğru yorumlar; veri dönüşümü gerekmez. Bu varsayım
kabul kriterlerinde bir testle sabitlenir.

**Neden P0:** Epic 15 (Tahsilat & Ödeme Planı) baştan sona **vade** üzerine kuruludur —
taksit vadesi, çek vadesi, "vadesi yaklaşanlar", "vadesi geçenler". Bu karar verilmeden o
modül yazılırsa saat dilimi hatası tek bir yerde değil, her ekranda ve her raporda tekrarlanır
ve sonradan düzeltmek migration + tüm sorguların yeniden yazımı demektir.

**Bu issue, Epic 15'in (T1, T3, T4) ÖN KOŞULUDUR.**

## Ek kabul kriterleri

- `Tenant.timeZone` alanı var ve tenant ayarları ekranından değiştirilebiliyor.
- Gün/dönem hesabı yapan tek bir yardımcı modül var; sorgular tarih aritmetiğini elle yapmıyor.
- Sunucu `TZ=UTC` iken bile, Europe/Istanbul saatiyle 23 Ocak 01:00'de girilen bir işlem
  listede **23 Ocak** görünüyor (regresyon testi).
```

### U2 — Issue #92 (Monitoring/Logging)

**Gövdeye eklenecek satır:**

```markdown
Somut ilk adım [B4] issue'sunda tanımlanmıştır (Sentry + request-scoped yapılandırılmış log).
```

### U3 — Issue #94 (Backup/DR)

**Gövdeye eklenecek satır:**

```markdown
Somut ilk adım [B6] issue'sunda tanımlanmıştır (RPO/RTO kararı, otomatik yedek, haftalık
mantıksal döküm ve geri dönüş provası).
```

---

# BÖLÜM B — "ŞU OLSA GÜZEL"

Bunlar ürünü olgunlaştırır; olmadan da sistem çalışır. Hepsi **Epic 16** altında toplanır ve
P0/P1 işleri bittikten sonra sıraya girer.

---

### N0
**title:** `Epic: Ürün Olgunluğu`
**labels:** `epic-16`, `P2-normal`, `enhancement`

**body:**

```markdown
## Amaç

Çekirdek işlevsellik ve launch blocker'ları tamamlandıktan sonra, ürünü "çalışan bir
uygulama"dan "kurumsal müşteriye güvenle satılan bir ürüne" taşıyan işler.

## Kapsam

Kullanıcı güveni (2FA, veri dışa aktarma, geri alınabilir silme), ilk kullanım deneyimi
(onboarding), yerelleştirme ve erişilebilirlik.

## Alt Issue'lar

- [N1] İki faktörlü doğrulama (TOTP)
- [N2] Tenant verisini dışa aktarma (KVKK + taşınabilirlik)
- [N3] Yumuşak silme ve çöp kutusu
- [N4] Onboarding: kayıt sonrası ilk tenant ve örnek veri
- [N5] Yerelleştirme: tarih, sayı ve para biçimlendirmesi tek yerden
- [N6] Erişilebilirlik denetimi ve klavye desteği

## Scope Dışı

- Çoklu dil (i18n) desteği — arayüz Türkçedir; İngilizce talebi geldiğinde ayrı epic.

## Acceptance Criteria

Alt issue'ların tamamı kapanmış.

## Bağımlılıklar

P0 ve P1 işlerinin tamamlanması.

## Önerilen Branch

Yok — gruplama issue'su.
```

---

### N1
**title:** `İki faktörlü doğrulama (TOTP)`
**labels:** `epic-16`, `P2-normal`, `auth`, `security`

**body:**

```markdown
## Amaç

Finansal veriye erişen bir üründe tek faktör (şifre) kurumsal müşteri için yetersizdir.
Şifresi sızmış bir hesap bugün doğrudan tüm tenant verisine erişir.

## Kapsam

- `UserTotpSecret` modeli: `secret` **şifrelenmiş** saklanır (`AUTH_SECRET` türevi bir anahtarla,
  Node'un yerleşik `crypto` modülü — ek bağımlılık yok), `confirmedAt`, `createdAt`.
- Kurulum akışı: gizli anahtar üret → `otpauth://` URI'si → kullanıcı doğrulama kodunu girer →
  `confirmedAt` dolar. Doğrulanana kadar 2FA **aktif sayılmaz**.
- **Kurtarma kodları**: 10 adet tek kullanımlık kod, DB'de yalnızca SHA-256 hash'leri
  (`PasswordResetToken` deseni). Kurtarma kodu olmadan 2FA açılamaz — telefonunu kaybeden
  kullanıcı kilitlenmemelidir.
- Giriş akışı: şifre doğruysa ve 2FA aktifse ikinci adım istenir.
- Rate limit: TOTP doğrulama 5/5dk (`auth:totp` bucket'ı).
- Audit: `AUTH_TOTP_ENABLED`, `AUTH_TOTP_DISABLED`, `AUTH_TOTP_FAILURE`.

## Teknik Gereksinimler

- TOTP doğrulaması **sabit zamanlı** karşılaştırma ile yapılır (`crypto.timingSafeEqual`).
- ±1 zaman penceresi (30 sn) toleransı; daha geniş pencere saldırı yüzeyini büyütür.
- Aynı kod iki kez kullanılamaz (son kullanılan pencere kaydedilir).
- Auth.js Credentials provider'ının `authorize()` fonksiyonuna nasıl entegre edileceği
  README'ye yazılır — bu, giriş akışının en kritik noktasıdır.
- 2FA kapatma **mevcut şifreyi** ister (`change-password` gerekçesiyle aynı).

## Scope Dışı

- SMS/e-posta ile OTP (güvenlik açısından daha zayıf, maliyetli).
- WebAuthn/passkey — ayrı ve daha büyük bir iş.
- Tenant seviyesinde "2FA zorunlu" politikası.

## Acceptance Criteria

- 2FA açık kullanıcı, doğru şifre + yanlış kodla giriş yapamıyor.
- Aynı TOTP kodu ikinci kez kabul edilmiyor.
- Kurtarma kodu bir kez çalışıyor, ikincide reddediliyor.
- TOTP secret'ı düz metin olarak DB'de veya loglarda yok.
- Rate limit uygulanıyor; başarısız denemeler audit'e yazılıyor.

## Bağımlılıklar

Yok.

## Önerilen Branch

`feature/totp-2fa`
```

---

### N2
**title:** `Tenant verisini dışa aktarma (KVKK + taşınabilirlik)`
**labels:** `epic-16`, `P2-normal`, `finance`

**body:**

```markdown
## Amaç

"Verim bende kalır mı?" sorusu satış görüşmesinde sorulur. Ayrıca KVKK kapsamında veri
taşınabilirliği bir haktır. Bugün bir tenant'ın verisini dışarı almanın hiçbir yolu yok.

## Kapsam

- `POST /api/tenants/[tenantId]/export` — OWNER yetkisi. Tenant'ın tüm verisini tek bir ZIP
  içinde üretir: hesaplar, kategoriler, işlemler, borç/alacak, üyeler (kişisel veri **hariç**:
  şifre hash'i, token'lar asla), açık modüllerin verisi ve o tenant'a ait audit log.
- Biçim: kayıt türü başına bir CSV + bir `manifest.json` (sürüm, üretim zamanı, satır sayıları).
  CSV, hem Excel'de açılır hem makine tarafından okunur.
- Üretim **eşzamanlı değildir**: istek bir dışa aktarma kaydı oluşturur, iş arka planda
  çalışır, hazır olunca indirilebilir bağlantı üretilir. Büyük tenant'ta senkron üretim
  isteği zaman aşımına uğratır.
- İndirme bağlantısı süreli (24 saat) ve tek kullanımlıktır (token deseni, invariant #6).
- Rate limit: 2/saat — üretim maliyetli bir iştir.

## Teknik Gereksinimler

- Tüm sorgular `tenantScoped()` üzerinden; başka tenant'ın tek bir satırı bile dosyaya
  giremez (security testiyle kanıtlanır).
- Parasal alanlar CSV'ye **string** olarak yazılır; Excel'in sayıya çevirip hassasiyet
  kaybetmesini önlemek için biçim kararı belgelenir.
- **CSV injection koruması:** `=`, `+`, `-`, `@` ile başlayan hücre değerleri kaçırılır.
  Kullanıcının girdiği bir kategori adı, Excel'de formül olarak çalışmamalıdır.
- Audit: `TENANT_DATA_EXPORTED`.

## Scope Dışı

- İçe aktarma (Epic 10, #79).
- Zamanlanmış periyodik dışa aktarma.

## Acceptance Criteria

- Dışa aktarılan ZIP, tenant'ın verisini eksiksiz içeriyor (satır sayıları manifest ile uyumlu).
- Başka tenant'ın verisi dosyada yok (security testi).
- Şifre hash'i, token, `credentialsChangedAt` gibi alanlar dosyada yok.
- CSV injection denemesi kaçırılmış hâlde çıkıyor.
- İndirme bağlantısı 24 saat sonra ve ikinci kullanımda çalışmıyor.
- OWNER olmayan kullanıcı dışa aktaramıyor.

## Bağımlılıklar

[B6] (dosya depolama), Epic 10 ile biçim uyumu.

## Önerilen Branch

`feature/tenant-data-export`
```

---

### N3
**title:** `Yumuşak silme ve çöp kutusu`
**labels:** `epic-16`, `P2-normal`, `finance`

**body:**

```markdown
## Amaç

Bugün silme geri dönülemez ve tenant silindiğinde cascade her şeyi götürür. Finansal veride
"yanlışlıkla sildim" talebi kaçınılmazdır ve bugünkü tek cevap yedekten dönmektir — yani
tüm tenant'ları etkileyen bir işlem.

## Kapsam

- Kullanıcının doğrudan sildiği üst düzey kayıtlara `deletedAt DateTime?` eklenir:
  `Transaction`, `DebtCredit`, `Account`, `Category` ve (varsa) modül kayıtları.
- Silme = `deletedAt` yazmak. Tüm listeleme ve toplama sorguları `deletedAt: null` filtresi
  alır.
- `/settings/trash` — son 30 gün içinde silinenler, geri yükleme aksiyonu.
- 30 günden eski kayıtlar bakım göreviyle **kalıcı** silinir ([B9] ile aynı desen: partili,
  idempotent, zamanlanmış).
- Tenant silme: `deletedAt` + 30 gün bekleme. Bu süre boyunca tenant'a erişilemez ama veri durur.

## Teknik Gereksinimler

- **En riskli kısım budur:** `deletedAt: null` filtresi bir sorguda unutulursa silinmiş kayıt
  bakiyeye ve rapora geri karışır. Bu yüzden `tenantScoped()`'un yanına `activeScoped()`
  helper'ı eklenir ve `integration/tenant-scope-pattern.spec.ts` deseni genişletilerek
  **her tenant-scoped sorgunun** bu filtreyi taşıdığı testle zorlanır.
- `Transaction` silmek `Account.balance`ı bugün düzeltiyor; yumuşak silmede de aynı düzeltme
  yapılır ve geri yüklemede **ters yönde** uygulanır — ikisi de aynı transaction içinde.
- Silinmiş bir kaydın referans verdiği kayıt (hesap/kategori) silinmişse geri yükleme
  **reddedilir** → 409, anlaşılır mesajla.
- Unique constraint'ler: silinmiş kayıt hâlâ ismi işgal eder. Bu bilinçlidir ve kullanıcıya
  "çöp kutusunda aynı isimde bir kayıt var" mesajıyla gösterilir (Institution/arşiv kararıyla
  aynı duruş).

## Scope Dışı

- Sürüm geçmişi / değişiklik geri alma.

## Acceptance Criteria

- Silinen işlem listede ve bakiyede görünmüyor; çöp kutusunda görünüyor.
- Geri yükleme bakiyeyi doğru düzeltiyor.
- 30 gün sonrası kalıcı silme çalışıyor ve idempotent.
- Pattern testi, `deletedAt` filtresi eksik bir sorguda kırmızıya dönüyor.
- Referansı silinmiş kaydın geri yüklenmesi 409 veriyor.

## Bağımlılıklar

[B9] (bakım görevi deseni).

## Önerilen Branch

`feature/soft-delete`
```

---

### N4
**title:** `Onboarding: kayıt sonrası ilk tenant ve örnek veri`
**labels:** `epic-16`, `P2-normal`, `frontend`

**body:**

```markdown
## Amaç

Bugün yeni kullanıcı kayıt oluyor, giriş yapıyor ve **boş bir uygulamaya** düşüyor: tenant'ı
yok, hesabı yok, kategorisi yok. Ne yapacağını anlatan hiçbir şey yok. Bu, denemeye gelen
kullanıcının ilk beş dakikada kaybedildiği noktadır.

## Kapsam

- Kayıt sonrası ilk girişte yönlendirilen bir kurulum akışı:
  1. Tenant adı (bireysel kullanım için "Kişisel" önerilir),
  2. İlk hesap (banka/kasa) ve para birimi,
  3. Varsayılan kategori seti — **modül seed deseniyle** ([M4]) idempotent kurulur:
     gelir (Maaş, Ek Gelir, Diğer), gider (Kira, Faturalar, Market, Ulaşım, Sağlık, Diğer).
- Kurulum atlanabilir; atlanırsa dashboard'da kalıcı bir "kurulumu tamamla" kartı görünür.
- Dashboard'da veri yokken boş durum, örnek ekran görüntüsü yerine **ne yapılacağını**
  söyleyen bir yönlendirme gösterir.

## Teknik Gereksinimler

- Kurulum tek bir `runSerializable()` işlemidir: yarıda kalırsa tenant'sız/hesapsız bir
  ara durum bırakmaz.
- Örnek/sahte finansal veri **üretilmez** — kullanıcının gerçek verisiyle karışması, bir
  finans ürününde kabul edilemez. Yalnızca kategori şablonu kurulur.
- Mevcut `POST /api/tenants` ve hesap/kategori servisleri kullanılır; yeni bir yazma yolu
  açılmaz.

## Scope Dışı

- Ürün turu / interaktif rehber.
- E-posta ile onboarding dizisi.

## Acceptance Criteria

- Yeni kullanıcı kayıt → giriş → kurulum → dolu bir dashboard akışını kesintisiz tamamlıyor
  (e2e testi).
- Kurulum atlanabiliyor ve daha sonra tamamlanabiliyor.
- Kurulum iki kez çalıştırılırsa kategori kopyalanmıyor.

## Bağımlılıklar

[M4] (seed deseni).

## Önerilen Branch

`feature/onboarding`
```

---

### N5
**title:** `Yerelleştirme: tarih, sayı ve para biçimlendirmesi tek yerden`
**labels:** `epic-16`, `P2-normal`, `frontend`

**body:**

```markdown
## Amaç

Bugün tarihler `toISOString().slice(0, 10)` ile (yani `2026-01-23` biçiminde) gösteriliyor;
`toLocaleDateString()` bilerek kullanılmadı çünkü çıktıyı sunucunun locale'ine bağlardı.
Sonuç: Türkçe bir arayüzde ISO tarih ve muhtemelen tutarsız sayı biçimleri.

Saat dilimi kararı (#134) verildikten sonra bu boşluk kapatılabilir hâle gelir.

## Kapsam

- `src/lib/format/` altında tek bir biçimlendirme modülü: tarih, tarih-saat, sayı, para.
- Locale ve saat dilimi **açıkça** verilir (`tr-TR` + tenant'ın `timeZone`'u); ortamın
  varsayılanına asla güvenilmez — bugünkü kararın arkasındaki endişe bu şekilde giderilir.
- Para: tutar string olarak gelir, `Intl.NumberFormat` ile biçimlenir, **aritmetik yapılmaz**
  (invariant #10). Mevcut `components/ui/money.tsx` bu modülü kullanacak şekilde güncellenir.
- Sunucu ve istemcide **aynı** sonucu üretmesi zorunludur (hydration uyuşmazlığı olmamalı):
  biçimlendirme sunucuda yapılıp string olarak geçirilir.

## Teknik Gereksinimler

- Bağımlılık eklenmez; `Intl` yeterlidir.
- Testler sabit bir zaman dilimi ve locale ile çalışır; CI'ın makine ayarına duyarlı olmaz.

## Scope Dışı

- Çoklu dil (i18n).

## Acceptance Criteria

- Tüm ekranlarda tarihler `23.01.2026`, tutarlar `1.234,56 ₺` biçiminde.
- Sunucu `TZ=UTC` ve `LANG=C` iken de çıktı aynı (test).
- Hydration uyarısı yok.

## Bağımlılıklar

#134 (saat dilimi kararı).

## Önerilen Branch

`feature/localized-formatting`
```

---

### N6
**title:** `Erişilebilirlik denetimi ve klavye desteği`
**labels:** `epic-16`, `P2-normal`, `frontend`

**body:**

```markdown
## Amaç

Arayüz hızla büyüdü (dashboard, işlemler, raporlar, üyeler, borç/alacak) ve erişilebilirlik
hiç ölçülmedi. Kurumsal ve kamu müşterilerinde bu bir satın alma kriteri olabiliyor; ayrıca
klavyeyle hızlı veri girişi, muhasebe işi yapan kullanıcının doğrudan verimliliğidir.

## Kapsam

- Playwright'a `@axe-core/playwright` ile otomatik erişilebilirlik denetimi; ana ekranlar için
  bir e2e testi. Kritik ihlaller CI'ı kırar.
- Klavye ile tam gezinme: form alanları, tablo aksiyonları, modal'lar (focus tuzağı ve
  `Esc` ile kapanma).
- Renk kontrastı: tasarım sistemi token'ları (`globals.css`) WCAG AA'ya göre kontrol edilir;
  düşen tokenlar düzeltilir.
- Durum yalnızca renkle anlatılmaz: "gecikti", "ödendi", "karşılıksız" gibi rozetler metin
  de taşır.
- Form hataları `aria-describedby` ile alana bağlanır; ekran okuyucu hatayı okur.

## Teknik Gereksinimler

- Denetim mevcut e2e altyapısına eklenir; ayrı bir test suite'i kurulmaz.
- Token değişiklikleri tek yerde (`globals.css`) yapılır; bileşenlere ham renk yazılmaz.

## Scope Dışı

- Tam WCAG AAA uyumu.
- Ekran okuyucu ile manuel sertifikasyon.

## Acceptance Criteria

- Ana ekranlarda axe kritik/ciddi ihlali yok.
- Tüm formlar ve tablo aksiyonları yalnızca klavyeyle kullanılabiliyor.
- Kontrast oranları AA eşiğini geçiyor.
- Rozetler renkten bağımsız okunabiliyor.

## Bağımlılıklar

Yok.

## Önerilen Branch

`feature/accessibility`
```

---

## 3. Uygulama sırası

```
P0  B1 → B3 → B2 → B5 → B4 → B6        (+ #134 kararı, Epic 15'ten ÖNCE)
P1  B7 → B10 → B11 → B8 → B9
P2  B12
────────────────────────────────────────
Epic 16 (N1..N6) — P0 ve P1 bittikten sonra
```

**B3'ün B2'den önce gelmesinin nedeni:** dağıtık rate limit kurulsa bile, IP çıkarımı
sertleştirilmeden limit uydurma bir header ile bypass edilebilir. Önce doğru IP, sonra
paylaşılan sayaç.

**#134'ün konumu:** Epic 15 (Tahsilat) baştan sona vade üzerine kurulu olduğu için, saat
dilimi kararı T1/T3/T4'ten **önce** verilmelidir. Modül işleriyle paralel yürütülebilir ama
tahsilat kodu yazılmadan bitmiş olmalıdır.
