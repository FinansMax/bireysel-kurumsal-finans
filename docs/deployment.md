# Deployment

Bu dosya, uygulamanın **güvenli çalışması için deployment tarafında sağlanması gereken**
koşulları anlatır. Kod tarafındaki karşılıkları `docs/security-invariants.md`'de; buradakiler
kodun tek başına zorlayamadığı, altyapıya ait gerekliliklerdir.

> Bu doküman Issue #182 ile açıldı ve şimdilik yalnızca proxy zorunluluğunu kapsıyor. Deployment
> ortam değişkenleri ve secret yönetiminin tamamı #90'ın konusudur; #91 ve #184 ile birlikte
> burası genişleyecek.

---

## 1. Uygulama doğrudan internete açılmaz

**Kural:** FinansMax, önünde `x-forwarded-for` header'ını **kendisi set eden** bir reverse
proxy / platform olmadan internete açılmaz.

**Neden:** Rate limiting (`src/lib/rate-limit/`) istemcileri IP'ye göre ayırır ve IP'yi
`x-forwarded-for` header'ından okur. Uygulama doğrudan açılırsa bu header'ı **istemcinin
kendisi** yazar. Saldırgan her istekte farklı bir değer göndererek her seferinde yeni bir
sayaç kutusuna düşer ve rate limit **tamamen etkisiz** kalır: brute-force şifre denemesi,
hesap enumeration'ı ve pahalı endpoint'lerin sömürülmesi hep birden mümkün hale gelir.

Aynı varsayım `authConfig.trustHost: true` için de geçerlidir (bkz. `src/lib/auth/config.ts`).

**Kabul edilebilir platformlar:** Vercel, Cloudflare (proxy modu açık), AWS ALB/CloudFront,
Google Cloud Load Balancer, önünde nginx/Caddy bulunan bir VPS.

### nginx örneği

Kritik nokta: `$proxy_add_x_forwarded_for` **istemcinin gönderdiği değeri korur ve sonuna
ekler** — yani istemci `x-forwarded-for: 1.2.3.4` gönderirse header `1.2.3.4, <gerçek-ip>`
olur ve uygulama ilk segmenti (yani saldırganın uydurduğu değeri) okur. Bu yüzden burada
`$remote_addr` kullanılır: header istemciden gelen ne varsa **ezilir**.

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-Proto $scheme;

    # DİKKAT: $proxy_add_x_forwarded_for DEĞİL. Bu satır, istemcinin gönderdiği
    # X-Forwarded-For değerini korumak yerine ÜZERİNE YAZAR (Issue #182).
    proxy_set_header X-Forwarded-For   $remote_addr;
}
```

Ayrıca uygulamanın portu (3000) dışarıdan erişilebilir olmamalıdır; yalnızca proxy'nin
ulaşabildiği bir arayüze (`127.0.0.1`) bağlanmalıdır. Aksi halde saldırgan proxy'yi atlayıp
doğrudan uygulamaya bağlanabilir ve yukarıdaki koruma anlamsızlaşır.

### Cloudflare kullanılıyorsa

Cloudflare `CF-Connecting-IP` yazar ve `X-Forwarded-For`'a kendi segmentini **ekler**. Origin'e
yalnızca Cloudflare'in ulaşabildiğinden emin olun (origin IP'sini firewall ile kısıtlayın veya
Authenticated Origin Pulls kullanın); aksi halde saldırgan origin'e doğrudan bağlanıp header'ı
serbestçe uydurabilir. Origin erişiminin kısıtlanması bu dokümanın kapsamında, header
imzalama/doğrulama ise #182'nin açıkça kapsam dışıdır.

---

## 2. `TRUSTED_PROXY` production'da açıkça yazılır

```bash
TRUSTED_PROXY=true    # önünde güvenilir bir proxy VAR (yukarıdaki kurulum yapıldı)
TRUSTED_PROXY=false   # proxy YOK
```

Production'da bu değişken **tanımsızsa uygulama bilerek hata verir**
(`src/lib/config/trusted-proxy.ts`). Sessiz bir varsayılan yoktur ve bu bilinçlidir:

- Varsayılan `true` olsaydı, proxy'siz bir deployment sessizce "korumalı" görünürdü — yani
  gerçekte hiç rate limit olmadığı halde her şey normal çalışıyor gibi dururdu.
- Varsayılan `false` olsaydı, proxy'li normal bir deployment tüm trafiği tek bir paylaşılan
  sayaca sıkıştırır ve gerçek kullanıcılar birbirinin limitini yerdi.

İkisi de **sessizce** yanlış olduğu için karar operatöre bırakılır ve yazılması zorunlu tutulur.
`"true"`/`"false"` dışındaki her değer (`1`, `yes`, `TRUE`) hata verir; gevşek ayrıştırma,
yazım hatası olan bir yapılandırmayı sessizce "güveniyoruz"a çevirirdi.

### `TRUSTED_PROXY=false` seçilirse ne olur

`x-forwarded-for` **hiç okunmaz** ve tüm istekler ortak `unknown` sayacını paylaşır. Next.js
16'da bir Route Handler'a bağlantının uzak adresi açılmadığı için (uygulama edge/middleware
kullanmıyor, `NextRequest.ip` bu sürümde yok) istemcileri ayırmanın başka bir yolu yoktur.

Sonuç **kısıtlayıcıdır**: tüm kullanıcılar aynı sayacı tükettiği için meşru trafik de 429
alabilir. Bu, sahtelenebilir bir header'a güvenmeye tercih edilmiştir (fail-closed). Yani
`false`, "tek kullanıcılık bir kurulum" veya "geçici" senaryolar dışında doğru cevap değildir;
doğru cevap proxy'yi kurmaktır.

---

## 3. Veritabanı: iki adres, ve migration'ın hangisini kullanacağı

Sağlayıcı **Neon**. Neon iki endpoint verir ve bunlar birbirinin yerine geçmez.

| Değişken | Adres | Kim kullanır |
| --- | --- | --- |
| `DATABASE_URL` | **Doğrudan** (`ep-xxx.<bolge>.aws.neon.tech`) | `prisma migrate`, `prisma generate` |
| `DATABASE_POOL_URL` | **Havuzlanmış** (`ep-xxx-pooler.<bolge>.aws.neon.tech`) | Uygulama çalışma zamanı |

### Migration'ı pooler üzerinden çalıştırmayın

Neon'un pooler'ı PgBouncer'ın **transaction modunda** çalışır: prepared statement ve oturum
düzeyi durum yoktur. Prisma Migrate bir **advisory lock** alır ve DDL'i tek oturumda yürütür.
Pooler üzerinden bu bozulur; migration **yarıda kalıp** şemayı tutarsız bırakabilir.

Deploy pipeline'ında migration adımı bu yüzden **açıkça doğrudan adresi** kullanmalıdır:

```bash
# Migration adımı - DOGRUDAN adres
DATABASE_URL="postgresql://user:pass@ep-xxx.eu-central-1.aws.neon.tech/db?sslmode=require" \
  npx prisma migrate deploy

# Uygulama adımı - her iki degisken de tanimli
#   DATABASE_URL      -> dogrudan  (Prisma sema kaynagi)
#   DATABASE_POOL_URL -> havuzlanmis (calisma zamani)
npm run start
```

`prisma/schema.prisma` daima `DATABASE_URL`'i okur; havuzlanmış adres şemaya hiç girmez.
Gerekçe ve reddedilen `directUrl` alternatifi: `src/lib/config/database.ts` ve README
"Veritabanı bağlantı yönetimi (Issue #187)".

### `connection_limit`

`DATABASE_POOL_URL`'de `connection_limit` belirtilmemişse uygulama başına **5** uygulanır
(`src/lib/config/database.ts`). Adrese `?connection_limit=N` yazarsanız o değer ezilmez.
Instance sayısı arttıkça bu değer Neon planının bağlantı kotasına göre gözden geçirilmelidir.

### `DATABASE_POOL_URL` tanımlamazsanız

Uygulama `DATABASE_URL`'e düşer ve doğrudan bağlanır. Tek instance'lı küçük bir kurulumda
çalışır; çok instance'lı/serverless bir kurulumda `too many connections` alırsınız.

---

## 4. Kontrol listesi

Production'a çıkmadan önce:

- [ ] Uygulama yalnızca `127.0.0.1`'e bağlı; uygulama portu dışarıdan erişilemiyor.
- [ ] Önünde `X-Forwarded-For`'u `$remote_addr` ile **ezen** bir proxy var.
- [ ] `TRUSTED_PROXY` açıkça `true` veya `false` olarak yazıldı.
- [ ] `APP_BASE_URL` mutlak bir `https://` adresi olarak yazıldı (bkz. `src/lib/config/app-url.ts`).
- [ ] `AUTH_SECRET` production'a özel ve CI'daki disposable değerden farklı.
- [ ] `.env` repository'de değil; secret'lar platform secret yöneticisinde.
- [ ] `DATABASE_URL` **doğrudan** Neon endpoint'i (host'unda `-pooler` YOK).
- [ ] `DATABASE_POOL_URL` **havuzlanmış** endpoint (host'unda `-pooler` VAR).
- [ ] Deploy pipeline'ında `prisma migrate deploy` adımı `DATABASE_URL` ile koşuyor, pooler ile değil.

---

## Bilinen sınırlar

- **Rate limiter process-local'dir.** Çok instance'lı bir deployment'ta her instance kendi
  sayacını tutar; gerçek limit instance sayısıyla çarpılır. Paylaşılan store #181'in konusudur.
- **Port'lu `x-forwarded-for` değerleri** (`203.0.113.7:8080`) geçersiz sayılır ve `unknown`
  sayacına düşer. Standart `X-Forwarded-For` port taşımaz; port taşıyan bir proxy kullanılıyorsa
  bu bilinçli olarak ele alınmalıdır.
- **Proxy header'ının imzalanması/doğrulanması** (Cloudflare Authenticated Origin Pulls vb.)
  #182'nin kapsamı dışındadır; yukarıdaki origin kısıtlaması bunun yerine geçen operasyonel
  önlemdir.
