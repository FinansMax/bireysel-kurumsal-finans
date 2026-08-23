## Özet

<!-- Ne değişti ve NEDEN? Bir cümlelik özet + gerekiyorsa kısa bağlam. -->

Closes #

## Yapılan değişiklikler

<!-- Maddeler halinde; her maddede "ne" değil "neden bu şekilde" de olsun. -->

-

## Kararlar ve alternatifler

<!-- Bir tasarım/güvenlik kararı verildiyse: seçilen yaklaşım, reddedilen alternatif ve gerekçesi.
     Bir risk bilinçli olarak kabul edildiyse burada ve README'de yazılı olmalı. -->

## Nasıl test edildi

<!-- Hangi suite'ler çalıştırıldı, hangi yeni testler eklendi, neyi kanıtlıyorlar.
     Çalıştırılamayan bir doğrulama varsa nedeniyle birlikte yaz. -->

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test:integration`
- [ ] `npm run test:security`
- [ ] `npm run test:e2e`
- [ ] `npm run build` (şema/route değiştiyse)

## Kontrol listesi

- [ ] Sadece issue'nun kapsamı değişti; ilgisiz dosya/refactor diff'te yok
- [ ] `docs/security-invariants.md`'deki invariant'ların hiçbiri ihlal edilmedi
- [ ] Yeni/değişen endpoint için "Yeni endpoint güvenlik kontrol listesi" işletildi
- [ ] Tenant-scoped sorgular `tenantScoped()` + trusted `context.tenant.id` kullanıyor
- [ ] Yetkilendirme backend'de zorlanıyor (`requireUser()` / `requirePermission()`)
- [ ] `GET`/`HEAD` handler'ları yan etkisiz
- [ ] Hata yanıtları iç durum/enumeration bilgisi sızdırmıyor
- [ ] Davranış değişikliği için test eklendi/güncellendi (mutlu yol + yetkisiz/sınır yolu)
- [ ] Finansal tutarlar `Decimal` (varsa)
- [ ] Yeni bağımlılık eklenmedi (eklendiyse gerekçesi yukarıda)
- [ ] `.env.example` güncellendi (yeni değişken varsa, placeholder değerle)
- [ ] `README.md` / `docs/` güncellendi (yeni karar veya desen varsa)

## Bilinen sınırlar / kapsam dışı

<!-- Kalan risk, sonraki issue'ya bırakılanlar. -->
