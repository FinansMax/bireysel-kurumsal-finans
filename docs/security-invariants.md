# Güvenlik Invariant'ları

Bu dosya, bu repository'de **pazarlığa kapalı** güvenlik kurallarının tek yetkili kaynağıdır.
`CLAUDE.md` ve `AGENTS.md` bu listenin kısa özetini taşır; ayrıntı, gerekçe ve nasıl zorlandığı
burada yazar.

Bir invariant'ı ihlal eden değişiklik, testleri geçse bile merge edilemez. Bir invariant'ı
bilinçli olarak değiştirmek gerekiyorsa: **önce** bu dosyayı ve `README.md`'deki ilgili karar
bölümünü güncelle, gerekçeyi ve kalan riski (residual risk) yaz, sonra kodu değiştir.

Bu kuralların çoğunun arkasında bu repo'da **otomatik bir regresyon testi** vardır. Testi
susturarak/silerek değil, kuralı sağlayarak ilerle.

---

## 1. Tenant izolasyonu sorgu seviyesinde yapılır

**Kural.** Tenant'a ait bir modele (`Membership` ve gelecekteki `Account`, `Transaction`,
`Category`, `Budget`, `Invoice`, ...) yapılan **her** sorgu `tenantId` ile scope'lanır:
`tenantScoped(tenantId, where)` — `src/lib/tenancy/scope.ts`.

**Yasak.** Tenant-scoped bir modelde yalnız-ID sorgusu:

```ts
prisma.membership.findUnique({ where: { id } })   // YASAK
prisma.membership.update({ where: { id }, ... })  // YASAK
prisma.membership.delete({ where: { id } })       // YASAK
```

`id` tek başına unique olduğu için Prisma bunları kabul eder — tehlike tam olarak budur:
Tenant B'ye ait geçerli bir ID, Tenant A context'inde eşleşir.

**Doğrusu.** `id` + `tenantId` birlikte unique bir alan olmadığından, tenant-scoped mutation
`updateMany`/`deleteMany` + `tenantScoped()` + `count === 1` kontrolü ile yapılır:

```ts
const { count } = await tx.membership.updateMany({
  where: tenantScoped(tenantId, { id: membershipId }),
  data: { role: newRole },
});
if (count !== 1) throw new NotFoundError();
```

**Referans implementasyon:** `src/lib/tenants/membership.ts`.
**Zorlayan testler:** `integration/tenant-scope-pattern.spec.ts` (yeni tenant-scoped model
eklendiğinde bu dosyaya benzer bir kontrol eklenir), `security/tenant-isolation-boundaries.spec.ts`.

---

## 2. Trusted `tenantId`'nin tek kaynağı authorization context'idir

`tenantId`, `userId` ve `role` için tek güvenilir kaynak `requirePermission()`'ın döndürdüğü
`context`tir (`context.tenant.id`, `context.user.id`, `context.role`) — bu değerler her istekte
DB'den canlı doğrulanır.

**Asla kaynak değildir:** request body, query string, header, URL path parametresi, JWT içine
gömülmüş rol iddiası, client'ın gönderdiği herhangi bir `tenantId`.

URL'deki `tenantId` yalnızca **beklenen değer** olarak guard'a geçilir; eşleşmezse 403 döner:

```ts
const { context, response } = await requirePermission(PERMISSIONS.UPDATE_MEMBER_ROLE, ids.tenantId);
if (!context) return response;
// Bundan sonrası SADECE context.tenant.id kullanır.
```

**Not.** Authorization ("bu kullanıcı ne yapabilir?") ve tenant isolation ("bu veri kimin?")
**ayrı** kontrollerdir. Birini yapmak diğerini gereksiz kılmaz; ikisi de gerekir.

---

## 3. Yetkilendirme backend'de zorlanır

- Her state değiştiren ve her tenant verisi okuyan route handler'ı, iş mantığına geçmeden önce
  `requireUser()` (yalnız kimlik) veya `requirePermission(PERMISSIONS.X, tenantId)` (kimlik +
  aktif tenant + canlı membership + rol matrisi) ile korunur.
- UI'da butonu gizlemek yetkilendirme **değildir**.
- Rol → izin matrisi tek yerde tanımlıdır: `src/lib/authz/permissions.ts`. Yeni bir izin,
  route'lara serpiştirilmiş `if (role === "OWNER")` ile değil, matrise eklenerek tanımlanır.
- `Record<MembershipRole, ...>` kullanımı, yeni bir rol eklendiğinde matrisin güncellenmesini
  **derleme zamanında** zorunlu kılar — bu tip gevşetilirse güvenlik boşluğu sessizce oluşur.
- **Least privilege / privilege escalation:** ADMIN kimseyi (kendisi dahil) OWNER yapamaz,
  mevcut bir OWNER'ı değiştiremez, OWNER rolüyle davet gönderemez. Yeni bir yönetim işlemi
  eklerken aynı soruyu sor: "bu işlem, çağıranın kendi yetkisini yükseltmesine izin veriyor mu?"

**Zorlayan testler:** `security/tenant-membership-authorization-security.spec.ts`,
`integration/permissions.spec.ts`.

---

## 4. GET/HEAD yan etkisizdir (CSRF invariant'ı)

`GET`/`HEAD` handler'ları veri yazmaz, silmez, token tüketmez, e-posta göndermez, sayaç
artırmaz. State değiştiren her işlem `POST`/`PATCH`/`DELETE`'tir.

Bu bir stil tercihi **değildir**. Projede özel bir CSRF token sistemi yoktur; koruma
`SameSite=Lax` cookie'lere dayanır ve `SameSite=Lax` top-level cross-site **GET** isteklerini
engellemez. State değiştiren tek bir GET endpoint'i, CSRF korumasını o endpoint için tamamen
ortadan kaldırır.

**Zorlayan test:** `integration/get-side-effect-free-pattern.spec.ts` (bir GET handler'ına
`create/update/delete/upsert/executeRaw` çağrısı eklenirse kırmızıya döner).
**Kanıt:** `e2e/csrf-samesite.spec.ts` (gerçek Chromium). **Ayrıntı:** `README.md` → "CSRF Duruşu".

**İlişkili kural.** Uygulamaya permissive CORS (`Access-Control-Allow-Origin`, özellikle
`credentials` ile) eklemeden önce README'deki CSRF bölümü okunmalıdır — bu, JSON/`PATCH`/
`DELETE` isteklerini koruyan ikinci katmanı kaldırır. CORS eklemek ayrı bir issue ve ayrı bir
karar gerektirir.

---

## 5. Secret'lar repository'ye girmez

- `.env` commit edilmez (`.gitignore`'da). Yeni bir değişken eklerken `.env.example`'a
  **placeholder** değeriyle eklenir, gerçek değerle değil.
- Kod içine gömülü API key / şifre / token yazılmaz.
- CI'daki disposable `AUTH_SECRET` (bkz. `.github/workflows/ci.yml`) production secret'ı
  **değildir**; başka bir ortama kopyalanmaz.
- Secret'lar yalnızca sunucu tarafında okunur. `NEXT_PUBLIC_` önekli bir değişkene asla secret
  konmaz — bu önek değeri tarayıcı bundle'ına gömer.

---

## 6. Kimlik doğrulama token'ları hash'lenmiş, süreli ve tek kullanımlıktır

`PasswordResetToken` ve `TenantInvitation` bu deseni izler; yeni bir token türü de izlemelidir:

- **Üretim:** `crypto.randomBytes(32)` (256 bit). `Math.random()` **asla** kullanılmaz.
- **Saklama:** DB'ye **yalnızca** SHA-256 hash'i yazılır (`tokenHash`); raw token saklanmaz ve
  production loglarına yazılmaz.
- **Süre:** açık bir `expiresAt` (reset 30 dk, davet 7 gün).
- **Tüketim:** tek kullanımlık ve **atomik** — "önce oku, sonra yaz" değil, tek bir koşullu
  `updateMany` (`WHERE tokenHash = ? AND usedAt IS NULL AND expiresAt > now()`) ile. Eşzamanlı
  iki istekten yalnızca biri kazanır.
- **Şifreler** `scrypt` ile hash'lenir (`src/lib/auth/password.ts`); doğrulama sabit maliyetlidir.
- Şifre değişimi `updateUserPassword()` (`src/lib/auth/credentials.ts`) üzerinden yapılır —
  `passwordHash` ve `credentialsChangedAt` **aynı** UPDATE'te güncellenir, aksi halde session
  revocation (README → "Session Revocation") sessizce devre dışı kalır.

---

## 7. Hata yanıtları bilgi sızdırmaz

- Geçersiz token'ın **hangi** nedenle geçersiz olduğu (bulunamadı / süresi doldu / kullanıldı /
  iptal edildi) ayrıştırılmaz — hepsi aynı genel `400`.
- Sign-in'de bilinmeyen e-posta ile yanlış şifre aynı hatayı verir **ve aynı hesaplama
  maliyetine sahiptir** (timing side-channel).
- `forgot-password` kayıtlı/kayıtsız e-posta için aynı yanıtı döner.
- `429` yanıtı IP, bucket key, kullanıcı kimliği veya deneme sayısı içermez.
- Stack trace, Prisma hata detayı, SQL veya iç durum client'a dönmez; `console.error` ile
  sunucuda loglanır.
- **Bilinçli istisna:** `POST /api/auth/signup` mevcut hesabı `409` ile bildirir. Bu bir gözden
  kaçma değil, kayda geçmiş bir karardır (Issue #106) — gerekçesi ve kalan riski `README.md`'de
  yazılıdır. Davranış değiştirilecekse önce oradaki karar güncellenir.

---

## 8. Audit log tek kapıdan, commit sonrası, best-effort yazılır

- Doğrudan `prisma.auditLog.create()` **çağrılmaz**; tek giriş noktası `writeAuditLog()`
  (`src/lib/audit/write-audit-log.ts`).
- `action` ve `targetType` serbest metin değil, `src/lib/audit/actions.ts`'teki typed
  sabitlerdir.
- Audit yazımı asıl işlemi **asla** başarısız etmez (fonksiyon throw etmez) ve transaction'ın
  **içinde** değil, commit **sonrasında** yapılır — böylece rollback olan bir işlem loglanmaz.
- `metadata`'ya hassas veri konmaz; `sanitizeMetadata()` yalnızca ikinci savunma katmanıdır,
  birincil sorumluluk çağıran koddadır.

---

## 9. Rate limit iş mantığından önce çalışır

- Kimlik doğrulaması gerektirmeyen veya pahalı olan state değiştiren endpoint'ler
  `checkRateLimit()` ile korunur (`src/lib/rate-limit/guard.ts`).
- Kontrol; body parse, DB erişimi ve `requireUser()` **dahil** her şeyden **önce** yapılır —
  429 durumunda hiçbir yan etki tetiklenmez, pahalı hash doğrulaması hiç çalışmaz.
- Limitler route'a gömülmez; `src/lib/rate-limit/policies.ts`'teki merkezi katalogda tanımlanır
  ve **gerekçesi yazılır**.
- Yeni bir public/state değiştiren endpoint eklerken varsayılan cevap "limit gerekir"dir;
  gerekmediğini düşünüyorsan gerekçesini PR'da yaz.

**Bilinen sınırlar:** limiter process-local'dir (çok instance'lı deployment'ta her instance kendi
sayacını tutar) ve istemci IP'si `x-forwarded-for`'un ilk segmentinden okunur — önünde güvenilir
bir reverse proxy varsayılır (bkz. README → "Rate Limiting").

---

## 10. Finansal tutarlar `Decimal`'dir

Para birimi ve tutarlar için `number`/`Float` **kullanılmaz** — kayan nokta yuvarlama hatası
finansal veride kabul edilemez.

- **Prisma:** `Decimal @db.Decimal(19, 4)`. (Ölçek, ilk finansal model eklenirken kararlaştırılır
  ve tüm modellerde tutarlı kullanılır; kararı README'ye yaz.)
- **Uygulama:** aritmetik `Prisma.Decimal` ile yapılır; ara işlemde `Number(...)`'a düşürülmez.
- **JSON:** tutarlar string olarak serialize edilir (JSON `number`'ı precision kaybettirir).
- **Para birimi kodu** tutardan ayrı, açık bir alanda tutulur; tutar + currency birlikte taşınır.

Bu invariant henüz finansal model olmadığı için ileriye dönüktür — ilk `Account`/`Transaction`
modeli eklendiğinde burası referans alınır.

---

## Yeni endpoint güvenlik kontrol listesi

Yeni bir route handler yazarken sırayla:

1. State değiştiriyorsa metot `POST`/`PATCH`/`DELETE` mi? (GET yan etkisiz — #4)
2. Public veya pahalıysa `checkRateLimit()` en başta mı? (#9)
3. `requireUser()` / `requirePermission()` iş mantığından önce mi? (#3)
4. Tenant verisine dokunuyorsa `tenantScoped()` + `context.tenant.id` mi kullanıyor? (#1, #2)
5. Client'tan gelen her değer `unknown` olarak alınıp doğrulanıyor mu? (Prisma'ya doğrulanmamış
   input geçilmez)
6. Yanıt hassas alan (`passwordHash`, `tokenHash`, başka tenant'ın verisi) içeriyor mu? Prisma
   `select` allowlist'i dar mı?
7. Hata yanıtları genel mi, iç durum sızdırıyor mu? (#7)
8. Güvenlik açısından kritik bir olaysa `writeAuditLog()` çağrılıyor mu? (#8)
9. Bu kontrollerin **her biri** için, ihlali yakalayan bir test yazıldı mı? (`docs/testing.md`)
