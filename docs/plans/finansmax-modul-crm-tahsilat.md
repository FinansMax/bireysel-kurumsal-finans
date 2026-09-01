# FinansMax — Modül Sistemi + CRM/Süreç Takibi + Tahsilat Planı

**Repo:** `FinansMax/bireysel-kurumsal-finans`
**Kapsam:** Ürünü "ham çekirdek + müşteriye göre açılan modüller" hâline getirmek ve ilk müşteri
(dijital eğitim programı satan firma) için CRM/süreç takibi ve tahsilat (çek/kart/nakit/taksit)
modüllerini eklemek.

Bu dosya iki şey içerir:

1. Claude Code'a verilecek **iki master prompt** (issue açma + implementasyon).
2. Açılacak **21 issue'nun tam gövdesi**, repo'daki mevcut issue şablonuyla birebir aynı formatta.

Epic numaraları repo'da 1–12 dolu olduğu için yeni epic'ler **13, 14, 15** olarak numaralandırıldı.

---

## 1. MASTER PROMPT — Issue'ları aç

> VS Code'da Claude Code'a bu dosyayı da vererek aşağıdaki metni yapıştır.

```
Bu repo `FinansMax/bireysel-kurumsal-finans`. Görevin KOD YAZMAK DEĞİL; ekteki
`finansmax-modul-crm-tahsilat.md` dosyasındaki 21 issue'yu GitHub'da açmak.

ÖNCE OKU (sırayla, atlamadan):
- README.md (bu repo'da README bir KARAR KAYDIDIR — mevcut kararların gerekçeleri orada)
- docs/architecture.md, docs/security-invariants.md, docs/conventions.md,
  docs/testing.md, docs/workflow.md
- CLAUDE.md / AGENTS.md
- prisma/schema.prisma
- src/lib/authz/permissions.ts, src/lib/tenancy/scope.ts, src/lib/audit/actions.ts
- Referans issue olarak `gh issue view 70` ve `gh issue view 46` (şablon bunlar gibi olacak)

SONRA YAP:
1. Eksik label'ları oluştur (varsa dokunma):
   gh label create "epic-13" --description "Epic 13: Modül Sistemi"
   gh label create "epic-14" --description "Epic 14: CRM & Süreç Takibi"
   gh label create "epic-15" --description "Epic 15: Tahsilat & Ödeme Planı"
   gh label create "modules" --description "Modül sistemi (tenant bazlı feature modules)"
   gh label create "crm" --description "CRM / süreç takibi modülü"
   gh label create "collections" --description "Tahsilat, çek ve taksit takibi"
2. Issue'ları dosyadaki SIRAYLA aç. Her issue için gövdeyi geçici bir dosyaya yaz ve:
   gh issue create --title "<title>" --body-file <dosya> --label "<labels>"
   Gövdeyi DEĞİŞTİRME, kısaltma, özetleme — olduğu gibi kullan.
3. Issue gövdelerinde `[M1]`, `[C3]`, `[T2]` gibi köşeli parantezli referanslar var. Tüm
   issue'lar açıldıktan SONRA, her gövdedeki bu referansları gerçek issue numaralarıyla
   (`#123` biçiminde) değiştir ve `gh issue edit <no> --body-file <dosya>` ile güncelle.
   Hangi kodun hangi numaraya karşılık geldiğini bir tabloda bana raporla.
4. Her epic issue'sunun (M0, C0, T0) gövdesindeki "Alt Issue'lar" listesini de gerçek
   numaralarla güncelle.
5. Mümkünse issue'ları "FinansMax Development" projesine ekle:
   gh issue edit <no> --add-project "FinansMax Development"
   (Yetki hatası alırsan zorlama, sadece raporla.)

KURALLAR:
- Hiçbir kod dosyasına dokunma, branch açma, commit atma.
- Bir issue'nun içeriğini kendi kafana göre "iyileştirme"; teknik bir hata gördüysen açma,
  bana söyle.
- İşin sonunda: açılan issue numaraları + label'lar + varsa başarısız adımlar tablosu.
```

---

## 2. MASTER PROMPT — Implementasyon (her issue için tekrar kullan)

```
Görev: bu repo'da #<ISSUE_NO> issue'sunu uçtan uca implemente et.

ÖNCE OKU: README.md, docs/architecture.md, docs/security-invariants.md,
docs/conventions.md, docs/testing.md, docs/workflow.md, CLAUDE.md.
Sonra `gh issue view <ISSUE_NO>` ile issue'yu ve bağımlı olduğu issue'ları oku.

PAZARLIĞA KAPALI (docs/security-invariants.md):
1. Tenant-scoped her sorgu `tenantScoped(tenantId, where)` üzerinden geçer; update/delete
   `updateMany`/`deleteMany` + `count === 1` ile yapılır. Yalnız-ID sorgusu YASAK.
2. Trusted `tenantId`/`userId`/`role`'un tek kaynağı `requirePermission()` context'idir.
   Body/query/header/path'ten gelen tenantId sadece BEKLENEN değerdir.
3. Yetki backend'de zorlanır; yeni izinler `src/lib/authz/permissions.ts` matrisine eklenir.
4. GET/HEAD yan etkisizdir (CSRF invariant'ı).
6. Token'lar randomBytes(32) + SHA-256 hash + expiresAt + atomik tek kullanım.
7. Hata yanıtları bilgi sızdırmaz.
8. Audit log yalnızca `writeAuditLog()` ile, commit SONRASI, typed action sabitleriyle.
9. Rate limit iş mantığından önce, `policies.ts`'teki merkezi katalogdan.
10. Parasal alanlar `Decimal @db.Decimal(19, 4)`, currency ayrı alan, JSON'a string olarak.

MİMARİ:
- route.ts İNCE: guard + parse + delegate + response map. İş kuralı/DB sorgusu route'ta olmaz.
- `src/lib/**` içinden `next/server` import edilmez (istisna: guard'lar).
- Servis fonksiyonları throw etmez; discriminated union döner ({ok:true,...} | {ok:false,status,error}).
- "Önce kontrol et sonra yaz" YASAK. Üç desen: unique constraint (P2002→409),
  `runSerializable()` (asla doğrudan prisma.$transaction+Serializable), koşullu atomik updateMany.
- Generic repository/DI/zod YOK — doğrulama elle `src/lib/*/validation.ts` içinde.
- Next.js 16: `params` bir Promise'tir, await edilir.

AKIŞ (docs/workflow.md):
- `main`'de çalışma. Branch: issue'da yazan "Önerilen Branch".
- Conventional Commits; başlık SADECE ASCII, ~72 karakter, emir kipi.
- Commit GÖVDESİ Türkçe ve bir KARAR KAYDIDIR: ne yapıldı, NEDEN böyle yapıldı, hangi
  alternatif neden reddedildi, güvenlik/eşzamanlılık etkisi, bilinen sınır, `(Issue #<no>)`.
- Definition of Done'ın tamamı: lint, typecheck, build, test:integration, test:security,
  test:e2e; migration üretildi ve gözden geçirildi; .env.example güncel; yeni bir
  mimari/güvenlik kararı varsa README.md'ye gerekçesiyle yazıldı.
- Testler: mutlu yol + yetkisiz yol + cross-tenant erişim (security/) + sınır durumları.

DURUP SOR:
- Bir invariant'ı gevşetmen gerektiğini düşünüyorsan.
- Issue'nun kapsamı yetersizse (sessizce genişletme).
- Çalıştıramadığın bir doğrulamayı ASLA "geçti" diye raporlama.

Sonunda: `Closes #<ISSUE_NO>` içeren bir PR aç, açıklamada ne değişti / neden / nasıl test
edildi / kalan risk yaz.
```

---

## 3. Mimari kararlar (issue'ların dayandığı zemin)

Bu kararlar issue gövdelerine gömülü; buradaki özet, bütünü bir bakışta görmen için.

| Karar | Neden |
| --- | --- |
| Modül **katalogu kodda**, **açık/kapalı durumu DB'de** (`TenantModule`) | Katalog tip güvenliği ve derleme zamanı kontrolü sağlar; DB flag'i tenant başına farklılaşmayı sağlar. İkisini de DB'ye koymak, olmayan bir modüle izin verilmesine izin verirdi. |
| Kapalı modül **404** döner (403 değil) | Var olmayan bir yüzey gibi davranır; `docs/architecture.md` status sözlüğünde 404 zaten "yok veya senin değil" anlamındadır. |
| Modül guard'ı **authentication'dan SONRA** çalışır | Aksi hâlde kimliksiz bir istek, bir tenant'ın hangi modülleri açtığını yoklayabilirdi. |
| Modül kapatmak **veri silmez** | Geri açıldığında geçmiş kaybolmaz; silme ayrı ve açık bir işlemdir. |
| Aşamalar (`PipelineStage`) **tenant verisidir**, enum değil | Müşteriye göre değişir; kod değiştirmeden yeni sektöre satılabilir. `AccountType`/`CategoryType` enum'dır çünkü onların kümesi KARARLIDIR — burada değildir. |
| Aşama ilerlemesi **tik listesi** (`DealStageProgress`), tek "current stage" değil | Müşterinin istediği davranış bu: aşamalar sırayla ama bazıları atlanarak da işaretlenebilir; kim ne zaman tikledi bilgisi kalır. |
| `WON` aşaması süreci **bitirmez** | Satıştan sonra eğitici eğitimi/sertifika/ders aşamaları devam eder. `LOST` bitirir. |
| Vadesi geçmişlik (**overdue**) **türetilir**, DB'de status olarak tutulmaz | Aksi hâlde her gece çalışan bir cron'a bağımlı olur ve cron çalışmazsa veri yalan söyler. |
| Tahsilat kaydı, mevcut `Transaction`'ı **aynı DB transaction'ında** üretir | Tahsilat ile hesap bakiyesi arasında tutarsızlık penceresi kalmaz. |
| `collections` modülü `crm` modülüne **bağımlıdır** | Ödeme planı bir `Deal`'a bağlıdır. Bağımsız müşteri kaydı ayrı bir issue konusudur. |

---

## 4. Issue'lar

> Aşağıdaki her blok bir issue'dur. `title`, `labels` ve `body` alanlarını olduğu gibi kullan.
> `[M1]`, `[C3]` gibi referanslar issue'lar açıldıktan sonra gerçek numaralarla değiştirilecek.

---

### M0
**title:** `Epic: Modül Sistemi (Tenant Bazlı Feature Modules)`
**labels:** `epic-13`, `modules`, `enhancement`

**body:**

```markdown
## Amaç

Ürünü "her müşteriye aynı uygulama" olmaktan çıkarıp, **ham bir çekirdek + tenant bazında
açılıp kapanan modüller** hâline getirmek. Çekirdek (auth, tenant, hesap, kategori, işlem,
dashboard) herkeste aynı kalır; müşteriye özel ihtiyaçlar modül olarak eklenir ve yalnızca
o tenant'ta açılır.

Bu epic, ilk gerçek modülleri (CRM — Epic 14, Tahsilat — Epic 15) taşıyacak altyapıyı kurar.

## Kapsam

- Kod tarafında **modül katalogu**: modül anahtarı, adı, açıklaması, bağımlılıkları,
  getirdiği permission'lar ve navigasyon girdileri.
- DB tarafında **`TenantModule`**: hangi tenant'ta hangi modülün açık olduğu + modül ayarları.
- Modül açma/kapama API'si ve OWNER'a özel yönetim ekranı.
- API ve sayfa seviyesinde **modül guard'ı**.
- Modül ilk kez açıldığında varsayılan verisini kuran **idempotent seed** mekanizması.

## Alt Issue'lar

- [M1] Module registry + `TenantModule` modeli + enable/disable API
- [M2] Modül guard'ları (API + sayfa) ve modül-farkında navigasyon
- [M3] Modül yönetim ekranı (`/settings/modules`)
- [M4] Modül seed/şablon mekanizması (idempotent)

## Scope Dışı

- Modül bazlı faturalama/lisanslama (kim hangi modüle para ödüyor) — ayrı epic.
- Runtime'da yüklenen plugin/paket mimarisi. Modüller bu repo'da derlenir; "modül" bir
  dağıtım birimi değil, **açılıp kapanabilen bir yetenek kümesidir**.
- Modül kapatınca veri silme.

## Acceptance Criteria

- Bir tenant'ta modül kapalıyken o modülün tüm API ve sayfaları erişilemez.
- Modül açıp kapatmak mevcut çekirdek davranışın hiçbirini değiştirmez.
- Modül durumu değişiklikleri audit log'a yazılır.
- `npm run lint`, `typecheck`, `build`, `test:integration`, `test:security`, `test:e2e` yeşil.

## Bağımlılıklar

#12, #13 (authorization + tenant izolasyonu).

## Önerilen Branch

Alt issue'lar kendi branch'lerini açar.
```

---

### M1
**title:** `Module registry + TenantModule modeli + enable/disable API`
**labels:** `epic-13`, `modules`, `multi-tenant`

**body:**

```markdown
## Amaç

Modül sisteminin çekirdeği: hangi modüllerin var olduğunu **kod** bilir, hangi tenant'ta
hangisinin açık olduğunu **veritabanı** bilir.

## Kapsam

### 1. Modül katalogu — `src/lib/modules/catalog.ts`

```ts
export const MODULES = {
  CRM: "crm",
  COLLECTIONS: "collections",
} as const;

export type ModuleKey = (typeof MODULES)[keyof typeof MODULES];

type ModuleDefinition = {
  key: ModuleKey;
  label: string;                          // "CRM & Süreç Takibi"
  description: string;
  dependsOn: readonly ModuleKey[];        // collections -> ["crm"]
  permissions: readonly Permission[];     // modülün getirdiği izinler
  nav: readonly { href: string; label: string; permission: Permission }[];
};

export const MODULE_CATALOG: Record<ModuleKey, ModuleDefinition> = { ... };
```

- `Record<ModuleKey, ModuleDefinition>` kullanılır: yeni bir modül anahtarı eklendiğinde
  tanımını yazmayı **derleme zamanında** zorunlu kılar (rol→izin matrisindeki
  `Record<MembershipRole, ...>` ile aynı gerekçe).
- Katalog **saf**tır: DB çağrısı yapmaz, request/session okumaz, side effect içermez
  (`permissions.ts` ile aynı sözleşme).

### 2. Şema — `TenantModule`

```prisma
model TenantModule {
  id        String   @id @default(cuid())
  moduleKey String                       // ModuleKey; Prisma enum DEĞİL (aşağıya bak)
  enabled   Boolean  @default(true)
  settings  Json?                        // modüle özel ayarlar; şeması modül tarafından doğrulanır
  seededAt  DateTime?                    // varsayılan verisi kurulduysa dolu (bkz. [M4])
  enabledAt DateTime?
  disabledAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, moduleKey])
  @@index([tenantId])
}
```

- `moduleKey` **String**, Prisma enum değil: `AuditLog.action`'daki tercihle aynı gerekçe —
  yeni modül eklemek migration gerektirmemeli. Tip güvenliği uygulama katmanındaki
  `ModuleKey` union'ı ile sağlanır; katalogda olmayan bir anahtar servis katmanında 400 ile
  reddedilir ve okuma tarafında YOK SAYILIR (katalogdan silinmiş eski satırlar uygulamayı
  kırmaz).
- Satırın **yokluğu** = modül kapalı. Bu, mevcut tüm tenant'ların migration sonrası
  etkilenmemesini sağlar (`credentialsChangedAt` nullable tercihiyle aynı mantık).

### 3. Servis — `src/lib/modules/tenant-module.ts`

- `listTenantModules(tenantId)` → katalogdaki her modül için `{ key, label, description,
  enabled, dependsOn, settings }`. Katalog + DB birleştirilerek döner; DB'de satırı olmayan
  modül `enabled: false` görünür.
- `setModuleEnabled(tenantId, moduleKey, enabled)`:
  - Katalogda olmayan anahtar → `400`.
  - **Açarken**: `dependsOn` içindeki her modül açık değilse `409` ("Önce bağımlı modülü
    açın"). Bağımlılığı otomatik açmak YASAK — kullanıcı ne açtığını bilmelidir.
  - **Kapatırken**: bu modüle bağımlı açık bir modül varsa `409`.
  - Yazma `upsert` + `@@unique([tenantId, moduleKey])` ile yapılır; eşzamanlı iki isteğin
    ikinci satır yaratmasını DB engeller (P2002 → 409'a değil, upsert'e düşer).
  - Bağımlılık kontrolü okuma sonucuna bağlı bir invariant olduğu için **`runSerializable()`**
    içinde yapılır (`prisma.$transaction` + Serializable'ı DOĞRUDAN çağırma — retry atlanır).
- `isModuleEnabled(tenantId, moduleKey)` → boolean; guard'ların ([M2]) tek okuma noktası.

### 4. İzinler

`src/lib/authz/permissions.ts`'e ekle ve rol matrisini güncelle:

- `VIEW_MODULES: "modules:view"` → OWNER, ADMIN, MEMBER (menüyü kurabilmek için gerekli).
- `MANAGE_MODULES: "modules:manage"` → **yalnız OWNER**. Gerekçe: bir modülü açmak tenant'ın
  ürün yüzeyini değiştirir; bu `UPDATE_TENANT_SETTINGS` ile aynı sınıfta bir karardır ve
  matriste OWNER-only olan tek izin şu an odur.

### 5. Route

- `GET /api/tenants/[tenantId]/modules` → `VIEW_MODULES`
- `PATCH /api/tenants/[tenantId]/modules/[moduleKey]` `{ enabled: boolean }` → `MANAGE_MODULES`

`docs/architecture.md`'deki route anatomisi birebir izlenir.

### 6. Audit

`AUDIT_ACTIONS`'a `MODULE_ENABLED`, `MODULE_DISABLED`; `targetType: "MODULE"`,
`targetId: moduleKey`. `writeAuditLog()` commit SONRASI çağrılır.

## Teknik Gereksinimler

- Invariant #1, #2, #3, #8: tenant izolasyonu `tenantScoped()`, trusted context, backend
  yetkilendirme, tek kapıdan audit.
- Servis katmanı result union döner; throw etmez.

## Scope Dışı

- Guard'lar ve UI ([M2], [M3]).
- Seed ([M4]).
- `settings` içeriğinin modüle özel doğrulanması — şimdilik `settings` yalnızca okunur/yazılır
  bir `Json?`; şema doğrulaması ilgili modülün issue'sunda tanımlanır.

## Acceptance Criteria

- Katalogda olmayan `moduleKey` ile `PATCH` → 400.
- Bağımlı modül kapalıyken `collections` açılamaz → 409; `crm` kapatılamaz (collections
  açıkken) → 409.
- Başka tenant'ın `tenantId`'si ile çağrı → 403 (guard) / veri sızmaz.
- MEMBER ve ADMIN `PATCH` çağrısında 403 alır; OWNER başarılı olur.
- `integration/tenant-module.spec.ts` + `security/tenant-module-security.spec.ts` yazıldı;
  `integration/tenant-scope-pattern.spec.ts`'e yeni model eklendi.
- Migration üretildi ve gözden geçirildi.

## Bağımlılıklar

#12, #13.

## Önerilen Branch

`feature/modules-registry`
```

---

### M2
**title:** `Modül guard'ları (API + sayfa) ve modül-farkında navigasyon`
**labels:** `epic-13`, `modules`, `security`, `frontend`

**body:**

```markdown
## Amaç

Kapalı bir modülün API'sine ve sayfalarına erişimi **backend'de** kesmek; menüyü açık
modüllere göre kurmak.

## Kapsam

### 1. API guard'ı — `src/lib/modules/guard.ts`

```ts
export async function requireModule(
  moduleKey: ModuleKey,
  permission: Permission,
  expectedTenantId: string,
): Promise<{ context: AuthzContext; response: null } | { context: null; response: NextResponse }>;
```

- Mevcut `requirePermission()` ile **aynı deseni** izler: ya hazır bir `NextResponse` ya da
  trusted context döner; route'ta tek satırda kullanılır.
- **Sıra kritiktir:** önce `requirePermission()` (kimlik + aktif tenant + canlı membership +
  rol), SONRA `isModuleEnabled()`. Ters sıra, kimliksiz bir isteğin bir tenant'ın hangi
  modülleri açtığını yoklamasına izin verirdi.
- Kapalı modül → **404** (`{ error: "Not found" }`), 403 değil. Gerekçe: kapalı modül o tenant
  için var olmayan bir yüzeydir ve `docs/architecture.md` status sözlüğünde 404 zaten "yok veya
  senin değil" anlamındadır; 403 "bu var ama sana kapalı" bilgisini sızdırırdı.
- Modül kontrolü **her istekte DB'den** yapılır (aktif tenant cookie'sinin yalnızca bir *ipucu*
  olması ve membership'in her istekte doğrulanmasıyla aynı duruş). Cache eklenecekse ayrı issue.

### 2. Sayfa guard'ı — `requirePageModule()`

`src/lib/auth/page-guard.ts`'teki `requirePageUser()` deseninin karşılığı: kapalı modül →
`/dashboard`'a `redirect()`. Yalnızca sunucu bileşenlerinden çağrılır.

### 3. Navigasyon

- App shell layout'u (`src/app/(app)/layout.tsx`) menüyü `listTenantModules()` + katalogdaki
  `nav` girdilerinden kurar; kapalı modülün linki hiç render edilmez.
- Menü sunucuda hesaplanır (client'a modül listesi göndermeye gerek yok).
- **Uyarı:** UI'da linki gizlemek yetkilendirme DEĞİLDİR (invariant #3). Menü değişikliği,
  API guard'ının yerine geçmez; ikisi de gerekir ve test edilir.

## Teknik Gereksinimler

- Invariant #3, #4, #7.
- Guard `src/lib/**` içinden `NextResponse` döndüren bilinçli istisnalardandır — mevcut
  `authz/authorize.ts` ile aynı konumda.

## Scope Dışı

- Modül yönetim ekranı ([M3]).
- Modül durumunun cache'lenmesi.

## Acceptance Criteria

- Modül kapalıyken korunan endpoint 404 döner ve **hiçbir yan etki** oluşmaz.
- Kimliksiz istek, modül durumundan bağımsız olarak 401 alır (yoklama yapılamaz).
- Menüde kapalı modülün linki yoktur; linki elle yazan kullanıcı `/dashboard`'a yönlenir.
- `security/module-guard-security.spec.ts`: kapalı modül + geçerli permission → 404;
  açık modül + yetersiz rol → 403; başka tenant → 403/404.
- E2E: modül kapatıldıktan sonra menüden kaybolduğu doğrulanır.

## Bağımlılıklar

[M1].

## Önerilen Branch

`feature/modules-guards`
```

---

### M3
**title:** `Modül yönetim ekranı (/settings/modules)`
**labels:** `epic-13`, `modules`, `frontend`

**body:**

```markdown
## Amaç

OWNER'ın, tenant'ında hangi modüllerin açık olduğunu görüp değiştirebileceği ekran.

## Kapsam

- `src/app/(app)/settings/modules/page.tsx` — sunucu bileşeni; `requirePageUser()` +
  `MANAGE_MODULES` izni yoksa `/dashboard`'a redirect.
- Her modül için kart: ad, açıklama, bağımlılıklar, açık/kapalı anahtarı.
- Kapatma işlemi **onay ister** ve şu metni gösterir: "Modül kapatıldığında verileriniz
  silinmez; yalnızca erişim kapanır."
- Bağımlılık hatası (409) kullanıcıya anlaşılır Türkçe mesajla gösterilir
  ("Bu modülü kapatmak için önce X modülünü kapatın").
- Mevcut tasarım sistemi token'ları kullanılır (`bg-surface`, `text-muted`, `rounded-card`...);
  ham renk yazılmaz.
- Hata mesajları Türkçedir; backend'in İngilizce iç metinleri kullanıcıya gösterilmez
  (mevcut auth ekranlarındaki duruş).

## Teknik Gereksinimler

- Form/aksiyonlar **client component**'ten gerçek HTTP isteğiyle yapılır (mevcut auth
  ekranlarındaki gerekçe: Server Action, route seviyesindeki guard/rate limit katmanını
  atlar).
- Sayfada mock veri yok.

## Scope Dışı

- Modül ayarlarının (`settings`) düzenlenmesi — her modül kendi ayar ekranını kendi
  issue'sunda getirir.

## Acceptance Criteria

- OWNER modülü açıp kapatabiliyor; ADMIN/MEMBER sayfaya erişemiyor.
- 409 durumunda anlaşılır mesaj görünüyor, durum değişmiyor.
- E2E: modül aç → menüde görün → kapat → menüden kaybol.

## Bağımlılıklar

[M1], [M2].

## Önerilen Branch

`feature/modules-settings-ui`
```

---

### M4
**title:** `Modül seed/şablon mekanizması (idempotent)`
**labels:** `epic-13`, `modules`, `multi-tenant`

**body:**

```markdown
## Amaç

Bir modül bir tenant'ta **ilk kez** açıldığında, kullanılabilir olması için gereken varsayılan
verinin (ör. CRM'in hazır aşama şablonu) kurulması. Kapatıp tekrar açmak veri KOPYALAMAMALIDIR.

## Kapsam

- `ModuleDefinition`'a opsiyonel `seed?: (tx, tenantId) => Promise<void>` alanı.
- `setModuleEnabled(..., true)` çağrısında: `TenantModule.seededAt` null ise seed çalışır ve
  `seededAt` **aynı transaction içinde** doldurulur.
- Tüm işlem `runSerializable()` içinde: eşzamanlı iki "aç" isteğinden yalnızca biri seed'i
  çalıştırır. `seededAt`'i seed'den ayrı bir yazmada doldurmak, arada düşen bir istekte
  **çift seed** üretirdi.
- Seed fonksiyonları kendi başlarına da idempotent yazılır (savunmanın ikinci katmanı):
  unique constraint'lere dayanır, "önce say sonra ekle" yapmaz.
- Kapatma seed'i geri almaz, veriyi silmez.

## Teknik Gereksinimler

- Invariant: eşzamanlılık deseni #2 (`runSerializable()`), doğrudan
  `prisma.$transaction(..., { isolationLevel: Serializable })` çağrılmaz.
- Seed, modülün kendi `src/lib/<modül>/seed.ts` dosyasında durur; `modules/` katmanı domain
  bilmez, yalnızca çağırır.

## Scope Dışı

- Var olan tenant'lara toplu seed basan CLI/migration script'i.
- Seed'in kullanıcı tarafından "sıfırla" ile yeniden çalıştırılması.

## Acceptance Criteria

- Modül aç → kapat → aç: seed **bir kez** çalışmış olur (kayıt sayısı sabit).
- Eşzamanlı iki "aç" isteği: tek seed, duplicate yok (integration testi ile kanıtlanır).
- Seed başarısız olursa modül açılmaz (transaction rollback) ve kullanıcı 500 değil anlamlı
  bir hata görür.

## Bağımlılıklar

[M1].

## Önerilen Branch

`feature/modules-seed`
```

---

### C0
**title:** `Epic: CRM & Süreç Takibi Modülü`
**labels:** `epic-14`, `crm`, `enhancement`

**body:**

```markdown
## Amaç

Saha satışı yapan bir tenant'ın, görüştüğü **kurumları** (okul, bayi, kurum) ve her kurumla
ilerleyen **süreci** aşama aşama takip edebilmesi.

Somut senaryo (ilk müşteri — dijital eğitim programı satışı): temsilci okullarla, bayilerle ve
kurumlarla görüşmeye gidiyor. Her kurum için süreç şu aşamalardan geçiyor ve yapıldıkça
işaretleniyor:

1. İletişime geçildi
2. Randevu alındı
3. Bilgi verildi
4. Ön görüşme yapıldı
5. Ziyaret gerçekleştirildi
6. Kurum karar aşamasında
7. Satın aldı **(kazanıldı)** / Satın almadı **(kaybedildi)**
8. Eğitici eğitimi için tarih verildi
9. Eğitici eğitimine başlandı
10. Sertifika verildi
11. Derslere başlandı
12. Dersler tamamlandı
13. Sonraki dönem için iletişime geçildi

Aşamalar **kodda sabit değildir**; tenant'a ait veridir ve yönetilebilir. Yukarıdaki liste
modül ilk açıldığında kurulan **varsayılan şablondur**.

## Kapsam

- `Institution` (kurum) ve `Contact` (kurum yetkilisi) kayıtları.
- `Pipeline` + `PipelineStage`: tenant'a özel, sıralanabilir aşama şablonu.
- `Deal`: bir kurumla yürüyen süreç; aşamalar tik listesi olarak işaretlenir.
- `DealActivity`: görüşme/randevu/ziyaret zaman çizelgesi.
- Liste, detay ve pano (board) ekranları.

## Alt Issue'lar

- [C1] `Institution` + `Contact` modelleri, API ve izinler
- [C2] `Pipeline` + `PipelineStage` modeli, yönetim API'si ve varsayılan şablon seed'i
- [C3] `Deal` modeli + aşama tikleme (`DealStageProgress`) API'si
- [C4] `DealActivity` — görüşme/randevu/ziyaret zaman çizelgesi
- [C5] Kurum listesi ve kurum detay ekranı (UI)
- [C6] Süreç panosu ve süreç detayı: aşama checklist'i (UI)
- [C7] Aşama şablonu yönetim ekranı (UI)
- [C8] CRM özeti: dashboard kartları ve huni (funnel)

## Scope Dışı

- Otomatik hatırlatma/bildirim (Epic 9).
- E-posta/telefon entegrasyonu, otomatik aktivite yakalama.
- Teklif/sözleşme dokümanı üretimi.
- Tahsilat ve çek takibi — **Epic 15**.

## Acceptance Criteria

- Tüm CRM API'leri `crm` modülü kapalıyken 404 döner.
- Tenant izolasyonu her model için `security/` testleriyle kanıtlanmıştır.
- Varsayılan aşama şablonu modül açılınca kuruluyor ve düzenlenebiliyor.
- E2E: kurum oluştur → süreç aç → birkaç aşamayı tikle → kazanıldı olarak işaretle.

## Bağımlılıklar

[M1], [M2], [M4].

## Önerilen Branch

Alt issue'lar kendi branch'lerini açar.
```

---

### C1
**title:** `CRM: Institution + Contact modelleri, API ve izinler`
**labels:** `epic-14`, `crm`, `multi-tenant`

**body:**

```markdown
## Amaç

Tenant'ın görüştüğü kurumları ve o kurumlardaki yetkilileri kaydedebilmesi.

## Kapsam

### Şema

```prisma
enum InstitutionType {
  SCHOOL      // okul
  DEALER      // bayi
  CORPORATE   // kurum/şirket
  OTHER
}

model Institution {
  id        String          @id @default(cuid())
  name      String
  type      InstitutionType
  city      String?
  district  String?
  address   String?
  phone     String?
  email     String?
  website   String?
  taxNumber String?         // faturalama için; doğrulama biçimsel
  notes     String?
  archivedAt DateTime?      // null = aktif. Silme yerine arşivleme (aşağıya bak)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  contacts Contact[]
  deals    Deal[]

  @@unique([tenantId, name])
  @@index([tenantId])
  @@index([tenantId, archivedAt])
}

model Contact {
  id        String   @id @default(cuid())
  name      String
  title     String?  // "Müdür", "Satın Alma Sorumlusu"
  phone     String?
  email     String?
  isPrimary Boolean  @default(false)
  notes     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  institutionId String
  institution   Institution @relation(fields: [institutionId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@index([institutionId])
}
```

**Kararlar ve gerekçeleri (commit gövdesine ve gerekiyorsa README'ye yazılacak):**

- `InstitutionType` **Prisma enum'dır**: küme küçük ve kararlıdır (`AccountType` ile aynı
  gerekçe). Aşamalar ise enum DEĞİLDİR ([C2]) çünkü orada küme müşteriye göre değişir.
- `@@unique([tenantId, name])`: aynı kurumun iki kez girilmesini DB seviyesinde engeller;
  servis `P2002`'yi 409'a çevirir ("önce ara, yoksa ekle" yarışı kapatılır). Kıyas
  büyük/küçük harfe duyarlıdır (mevcut `Account`/`Category` ile aynı sınır).
- **Arşivlenmiş kayıt da ismi İŞGAL EDER** — `@@unique([tenantId, name])` arşiv durumuna
  bakmaz ve bu bilinçlidir. Kısıtı kaldırmak (ya da `archivedAt`'i unique anahtara katmak)
  aynı kurumun iki kaydını yaratırdı ve geçmişin/tahsilatın hangisine bağlı olduğu
  belirsizleşirdi — bu modelde kurum, süreç ve tahsilat geçmişinin taşıyıcısıdır.
- Servis `P2002`'yi `409`'a çevirirken, çakışan kaydın **arşivlenmiş olup olmadığını aynı
  transaction içinde** tespit eder ve yanıtta ayırt edilebilir bir kod döner:
  `{ error, code: "ARCHIVED_NAME_CONFLICT", archivedId }`. Kullanıcı böylece "bu isim
  kullanımda" duvarına toslamak yerine kaydı arşivden çıkarabilir ([C5]). Bu, invariant #7'nin
  (hata yanıtları bilgi sızdırmaz) **istisnası DEĞİLDİR**: kayıt zaten aynı tenant'a aittir ve
  çağıranın onu görmeye yetkisi vardır (`VIEW_CRM`); dışarıya sızan bir bilgi yoktur. Aktif bir
  kayıtla çakışmada kod dönmez, yalın `409` döner.
- **Silme yerine arşivleme**: `archivedAt`. Bir kurumun süreç ve tahsilat geçmişi vardır;
  silmek bu geçmişi anlamsızlaştırır. Gerçek silme yalnızca hiç `Deal`'ı olmayan kurum için
  mümkündür (`onDelete: NoAction` ile korunur, servis `P2003`'ü 409'a çevirir) — `Transaction`
  ile `Account` arasındaki kararla aynı.
- `Contact.isPrimary`: birden fazla birincil yetkiliyi DB engellemez; servis, bir kontağı
  primary yaparken aynı kurumun diğerlerini **aynı transaction içinde** false'a çeker
  (koşullu `updateMany`).

### İzinler

- `VIEW_CRM: "crm:view"` → OWNER, ADMIN, MEMBER
- `MANAGE_CRM: "crm:manage"` → OWNER, ADMIN, **MEMBER dahil**

> MEMBER'a yazma izni verilmesi, finansal modellerdeki duruştan (MEMBER yalnız okur)
> bilinçli olarak **ayrılır**: CRM kayıtlarını üreten kişi sahadaki temsilcidir, para
> hareketi yaratmaz. Bu karar ve gevşetme/sıkılaştırma yolu README'ye yazılır.

### Route

- `GET/POST /api/tenants/[tenantId]/crm/institutions`
- `GET/PATCH/DELETE /api/tenants/[tenantId]/crm/institutions/[institutionId]`
- `POST /api/tenants/[tenantId]/crm/institutions/[institutionId]/archive` (ve `/unarchive`)
- `GET/POST .../institutions/[institutionId]/contacts`, `PATCH/DELETE .../contacts/[contactId]`

Liste: `?q=` (isim araması), `?type=`, `?city=`, `?archived=true|false`, keyset cursor ile
sayfalama (mevcut `transactions` listesindeki desenle aynı).

### Audit

`CRM_INSTITUTION_CREATED/UPDATED/ARCHIVED/DELETED`, `CRM_CONTACT_CREATED/UPDATED/DELETED`.

## Teknik Gereksinimler

- Tüm route'lar `requireModule(MODULES.CRM, PERMISSIONS.X, tenantId)` ile korunur ([M2]).
- Invariant #1 (tenantScoped + updateMany/count===1), #2, #3, #7, #8.
- Doğrulama `src/lib/crm/validation.ts` içinde elle: `name` trim sonrası 2–200 karakter,
  `email` biçimsel kontrol, `phone` serbest (uluslararası biçimleri regex'le daraltmak meşru
  kullanıcıyı dışlar — `name` karakter kümesindeki kararla aynı).

## Scope Dışı

- Kurum bazlı dosya/ek yükleme (Epic 6 attachment altyapısı bekleniyor).
- Toplu içe aktarma (Epic 10).

## Acceptance Criteria

- CRUD + arşivle/arşivden çıkar çalışıyor.
- Aynı isimde ikinci kurum → 409.
- `Deal`'ı olan kurum silinemiyor → 409; arşivlenebiliyor.
- Bir kurumda ikinci kontak primary yapılınca öncekinin primary'si düşüyor (tek transaction).
- Arşivdeki bir isimle kurum oluşturma denemesi `409` + `code: "ARCHIVED_NAME_CONFLICT"` ve
  `archivedId` döner; aktif bir isimle çakışmada yalın `409` döner.
- Arşivden çıkarma sonrası kayıt normal çalışıyor (listede görünüyor, düzenlenebiliyor, yeni
  süreç açılabiliyor).
- Cross-tenant erişim testleri (`security/crm-institution-security.spec.ts`) yeşil.
- `integration/tenant-scope-pattern.spec.ts`'e yeni modeller eklendi.

## Bağımlılıklar

[M1], [M2].

## Önerilen Branch

`feature/crm-institutions`
```

---

### C2
**title:** `CRM: Pipeline + PipelineStage modeli, yönetim API'si ve varsayılan şablon seed'i`
**labels:** `epic-14`, `crm`, `multi-tenant`

**body:**

```markdown
## Amaç

Süreç aşamalarının **tenant'a ait, yönetilebilir veri** olması. Böylece ürün, kod değiştirmeden
başka bir sektöre/müşteriye satılabilir.

## Kapsam

### Şema

```prisma
enum StageKind {
  NORMAL
  WON     // satış kazanıldı — süreci BİTİRMEZ
  LOST    // kaybedildi — süreci bitirir
}

model Pipeline {
  id        String   @id @default(cuid())
  name      String                       // "Okul Satış ve Eğitim Süreci"
  isDefault Boolean  @default(false)
  archivedAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  stages PipelineStage[]
  deals  Deal[]

  @@unique([tenantId, name])
  @@index([tenantId])
}

model PipelineStage {
  id       String    @id @default(cuid())
  name     String
  position Int                            // 0'dan artan; unique DEĞİL (aşağıya bak)
  kind     StageKind @default(NORMAL)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  pipelineId String
  pipeline   Pipeline @relation(fields: [pipelineId], references: [id], onDelete: Cascade)

  progress DealStageProgress[]

  @@unique([pipelineId, name])
  @@index([tenantId])
  @@index([pipelineId, position])
}
```

**Kararlar:**

- **Aşamalar enum değil, veridir.** `AccountType`/`CategoryType` enum'dır çünkü kümeleri
  kararlıdır; süreç aşamaları müşteriye göre değişir ve her müşteri için migration üretmek
  ürünü satılamaz kılar. Bu farkın gerekçesi README'ye yazılır.
- `position` üzerinde **unique constraint YOKTUR**. Unique olsaydı sıralama değiştirirken
  ara adımlarda çakışma olur, geçici negatif/offset numaralar yazmak gerekirdi. Sıralama
  `ORDER BY position, id` ile deterministiktir; yeniden sıralama tek bir transaction'da
  toplu update ile yapılır.
- `kind = WON` süreci **bitirmez**: satıştan sonraki eğitici eğitimi / sertifika / ders
  aşamaları işaretlenmeye devam eder. `kind = LOST` süreci kapatır. Bu, müşterinin gerçek
  akışının doğrudan sonucudur ve README'ye yazılır.
- Bir pipeline'da en fazla **bir** `WON` ve **bir** `LOST` aşama olabilir; servis bunu
  `runSerializable()` içinde doğrular (okuma sonucuna bağlı invariant).
- Kullanılan (`DealStageProgress` kaydı olan) bir aşama **silinemez** → 409; yeniden
  adlandırılabilir. Geçmişteki tik "hangi aşama" bilgisini kaybetmemelidir.
- **Arşivlenmiş pipeline da ismi İŞGAL EDER** — `@@unique([tenantId, name])` arşiv durumuna
  bakmaz ve bu bilinçlidir. Kısıtı kaldırmak aynı şablonun iki kaydını yaratırdı ve geçmiş
  süreçlerin hangi şablona dayandığı belirsizleşirdi ([C1]'deki kurum kararıyla aynı).
- Servis `P2002`'yi `409`'a çevirirken çakışan kaydın **arşivlenmiş olup olmadığını aynı
  transaction içinde** tespit eder ve ayırt edilebilir bir kod döner:
  `{ error, code: "ARCHIVED_NAME_CONFLICT", archivedId }` — kullanıcı şablonu arşivden
  çıkarabilsin diye ([C7]). Invariant #7'nin **istisnası DEĞİLDİR**: kayıt aynı tenant'a
  aittir ve çağıranın görme yetkisi vardır (`VIEW_CRM`). Aktif kayıtla çakışmada yalın `409`
  döner. (`PipelineStage`'in `@@unique([pipelineId, name])`'i aynı deseni izler; aşamada arşiv
  kavramı olmadığı için orada yalnızca yalın `409` vardır.)

### Servis + Route

- `GET/POST /api/tenants/[tenantId]/crm/pipelines`
- `GET/PATCH/DELETE .../pipelines/[pipelineId]`
- `GET/POST .../pipelines/[pipelineId]/stages`
- `PATCH/DELETE .../stages/[stageId]`
- `PATCH .../pipelines/[pipelineId]/stages/reorder` `{ stageIds: string[] }` — tam liste
  gönderilir; eksik/fazla/yabancı id → 400; sıralama tek transaction'da yazılır.

İzin: okuma `VIEW_CRM`, yönetim **`MANAGE_CRM_PIPELINE: "crm:manage-pipeline"`** → yalnız
OWNER + ADMIN. Gerekçe: aşama şablonunu değiştirmek tüm ekibin raporlarını etkiler; tekil
kayıt girmekle aynı sınıfta bir iş değildir.

### Seed ([M4] mekanizmasıyla)

`crm` modülü ilk açıldığında `isDefault: true` bir pipeline ve şu aşamalar `position` sırasıyla
kurulur:

| # | Aşama | kind |
| --- | --- | --- |
| 0 | İletişime geçildi | NORMAL |
| 1 | Randevu alındı | NORMAL |
| 2 | Bilgi verildi | NORMAL |
| 3 | Ön görüşme yapıldı | NORMAL |
| 4 | Ziyaret gerçekleştirildi | NORMAL |
| 5 | Kurum karar aşamasında | NORMAL |
| 6 | Satın aldı | WON |
| 7 | Satın almadı | LOST |
| 8 | Eğitici eğitimi için tarih verildi | NORMAL |
| 9 | Eğitici eğitimine başlandı | NORMAL |
| 10 | Sertifika verildi | NORMAL |
| 11 | Derslere başlandı | NORMAL |
| 12 | Dersler tamamlandı | NORMAL |
| 13 | Sonraki dönem için iletişime geçildi | NORMAL |

Seed idempotenttir; `@@unique([pipelineId, name])` ve `@@unique([tenantId, name])`'e dayanır.

## Teknik Gereksinimler

- Invariant #1, #2, #3, #8; eşzamanlılık deseni #2 (`runSerializable()`).

## Scope Dışı

- Aşamaya bağlı otomasyon (aşama tiklenince e-posta/görev üretme) — Epic 9.
- Aşama bazlı zorunlu alanlar.

## Acceptance Criteria

- Varsayılan şablon modül açılınca kuruluyor; tekrar aç/kapa çift kayıt üretmiyor.
- İkinci bir WON aşaması eklenemiyor → 409.
- Kullanılan aşama silinemiyor → 409; adı değiştirilebiliyor.
- `reorder` eksik id ile 400 döner; başarılı çağrıda sıra beklenen hâle geliyor.
- MEMBER aşama şablonunu değiştiremiyor → 403.
- Arşivdeki bir isimle pipeline oluşturma denemesi `409` + `code: "ARCHIVED_NAME_CONFLICT"`
  döner; arşivden çıkarma sonrası şablon normal çalışıyor.
- Cross-tenant testleri yeşil.

## Bağımlılıklar

[M1], [M2], [M4], [C1].

## Önerilen Branch

`feature/crm-pipeline`
```

---

### C3
**title:** `CRM: Deal modeli + aşama tikleme (DealStageProgress) API'si`
**labels:** `epic-14`, `crm`, `multi-tenant`

**body:**

```markdown
## Amaç

Bir kurumla yürüyen sürecin kaydı ve **aşamaların yapıldıkça işaretlenmesi** — müşterinin
asıl istediği davranış.

## Kapsam

### Şema

```prisma
enum DealStatus {
  OPEN
  WON
  LOST
}

model Deal {
  id     String     @id @default(cuid())
  title  String                          // "2026 Bahar Dönemi - Atatürk İlkokulu"
  status DealStatus @default(OPEN)

  expectedAmount Decimal? @db.Decimal(19, 4)   // tahmini sözleşme tutarı
  currency       String                         // ISO 4217; tutar varsa zorunlu

  ownerUserId String?                     // sorumlu temsilci
  closedAt    DateTime?
  lostReason  String?
  notes       String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  institutionId String
  institution   Institution @relation(fields: [institutionId], references: [id], onDelete: NoAction)

  pipelineId String
  pipeline   Pipeline @relation(fields: [pipelineId], references: [id], onDelete: NoAction)

  progress   DealStageProgress[]
  activities DealActivity[]

  @@index([tenantId, status])
  @@index([tenantId, institutionId])
  @@index([institutionId])
  @@index([pipelineId])
}

model DealStageProgress {
  id          String   @id @default(cuid())
  completedAt DateTime @default(now())    // "ne zaman tiklendi"
  note        String?
  completedByUserId String?

  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  dealId String
  deal   Deal @relation(fields: [dealId], references: [id], onDelete: Cascade)

  stageId String
  stage   PipelineStage @relation(fields: [stageId], references: [id], onDelete: NoAction)

  @@unique([dealId, stageId])
  @@index([tenantId])
  @@index([stageId])
}
```

**Kararlar:**

- **Satırın varlığı = aşama tamamlandı.** Ayrı bir `completed: Boolean` alanı yoktur; tik
  kaldırıldığında satır silinir. `@@unique([dealId, stageId])` iki eşzamanlı tikin çift kayıt
  üretmesini DB'de kapatır — servis `P2002`'yi **200/idempotent başarı** olarak yorumlar
  (aynı tiki iki kez atmak hata değildir).
- **Tek bir "current stage" alanı YOKTUR.** Müşterinin ihtiyacı bir kanban sütunu değil,
  bir kontrol listesidir; aşamalar sırayla ilerlese de bazıları atlanabilir ve kimin ne zaman
  işaretlediği kalmalıdır. "Şu an neredeyiz" bilgisi, tamamlanmış aşamaların en büyük
  `position`'ından **türetilir**.
- `status` alanı türetilmez, **yazılır**: WON aşaması tiklendiğinde `status = WON` ve
  `closedAt` aynı transaction'da set edilir; LOST tiklendiğinde `status = LOST`. Tik
  kaldırılırsa geri alınır. Türetmek her listede ekstra join gerektirirdi ve `status` en çok
  filtrelenen alandır.
- **WON süreci kapatmaz**: `status = WON` olduktan sonra sonraki aşamalar (eğitici eğitimi,
  sertifika, dersler) tiklenmeye devam eder. **LOST kapatır**: LOST iken NORMAL aşama tiklemek
  409 döner; önce LOST tiki kaldırılmalıdır.
- Aynı anda hem WON hem LOST tiklenemez → 409.
- `Deal` ve `PipelineStage` farklı pipeline'lara aitse tik → 400 (stage, deal'ın pipeline'ına
  ait olmalı).
- `institution`/`pipeline` için `onDelete: NoAction`: süreç geçmişi sessizce yok edilemez
  (`Transaction` → `Account` kararıyla aynı).

### Route

- `GET/POST /api/tenants/[tenantId]/crm/deals` — liste filtreleri: `?status=`, `?institutionId=`,
  `?pipelineId=`, `?ownerUserId=`, `?stageId=` (o aşamayı tamamlamış olanlar), keyset cursor.
- `GET/PATCH/DELETE .../deals/[dealId]` — detay, aşamalar ve tamamlanma durumlarıyla birlikte.
- `POST .../deals/[dealId]/stages/[stageId]/complete` `{ note?: string }` → tikle
- `DELETE .../deals/[dealId]/stages/[stageId]/complete` → tiki kaldır

> Tikleme **POST/DELETE**'tir, GET değil (invariant #4).

Yazma işlemleri (`status` güncellemesiyle birlikte) `runSerializable()` içinde yapılır.

### Audit

`CRM_DEAL_CREATED/UPDATED/DELETED`, `CRM_DEAL_STAGE_COMPLETED`, `CRM_DEAL_STAGE_UNCOMPLETED`,
`CRM_DEAL_WON`, `CRM_DEAL_LOST`. `metadata`'ya aşama adı ve deal başlığı yazılır (hassas veri yok).

## Teknik Gereksinimler

- Invariant #1, #2, #3, #4, #7, #8, #10 (`expectedAmount` Decimal, JSON'a string).
- İzinler: okuma `VIEW_CRM`, yazma `MANAGE_CRM`.
- Modül guard'ı: `MODULES.CRM`.

## Scope Dışı

- Ödeme planı ve tahsilat (Epic 15) — `Deal` bunlara referans verilecek taraftır.
- Aşama tamamlanınca otomatik görev/bildirim (Epic 9).

## Acceptance Criteria

- Aynı aşama iki kez tiklenince tek kayıt oluşur, hata dönmez (idempotent).
- WON tiklenince `status=WON`, `closedAt` dolar; tik kaldırılınca geri alınır.
- LOST iken NORMAL aşama tiklenemez → 409.
- Başka pipeline'ın aşaması tiklenemez → 400.
- Başka tenant'ın deal/stage id'siyle yapılan tüm çağrılar 404 döner.
- Eşzamanlı iki tik isteği tek kayıt üretir (integration testi).
- `integration/crm-deal.spec.ts`, `security/crm-deal-security.spec.ts` yazıldı.

## Bağımlılıklar

[C1], [C2].

## Önerilen Branch

`feature/crm-deals`
```

---

### C4
**title:** `CRM: DealActivity — görüşme/randevu/ziyaret zaman çizelgesi`
**labels:** `epic-14`, `crm`

**body:**

```markdown
## Amaç

"Ne zaman aradık, kiminle görüştük, randevu ne zaman, ziyarete gidildi mi" sorularının
cevabının kayda geçmesi. Aşama tikleri süreci **özetler**; aktiviteler **anlatır**.

## Kapsam

```prisma
enum ActivityType {
  CALL      // telefon görüşmesi
  MEETING   // toplantı / ön görüşme
  VISIT     // yerinde ziyaret
  EMAIL
  NOTE
}

model DealActivity {
  id      String       @id @default(cuid())
  type    ActivityType
  subject String
  note    String?

  scheduledAt DateTime?   // planlanan (randevu) — gelecekte olabilir
  occurredAt  DateTime?   // gerçekleşen. null + scheduledAt dolu = bekleyen randevu
  createdByUserId String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  dealId String
  deal   Deal @relation(fields: [dealId], references: [id], onDelete: Cascade)

  contactId String?
  contact   Contact? @relation(fields: [contactId], references: [id], onDelete: SetNull)

  @@index([tenantId, scheduledAt])
  @@index([dealId, occurredAt])
}
```

**Kararlar:**

- `scheduledAt` ve `occurredAt` **ayrı alanlardır**: randevu almak ile randevuya gitmek farklı
  olaylardır ve arada iptal/erteleme olur. Tek alan tutmak "gitti mi gitmedi mi" sorusunu
  cevapsız bırakırdı (`Transaction.occurredAt` ile `createdAt` ayrımıyla aynı mantık).
- Bekleyen randevu = `occurredAt IS NULL AND scheduledAt IS NOT NULL`. Ayrı bir `status`
  alanı **yoktur** — türetilebilen bir durumu ayrıca yazmak, ikisinin ayrışmasına davetiyedir.
- "Gecikmiş randevu" da türetilir (`scheduledAt < now()` ve `occurredAt IS NULL`); DB'de
  tutulmaz, çünkü tutmak bir cron'a bağımlılık yaratır.
- `contact` silinirse aktivite **kalır** (`SetNull`) — geçmiş bir görüşmenin kaydı, kişi
  kayıttan çıktı diye silinmemelidir.

### Route

- `GET/POST /api/tenants/[tenantId]/crm/deals/[dealId]/activities`
- `PATCH/DELETE .../activities/[activityId]`
- `POST .../activities/[activityId]/complete` `{ occurredAt?: string }` — randevuyu
  gerçekleşti olarak işaretler (POST; GET değil).
- `GET /api/tenants/[tenantId]/crm/activities?upcoming=true` — bekleyen randevular, tarihe
  göre artan.

İzin: okuma `VIEW_CRM`, yazma `MANAGE_CRM`.

## Teknik Gereksinimler

- Invariant #1, #2, #3, #4, #8.
- Tarih doğrulama: `scheduledAt`/`occurredAt` geçerli ISO 8601; ikisi de null olamaz.

## Scope Dışı

- Hatırlatma bildirimi / e-posta (Epic 9).
- Takvim (ICS) senkronizasyonu.

## Acceptance Criteria

- Randevu oluştur → bekleyenlerde görünür → tamamla → bekleyenlerden çıkar.
- `upcoming` listesi yalnızca aktif tenant'ın kayıtlarını döner.
- Kontak silinince aktivite kalır, `contactId` null olur.
- Integration + security testleri yeşil.

## Bağımlılıklar

[C3].

## Önerilen Branch

`feature/crm-activities`
```

---

### C5
**title:** `CRM UI: Kurum listesi ve kurum detay ekranı`
**labels:** `epic-14`, `crm`, `frontend`

**body:**

```markdown
## Amaç

Kurumların görüntülenip yönetilebildiği ekranlar.

## Kapsam

- `/crm/institutions` — liste: arama (isim), tür/şehir filtresi, arşivlenmişleri göster/gizle,
  keyset sayfalama. Sütunlar: kurum, tür, şehir, birincil yetkili, açık süreç sayısı,
  son aktivite tarihi.
- `/crm/institutions/[id]` — detay: künye, yetkililer (ekle/düzenle/sil, birincil işaretle),
  o kuruma ait süreçler listesi, son aktiviteler.
- Kurum ekleme/düzenleme formu.
- `ARCHIVED_NAME_CONFLICT` kodlu `409`'da kullanıcıya "Bu isimde arşivlenmiş bir kayıt var"
  mesajı ve tek tıkla **"Arşivden çıkar"** aksiyonu gösterilir (`POST .../unarchive`); başarıda
  kullanıcı o kurumun detayına götürülür. Diğer `409`'larda yalın çakışma mesajı gösterilir.
- `requirePageModule(MODULES.CRM)` ile korunur; modül kapalıysa `/dashboard`'a redirect.
- Boş durum (empty state): "Henüz kurum eklenmedi" + ekleme çağrısı.

## Teknik Gereksinimler

- Mevcut tasarım sistemi token'ları; ham renk yazılmaz, `dark:` sınıfı yalnız marka
  rampasında kullanılır.
- Veri okuma sunucu bileşeninde; formlar client component'ten gerçek HTTP isteğiyle.
- Hata mesajları Türkçe ve status koduna göre eşlenir; backend'in İngilizce iç metni
  kullanıcıya gösterilmez.
- Mock veri yok.

## Scope Dışı

- Toplu içe aktarma (Epic 10), dosya ekleri (Epic 6).

## Acceptance Criteria

- Kurum oluştur/düzenle/arşivle akışları çalışıyor; 409 anlaşılır mesaj veriyor.
- Modül kapalıyken sayfaya erişilemiyor.
- E2E: kurum oluştur → yetkili ekle → listede gör.
- Mobil genişlikte tablo yatay kayabiliyor, sayfa gövdesi yatay kaymıyor.

## Bağımlılıklar

[C1], [M2].

## Önerilen Branch

`feature/crm-institutions-ui`
```

---

### C6
**title:** `CRM UI: Süreç panosu ve süreç detayı (aşama checklist'i)`
**labels:** `epic-14`, `crm`, `frontend`

**body:**

```markdown
## Amaç

Müşterinin günlük olarak kullanacağı ana ekran: her kurumun süreci ve **yapıldıkça tiklenen
aşamalar**.

## Kapsam

### `/crm/deals` — süreç listesi/panosu

- Varsayılan görünüm: liste. Sütunlar: kurum, süreç adı, durum (Açık/Kazanıldı/Kaybedildi),
  ilerleme (tamamlanan aşama / toplam aşama + ince bir çubuk), son aktivite, sorumlu.
- Filtreler: durum, kurum, sorumlu, aşama.
- İkinci görünüm: aşamaya göre gruplanmış pano (her aşamada kaç süreç var).

### `/crm/deals/[id]` — süreç detayı

- **Aşama checklist'i**: pipeline'ın aşamaları sırayla; her biri tiklenebilir bir satır.
  Tiklendiğinde: kim, ne zaman ve varsa not gösterilir.
- WON aşaması tiklendiğinde süreç "Kazanıldı" rozetine geçer ama **sonraki aşamalar
  tiklenmeye devam edebilir** (eğitici eğitimi, sertifika, dersler).
- LOST tiklendiğinde süreç kapanır; diğer aşamalar disabled olur ve neden alanı istenir.
- Tik atma **iyimser (optimistic) güncellenir**, hata dönerse geri alınır ve mesaj gösterilir.
- Zaman çizelgesi: aktiviteler ([C4]) + aşama tikleri tek bir kronolojik akışta.
- Yaklaşan randevu varsa üstte vurgulanır.
- `collections` modülü açıksa ve süreç kazanıldıysa "Ödeme planı" bölümü görünür ([T5]).

## Teknik Gereksinimler

- Aşama sırası backend'den geldiği gibi kullanılır (client'ta yeniden sıralanmaz).
- Tik işlemleri `POST`/`DELETE` (invariant #4).
- Butonu gizlemek yetkilendirme değildir: MEMBER'ın göremeyeceği aksiyonlar backend'de de
  reddedilir ve bu test edilir.
- Tasarım sistemi token'ları; erişilebilirlik: checklist gerçek `<button>`/`<input>` ile,
  klavyeyle kullanılabilir, durum yalnızca renkle anlatılmaz.

## Scope Dışı

- Sürükle-bırak ile aşama değiştirme.
- Aşama bazlı otomasyon.

## Acceptance Criteria

- E2E: süreç aç → 3 aşama tikle → ilerleme çubuğu güncellenir → WON tikle → rozet değişir →
  satış sonrası aşamalar hâlâ tiklenebilir.
- LOST tiklenince diğer aşamalar disabled olur.
- Ağ hatası durumunda iyimser güncelleme geri alınır.
- Boş pipeline durumunda anlamlı boş durum gösterilir.

## Bağımlılıklar

[C3], [C4], [C5].

## Önerilen Branch

`feature/crm-deal-board-ui`
```

---

### C7
**title:** `CRM UI: Aşama şablonu yönetim ekranı`
**labels:** `epic-14`, `crm`, `frontend`

**body:**

```markdown
## Amaç

Tenant'ın kendi süreç aşamalarını kod değişikliği olmadan yönetebilmesi — ürünün başka
müşterilere satılabilir olmasının UI tarafındaki karşılığı.

## Kapsam

- `/crm/settings/pipelines` — pipeline listesi, yeni pipeline, varsayılan yapma, arşivleme.
- Pipeline detayında aşama listesi: ekle, yeniden adlandır, sil, **sırala** (yukarı/aşağı
  butonları + sürükle-bırak opsiyonel), `kind` seçimi (Normal / Kazanıldı / Kaybedildi).
- Sıralama değişikliği tek bir `reorder` isteğiyle gönderilir (kısmi güncelleme yapılmaz).
- Kullanılan aşama silinmeye çalışılınca 409 → "Bu aşama X süreçte işaretlenmiş, silinemez.
  Adını değiştirebilirsiniz." mesajı.
- `ARCHIVED_NAME_CONFLICT` kodlu `409`'da "Bu isimde arşivlenmiş bir süreç şablonu var" mesajı
  ve tek tıkla **"Arşivden çıkar"** aksiyonu gösterilir; başarıda şablon listeye döner.
- Yalnız OWNER/ADMIN erişir (`MANAGE_CRM_PIPELINE`); MEMBER için sayfa yok ve API 403 verir.

## Teknik Gereksinimler

- Tasarım sistemi token'ları; sıralama klavyeyle de yapılabilir.
- Sunucu doğrulaması esastır; UI kısıtları yalnızca kolaylıktır.

## Scope Dışı

- Şablon içe/dışa aktarma (Epic 10).

## Acceptance Criteria

- Aşama ekle/sil/sırala çalışıyor; sıralama sayfa yenilendiğinde korunuyor.
- İkinci WON eklenmeye çalışılınca anlaşılır hata.
- MEMBER sayfaya erişemiyor.
- E2E: yeni aşama ekle → süreç detayında checklist'te görün.

## Bağımlılıklar

[C2], [C6].

## Önerilen Branch

`feature/crm-pipeline-ui`
```

---

### C8
**title:** `CRM: Dashboard kartları ve satış hunisi (funnel)`
**labels:** `epic-14`, `crm`, `frontend`, `finance`

**body:**

```markdown
## Amaç

"Kaç kurumla görüşüldü, kaçı hangi aşamada, kaçı kazanıldı" sorusunun tek bakışta cevabı.

## Kapsam

- `GET /api/tenants/[tenantId]/crm/dashboard?from=&to=` →
  - toplam kurum, açık süreç, kazanılan/kaybedilen süreç sayısı,
  - aşama bazlı huni: her aşama için o aşamayı tamamlamış açık süreç sayısı,
  - bekleyen randevu sayısı ve en yakın 5 randevu,
  - kazanılan süreçlerin `expectedAmount` toplamı (para birimi bazında ayrı; **karışık para
    birimleri toplanmaz**, her biri ayrı satır olarak döner).
- Dashboard'a modül açıkken görünen bir CRM bölümü; huni görselleştirmesi mevcut donut
  chart'la aynı görsel dili kullanır.
- Tarih aralığı filtresi mevcut dashboard filtresiyle aynı davranır.

## Teknik Gereksinimler

- **GET yan etkisizdir** (invariant #4): hiçbir sayaç/kayıt yazılmaz.
- Sorgular tek seferde ve `tenantScoped()` üzerinden; N+1 yok (aşama sayımı tek `groupBy`).
- Tutarlar JSON'a **string** olarak yazılır (invariant #10).
- Modül kapalıysa endpoint 404, dashboard bölümü hiç render edilmez.

## Scope Dışı

- Dönemsel karşılaştırma (geçen ay/bu ay), tahminleme.
- PDF/Excel çıktısı (Epic 10).

## Acceptance Criteria

- Sayılar elle kurulan senaryoyla birebir uyuşuyor (integration testi).
- Farklı para birimlerindeki tutarlar toplanmıyor, ayrı gösteriliyor.
- Cross-tenant veri sızmıyor.
- Modül kapalıyken 404.

## Bağımlılıklar

[C3], [C4].

## Önerilen Branch

`feature/crm-dashboard`
```

---

### T0
**title:** `Epic: Tahsilat & Ödeme Planı Modülü (çek / kart / nakit / taksit)`
**labels:** `epic-15`, `collections`, `finance`, `enhancement`

**body:**

```markdown
## Amaç

Bir satış kazanıldığında, o kurumdan **paranın nasıl alınacağının** planlanması ve takibi:
nakit mi, kart mı, havale mi, çek mi; kaç taksit; kaç çek; hangi çek hangi vadede; tahsil
edildi mi, karşılıksız mı çıktı.

## Kapsam

- `PaymentPlan` — bir sürece bağlı ödeme planı (toplam tutar, yöntem, taksit sayısı).
- `PaymentInstallment` — taksitler (vade, tutar, tahsil durumu).
- `Cheque` — çek portföyü ve çekin yaşam döngüsü.
- Tahsilat kaydedildiğinde mevcut `Transaction`/`Account` ile entegrasyon.
- Vadesi yaklaşan/geçen tahsilat ekranı ve dashboard kartları.

## Alt Issue'lar

- [T1] `PaymentPlan` + `PaymentInstallment` modelleri ve API
- [T2] Taksit tahsilatı → `Transaction` üretimi (ve geri alma)
- [T3] `Cheque` modeli, durum makinesi ve API
- [T4] Tahsilat takvimi ve dashboard kartları (vadesi yaklaşan/geçen)
- [T5] Ödeme planı UI: plan kurulumu, taksit tablosu, tahsilat işaretleme
- [T6] Çek portföyü UI

## Scope Dışı

- Banka/POS entegrasyonu, otomatik mutabakat.
- Otomatik hatırlatma bildirimi/e-posta (Epic 9) — bu modül veriyi üretir, bildirimi Epic 9 taşır.
- Fatura kesme/e-fatura (Epic 8).
- Kur dönüşümü: bir plan tek para biriminde çalışır.

## Acceptance Criteria

- `collections` modülü `crm` kapalıyken açılamıyor.
- Tüm parasal alanlar `Decimal(19,4)`; JSON'a string olarak yazılıyor.
- Tahsilat ile hesap bakiyesi arasında tutarsızlık üretebilecek bir yol yok (aynı transaction).
- Vadesi geçmişlik türetiliyor; cron gerektirmiyor.

## Bağımlılıklar

[M1], [M2], [M4], [C3], #46 (Account), #53 (Transaction).

## Önerilen Branch

Alt issue'lar kendi branch'lerini açar.
```

---

### T1
**title:** `Tahsilat: PaymentPlan + PaymentInstallment modelleri ve API`
**labels:** `epic-15`, `collections`, `finance`, `multi-tenant`

**body:**

```markdown
## Amaç

Kazanılan bir süreç için ödeme planının kurulması: toplam tutar, ödeme yöntemi, peşinat,
taksit sayısı ve taksitlerin vadeleri.

## Kapsam

### Şema

```prisma
enum PaymentMethod {
  CASH      // nakit
  CARD      // kredi/banka kartı
  TRANSFER  // havale/EFT
  CHEQUE    // çek
  MIXED     // karma
}

enum PaymentPlanStatus {
  ACTIVE
  COMPLETED
  CANCELLED
}

enum InstallmentStatus {
  PENDING
  PARTIAL
  PAID
  CANCELLED
  // OVERDUE YOKTUR — türetilir (aşağıya bak)
}

model PaymentPlan {
  id             String            @id @default(cuid())
  totalAmount    Decimal           @db.Decimal(19, 4)
  currency       String                                   // ISO 4217
  method         PaymentMethod
  downPayment    Decimal           @default(0) @db.Decimal(19, 4)
  installmentCount Int                                     // >= 1
  status         PaymentPlanStatus @default(ACTIVE)
  notes          String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  dealId String                                            // bir sürecin AYNI ANDA tek aktif planı
  deal   Deal   @relation(fields: [dealId], references: [id], onDelete: NoAction)

  installments PaymentInstallment[]
  cheques      Cheque[]

  @@index([tenantId])
  @@index([dealId])
}
```

> `Deal` tarafındaki ilişki alanı `plans PaymentPlan[]` olur (tekil değil) — iptal edilmiş
> planlar da geçmiş olarak durur.

```prisma

model PaymentInstallment {
  id         String            @id @default(cuid())
  sequence   Int                                           // 1'den başlar
  dueDate    DateTime
  amount     Decimal           @db.Decimal(19, 4)
  paidAmount Decimal           @default(0) @db.Decimal(19, 4)
  status     InstallmentStatus @default(PENDING)
  paidAt     DateTime?
  method     PaymentMethod?                                // plandan farklıysa
  notes      String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  planId String
  plan   PaymentPlan @relation(fields: [planId], references: [id], onDelete: Cascade)

  transactionId String?  @unique                           // [T2]
  // Bir taksit birden fazla çekle ödenebilir: `Cheque.installmentId` üzerindeki `@unique`
  // [T3]'te REDDEDİLDİ (karşılıksız çekin yerine yenisini bağlamayı imkânsız kılardı), bu
  // yüzden ilişki 1-N'dir. "Bağlı çeklerin toplamı taksitin kalanını aşamaz" kuralı DB'de
  // değil serviste, `runSerializable()` içinde zorlanır (bkz. [T3]).
  cheques       Cheque[]

  @@unique([planId, sequence])
  @@index([tenantId, dueDate])
  @@index([tenantId, status])
}
```

**Kararlar:**

- **`OVERDUE` bir enum değeri DEĞİLDİR.** Vadesi geçmişlik `dueDate < now() AND status IN
  (PENDING, PARTIAL)` ile **türetilir**. Enum'a koymak, her gece çalışan bir cron'a bağımlılık
  yaratırdı; cron çalışmadığı gün veri yalan söylerdi. Bu karar README'ye yazılır.
- **`dealId @unique` REDDEDİLDİ.** Kısıt duruma bakmaz: `CANCELLED` bir plan da `dealId`'yi
  işgal etmeye devam eder ve "planı iptal et, yenisini kur" akışı P2002'ye çarpardı. Yani
  yazılmak istenen "aynı anda tek aktif plan" değil, "süreç başına ömür boyu tek plan" olurdu.
  Postgres'te `WHERE status = 'ACTIVE'` koşullu unique index bu kuralı deklaratif olarak
  taşırdı, ama Prisma şemasında ifade edilemez ve elle düzenlenmiş migration gerektirir —
  repo'nun "migration dosyaları elle düzenlenmez" kuralıyla çelişir.
- **Kural kodda zorlanır:** "bir sürecin aynı anda tek `ACTIVE` planı olur" okuma sonucuna
  bağlı bir invariant'tır, bu yüzden `runSerializable()` içinde kontrol edilir (eşzamanlılık
  deseni #2; doğrudan `prisma.$transaction(..., { isolationLevel: Serializable })` çağrılmaz).
  Mevcut `ACTIVE` plan varsa **409**; retry denemeleri tükenirse **503**. Kural DB'den koda
  taşındığı için eşzamanlı iki "plan kur" isteğinin tek plan üretmesi **integration testiyle
  kanıtlanmak zorundadır** — burada artık koruyan bir constraint yoktur.
- `@@unique([planId, sequence])`: taksit üretimi tekrarlanırsa DB duplicate'i keser.
- **Taksit tutarları toplamı = `totalAmount - downPayment`** invariant'ıdır; plan
  oluşturulurken doğrulanır. Kuruş artıkları **son taksite** eklenir (dağıtım kuralı açıkça
  yazılır ve test edilir) — bölme kalanını yok saymak, toplamın tutmadığı bir plan üretirdi.
- Aritmetik `Prisma.Decimal` ile yapılır; ara adımda `Number(...)`'a düşürülmez (invariant #10).
- `Deal` için `onDelete: NoAction`: ödeme planı olan süreç silinemez → 409.
- `status` alanı **yazılır** ama tek doğruluk kaynağı `paidAmount`tır: servis her tahsilat
  yazımında `status`'ü aynı transaction'da `paidAmount` ile tutarlı hâle getirir
  (`paidAmount = 0 → PENDING`, `0 < paidAmount < amount → PARTIAL`, `>= amount → PAID`).

### Servis + Route

- `POST /api/tenants/[tenantId]/collections/plans` `{ dealId, totalAmount, currency, method,
  downPayment?, installmentCount, firstDueDate, intervalMonths? }` — taksitleri **sunucu
  üretir** (client'ın gönderdiği taksit listesi kabul edilmez; tutar tutarlılığı sunucunun
  sorumluluğudur).
- `GET/PATCH .../plans/[planId]`, `POST .../plans/[planId]/cancel`
- `GET .../plans/[planId]/installments`, `PATCH .../installments/[installmentId]`
  (vade/tutar/not düzeltmesi; tahsilat işaretleme [T2]'de)
- `GET /api/tenants/[tenantId]/collections/installments?from=&to=&status=&overdue=true`

İzinler: `VIEW_COLLECTIONS: "collections:view"` (OWNER/ADMIN/MEMBER),
`MANAGE_COLLECTIONS: "collections:manage"` (**OWNER/ADMIN**). Gerekçe: tahsilat kaydı hesap
bakiyesini değiştirir; bu, `MANAGE_TRANSACTIONS`'ın MEMBER'dan esirgenmesiyle aynı karardır.

### Audit

`COLLECTION_PLAN_CREATED/UPDATED/CANCELLED`, `COLLECTION_INSTALLMENT_UPDATED`.

## Teknik Gereksinimler

- Modül guard'ı `MODULES.COLLECTIONS`; katalogda `dependsOn: ["crm"]`.
- Invariant #1, #2, #3, #4, #7, #8, #10.
- Doğrulama: `installmentCount >= 1`, `totalAmount > 0`, `downPayment >= 0` ve
  `< totalAmount`, `currency` 3 büyük harf, `firstDueDate` geçerli tarih.

## Scope Dışı

- Tahsilat kaydı ve `Transaction` üretimi ([T2]).
- Çek kayıtları ([T3]).

## Acceptance Criteria

- 12 taksitlik plan kurulunca 12 taksit oluşuyor, tutarların toplamı `totalAmount - downPayment`'a
  **kuruşu kuruşuna** eşit (kalan son taksitte).
- Aynı deal'a ikinci aktif plan kurulamıyor → 409.
- İptal edilmiş bir planın ardından aynı deal'a **yeni plan kurulabiliyor** (409 dönmüyor).
- Eşzamanlı iki "plan kur" isteği tek plan üretiyor (integration testi ile kanıtlanmış).
- Client'ın gönderdiği taksit listesi yok sayılıyor (body'ye eklenen alanlar etkisiz).
- MEMBER plan kuramıyor → 403; görebiliyor.
- `crm` modülü kapalıyken `collections` açılamıyor.
- Cross-tenant testleri yeşil; `tenant-scope-pattern` güncellendi.

## Bağımlılıklar

[M1], [M2], [C3].

## Önerilen Branch

`feature/collections-payment-plan`
```

---

### T2
**title:** `Tahsilat: taksit tahsilatı → Transaction üretimi ve geri alma`
**labels:** `epic-15`, `collections`, `finance`, `security`

**body:**

```markdown
## Amaç

Bir taksit tahsil edildiğinde, bunun yalnızca CRM tarafında değil **gerçek finansal kayıtta**
da görünmesi: ilgili hesabın bakiyesi artmalı ve gelir işlemi oluşmalı.

## Kapsam

- `POST /api/tenants/[tenantId]/collections/installments/[installmentId]/collect`
  `{ accountId, amount, paidAt?, method?, categoryId?, note? }`
- `DELETE .../installments/[installmentId]/collect` — tahsilatı geri al.

### Davranış

- Tek bir `runSerializable()` transaction'ı içinde:
  1. Taksit `tenantScoped()` ile okunur ve kilitlenir (`updateMany` + `count === 1` deseni).
  2. `amount` doğrulanır: `> 0` ve `paidAmount + amount <= installment.amount`
     (fazla tahsilat → 400; kısmi tahsilat serbesttir → `PARTIAL`).
  3. `Transaction` **INCOME** olarak oluşturulur (mevcut `src/lib/finance/transaction.ts`
     servisi kullanılır — bakiye güncellemesi orada zaten aynı transaction içinde yapılıyor;
     **kopya kod yazılmaz**).
  4. `installment.transactionId` yazılır (`@unique` → çift tahsilat DB seviyesinde kesilir).
  5. `paidAmount`, `status`, `paidAt` güncellenir.
  6. Planın tüm taksitleri PAID ise `PaymentPlan.status = COMPLETED`.
- **Geri alma**: üretilen `Transaction` silinir (bakiye aynı transaction'da geri alınır),
  `transactionId` null'lanır, `paidAmount`/`status`/`paidAt` geri alınır.
- Para birimi kontrolü: `account.currency !== plan.currency` → **400**. Kur dönüşümü kapsam
  dışıdır ve sessizce yanlış tutar yazmaktansa reddetmek doğrudur.
- Audit: `COLLECTION_INSTALLMENT_COLLECTED`, `COLLECTION_INSTALLMENT_COLLECTION_REVERSED`;
  `metadata`'ya taksit sırası ve tutar (hassas veri yok).

**Kararlar:**

- **Tahsilat ve muhasebe kaydı aynı transaction'dadır.** Ayrı yazılsaydı araya düşen bir hata
  "tahsil edildi ama bakiye artmadı" (veya tersi) durumu bırakırdı — finansal bir üründe
  kabul edilemez.
- `transactionId @unique`: aynı taksit için iki eşzamanlı tahsilat isteğinden yalnızca biri
  kazanır; ikincisi P2002 → 409. "Önce kontrol et sonra yaz" YASAK olduğu için kontrol
  constraint'e bırakılır.
- Kategori opsiyoneldir; verilirse `INCOME` türünde olmalı (aksi hâlde 400) — mevcut
  `Transaction` kuralı.

## Teknik Gereksinimler

- Invariant #1, #2, #3, #4, #8, #10.
- `runSerializable()` doğrudan `prisma.$transaction(..., Serializable)` yerine kullanılır;
  denemeler tükenirse **503** (409 değil).
- İzin: `MANAGE_COLLECTIONS`. Ek olarak `MANAGE_TRANSACTIONS` gerekmez — tahsilat tek bir
  iş eylemidir ve iki izin istemek pratikte MEMBER'ı değil ADMIN'i engellerdi; bu karar
  README'ye yazılır.

## Scope Dışı

- Çekin tahsile verilmesi/karşılıksız çıkması ([T3]).
- Kısmi tahsilatın taksitlere otomatik dağıtılması.

## Acceptance Criteria

- Tahsilat sonrası hesap bakiyesi tam olarak tahsil edilen kadar artar.
- Geri alma sonrası bakiye ve taksit durumu **başlangıçtaki değerine birebir** döner.
- Eşzamanlı iki tahsilat isteği: bir başarı + bir 409; bakiye bir kez artar (integration testi).
- Farklı para birimli hesap → 400, hiçbir yazma olmaz.
- Fazla tahsilat → 400.
- Tüm taksitler ödenince plan COMPLETED olur.
- `security/collections-security.spec.ts`: başka tenant'ın taksiti/hesabıyla tahsilat 404 döner.

## Bağımlılıklar

[T1], #46, #53.

## Önerilen Branch

`feature/collections-collect`
```

---

### T3
**title:** `Tahsilat: Cheque modeli, durum makinesi ve API`
**labels:** `epic-15`, `collections`, `finance`

**body:**

```markdown
## Amaç

Çekle ödemede "kaç çek, hangi banka, hangi vade, tahsil edildi mi, karşılıksız mı çıktı"
takibi — müşterinin en çok kullanacağı tahsilat biçimi.

## Kapsam

### Şema

```prisma
enum ChequeStatus {
  PORTFOLIO   // elimizde, vadesi bekleniyor
  DEPOSITED   // tahsile verildi
  CLEARED     // tahsil edildi
  BOUNCED     // karşılıksız
  RETURNED    // iade edildi (müşteriye geri verildi)
  CANCELLED
}

model Cheque {
  id           String       @id @default(cuid())
  chequeNumber String
  bankName     String
  branchName   String?
  drawerName   String?                      // keşideci
  dueDate      DateTime
  amount       Decimal      @db.Decimal(19, 4)
  currency     String
  status       ChequeStatus @default(PORTFOLIO)
  depositedAt  DateTime?
  clearedAt    DateTime?
  bouncedAt    DateTime?
  notes        String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  institutionId String
  institution   Institution @relation(fields: [institutionId], references: [id], onDelete: NoAction)

  planId String?
  plan   PaymentPlan? @relation(fields: [planId], references: [id], onDelete: SetNull)

  installmentId String?
  installment   PaymentInstallment? @relation(fields: [installmentId], references: [id], onDelete: SetNull)

  @@unique([tenantId, bankName, chequeNumber])
  @@index([tenantId, dueDate])
  @@index([tenantId, status])
  @@index([institutionId])
  @@index([installmentId])
}
```

**Kararlar:**

- `@@unique([tenantId, bankName, chequeNumber])`: aynı çekin iki kez girilmesini engeller.
  Yalnız `chequeNumber` yetmez — farklı bankalar aynı numarayı kullanabilir. Kıyas
  büyük/küçük harfe duyarlıdır (mevcut sınır).
- **`installmentId` üzerinde `@unique` YOKTUR.** `@unique` REDDEDİLDİ çünkü kısıt duruma
  bakmaz: `BOUNCED`/`RETURNED` bir çek de taksitin `installmentId`'sini işgal etmeye devam
  eder ve "karşılıksız çekin yerine yeni çek bağlama" akışını imkânsız kılardı. Kısıt gerçek
  hayatı da yanlış modellerdi: bir taksit birden fazla çekle ödenebilir.
- Bunun yerine kural şudur: **bir taksite bağlı, terminal olmayan (`PORTFOLIO`, `DEPOSITED`)
  çeklerin tutar toplamı, taksitin KALAN tutarını (`amount - paidAmount`) AŞAMAZ.** Okuma
  sonucuna bağlı bir invariant olduğu için `runSerializable()` içinde doğrulanır (eşzamanlılık
  deseni #2; `prisma.$transaction(..., Serializable)` DOĞRUDAN çağrılmaz — retry atlanır);
  aşılırsa **409**, denemeler tükenirse `503`. **Bedeli:** kural DB'de değil kodda — bu yüzden
  aşım ve eşzamanlılık senaryoları integration testiyle KANITLANIR, aksi hâlde invariant
  sessizce kaybolur. İlişki artık 1-N olduğundan [T1]'deki `PaymentInstallment.cheque` alanı
  `cheques Cheque[]` olur; `@@index([installmentId])` okuma tarafını karşılar.
- **Durum makinesi** servis katmanında açıkça tanımlanır; geçersiz geçiş **409** döner:
  - `PORTFOLIO → DEPOSITED | RETURNED | CANCELLED`
  - `DEPOSITED → CLEARED | BOUNCED | PORTFOLIO` (tahsilden geri çekildi)
  - `BOUNCED → DEPOSITED | RETURNED` (yeniden tahsile verilebilir)
  - `CLEARED`, `RETURNED`, `CANCELLED` **terminaldir**.
  Geçiş tablosu `Record<ChequeStatus, readonly ChequeStatus[]>` olarak yazılır — yeni bir
  durum eklendiğinde tabloyu doldurmak derleme zamanında zorunlu olur (rol matrisiyle aynı
  gerekçe).
- `CLEARED`'a geçiş, çek bir taksite bağlıysa **[T2]'deki tahsilat akışını tetikler** (aynı
  transaction: `Transaction` üretilir, bakiye artar, taksit PAID olur). Bağlı değilse yalnız
  durum değişir. Kopya tahsilat kodu yazılmaz.
- `BOUNCED`, daha önce `CLEARED` olmuş bir çekte oluşamaz (terminal); karşılıksız çıkan bir
  çekin tahsilatını geri almak gerekiyorsa önce tahsilat geri alınır ([T2]).
- Vade geçmişliği burada da **türetilir**; `OVERDUE` durumu yoktur.
- `Institution` için `onDelete: NoAction` (finansal geçmiş korunur).

### Route

- `GET/POST /api/tenants/[tenantId]/collections/cheques`
- `GET/PATCH/DELETE .../cheques/[chequeId]`
- `POST .../cheques/[chequeId]/status` `{ status, occurredAt?, accountId? }` — durum geçişi
  (POST; GET değil). `accountId` yalnız `CLEARED` geçişinde ve taksite bağlıysa gerekir.
- Liste filtreleri: `?status=`, `?institutionId=`, `?from=&to=` (vade), `?overdue=true`.

### Audit

`CHEQUE_CREATED/UPDATED/DELETED`, `CHEQUE_STATUS_CHANGED` (metadata: eski/yeni durum).

## Teknik Gereksinimler

- Invariant #1, #2, #3, #4, #7, #8, #10.
- Durum geçişi + tahsilat tek `runSerializable()` içinde.
- `CLEARED` olmuş çek silinemez → 409 (yalnızca `CANCELLED` edilebilir).

## Scope Dışı

- Çek görüntüsü/fotoğrafı yükleme (Epic 6 attachment).
- Çek karnesi / keşide edilen (borç) çekler — bu issue **alınan** çekleri kapsar; verilen
  çekler ayrı bir issue'dur.

## Acceptance Criteria

- Geçersiz durum geçişi → 409, hiçbir yazma olmaz.
- Taksite bağlı çek `CLEARED` olunca: taksit PAID, `Transaction` oluştu, bakiye arttı — hepsi
  tek transaction'da.
- Aynı banka + numara ile ikinci çek → 409.
- `overdue=true` filtresi yalnızca vadesi geçmiş ve `PORTFOLIO`/`DEPOSITED` çekleri döner.
- Karşılıksız (`BOUNCED`) çekin yerine aynı taksite yeni çek bağlanabiliyor.
- Taksitin kalan tutarını aşan çek bağlama denemesi → 409, hiçbir yazma olmaz.
- Eşzamanlı iki çek bağlama isteği toplamı aşamıyor: biri başarılı, biri 409 (integration testi).
- Cross-tenant testleri yeşil.

## Bağımlılıklar

[T1], [T2], [C1].

## Önerilen Branch

`feature/collections-cheques`
```

---

### T4
**title:** `Tahsilat: takvim, vadesi yaklaşan/geçen listesi ve dashboard kartları`
**labels:** `epic-15`, `collections`, `finance`, `frontend`

**body:**

```markdown
## Amaç

"Bu hafta hangi taksitler ve çekler geliyor, neyin vadesi geçti" sorusunun tek ekranda cevabı.

## Kapsam

- `GET /api/tenants/[tenantId]/collections/calendar?from=&to=` → taksitler + çekler birleşik,
  vade tarihine göre artan; her kayıtta: tür (taksit/çek), kurum, tutar, para birimi, vade,
  durum, `isOverdue` (türetilmiş).
- `GET /api/tenants/[tenantId]/collections/summary?from=&to=` →
  - bekleyen tahsilat toplamı (para birimi bazında ayrı),
  - vadesi geçmiş toplamı ve adedi,
  - portföydeki çek toplamı, tahsile verilmiş çek toplamı, karşılıksız çek adedi,
  - önümüzdeki 30 günde vadesi gelen toplam.
- Dashboard'a `collections` modülü açıkken görünen kart grubu + "vadesi geçenler" uyarı rozeti.
- `/collections` sayfasında takvim/liste görünümü, tarih aralığı ve durum filtreleri.

## Teknik Gereksinimler

- **GET yan etkisizdir** (invariant #4).
- `isOverdue` **hesaplanarak** döner; DB'de tutulmaz.
- Farklı para birimleri **toplanmaz**, ayrı satır döner (invariant #10 ile tutarlı).
- Tutarlar JSON'a string olarak yazılır.
- Sorgular tek seferde; taksit ve çek listeleri iki sorguyla alınıp serviste birleştirilir.

## Scope Dışı

- Bildirim/e-posta hatırlatma (Epic 9).
- Excel/PDF çıktısı (Epic 10).

## Acceptance Criteria

- Vadesi dünde olan `PENDING` taksit `isOverdue: true`, yarınki `false`.
- `CLEARED` çek ve `PAID` taksit vadesi geçmiş sayılmaz.
- Karışık para birimli veride toplamlar ayrı satırlarda.
- Modül kapalıyken 404; dashboard kartları render edilmez.
- Integration testleri sabit bir zaman referansıyla yazılır (test flake olmaz).

## Bağımlılıklar

[T1], [T3].

## Önerilen Branch

`feature/collections-calendar`
```

---

### T5
**title:** `Tahsilat UI: ödeme planı kurulumu, taksit tablosu ve tahsilat işaretleme`
**labels:** `epic-15`, `collections`, `frontend`

**body:**

```markdown
## Amaç

Kullanıcının ödeme planını kurup taksitleri tek tek tahsil olarak işaretleyebilmesi.

## Kapsam

- Süreç detayında ([C6]) "Ödeme Planı" bölümü: plan yoksa "Plan oluştur" formu.
- Plan formu: toplam tutar, para birimi, yöntem (nakit/kart/havale/çek/karma), peşinat,
  taksit sayısı, ilk vade, taksit aralığı (ay). Form, taksit tablosunun **önizlemesini**
  gösterir; ama gerçek tutarlar sunucudan gelir (client'ın hesabı yalnız görseldir ve
  sunucu yanıtıyla değiştirilir).
- Taksit tablosu: sıra, vade, tutar, tahsil edilen, durum rozeti (Bekliyor / Kısmi / Ödendi /
  **Gecikti**), aksiyonlar.
- "Tahsil et" modalı: hesap seçimi, tutar (varsayılan kalan tutar), tarih, yöntem, not.
- "Tahsilatı geri al" aksiyonu onay ister ve ne olacağını açıkça yazar ("Bu işlem, oluşan
  gelir kaydını siler ve hesap bakiyesini düşürür").
- Gecikmiş taksitler görsel olarak ayrışır; **yalnız renkle değil**, metin/rozet ile de.
- `/collections` sayfasında tüm planların listesi ve filtreleri.

## Teknik Gereksinimler

- Tasarım sistemi token'ları; tutarlar Türkçe biçimde ve para birimi kodu ile gösterilir.
- Tutarlar API'den **string** gelir; client'ta `Number`'a çevrilip **hesap yapılmaz**, yalnız
  biçimlendirilir.
- Aksiyonlar POST/DELETE; MEMBER'a aksiyon butonu gösterilmez ama asıl koruma backend'dedir.
- Hata mesajları Türkçe; 400/409/503 ayrı ayrı anlamlı mesaja eşlenir (503 = "Sistem yoğun,
  lütfen tekrar deneyin").

## Scope Dışı

- Çek ekranı ([T6]).

## Acceptance Criteria

- E2E: süreç kazanıldı → 6 taksitlik plan kur → 2 taksiti tahsil et → hesap bakiyesi
  beklenen kadar arttı → birini geri al → bakiye geri döndü.
- Gecikmiş taksit rozetle işaretleniyor.
- Modül kapalıyken bölüm hiç görünmüyor.

## Bağımlılıklar

[T1], [T2], [C6].

## Önerilen Branch

`feature/collections-plan-ui`
```

---

### T6
**title:** `Tahsilat UI: çek portföyü ekranı`
**labels:** `epic-15`, `collections`, `frontend`

**body:**

```markdown
## Amaç

Elde bulunan, tahsile verilen ve karşılıksız çıkan çeklerin tek ekranda yönetimi.

## Kapsam

- `/collections/cheques` — liste: çek no, banka, keşideci, kurum, vade, tutar, durum.
  Filtreler: durum, kurum, vade aralığı, vadesi geçenler.
- Durum bazlı özet şeridi: portföyde X çek / Y tutar, tahsilde, karşılıksız.
- Çek ekleme/düzenleme formu; ödeme planına ve taksite bağlama (opsiyonel).
- Durum değiştirme aksiyonu **yalnızca geçerli geçişleri** gösterir; sunucu yine de doğrular.
- `CLEARED` geçişinde, çek bir taksite bağlıysa hesap seçimi istenir ve "bu işlem gelir kaydı
  oluşturacak ve bakiyeyi artıracak" uyarısı gösterilir.
- Karşılıksız çekler listede belirgin biçimde ayrışır (renk + metin).

## Teknik Gereksinimler

- Tasarım sistemi token'ları; tablo dar ekranda kendi içinde yatay kayar.
- Tutarlar string olarak gelir, client'ta hesaplanmaz.
- Geçersiz geçiş denemesinde 409 mesajı kullanıcıya anlaşılır Türkçeyle gösterilir.

## Scope Dışı

- Çek görselinin yüklenmesi (Epic 6).
- Verilen (keşide edilen) çekler.

## Acceptance Criteria

- E2E: çek ekle → tahsile ver → tahsil edildi işaretle → bağlı taksit ödendi ve bakiye arttı.
- Terminal durumdaki çekte geçiş aksiyonu gösterilmiyor.
- Vadesi geçen portföy çekleri filtreyle listelenebiliyor.
- Modül kapalıyken sayfaya erişilemiyor.

## Bağımlılıklar

[T3], [T5].

## Önerilen Branch

`feature/collections-cheques-ui`
```

---

## 5. Önerilen sıra

```
M1 → M2 → M4 → M3            (modül altyapısı; M3 UI'ı en sona da bırakılabilir)
  → C1 → C2 → C3 → C4        (CRM backend)
  → C5 → C6 → C7 → C8        (CRM UI)
  → T1 → T2 → T3             (tahsilat backend)
  → T4 → T5 → T6             (tahsilat UI)
```

İlk demoya en hızlı giden yol: **M1, M2, M4, C1, C2, C3, C6**. Bu yedi issue bittiğinde
müşteri kurum ekleyip aşamaları tikleyebilir; tahsilat sonra gelir.
