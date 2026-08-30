# Test Rehberi

Bu projede test, "kapsam yüzdesi" için değil, **bir invariant'ın bozulduğunu yakalamak** için
yazılır. Test yazmadan bir davranış değişikliği tamamlanmış sayılmaz.

Üç ayrı Playwright suite'i vardır; her birinin kendi config'i ve CI job'ı vardır.

| Suite | Dizin | Config | Ne test eder | Tarayıcı | Sunucu | DB |
| --- | --- | --- | --- | --- | --- | --- |
| E2E | `e2e/` | `playwright.config.ts` | Gerçek tarayıcıda uçtan uca akış, tarayıcı davranışı (cookie, SameSite) | Chromium | ✔ | ✔ |
| Integration | `integration/` | `playwright.integration.config.ts` | `src/lib` fonksiyonlarını doğrudan, DB'ye karşı | ✘ | ✘ | ✔ |
| Security | `security/` | `playwright.security.config.ts` | Saldırgan bakış açısı: yetkisiz erişim, izolasyon ihlali, enumeration, revocation | ✘ | ✔ | ✔ |

```bash
npm run test:integration   # en hızlı geri bildirim — önce bunu çalıştır
npm run test:security
npm run test:e2e
```

Integration ve security suite'leri `workers: 1` ile **sıralı** çalışır (paylaşılan test
veritabanında çakışmayı önlemek için). E2E paralel çalışır.

## Ön koşullar

```bash
docker compose up -d      # lokal PostgreSQL
npm run prisma:migrate    # şemayı uygula
```

`AUTH_SECRET` ve `DATABASE_URL` `.env`'de tanımlı olmalıdır; security suite'i `AUTH_SECRET`
yoksa açık bir hata ile durur. Testler **test veritabanına** karşı çalışır — gerçek veri içeren
bir DB'ye asla yöneltilmez.

## Hangi testi nereye yazmalı

- Bir **iş kuralı** mı değişti (rol değişimi, son OWNER koruması, token süresi)? → `integration/`
- Bir **yetki/izolasyon sınırı** mı var (başka tenant'ın kaynağı, yetkisiz mutation, enumeration,
  session revocation, rate limit bypass)? → `security/`
- Doğruluğu **tarayıcının** davranışına mı bağlı (cookie gönderilir mi, redirect, form akışı)? →
  `e2e/`

Yeni bir endpoint genellikle **iki** test gerektirir: mutlu yol (`integration/`) ve yetkisiz/
cross-tenant yol (`security/`).

## Bu repo'daki test kuralları

### 1. Testler kendi kendini doğrular

Bir test "hiçbir şey bulamadığı için" yeşil kalmamalıdır. Tarama/pattern testlerinde önce
taramanın çalıştığı iddia edilir:

```ts
// Bu kontrol olmadan, tarama bozulup 0 dosya bulsa bile aşağıdaki test sessizce geçerdi.
expect(ROUTE_FILES.length).toBeGreaterThanOrEqual(5);
expect(inspectedGetHandlers).toBeGreaterThanOrEqual(3);
```

Aynı mantık davranış testleri için de geçerlidir: "403 döndü" iddiası, isteğin gerçekten
sunucuya ulaştığı ve kaynağın gerçekten var olduğu kanıtlanmadan değersizdir.

### 2. Kontrol grubu ve duyarlılık

Bir güvenlik testi, **korumanın zayıflaması durumunda kırmızıya döndüğü** gösterilerek
tamamlanır:

- **Kontrol grubu:** cross-site istek 401 alıyorsa, aynı-site isteğin 200 aldığı da test edilir —
  aksi halde 401'in sebebi "cookie zaten geçersizdi" olabilir.
- **Duyarlılık:** `e2e/csrf-samesite.spec.ts`, cookie `SameSite=None` yapıldığında isteğin
  authentication'ı geçtiğini göstererek testin gerçekten koruma ölçtüğünü kanıtlar.

### 3. Güvenlik mekanizmaları mock'lanmaz

- Sign-in, Auth.js'in gerçek CSRF + credentials callback akışıyla yapılır
  (`e2e/support/auth.ts`) — `signIn()` mock'lanmaz.
- Session cookie'si, uygulamanın **gerçek** JWT encode fonksiyonuyla ve aynı `AUTH_SECRET` ile
  üretilir (`security/support/session.ts`); server bunu normal bir oturum gibi doğrular.
- Hash, token üretimi, rate limiter gibi mekanizmalar stub'lanmaz; gerçek implementasyon çalışır.

### 4. Test verisi izole ve benzersizdir

Suite'ler paylaşılan bir DB kullandığından:

- E-posta/slug gibi unique alanlar `randomUUID()` ile üretilir:
  `member-${randomUUID()}@example.com`.
- Kurulum yardımcıları test dosyasının başında küçük fonksiyonlar olarak tanımlanır
  (`createUser`, `createTenant`, `setupTenantWithOwner`, `cleanup`).
- Test ürettiği kayıtları temizler (`cleanup(userIds, tenantIds)`); `Tenant`/`User` silinince
  ilişkili kayıtlar cascade ile gider.
- DB'ye doğrudan dokunan suite'ler sonunda `prisma.$disconnect()` çağırır:

  ```ts
  test.afterAll(async () => { await prisma.$disconnect(); });
  ```

### 5. Rate limit tuzağı

Auth endpoint'lerine HTTP isteği atan **her** test, benzersiz bir sahte istemci IP'si
kullanmalıdır — aksi halde testler birbirinin rate-limit bucket'ını tüketir ve rastgele 429
alırsınız:

```ts
import { uniqueTestClientIp } from "./support/rate-limit";
// signInWithCredentials() ip verilmezse zaten benzersiz üretir.
```

Rate limiter'ın **kendisini** test eden yerler (`security/rate-limit-security.spec.ts`) bucket'ı
kasıtlı tüketmek için sabit bir IP geçer.

### 6. E-posta akışları outbox üzerinden doğrulanır

Gerçek e-posta sağlayıcısı yoktur; `EmailSender`/`InvitationSender` dosyaya yazar. Testler
reset/davet token'ını `e2e/support/outbox.ts` ve `e2e/support/invitation-outbox.ts` ile okur
(`.test-outbox/`, `.test-outbox-invitations/` — ikisi de `.gitignore`'da).

### 7. Pattern (kaynak metni) testleri

`integration/get-side-effect-free-pattern.spec.ts` ve `integration/tenant-scope-pattern.spec.ts`,
kaynak kodu okuyup tehlikeli desenleri arar. Bunlar lint/AST aracı değildir; **regresyon
bariyeridir** — birinin ileride `where: { id }` yazmasını veya bir GET handler'ına yazma
eklemesini yakalar. Yeni tenant-scoped modeller eklendikçe bu dosyalara kontrol eklenir.

Bu testlerden biri kırmızıya dönerse: **testi gevşetme, kodu düzelt.** Kural gerçekten
değişiyorsa, önce `docs/security-invariants.md` ve `README.md` güncellenir.

### 8. Yazım biçimi

- Dosya adı: `<konu>.spec.ts` (security suite'inde `<konu>-security.spec.ts`).
- `test.describe("updateMemberRole()", ...)` — test edilen birim veya senaryo adıyla.
- Test adları Türkçe ve **davranışı** anlatır: `"başka tenant'ın membership'i güncellenemez"`.
- Bir testin neden var olduğu (hangi saldırı/regresyon) yorumla açıklanır; ilgili issue
  numarası yazılır.

## Doğrulama sırası

Değişiklik tamamlandığını iddia etmeden önce:

```bash
npm run lint
npm run typecheck
npm run test:integration
npm run test:security
npm run test:e2e
npm run build        # şema/route değişikliklerinden sonra
```

CI aynı adımları beş ayrı job'da çalıştırır (`lint`, `typecheck`, `build`, `integration`,
`e2e`, `security`) ve PR'lar için zorunludur. Lokalde bir suite'i çalıştıramadıysan (ör. DB
yoksa) bunu **açıkça söyle**; "geçiyor" deme.

## Flaky test politikası

E2E suite'i CI'da 2 kez retry eder; lokalde etmez. Bir test flaky ise sebebi bulunur — retry
sayısı artırılarak veya `test.skip` ile susturularak geçilmez. Sık sebepler: paylaşılan DB'de
benzersiz olmayan test verisi, ortak rate-limit bucket'ı, sabit `waitForTimeout`.

**Yeşil CI "stabil" demek değildir.** `retries: process.env.CI ? 2 : 0` (bkz.
`playwright.config.ts`) CI'da kararsızlığı ÖRTER: yerelde kırmızı olan bir suite CI'da yeşil
görünebilir. Bu yüzden yerel `retries: 0` bilinçlidir — kararsızlığı görünür tutar. Bir PR'da
e2e'yi değerlendirirken CI'nın yeşilliği tek başına kanıt sayılmamalıdır.

**CI retry'i tam olarak neyi örter (Issue #129):** ilk denemede düşüp ikinci veya üçüncü
denemede geçen bir test, job'ı yeşil bırakır ve özet satırında **"flaky"** olarak görünür —
"passed" ile aynı renkte. Örtülen şey bir testin yanlış olması değil, suite'in
KARARSIZLIĞIDIR: aynı commit yerelde kırmızı, CI'da yeşildir.

`retries: 2` bilerek korunuyor (kaldırmak, kalan her tekil kararsızlıkta CI'ı kırmızıya
çevirip PR akışını durdururdu), ama **flaky sayısı sıfırdan büyükse bu bir hata raporudur,
gürültü değildir.** CI çıktısında `N flaky` gördüğünüzde: hangi test olduğunu bulun, tek
başına ve tam suite içinde tekrar koşun, sebebi aşağıdaki bölümlerden biriyle eşleştirin.
Retry sayısını artırarak veya `test.skip` ile geçmeyin.

### Sunucu round-trip'i bekleyen assertion'lara açık süre verin

Bir formu gönderdikten sonra listede beliren satırı (veya hata kutusunu) bekleyen assertion,
`router.refresh()` kaynaklı bir sunucu round-trip'ine ve RSC yeniden render'ına bağlıdır. Tam
suite paralel koşarken bu adım varsayılan 5 saniyeyi aşabiliyor ve test, uygulama doğru
çalıştığı hâlde kırmızıya düşüyor. Bu tür beklemelerde açık bir süre verin:

```ts
const ROW_TIMEOUT_MS = 15_000;

function expectRow(page: Page, name: string) {
  return expect(page.getByRole("cell", { name })).toBeVisible({ timeout: ROW_TIMEOUT_MS });
}
```

Bu bir **gevşetme değildir** ve "flaky testi susturma" yasağının istisnası da değildir: iddia
aynı kalır, yalnızca bilinen bir yavaş adıma süre tanınır. Kaydın sunucuda gerçekten oluştuğu
zaten bağımsız bir API okumasıyla, bu beklemeden ayrı olarak doğrulanmalıdır (kural #2:
kontrol grubu). Süreyi bir iddiayı kurtarmak için değil, yalnızca round-trip beklemek için
kullanın.

### `ECONNRESET`: keep-alive yarışı (Issue #129)

Tam suite koşusunda rastgele testler şu hatayla düşüyordu:

```
Error: apiRequestContext.get: read ECONNRESET
```

Aynı test tek başına daima geçiyordu. Bu bir uygulama hatası değil, bir **istemci-sunucu
bağlantı yarışıdır**: Playwright'ın `request` context'i (Node tarafı — tarayıcı değil)
soketleri keep-alive ile yeniden kullanır; `next dev`in altındaki Node HTTP sunucusu ise
boşta kalan bağlantıyı `keepAliveTimeout` dolunca kapatır. İstemci tam o anda kapanmakta olan
soketi yeniden kullanırsa istek ECONNRESET ile ölür. Sunucu doğru davranıyor; istemci ölü bir
sokete yazıyor.

Çare, iki Playwright config'inde de `use.extraHTTPHeaders` ile verilen `Connection: close`
başlığıdır: her istek kendi bağlantısını açıp kapatır, yeniden kullanılacak boşta soket kalmaz.
Tarayıcı isteklerini etkilemez (Chromium `Connection`'ı yasaklı başlık sayıp yok sayar) —
hatalar da zaten yalnızca API isteklerindeydi.

**Ölçüm** (yerel, `--retries=0`, tam suite, 127 test):

| Yapılandırma | Koşu başına hata |
| --- | --- |
| Düzeltmesiz (kontrol, 6 koşu) | 0, 1, 6, 18, 19, 27 |
| `--workers=4` (3 koşu) | 0, 1, 0 |
| `Connection: close` (6 koşu) | 0, 0, 0, 0, 0, 0 |

Hata sayısı istek hacmiyle birlikte artıyor: #135'in sayfalama testleri (50+ kayıt seed'i)
eklendikten sonra kötü koşular 27 teste kadar çıktı. Bu yüzden worker sayısını düşürmek
**yeterli değildi** — olasılığı azaltıyor, sebebi ortadan kaldırmıyor.

**Reddedilen alternatif — `webServer`ı `npm run build && npm run start` ile koşturmak.**
Soğuk route derlemesini gerçekten ortadan kaldırırdı, ama uygulama prod modunda farklı
davranıyor (ör. `NODE_ENV=production` ile `secure` cookie'ler) ve suite prod sunucusuna karşı
koşu başına ~30 testle toplu düştü. Bu, kararsızlık düzeltmesinin yanına sığmayacak ayrı bir
araştırma; e2e'yi prod build'e taşımak istenirse önce bu farkların tek tek çözülmesi gerekir.

### Yerelde bozuk bir dev sunucusu tüm suite'i zehirler

`webServer.reuseExistingServer` lokalde açıktır. Önceki bir koşu yarıda kesildiyse (ör. terminal
kapatıldı, süreç SIGTERM aldı) port 3000'de yarım kalmış bir `next dev` süreci kalabilir;
Playwright onu yeniden kullanır ve API route'ları JSON yerine HTML hata sayfası döndürmeye
başlar. Belirti kolay tanınır: `SyntaxError: Unexpected token '<', "<!DOCTYPE "...` ve suite'in
neredeyse tamamının aynı anda düşmesi.

Tek tük değil de **onlarca** test birden düştüyse önce süreci kontrol edin:

```bash
netstat -ano | grep ":3000.*LISTENING"   # PID'i bul
taskkill //PID <pid> //F                 # Windows
```
