# Çalışma Akışı

Issue'dan merge'e kadar izlenen yol. Bu akış hem insan hem AI ajan katkıları için geçerlidir.

## 1. Kapsam: bir issue = bir scope

- Sadece istenen issue'nun kapsamındaki değişikliği yap.
- İlgisiz feature, refactor veya "yeri gelmişken" iyileştirme ekleme. Yol üstünde bir sorun
  fark ettiysen: **düzeltme, not et** — PR açıklamasına yaz veya yeni bir issue öner.
- Gereksiz dependency ekleme, over-engineering yapma (bkz. `docs/conventions.md` →
  "Bağımlılıklar").
- Kapsam gerçekten yetersizse, sessizce genişletmek yerine sor.

## 2. Branch

`main` üzerinde **doğrudan çalışılmaz**. Her iş kendi branch'inde:

```
feature/<issue-no>-<kisa-slug>     # feature/13-tenant-data-isolation
feature/<konu>                     # feature/security-rate-limiting
fix/<konu>                         # fix/security-audit-findings
docs/<konu>                        # docs/signup-enumeration-decision
chore/<konu>                       # chore/ci-test-matrix
```

Branch açmadan önce `main`'i güncelle. İş bitene kadar branch üstünde kal.

## 3. Commit

Conventional Commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`, `ci:`.

**Başlık satırı:**
- ~72 karakteri geçmez, sonunda nokta yok, emir kipi.
- **Sadece ASCII** — Türkçe karakter kullanma (bu repo'daki mevcut başlıklar böyle: `test: CSRF
  durusunu gercek tarayiciyla kanitla`). Türkçe veya İngilizce olabilir; bir PR içinde tutarlı ol.

**Gövde (Türkçe, tam diakritikli):** bu repo'nun ayırt edici yanı, commit gövdesinin bir **karar
kaydı** olmasıdır. Şunları içerir:

- Ne yapıldığı ve **neden** bu şekilde yapıldığı.
- Reddedilen alternatif ve gerekçesi.
- Güvenlik/eşzamanlılık etkisi, bilinen sınırlar.
- İlgili issue: `(Issue #27)`.

Örnek (`7f1cd53`):

```
feat: add rate limiting to auth and tenant creation endpoints

Auth ve tenant-creation endpoint'lerini brute-force ve otomatik spam
trafiğine karşı IP + endpoint bazlı sliding-window rate limiter ile korur
(Issue #27).

- `guard.ts`: `checkRateLimit()`, mevcut `requireUser()` deseniyle aynı
  şekilde ya hazır bir 429 `NextResponse` ya da `null` döner.
- Kontrol her zaman business logic'ten ÖNCE yapılır; 429 durumunda hiçbir
  side-effect tetiklenmez.
- Sign-in limiti route seviyesinde uygulanır: Auth.js'in `authorize()`
  callback'i özel bir status/header üretemediği için...
```

Commit'ler mantıksal olarak bölünür; "wip" / "fix typo" gibi ara commit'ler bırakılmaz.
`--no-verify` ile hook atlanmaz.

## 4. Pull Request

- Hedef: `main`. PR başlığı Türkçe olabilir ve tam diakritik kullanabilir.
- Açıklamada: ne değişti, neden, hangi issue'yu kapatıyor (`Closes #27`), nasıl test edildi,
  bilinen sınırlar/kalan risk.
- Şablon: `.github/pull_request_template.md`.
- CI'daki altı job (`lint`, `typecheck`, `build`, `integration`, `e2e`, `security`) yeşil olmadan
  merge edilmez. Kırmızı bir job'ın sebebi anlaşılmadan yeniden çalıştırılmaz.
- Bir güvenlik kararı verildiyse (bir riski kabul etmek dahil) `README.md`'ye gerekçesiyle
  yazılır — bu repo'da README, işleyen bir **karar kaydıdır**.

## 5. Definition of Done

Bir iş, aşağıdakilerin **hepsi** doğruysa bitmiştir:

- [ ] Sadece issue'nun kapsamı değişti; ilgisiz dosya diff'te yok.
- [ ] `docs/security-invariants.md`'deki invariant'ların hiçbiri ihlal edilmedi; ilgili olanlar
      için "Yeni endpoint güvenlik kontrol listesi" işletildi.
- [ ] Davranış değişikliği için test yazıldı/güncellendi (mutlu yol + yetkisiz/sınır yolu).
- [ ] `npm run lint`, `npm run typecheck` temiz.
- [ ] `npm run test:integration`, `npm run test:security`, `npm run test:e2e` geçiyor
      (çalıştırılamayan varsa PR'da açıkça belirtildi).
- [ ] Şema veya route değiştiyse `npm run build` başarılı; migration üretildi ve gözden geçirildi.
- [ ] `.env.example` yeni değişkenlerle güncellendi (placeholder değerle).
- [ ] Yeni bir mimari/güvenlik kararı varsa `README.md` ve gerekiyorsa `docs/` güncellendi.
- [ ] Commit mesajı kararın gerekçesini içeriyor.

## 6. Dokümantasyonu güncel tutma

| Değişiklik | Güncellenecek yer |
| --- | --- |
| Yeni güvenlik kararı / kabul edilen risk | `README.md` (karar kaydı) |
| Yeni veya değişen invariant | `docs/security-invariants.md` + `CLAUDE.md`/`AGENTS.md` özeti |
| Yeni katman, dizin veya desen | `docs/architecture.md` |
| Yeni kod stili kuralı | `docs/conventions.md` |
| Yeni test suite'i / test kuralı | `docs/testing.md` |
| Komut veya script değişikliği | `README.md` + `CLAUDE.md`/`AGENTS.md` komut tablosu |

`CLAUDE.md` ve `AGENTS.md` aynı invariant özetini taşır; **biri değişirse diğeri de aynı commit
içinde güncellenir.**

## 7. AI ajanlarıyla çalışırken

- Ajan `main`'de çalışmaz, kendi branch'ini açar.
- Ajan bir invariant'ı gevşetmek zorunda kaldığını düşünüyorsa **durup sorar**; testi susturarak
  ilerlemez.
- Ajan çalıştıramadığı doğrulamayı "geçti" diye raporlamaz.
- Üretilen kod, insan katkısıyla aynı Definition of Done'a tabidir.
