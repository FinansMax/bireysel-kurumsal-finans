# Veri: nerede durur, ne kadar durur, kim erişir

> Issue **#185**. Geri dönüş prosedürü: `docs/runbook-restore.md`.
>
> Bu belge **KVKK'ya hazırlıktır**, KVKK uyumunun kendisi değildir. Bir aydınlatma metni, veri
> işleme envanteri ve hukuki dayanak analizi ayrıca gerekir ve bunlar bu issue'nun kapsamı
> dışındadır. Buradaki amaç, o çalışmanın dayanacağı **teknik gerçeği** yazılı hâle getirmektir:
> hangi veri fiziksel olarak nerede duruyor ve ne kadar süre kalıyor.

---

## 1. Verinin durduğu yerler

| Yer | Ne | Nasıl korunuyor |
| --- | --- | --- |
| **Neon PostgreSQL** (birincil) | Bütün uygulama verisi | Aktarımda TLS (`sslmode=require`), disk şifrelemesi sağlayıcıda |
| **Neon otomatik yedek + PITR** | Yukarıdakinin geçmiş hâlleri | Aynı proje, aynı bölge |
| **Nesne deposu (S3/R2)** | Haftalık taşınabilir `pg_dump` | **Şifrelenmiş** bucket, en az yetki ilkesiyle erişim |
| **Audit arşivi** | 12 aydan eski `AuditLog` kayıtları, JSONL | `AUDIT_ARCHIVE_DIR` (bkz. Issue #188) |
| **Hata izleme (Sentry)** | Hata olayları — **PII temizlenmiş** | `sendDefaultPii: false` + `beforeSend` temizliği (Issue #183) |
| **Uygulama logları** | JSON satırları — request-id, yol, süre | Platformun log deposu |

**Uygulama loglarında ve Sentry'de kişisel veri bulunmaz.** Bu bir temenni değil, kodla zorlanan
bir karardır: `src/lib/observability/sentry-scrub.ts` sorgu dizesini bütünüyle düşürür,
cookie/authorization/x-forwarded-for header'larını temizler ve olay gövdesini tarar. Gerekçesi
README "Sentry — hata izleme"de.

**Bölge.** Neon projesi ve nesne deposu **aynı bölgede** seçilir; hedef bölge Avrupa'dır. Bu bir
KVKK gereği değil, veriyi tek bir yargı alanında tutmanın sonraki analizi basitleştirmesindendir.

---

## 2. Saklama süreleri

| Veri | Süre | Neden bu süre |
| --- | --- | --- |
| Kullanıcı, tenant, üyelik | Hesap silinene kadar | Hizmetin kendisi |
| Finansal kayıtlar (hesap, işlem, borç/alacak) | Hesap silinene kadar | Kullanıcının kendi kaydı; muhasebe amaçlı geriye dönük erişim beklenir |
| **`AuditLog` (sıcak)** | **12 ay** | Issue #188 kararı — bkz. README |
| **`AuditLog` (arşiv)** | 12 aydan sonra JSONL dosyasında | Aynı |
| **Şifre sıfırlama token'ı** | `expiresAt` (1 saat), tek kullanımlık | Invariant #6 |
| **E-posta doğrulama token'ı** | `expiresAt` (24 saat), tek kullanımlık | Issue #190 |
| **Neon PITR** | Plan tarafından belirlenir; **en az 7 gün** hedef | RPO'yu dakikalar seviyesine indiren katman |
| **Haftalık taşınabilir döküm** | **8 hafta** (son 8 döküm) | Fark edilmesi haftalar süren bir bozulmanın öncesine dönebilmek |

**8 hafta neden:** bir veri bozulması her zaman aynı gün fark edilmez. Yalnızca son dökümü
tutmak, "bozulma zaten dökümün içinde" senaryosunda hiçbir işe yaramaz. Sekiz hafta, saklama
maliyeti ile geriye gidebilme arasındaki dengedir.

### Hesap silme

**Bugün uygulanmış bir "hesabımı sil" akışı YOKTUR.** Bu, bilinmesi gereken bir eksikliktir ve
KVKK açısından da kapatılması gerekir. Kapsamı bu issue'nun dışındadır; buraya yazılmasının
sebebi, saklama tablosunun "hesap silinene kadar" satırlarının bugün **süresiz** anlamına
gelmesidir.

**Silme, yedekleri geriye dönük temizlemez.** Bir kullanıcı silindiğinde veri, o tarihten
önceki dökümlerde ve PITR penceresinde kalmaya devam eder; en geç **8 hafta** içinde döküm
rotasyonuyla düşer. Bu, yedeği olan her sistem için geçerlidir ve silme akışı yazıldığında
kullanıcıya bu şekilde anlatılmalıdır.

---

## 3. Erişim

| Kim | Neye | Nasıl |
| --- | --- | --- |
| Uygulama (çalışma zamanı) | Yalnızca veritabanı | `DATABASE_POOL_URL` — platform secret yöneticisinde |
| Deploy pipeline | Veritabanı (migration) | `DATABASE_URL` (doğrudan) — pipeline secret'ı |
| Yedekleme işi | Veritabanı (okuma) + nesne deposu (yazma) | Ayrı, **yalnızca yazma** yetkili anahtar |
| Geri dönüş (insan) | Nesne deposu (okuma) | Ayrı anahtar; olay anında kullanılır |

**Yedekleme anahtarı yalnızca yazma yetkilidir.** Sunucusu ele geçirilen bir sistemde, o
anahtarla **yedekler okunamaz ve silinemez** — yalnızca yenisi yazılabilir. Fidye yazılımı
senaryosunda yedekleri koruyan tek şey budur.

**Hiçbir yedekleme credential'ı repository'de değildir** (invariant #5). `.env.example` yalnızca
placeholder içerir.

---

## 4. Bugün açık olanlar

Bu belge **hedef durumu** tarif eder. Aşağıdakiler hesap erişimi gerektirdiği için henüz
yapılmadı ve #185 bunlar tamamlanmadan kapatılmamalıdır:

- [ ] Neon projesinde otomatik yedekleme + **PITR açılması** ve saklama süresinin bu belgeye yazılması.
- [ ] Nesne deposu (S3/R2) bucket'ının oluşturulması, şifrelemenin açılması, **yalnızca yazma**
      yetkili anahtarın üretilmesi.
- [ ] Haftalık döküm işinin zamanlanması ve **son üç dökümün varlığının doğrulanması**.
- [ ] Geri dönüş provasının **Neon'a karşı** tekrarlanması (lokal prova yapıldı; bkz.
      `docs/runbook-restore.md` § 7).
- [ ] "Hesabımı sil" akışı (ayrı issue).
