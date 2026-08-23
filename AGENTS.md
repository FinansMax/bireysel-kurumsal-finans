# AGENTS.md

Bu dosya, bu repository üzerinde çalışan kodlama ajanları (OpenAI Codex ve `AGENTS.md` okuyan
diğer ajanlar) için **bağlayıcı** kuralları tanımlar ve varsayılan davranışın üstündedir. Amaç:
üretim kalitesinde, güvenli ve mevcut kodla tutarlı değişiklikler üretmek.

> Bu dosya, Claude Code için tutulan `CLAUDE.md` ile **aynı** proje kurallarını taşır; yalnızca
> ajan-özgü çalışma biçimi bölümü farklıdır. Kurallardan biri değişirse **her iki dosya da aynı
> commit içinde** güncellenmelidir. Kuralların yetkili kaynağı `docs/` altındaki dosyalardır.

Derinlemesine referanslar (gerektiğinde oku, ezberden davranma):

| Dosya | İçerik |
| --- | --- |
| `docs/security-invariants.md` | Pazarlığa kapalı güvenlik kuralları — **yetkili kaynak** |
| `docs/architecture.md` | Katmanlar, dizin haritası, route/servis anatomisi, yeni model ekleme |
| `docs/conventions.md` | TypeScript, isimlendirme, import, yorum, Prisma, hata yönetimi |
| `docs/testing.md` | Üç test suite'i, ne nereye yazılır, tuzaklar |
| `docs/workflow.md` | Branch, commit, PR, Definition of Done |
| `README.md` | Ürün + **karar kaydı**: her güvenlik kararı, gerekçesi ve kalan riski |

---

## 1. Her görevden önce

1. **Ne istendiğini netleştir.** Bir issue = bir scope. Kapsam dışına çıkma.
2. **Dokun(may)acağın kodu oku.** Bu repo'da desenler tutarlıdır; en yakın benzer dosyayı bul ve
   onu taklit et. Varsayımla kod yazma.
3. **İlgili kararı oku.** Auth, tenant, CSRF, rate limit, enumeration konularına dokunuyorsan
   `README.md`'deki ilgili bölüm ve `docs/security-invariants.md` **okunmadan** kod yazma —
   burada "iyileştirme" gibi görünen çoğu şey, gerekçesi yazılmış bilinçli bir karardır.
4. **Next.js sürümünü doğrula.** Bu Next.js 16'dır; API'ler eğitim verinden farklı olabilir.
   Kod yazmadan önce `node_modules/next/dist/docs/` altındaki ilgili rehberi oku.
5. **Branch aç.** `main` üzerinde asla doğrudan çalışma.

## 2. Proje

Çok kiracılı (multi-tenant) finansal yönetim SaaS'ı. Bireysel + kurumsal kullanım, RBAC,
faturalandırma, raporlama, veri içe/dışa aktarma hedefleniyor.

**Stack:** Next.js 16 (App Router) + React 19 + TypeScript (strict) · PostgreSQL + Prisma 6 ·
Auth.js v5 (JWT session) · Tailwind CSS 4 · Playwright · Docker Compose (lokal DB).

**Durum:** Backend temeli hazır — auth, tenant/membership, davet, RBAC, tenant izolasyonu, audit
log, rate limiting, session revocation. Finansal modeller (`Account`, `Transaction`, ...) ve
frontend kabuğu henüz yok.

## 3. Komutlar

```bash
docker compose up -d          # lokal PostgreSQL
npm run prisma:migrate        # migration üret + uygula (dev)
npm run dev                   # http://localhost:3000

npm run lint                  # ESLint
npm run typecheck             # next typegen && tsc --noEmit
npm run build                 # production build
npm run test:integration      # DB'ye karşı, tarayıcısız — en hızlı geri bildirim
npm run test:security         # yetki/izolasyon/enumeration testleri
npm run test:e2e              # gerçek Chromium
```

Integration/security/e2e için çalışan bir PostgreSQL ve `.env` içinde `DATABASE_URL` +
`AUTH_SECRET` gerekir. Ağ erişimi veya Docker olmayan bir sandbox'ta bu suite'ler
çalıştırılamaz — o durumda `lint` + `typecheck` çalıştır ve **hangi doğrulamayı
yapamadığını açıkça yaz**.

## 4. Mutlak kurallar

Bunlar özet; her birinin gerekçesi ve zorlayan testi `docs/security-invariants.md`'de. Bir
ihlal, testler yeşil olsa bile merge edilemez.

1. **Tenant izolasyonu sorgu seviyesinde.** Tenant-scoped modellerde `tenantScoped(tenantId, where)`
   kullan. `findUnique/update/delete({ where: { id } })` **yasak**; mutation `updateMany`/
   `deleteMany` + `count === 1` ile yapılır.
2. **Trusted `tenantId`/`userId`/`role` yalnızca `requirePermission()` context'inden gelir.**
   Body, query, header, URL parametresi veya JWT'deki iddia asla kaynak değildir.
3. **Yetkilendirme backend'de.** Her korunan route `requireUser()`/`requirePermission()` ile
   başlar; izinler `src/lib/authz/permissions.ts` matrisinde tanımlıdır. UI'da gizlemek yetmez.
4. **GET/HEAD yan etkisizdir.** State değiştiren her işlem POST/PATCH/DELETE. Bu, CSRF
   korumasının dayandığı invariant'tır (özel CSRF token yok; `SameSite=Lax` + CORS).
5. **Secret repo'ya girmez.** `.env` commit edilmez; yeni değişken `.env.example`'a placeholder
   ile eklenir; `NEXT_PUBLIC_` altına secret konmaz.
6. **Token'lar:** `randomBytes(32)`, DB'de yalnızca SHA-256 hash, `expiresAt`, tek kullanımlık ve
   **atomik** tüketim. Şifre `scrypt`. Şifre değişimi `updateUserPassword()` üzerinden
   (`credentialsChangedAt` aynı UPDATE'te).
7. **Hata yanıtları bilgi sızdırmaz.** Geçersizlik nedeni ayrıştırılmaz, timing eşitlenir, 429
   sayaç/IP içermez, stack trace dönmez. (Signup'ın `409`'u kayda geçmiş bilinçli istisnadır.)
8. **Audit log yalnızca `writeAuditLog()` ile**, typed action sabitleriyle, transaction commit
   **sonrasında**, best-effort.
9. **Rate limit iş mantığından önce.** Public/pahalı state değiştiren endpoint'lerde
   `checkRateLimit()` en üstte; limitler `policies.ts`'te merkezî.
10. **Para `Decimal`.** `number`/`Float` yasak; JSON'da string; para birimi ayrı alan.

**Ek kural:** Yeni npm bağımlılığı eklemek açık onay gerektirir. Bu repo bilinçli olarak yalın:
hash için Node `crypto`, doğrulama için elle yazılmış `validation.ts` (zod yok), rate limit için
kendi küçük implementasyonu.

## 5. Kod yazarken

**Katmanlar:** `route.ts` incedir (guard → parse → delegate → response map); iş mantığı
`src/lib/<domain>/` içindedir ve HTTP bilmez. Ayrıntı: `docs/architecture.md`.

**Route sırası:** ucuz shape kontrolü → rate limit → authn/authz → body parse → servis çağrısı →
result union'ı HTTP'ye çevir.

**Servis sözleşmesi:** throw etme, ayrıştırılmış union dön:
`{ ok: true; ... } | { ok: false; status: 400 | 403 | 404 | 409; error: string }`.

**Eşzamanlılık:** "önce kontrol et sonra yaz" kabul edilmez. Unique constraint'e güven (P2002),
okumaya bağlı invariant'lar için `Serializable` transaction + retry, token tüketimi için koşullu
atomik `updateMany`.

**Prisma:** tek singleton (`@/lib/prisma`), her sorguda dar `select` allowlist'i (`passwordHash`/
`tokenHash` asla dışarı), tipler `Prisma.XGetPayload` ile türetilir, transaction içinde daima
`tx`, ham SQL yok.

**TypeScript:** `any` yok; dış girdi `unknown` olarak alınır ve doğrulanır; sabit kümeler
`as const` + union; `Record<MembershipRole, ...>` gibi bütünlük zorlayan tipleri gevşetme.

**Yorumlar Türkçe ve NEDEN'i anlatır** — hangi alternatif neden reddedildi, hangi saldırı
engelleniyor, ilgili issue numarası. Bu kod tabanının en değerli özelliği budur; sürdür.

**Next.js 16:** Route Handler'da `params` bir `Promise`'tir (`await params`). Sunucu bileşeni
varsayılan; `"use client"` yalnızca gerektiğinde ve en küçük yaprakta. Yeni cookie'ler
`HttpOnly` + `SameSite=Lax` (+ prod'da `Secure`).

## 6. Test

Üç suite: `integration/` (iş kuralları, DB'ye karşı), `security/` (saldırgan bakışı), `e2e/`
(gerçek tarayıcı). Yeni bir endpoint genellikle **iki** test ister: mutlu yol + yetkisiz/
cross-tenant yol.

Kritik kurallar:

- Testler **kendi kendini doğrular** (tarama 0 dosya bulunca sessizce geçmez).
- Güvenlik testleri **kontrol grubu** ve **duyarlılık** kanıtı içerir.
- Güvenlik mekanizmaları mock'lanmaz; gerçek JWT/CSRF/hash akışı çalışır.
- Test verisi `randomUUID()` ile benzersizdir; test kendi kayıtlarını temizler,
  `prisma.$disconnect()` çağırır.
- Auth endpoint'lerine istek atan testler benzersiz sahte IP kullanır (`uniqueTestClientIp()`),
  yoksa birbirinin rate-limit bucket'ını tüketir.
- Pattern testleri (`get-side-effect-free-pattern`, `tenant-scope-pattern`) kırmızıya dönerse
  **testi gevşetme, kodu düzelt**.

Ayrıntı: `docs/testing.md`.

## 7. Akış

Branch: `feature/<issue-no>-<slug>` · `fix/<konu>` · `docs/<konu>` · `chore/<konu>`.

Commit: Conventional Commits; başlık ≤72 karakter ve **ASCII** (Türkçe karakter yok); gövde
Türkçe ve kararın gerekçesini, reddedilen alternatifi, bilinen sınırları, `(Issue #N)`'i içerir.

PR: `main`'e; `.github/pull_request_template.md` şablonunu doldur; altı CI job'ı (`lint`,
`typecheck`, `build`, `integration`, `e2e`, `security`) yeşil olmalı; yeni bir güvenlik kararı
varsa `README.md`'ye gerekçesiyle yaz.

Definition of Done listesi: `docs/workflow.md`.

## 8. Ajan çalışma kuralları

- **Plan yap, sonra uygula.** Birden fazla dosyaya dokunan işlerde önce kısa bir plan çıkar;
  adımları sırayla tamamla ve durumunu güncel tut.
- **Doğrulanmamış iş "bitti" değildir.** En az `npm run lint` + `npm run typecheck` ve mümkünse
  ilgili test suite'ini çalıştır. Sandbox kısıtı nedeniyle çalıştıramadığını **açıkça yaz**;
  çıktı uydurma, "geçiyor" deme.
- **Test kırmızıysa bildir.** Başarısız çıktıyı özetle; `test.skip` ekleyerek, assertion
  gevşeterek veya `--no-verify` ile atlatma.
- **Kapsam disiplini.** Yol üstünde gördüğün ilgisiz sorunu düzeltme; çıktında not et. Alakasız
  formatlama/refactor diff'i kirletir. Dosyaları yeniden formatlayan araçlar çalıştırma.
- **Değiştirmeden önce oku.** Bir dosyayı düzenlemeden önce oku; hedef dosyanın mevcut içeriğini
  bilmeden üzerine yazma. Yamalar minimal ve odaklı olsun.
- **Git güvenliği.** `main`'e commit etme, force push yapma, `reset --hard`/`clean -fd`
  çalıştırma; commit/push işlemini kullanıcı istemeden yapma. `.env`'i asla `git add` etme.
- **Etkileşimli komut çalıştırma.** Onay bekleyen veya editör açan komutlar (`git rebase -i`,
  `prisma studio`, watch modundaki süreçler) sandbox'ta asılı kalır. Uzun süren komutlara
  makul bir timeout ver.
- **Ağ erişimi varsayma.** `npm install` gerektiren bir çözüm önermeden önce bunun mümkün olup
  olmadığını kontrol et; zaten yeni bağımlılık açık onay gerektirir.
- **Windows ortamı.** Geliştirme makinesi Windows'tur; yollar ters bölü içerebilir, satır sonu
  CRLF'tir (`core.autocrlf=true`). Satır sonlarını topluca değiştiren düzenlemeler yapma.
- **Belirsizlikte:** cevabı olmayan kararlar için önce bağımsız işleri bitir, sonra tek ve net bir
  soru sor. Bir invariant'ı gevşetmen gerektiğini düşünüyorsan **kod yazmadan önce sor** — bu tür
  kararlar kullanıcıya aittir.
- **Türkçe yaz.** Kullanıcıya yanıtlar, yorumlar ve dokümantasyon Türkçe; tanımlayıcılar İngilizce.

## 9. Yapma listesi

- `main`'de çalışma, invariant'ı sessizce gevşetme, güvenlik testini susturma.
- Tenant-scoped modelde yalnız-ID sorgusu yazma.
- Client'tan gelen `tenantId`/`role`'ü güvenilir kabul etme.
- GET handler'ında yazma işlemi yapma.
- `prisma.auditLog.create()`'i doğrudan çağırma.
- Yeni `PrismaClient()` oluşturma.
- Onaysız bağımlılık ekleme, generic repository/DI soyutlaması getirme.
- Para için `number` kullanma.
- `.env`'i commit etme, secret'ı koda gömme, `NEXT_PUBLIC_` altına secret koyma.
- Mevcut konvansiyonu bozan yeni bir stil başlatma.
- Yeni bir CORS yapılandırmasını (özellikle `credentials` ile) README'deki CSRF bölümünü okumadan
  ekleme.

## 10. Next.js sürüm uyarısı

Bu Next.js 16'dır ve eğitim verindeki Next.js'ten farklı olabilir: API'ler, konvansiyonlar ve
dosya yapısı değişmiş olabilir. Kod yazmadan önce `node_modules/next/dist/docs/` altındaki ilgili
rehberi oku (özellikle `01-app/01-getting-started/15-route-handlers.md`,
`01-app/02-guides/authentication.md`, `01-app/02-guides/data-security.md`) ve deprecation
uyarılarını dikkate al.
