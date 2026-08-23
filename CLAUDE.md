# CLAUDE.md

Bu dosya, bu repository üzerinde çalışan Claude görevleri için temel kuralları tanımlar.

## Kapsam Kuralları

- Bir issue = bir scope. Sadece istenen issue'nun kapsamındaki değişikliği yap.
- İlgisiz (unrelated) feature, refactor veya "yeri gelmişken" iyileştirme ekleme.
- Gereksiz dependency ekleme veya over-engineering yapma.
- `main` branch'i üzerinde doğrudan çalışma; her zaman bir feature/fix branch'i kullan.

## Multi-Tenant ve Güvenlik

- Tenant isolation'ı her zaman koru: bir tenant'ın verisi başka bir tenant'a asla sızmamalı.
- Authorization (yetkilendirme) kontrolleri backend'de uygulanmalı; sadece UI/frontend'de gizlemek yeterli değildir.
- Membership rollerine (`OWNER`, `ADMIN`, `MEMBER`) göre yetki kontrolü sunucu tarafında yapılmalı.
- Secret veya API key'leri repository'ye ekleme; `.env` dosyası Git'e girmemeli.

### State Değiştiren İşlemler GET ile Yapılmaz (CSRF — Issue #28)

- `GET`/`HEAD` handler'ları **yan etkisiz (side-effect free)** olmalıdır: veri yazmaz, silmez,
  token tüketmez, e-posta göndermez. State değiştiren her işlem `POST`/`PATCH`/`DELETE` olmalıdır.
- Bu bir stil tercihi DEĞİL, güvenlik gereğidir: projede özel bir CSRF token sistemi yoktur;
  koruma `SameSite=Lax` cookie'lere dayanır ve `SameSite=Lax`, top-level cross-site **GET**
  isteklerini engellemez. State değiştiren tek bir GET endpoint'i eklemek, CSRF korumasını o
  endpoint için tamamen ortadan kaldırır (bkz. README "CSRF Duruşu", kanıt:
  `e2e/csrf-samesite.spec.ts`).
- Uygulamaya permissive bir CORS yapılandırması (`Access-Control-Allow-Origin`, özellikle
  `credentials` ile) eklemeden önce README'deki CSRF bölümü okunmalıdır — bu, JSON/`PATCH`/
  `DELETE` isteklerini koruyan ikinci katmanı kaldırır.

### Tenant Veri İzolasyonu (Query-Level Scoping — Issue #13)

- Tenant-owned bir modele (örn. `Membership`, gelecekte `Account`/`Transaction`/`Category`/
  `Budget`/`Invoice`) ait sorgular her zaman trusted `tenantId` ile scope'lanmalı:
  `src/lib/tenancy/scope.ts`'teki `tenantScoped(tenantId, where)` helper'ını kullan.
- `findUnique({ where: { id } })` / `update({ where: { id } })` / `delete({ where: { id } })`
  gibi yalnız-ID sorguları tenant-scoped modeller için KULLANILMAZ — id + tenantId birlikte
  unique bir alan olmadığından, tenant-scoped update/delete `updateMany`/`deleteMany` +
  `tenantScoped()` + `result.count === 1` kontrolü ile yapılır (örnek: `src/lib/tenants/membership.ts`).
- Query scope için trusted `tenantId`, authorization guard'ından (`requirePermission()`,
  Issue #12) gelen `context.tenant.id`'dir — body/query/header'daki `tenantId` veya
  membership üzerindeki iddia edilen tenant bilgisi ASLA kaynak değildir.
- Authorization ("bu kullanıcı ne yapabilir?") ve tenant isolation ("bu veri hangi
  tenant'a ait?") ayrı kontrollerdir; birini yapmak diğerini gereksiz kılmaz.
- Yeni tenant-scoped modeller eklendiğinde bu pattern (concrete lookup/list/update/delete
  fonksiyonları + `tenantScoped()`) takip edilmeli.

## Finansal Veri

- Finansal tutarlarda (para birimi vb.) floating point (`number`/`float`) kullanma; `Decimal` tipi kullan.

## Kod Kalitesi

- Yaptığın değişikliğe uygun testleri güncelle veya ekle (Playwright E2E, gerektiğinde birim testleri).
- Mevcut proje yapısını (`src/app`, `src/lib`, `prisma/`) koru; yeni bir konvansiyon başlatmadan önce mevcut düzeni takip et.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
