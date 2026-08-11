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
