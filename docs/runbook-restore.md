# Runbook: yedekten geri dönüş

> **Bu belge bir prosedürdür, bir açıklama değil.** Olay anında yukarıdan aşağıya okunup
> uygulanacak şekilde yazıldı. Karar gerektiren yerler açıkça işaretlendi.
>
> İlgili issue: **#185**. Yedekleme hedefleri ve verinin nerede durduğu: `docs/data-retention.md`.

---

## 0. Hedefler (bu sayılar prosedürü bağlar)

| | Değer | Anlamı |
| --- | --- | --- |
| **RPO** | **24 saat** | En kötü durumda **24 saate kadar** veri kaybını göze alıyoruz. |
| **RTO** | **4 saat** | Olayın başlangıcından hizmetin geri gelmesine kadar **4 saat**. |

Bu iki sayı keyfi değil, **tutarlı bir çift**: haftalık taşınabilir döküm tek başına 7 günlük
RPO demek olurdu — kabul edilemez. Bu yüzden sağlayıcının **point-in-time recovery**'si (PITR)
birincil yedektir ve RPO'yu dakikalar seviyesine indirir; **24 saat**, PITR'ın da kullanılamadığı
senaryoda (hesap kilitlenmesi, sağlayıcı kaybı) günlük dökümle karşılanan **tavan**dır.

RTO 4 saat, aşağıdaki ölçülmüş sürelere göre **çok geniş** görünür ve öyle olması kasıtlıdır:
ölçülen süre yalnızca `pg_restore` süresidir. Gerçek olayda buna kararın verilmesi, doğru
yedeğin seçilmesi, DNS/deployment geçişi ve doğrulama eklenir.

---

## 1. Önce dur: hangi olaydasın?

Yanlış prosedür, olayı büyütür. Üç durum vardır ve **çözümleri farklıdır**:

| Durum | Belirti | Git |
| --- | --- | --- |
| **A. Veri bozulması / yanlış silme** | Veritabanı ayakta, veri yanlış | § 3 (PITR) |
| **B. Veritabanı erişilemez** | Bağlantı yok, sağlayıcı olayı | § 4 (sağlayıcı yedeği) |
| **C. Sağlayıcı kaybı** | Hesap kilitli, bölge kayıp, sağlayıcı değişiyor | § 5 (taşınabilir döküm) |

**Her durumda ilk adım aynıdır:** yazma trafiğini durdur. Bozulmuş bir veritabanına yazmaya
devam etmek, geri dönülecek noktayı her saniye daha da uzağa iter.

```bash
# Uygulamayi bakim moduna al / instance sayisini sifira indir.
# Platforma ozeldir; deployment karari kesinlestiginde buraya komut yazilacak (#185 kalan is).
```

---

## 2. Yedekler nerede

| Katman | Ne | Nerede | Saklama |
| --- | --- | --- | --- |
| **Birincil** | Neon otomatik yedek + **PITR** | Neon projesi, uygulama ile aynı bölge | Plan tarafından belirlenir; **en az 7 gün** hedefleniyor |
| **İkincil** | Haftalık **taşınabilir** `pg_dump -Fc` | Sağlayıcıdan **bağımsız** nesne deposu (S3/R2) | 8 hafta |

**İkinci katman neden var:** sağlayıcının kendi yedeği, hesabın kilitlenmesi ya da sağlayıcının
kendisinin kaybedilmesi durumunda **erişilemez**. Snapshot formatı da sağlayıcıya özeldir ve
başka bir Postgres'e taşınamaz. `pg_dump -Fc` çıktısı herhangi bir Postgres 16'ya
`pg_restore` ile geri yüklenir — bu, sağlayıcı kilidini kıran tek şeydir (#95'ten devralınan
kısıt).

---

## 3. Durum A — veri bozulması (PITR)

Neon'un point-in-time recovery'si, veritabanını **geçmişte bir ana** geri sarar.

1. **Bozulmanın başladığı anı belirle.** `AuditLog` tablosu bunun için birincil kaynaktır:
   ```sql
   select "createdAt", action, "actorUserId", "tenantId"
   from "AuditLog"
   where "createdAt" > now() - interval '24 hours'
   order by "createdAt" desc
   limit 200;
   ```
2. **Üretimin üzerine geri sarma.** Neon konsolunda o andan **hemen öncesine** yeni bir branch
   oluştur. Böylece bozuk hâl incelenebilir durumda kalır.
3. Yeni branch'in bağlantı adresini al ve **§ 6'daki doğrulamayı** uygula.
4. Doğrulama geçerse uygulamanın `DATABASE_URL` / `DATABASE_POOL_URL` değişkenlerini yeni
   branch'e çevir ve trafiği aç.

> **Dikkat:** geri sarma, o andan sonraki **meşru** yazmaları da geri alır. § 1'de yazmayı
> durdurmanın sebebi budur; ne kadar geç durdurulursa o kadar çok meşru kayıt kaybedilir.

---

## 4. Durum B — veritabanı erişilemez

1. Sağlayıcının durum sayfasını kontrol et; olay sağlayıcıdaysa **bekleme** çoğu zaman geri
   dönüşten hızlıdır ve veri kaybettirmez. RTO'nun 4 saat olmasının sebeplerinden biri budur.
2. Kesinti RTO'yu tehdit ediyorsa (≈2 saat) § 5'e geç: taşınabilir döküm her koşulda çalışır.

---

## 5. Durum C — taşınabilir dökümden geri dönüş

**Bu prosedür ölçüldü** (§ 7). Sağlayıcıdan bağımsızdır: hedef, herhangi bir Postgres 16 olabilir.

### 5.1 Dökümü indir ve doğrula

```bash
# En son dokumu indir (S3/R2 - kimlik bilgileri platform secret yoneticisinde)
aws s3 cp "s3://$BACKUP_BUCKET/pg/$(date +%Y)/latest.dump" ./restore.dump

# BOYUT KONTROLU: sifir ya da beklenenden cok kucuk bir dosya, bozuk bir yedektir.
ls -l restore.dump

# ICERIK KONTROLU: dokum okunabiliyor mu? (Veriyi yazmaz, yalnizca listeler.)
pg_restore --list restore.dump | head -30
```

`pg_restore --list` hata verirse **bu dökümü kullanma**, bir öncekine geç.

### 5.2 Boş bir hedef veritabanı oluştur

```bash
psql "$TARGET_ADMIN_URL" -c 'create database finans_restore;'
```

> **Var olan veritabanının üzerine geri yükleme.** Kısmi bir geri yükleme, ne eski ne yeni olan
> bir hâl üretir ve bunu teşhis etmek asıl olaydan zordur. Daima boş bir veritabanına yükle,
> doğrula, sonra geçiş yap.

### 5.3 Geri yükle

```bash
pg_restore \
  --dbname="$TARGET_URL" \
  --no-owner --no-privileges \
  restore.dump
```

- `--no-owner --no-privileges`: döküm kaynak ortamın rol adlarını taşır; hedefte o roller
  yoksa geri yükleme rol hatalarıyla dolar. Bunlar veriyle ilgisizdir ve gerçek hataları gizler.
- **Uyarılar normaldir**, hatalar değildir. Çıktıda `ERROR` geçerse § 5.1'e dön.

> **Geri yükleme, doğrudan bağlantı üzerinden yapılır — pooler üzerinden DEĞİL.** Sebebi
> migration'larla aynı (bkz. `docs/deployment.md` § 3): pooler transaction modundadır ve
> oturum düzeyi durumu desteklemez.

### 5.4 Doğrula → § 6

---

## 6. Doğrulama (her geri dönüşten sonra, istisnasız)

Geri yükleme "hatasız bitti" demek, **veri doğru** demek değildir.

```bash
# 1) Sema tam mi? 13 tablo bekleniyor (Prisma modelleri + _prisma_migrations).
psql "$TARGET_URL" -tAc \
  "select count(*) from information_schema.tables where table_schema='public';"

# 2) Migration durumu: uygulanmis migration sayisi repo ile ayni mi?
psql "$TARGET_URL" -tAc \
  "select count(*) from _prisma_migrations where finished_at is not null;"
ls prisma/migrations | grep -v migration_lock | wc -l   # iki sayi ESIT olmali

# 3) YARIM KALMIS migration var mi? SIFIR olmali.
psql "$TARGET_URL" -tAc \
  "select count(*) from _prisma_migrations where finished_at is null or rolled_back_at is not null;"

# 4) Son migration adi repo'daki son dizinle ayni mi?
psql "$TARGET_URL" -tAc \
  "select migration_name from _prisma_migrations order by finished_at desc nulls last limit 1;"

# 5) Kayit sayilari makul mu? (Sifir bir tablo, sessiz bir veri kaybidir.)
psql "$TARGET_URL" -tAc \
  'select ''User'', count(*) from "User"
   union all select ''Tenant'', count(*) from "Tenant"
   union all select ''Membership'', count(*) from "Membership"
   union all select ''Account'', count(*) from "Account"
   union all select ''Transaction'', count(*) from "Transaction"
   union all select ''AuditLog'', count(*) from "AuditLog";'
```

**Uygulama seviyesi doğrulama** (veri okunabiliyor mu, yalnızca duruyor mu değil):

```bash
DATABASE_URL="$TARGET_URL" npx prisma migrate status   # "Database schema is up to date"
DATABASE_URL="$TARGET_URL" npm run test:integration    # is kurallari gercek veriye karsi
```

> `npx prisma migrate deploy` **çalıştırma.** Döküm zaten uygulanmış migration'ları içerir;
> `migrate status` ile durumu **görmek** yeterlidir. `deploy`, tutarsız bir hâlde şemayı
> daha da bozabilir.

**Son kontrol — parasal bütünlük.** Bu ürün para tutuyor; kayıt sayısı doğru olup tutarlar
yanlışsa geri dönüş başarısızdır:

```sql
select "currency", sum(amount) from "Transaction" group by "currency";
```
Bu toplamlar olaydan önceki son bilinen değerlerle karşılaştırılır.

---

## 7. Prova — 2026-09-03'te GERÇEKTEN yapıldı

"Test edilmemiş bir yedek, yedek değildir." Prosedür varsayılmadı, **koşuldu**.

**Ortam:** PostgreSQL 16 (`postgres:16-alpine`, `docker-compose.yml`), 31 MB kaynak veritabanı,
2 624 949 baytlık `-Fc` döküm.

**Adımlar:** kaynak sayıldı → `pg_dump -Fc` → **boş** hedef veritabanı oluşturuldu →
`pg_restore --no-owner --no-privileges` → § 6 doğrulaması → hedef silindi.

| Adım | Süre |
| --- | --- |
| `pg_dump -Fc` | **518 ms** |
| `pg_restore` | **639 ms** |
| **Toplam** | **1 157 ms** |

**Doğrulama sonucu — GEÇTİ:**

| Kontrol | Kaynak | Hedef |
| --- | --- | --- |
| `public` şemasındaki tablo | — | **13** (öncesinde 0) |
| `User` | 2 722 | **2 722** |
| `Tenant` | 935 | **935** |
| `Membership` | 932 | **932** |
| `AuditLog` | 53 715 | **53 715** |
| `Account` | 9 | **9** |
| `Transaction` | 16 | **16** |
| Uygulanmış migration | 15 | **15** (repo'daki dizin sayısı da 15) |
| Yarım kalmış migration | 0 | **0** |
| Son migration | `20260902231409_add_email_verification_token` | **aynı** |

**Bu provanın kanıtladığı:** `pg_dump -Fc` → `pg_restore` yolu şemayı, veriyi **ve Prisma
migration durumunu** eksiksiz taşıyor; `--no-owner --no-privileges` ile farklı bir ortama
sorunsuz yükleniyor.

**Bu provanın KANITLAMADIĞI** (dürüst sınırlar):

- **Neon'a karşı koşulmadı** — hesap henüz bağlı değil. Lokal Postgres 16 kullanıldı. Neon da
  Postgres 16'dır ve `pg_dump`/`pg_restore` sağlayıcıdan bağımsızdır, ama **ölçülen bu değildir.**
- **31 MB, production ölçeği değil.** Süreler veri boyutuyla kabaca doğrusal artar; 30 GB'lık bir
  veritabanında dakikalar mertebesi beklenir. RTO'nun 4 saat olması bu belirsizliği karşılar.
- **Ağ üzerinden indirme ölçülmedi** — döküm ve geri yükleme aynı makinedeydi. Gerçek olayda
  S3/R2'den indirme süresi eklenir.
- **PITR provası yapılmadı** (§ 3) — Neon hesabı gerektirir.

---

## 8. Geri dönüşten sonra

1. **Kaybedilen aralığı yaz.** Hangi ana geri dönüldü, hangi zaman aralığındaki yazmalar
   kayboldu. Bu bilgi kullanıcı bildirimi için gereklidir.
2. **`AUTH_SECRET`'ı düşünme fırsatı.** Geri dönüş, oturumları geçersiz kılmaz — `credentialsChangedAt`
   ve `sessionsRevokedAt` alanları da geri sarılır. Olay bir güvenlik ihlaliyse `AUTH_SECRET`
   döndürülmeli, aksi hâlde **geri alınmış bir şifre değişikliği eski oturumu tekrar geçerli kılar.**
3. **Bu runbook'u güncelle.** Yanlış çıkan her adım, olay hafızadayken düzeltilir.
4. **Provayı takvimle.** Prova **altı ayda bir** ve **her büyük şema değişikliğinden sonra**
   tekrarlanır; sonucu bu bölüme eklenir.
