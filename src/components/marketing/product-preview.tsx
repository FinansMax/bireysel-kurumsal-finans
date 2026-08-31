import { Badge, CategoryBadge } from "@/components/ui/badge";
import {
  IconArrowDownRight,
  IconArrowUpRight,
  IconSearch,
  IconWallet,
  IconWorkspace,
} from "@/components/ui/icons";
import { DirectionChip, Money } from "@/components/ui/money";

/**
 * Açılış sayfasındaki ürün önizlemesi — katmanlı bir arayüz kompozisyonu.
 *
 * NEDEN EKRAN GÖRÜNTÜSÜ DEĞİL: bir PNG, tema değişince (koyu/açık) yanlış görünür, ölçeklenince
 * bulanıklaşır ve ürün değiştiğinde sessizce bayatlar. Bu kompozisyon gerçek bileşenlerle
 * (`Money`, `CategoryBadge`, `Badge`) kurulduğu için tasarım sistemi değiştiğinde birlikte
 * değişir ve iki temada da doğru görünür.
 *
 * BURADAKİ HER PARÇA GERÇEKTEN VAR OLAN BİR EKRANI TEMSİL EDER:
 *
 * - hesap kartı ve bakiye  → `/accounts` (#47), bakiye işlemlerden türetilir (#53)
 * - işlem satırları        → `/transactions` (#54): tarih, açıklama, kategori, yön, tutar
 * - kategori etiketleri    → `/categories` (#50)
 * - arama/filtre çubuğu    → işlem filtreleri (#56)
 * - çalışma alanı çipi     → tenant switcher (#40)
 * - rol çipi               → üyeler ve RBAC (#43)
 *
 * BİLEREK YOK: grafik/çizim, aylık toplam, "cash flow" gibi ÖZET değerler. Bunların hiçbiri
 * bugün üründe yok (`/dashboard` boş — #62/#63) ve bir önizlemede göstermek, var olmayan bir
 * ekranı vaat etmek olurdu. Kompozisyonun zenginliği düzenden geliyor, uydurma veriden değil.
 *
 * Rakamlar TEMSİLİDİR ve öyle görünür (yuvarlak, tipik değerler); gerçek bir kullanıcının
 * verisi ya da bir vaat değil, düzenin nasıl göründüğünü anlatan bir örnek.
 */

type PreviewRow = {
  date: string;
  description: string;
  category: string | null;
  amount: string;
  direction: "in" | "out";
};

/**
 * ÜÇ satır — dördüncüsü vardı ve KALDIRILDI: serbest katmandaki "Kategoriler" kartı pencerenin
 * sol alt köşesine biniyor, dört satırda o köşe bir VERİ satırıydı ve üzeri örtülüyordu.
 * Katmanlı bir kompozisyonda taşan kartların yalnızca boşluğu örtmesi gerekir.
 */
const PREVIEW_ROWS: readonly PreviewRow[] = [
  { date: "12 Mar", description: "Mart kirası", category: "Kira", amount: "8.500,00", direction: "out" },
  { date: "10 Mar", description: "Danışmanlık", category: "Hizmet geliri", amount: "24.000,00", direction: "in" },
  { date: "08 Mar", description: "Ofis internet", category: null, amount: "620,00", direction: "out" },
];

export function ProductPreview() {
  return (
    // `perspective` + hafif döndürme: önizlemeyi düz bir ekran görüntüsü yerine "masaya
    // konmuş bir arayüz" gibi gösterir. Açı KÜÇÜK tutuldu (1.5°) — büyük açılar metni
    // okunmaz hâle getirir ve "Dribbble konsepti" hissi verir.
    <div className="[perspective:1600px]">
      <div className="relative [transform:rotateX(2deg)_rotateY(-1.5deg)]">
        {/*
         * ARKA KATMAN — derinlik buradan gelir.
         *
         * İkinci bir serbest kart denendi ve KALDIRILDI: pencerenin dışına taşan her kart,
         * konumlandırıldığı her yerde bir veri satırını (tutar, tarih ya da kategori)
         * örtüyordu. Katmanlı görünmek için veriyi gizlemek kötü bir takas. Bunun yerine
         * pencerenin arkasına kaydırılmış, renkli ve saydam bir yüzey konuyor: derinlik aynı,
         * hiçbir şey örtülmüyor.
         */}
        <div
          aria-hidden="true"
          className="absolute inset-x-6 -bottom-4 top-8 rounded-showcase bg-gradient-to-br from-brand-200/70 via-iris-200/50 to-mint-200/50 blur-[2px] dark:from-brand-800/40 dark:via-iris-600/20 dark:to-mint-900/30"
        />

        {/* Ana pencere */}
        <div className="relative overflow-hidden rounded-showcase border border-line bg-surface shadow-float">
          {/* Üst çubuk: çalışma alanı + rol. Uygulamanın gerçek kabuğundaki bilgiyi yansıtır.
              İkisi SOLA toplandı — sağ üst köşe serbest katmandaki karta bırakıldı; orada bir
              badge dururken üzerine kart binmesi, bilgiyi gizlemek olurdu. */}
          <div className="flex items-center gap-2.5 border-b border-line bg-surface-muted px-4 py-3">
            <IconWorkspace className="size-4 text-brand-600" />
            <span className="text-xs font-medium text-strong">Acme A.Ş.</span>
            <Badge tone="brand">OWNER</Badge>
          </div>

          <div className="space-y-4 p-4">
            {/* Hesap kartları — iki hesap, iki para birimi. Bakiyeler TOPLANMAZ: farklı para
                birimlerini toplamak anlamsız olurdu ve ürün de toplamıyor. */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-card border border-line bg-surface p-3.5">
                <div className="flex items-center gap-2">
                  <IconWallet className="size-4 text-brand-600" />
                  <span className="text-xs text-muted">Ana Kasa</span>
                </div>
                <div className="mt-2">
                  <Money value="48.920,00" currency="TRY" size="lg" />
                </div>
              </div>

              <div className="rounded-card border border-line bg-surface p-3.5">
                <div className="flex items-center gap-2">
                  <IconWallet className="size-4 text-mint-600" />
                  <span className="text-xs text-muted">Vadesiz Hesap</span>
                </div>
                <div className="mt-2">
                  <Money value="12.480,75" currency="TRY" size="lg" />
                </div>
              </div>
            </div>

            {/* Arama/filtre çubuğu — işlem ekranındaki gerçek filtrelerin temsili. */}
            <div className="flex items-center gap-2 rounded-control border border-line bg-surface-muted px-3 py-2">
              <IconSearch className="size-4 text-faint" />
              <span className="text-xs text-faint">Açıklamada ara…</span>
              <span className="ml-auto flex items-center gap-1.5">
                <Badge tone="outline">Mart</Badge>
                <Badge tone="outline">Ana Kasa</Badge>
              </span>
            </div>

            {/* İşlem listesi */}
            <ul className="divide-y divide-line">
              {PREVIEW_ROWS.map((row) => (
                <li key={row.description} className="flex items-center gap-3 py-2.5">
                  <DirectionChip direction={row.direction}>
                    {row.direction === "in" ? (
                      <IconArrowUpRight className="size-4" />
                    ) : (
                      <IconArrowDownRight className="size-4" />
                    )}
                  </DirectionChip>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-strong">
                      {row.description}
                    </span>
                    <span className="mt-0.5 flex items-center gap-2">
                      <span className="text-xs text-faint">{row.date}</span>
                      <CategoryBadge name={row.category} />
                    </span>
                  </span>

                  <Money value={row.amount} direction={row.direction} />
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/*
         * SERBEST KATMAN — pencerenin dışına taşan iki küçük kart.
         *
         * Derinliği bunlar kurar: tek bir dikdörtgen "resim" yerine üst üste binmiş yüzeyler.
         * `hidden lg:block` çünkü küçük ekranda taşan öğeler ya kırpılır ya da yatay kaydırma
         * üretir; mobilde önizleme sade ve okunur kalmalı.
         */}
        <div
          aria-hidden="true"
          className="absolute -top-5 -right-6 hidden animate-drift rounded-card border border-line bg-surface p-3 shadow-raised lg:block"
        >
          {/* Ekip ve roller — `/members` ekranının temsili. Buraya bir "aylık toplam" kartı
              koymak cazipti ama üründe böyle bir özet YOK; var olmayan bir ekranı vaat etmek
              yerine gerçekten çalışan bir yeteneği göstermek daha değerli. */}
          <span className="text-[0.65rem] tracking-wide text-muted uppercase">Ekip</span>
          <div className="mt-2 space-y-1.5">
            <span className="flex items-center gap-2">
              <span className="size-6 rounded-badge bg-brand-100 dark:bg-brand-900" />
              <span className="text-xs text-body">Elif</span>
              <Badge tone="brand">ADMIN</Badge>
            </span>
            <span className="flex items-center gap-2">
              <span className="size-6 rounded-badge bg-iris-200 dark:bg-iris-600/30" />
              <span className="text-xs text-body">Mert</span>
              <Badge tone="outline">MEMBER</Badge>
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}
