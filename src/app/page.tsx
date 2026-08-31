import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { ProductPreview } from "@/components/marketing/product-preview";
import { Badge } from "@/components/ui/badge";
import { BrandMark } from "@/components/ui/brand-mark";
import {
  IconArrowUpRight,
  IconPlus,
  IconSearch,
  IconShield,
  IconTag,
  IconTransactions,
  IconUsers,
  IconWallet,
  IconWorkspace,
} from "@/components/ui/icons";
import { getCurrentUser } from "@/lib/auth/current-user";

export const metadata: Metadata = {
  title: "FinansMax — Paranın kontrolü sende",
  description:
    "Gelirlerinizi, giderlerinizi ve hesaplarınızı tek bir çalışma alanından takip edin. Bireysel bütçe ve şirket finansı bir arada.",
};

/**
 * Public açılış sayfası.
 *
 * NEDEN `(app)` DIŞINDA: bu dosya root layout'un altındadır. Uygulama kabuğu (sidebar +
 * navigasyon) yalnızca `src/app/(app)/layout.tsx`'tedir, dolayısıyla burada HİÇ render edilmez —
 * ayrıca bir "kabuğu gizle" koşuluna gerek yoktur. Aynı ayrım `/login`, `/signup`,
 * `/forgot-password`, `/reset-password` için de geçerlidir.
 *
 * OTURUM OKUNUR AMA YÖNLENDİRME YAPILMAZ: `getCurrentUser()` kullanılır, `requirePageUser()`
 * DEĞİL. İkincisi oturum yoksa `/login`'e yönlendirir; bu sayfanın işi ise tam tersidir —
 * oturumsuz ziyaretçiye ürünü anlatmak. Oturum varsa yalnızca eylemler değişir ("Panele Git");
 * kullanıcı zorla panele ATILMAZ, çünkü giriş yapmış birinin ana sayfayı (ör. paylaşılan bir
 * linkten) görmek istemesi meşrudur.
 *
 * BU SAYFA DİNAMİKTİR (oturum cookie'si okuduğu için) ama oturumsuz ziyaretçide DB'ye gitmez:
 * cookie yoksa Auth.js JWT'yi hiç çözmez, dolayısıyla `callbacks.jwt` içindeki
 * session-revocation sorgusu da çalışmaz.
 *
 * BÖLÜM DÜZENİ BİLEREK TEKRARSIZ: hero (metin + ürün önizlemesi), numaralı akış, asimetrik
 * bento ızgarası, koyu güven paneli, kapanış çağrısı. Sayfa boyunca aynı "ikon + başlık +
 * paragraf" kutusunu tekrarlamak, ürünü tanıtmak yerine şablon hissi verirdi.
 */
export default async function LandingPage() {
  const user = await getCurrentUser();
  const isAuthenticated = user !== null;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-canvas">
      <LandingHeader isAuthenticated={isAuthenticated} />

      <main className="flex-1">
        <Hero isAuthenticated={isAuthenticated} />
        <Workflow />
        <Capabilities />
        <TrustPanel />
        <ClosingCta isAuthenticated={isAuthenticated} />
      </main>

      <LandingFooter />
    </div>
  );
}

/* ============================================================================================
 * Header
 * ========================================================================================= */

function LandingHeader({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    // `sticky` + yarı saydam zemin: sayfa kaydıkça eylemler erişilebilir kalır. `backdrop-blur`
    // olmadan saydam bir header, altından kayan metni okunmaz hâle getirirdi.
    <header className="sticky top-0 z-30 border-b border-line/80 bg-canvas/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-3.5">
        <Link href="/" className="flex items-center gap-2.5">
          <BrandMark />
          <span className="text-base font-semibold tracking-tight text-strong">FinansMax</span>
        </Link>

        {/* Oturum durumuna göre eylemler. Bu bir güvenlik kontrolü DEĞİLDİR — yalnızca doğru
            eylemi göstermektir; `/dashboard` kendi `requirePageUser()` guard'ını çalıştırır. */}
        <nav aria-label="Hesap" className="flex items-center gap-1.5 sm:gap-2">
          {isAuthenticated ? (
            <PrimaryLink href="/dashboard">Panele Git</PrimaryLink>
          ) : (
            <>
              <QuietLink href="/login">Giriş Yap</QuietLink>
              <PrimaryLink href="/signup">Kayıt Ol</PrimaryLink>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

/* ============================================================================================
 * Hero
 * ========================================================================================= */

function Hero({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <section className="relative overflow-hidden border-b border-line">
      <HeroBackdrop />

      <div className="relative mx-auto grid w-full max-w-6xl gap-14 px-6 py-16 sm:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-center lg:gap-12 lg:py-24">
        <div className="max-w-xl">
          {/* Üst etiket: sayfanın ilk saniyesinde "bu ne?" sorusunu cevaplar. */}
          <span className="inline-flex items-center gap-2 rounded-badge border border-line bg-surface px-2.5 py-1 text-xs font-medium text-muted shadow-subtle">
            <span className="size-1.5 rounded-full bg-mint-500" />
            Bireysel ve kurumsal finans, tek uygulamada
          </span>

          <h1 className="mt-5 text-4xl leading-[1.05] font-semibold tracking-tight text-balance text-strong sm:text-5xl lg:text-[3.5rem]">
            Paranın kontrolü{" "}
            {/* Vurgu TEK bir kelimede ve gradyanla: her yüzeye gradyan dağıtmak yerine tek
                stratejik nokta, marka rengini metnin içine taşımanın en ucuz yolu. */}
            <span className="bg-gradient-to-r from-brand-600 via-brand-500 to-mint-500 bg-clip-text text-transparent">
              sende
            </span>
            .
          </h1>

          <p className="mt-5 max-w-lg text-lg text-pretty text-muted">
            Gelir ve giderlerinizi hesap hesap kaydedin, kategorilere ayırın ve aradığınız
            hareketi saniyede bulun. Bireysel bütçeniz ve şirketiniz ayrı çalışma alanlarında,
            aynı yerde.
          </p>

          <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            {isAuthenticated ? (
              <PrimaryLink href="/dashboard" size="lg">
                Panele Git
              </PrimaryLink>
            ) : (
              <>
                {/* Ana CTA mevcut signup akışına gider; auth route adları DEĞİŞTİRİLMEDİ. */}
                <PrimaryLink href="/signup" size="lg">
                  Ücretsiz Başla
                </PrimaryLink>
                <SecondaryLink href="/login">Giriş Yap</SecondaryLink>
              </>
            )}
          </div>

          {/* Bu cümle bir vaat değil, olgu: üründe faturalandırma HİÇ yok, kayıt için e-posta
              ve şifre yeterli. */}
          <p className="mt-6 flex items-center gap-2 text-sm text-faint">
            <IconShield className="size-4 shrink-0 text-mint-600" />
            Kredi kartı istemiyoruz; e-posta ve şifre yeterli.
          </p>
        </div>

        <div className="lg:pl-4">
          <ProductPreview />
        </div>
      </div>
    </section>
  );
}

/**
 * Hero zemini: ince ızgara + iki renkli ışık lekesi.
 *
 * `aria-hidden` çünkü hiçbir bilgi taşımıyor. Işık lekeleri `blur-3xl` ile öyle yumuşak ki
 * renk olarak değil "ortam" olarak okunuyor — sayfayı mor-mavi bir gradyana boyamadan marka
 * rengini hissettirmenin yolu bu. Izgara `mask-image` ile yukarıdan aşağı söner; kenarda
 * kesilen bir ızgara, arka planı "bitmemiş" gösterirdi.
 */
function HeroBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--color-line)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-line)_1px,transparent_1px)] bg-[size:56px_56px] opacity-60 [mask-image:radial-gradient(75%_55%_at_50%_0%,black,transparent)]" />
      <div className="absolute -top-32 -left-24 size-96 rounded-full bg-brand-400/20 blur-3xl dark:bg-brand-500/15" />
      <div className="absolute -top-24 right-0 size-80 rounded-full bg-mint-400/20 blur-3xl dark:bg-mint-500/10" />
    </div>
  );
}

/* ============================================================================================
 * Akış — numaralı adımlar, kart değil
 * ========================================================================================= */

const STEPS: ReadonlyArray<{ title: string; description: string; icon: ReactNode }> = [
  {
    title: "Hesaplarını tanımla",
    description: "Banka ve kasa hesaplarını ekle; bakiye buradan itibaren kendi kendine işler.",
    icon: <IconWallet className="size-5" />,
  },
  {
    title: "Hareketleri kaydet",
    description: "Her geliri ve gideri hesabıyla, kategorisiyle ve tarihiyle yaz.",
    icon: <IconTransactions className="size-5" />,
  },
  {
    title: "Aradığını bul",
    description: "Tarih aralığı, hesap, kategori ve açıklamada arama ile listeyi daralt.",
    icon: <IconSearch className="size-5" />,
  },
];

function Workflow() {
  return (
    <section className="border-b border-line bg-surface">
      <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
        <SectionLabel>Nasıl çalışır</SectionLabel>
        <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-balance text-strong sm:text-3xl">
          Üç adımda kurulur, sonrası sadece kayıt tutmak.
        </h2>

        {/* Eşit üç kutu yerine NUMARALI AKIŞ: adımlar arasında bir SIRA olduğunu anlatan tek
            düzen. Eşit kartlar sırayı değil listeyi anlatırdı. */}
        <ol className="mt-12 grid gap-10 sm:grid-cols-3 sm:gap-6">
          {STEPS.map((step, index) => (
            <li key={step.title} className="relative">
              {/* Adımlar arası bağlantı çizgisi — yalnızca yan yana dizildiklerinde, ve son
                  adımdan sonra çizilmez. */}
              {index < STEPS.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="absolute top-5 left-16 hidden h-px w-[calc(100%-3.5rem)] bg-gradient-to-r from-line-strong to-transparent sm:block"
                />
              ) : null}

              <div className="flex items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-brand-600 text-white shadow-raised">
                  {step.icon}
                </span>
                <span className="font-mono text-xs text-faint">0{index + 1}</span>
              </div>

              <h3 className="mt-4 text-base font-semibold text-strong">{step.title}</h3>
              <p className="mt-1.5 text-sm text-pretty text-muted">{step.description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ============================================================================================
 * Yetenekler — asimetrik bento
 * ========================================================================================= */

/**
 * Bu bölümdeki her yetenek ÜRÜNDE GERÇEKTEN VARDIR ve çalışan bir ekrana karşılık gelir:
 * çoklu çalışma alanı (#40, #42), gelir/gider takibi (#54, #56, #135), kategoriler (#50),
 * ekip ve roller (#43).
 *
 * Kasıtlı olarak DIŞARIDA bırakılanlar: finansal özet/rapor ve grafikler (`/dashboard` henüz
 * boş — #62/#63), bildirimler, içe/dışa aktarma, fatura ve borç/alacak takibi. Bir açılış
 * sayfasını doldurmak için verilen söz, ürünün kendisinden önce güveni tüketir.
 */
function Capabilities() {
  return (
    <section className="border-b border-line">
      <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
        <SectionLabel>Neler yapabilirsin</SectionLabel>
        <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-balance text-strong sm:text-3xl">
          Günlük finans işleriniz için gereken kadarı.
        </h2>
        <p className="mt-3 max-w-xl text-pretty text-muted">
          Ürünün bugün gerçekten sunduğu yetenekler — fazlası değil.
        </p>

        {/* BENTO: kutular EŞİT DEĞİL. Ürünü ayıran yetenek (çoklu çalışma alanı) iki sütun
            genişliğinde; diğerleri etrafına yerleşiyor. Eşit ızgara "hepsi aynı derecede
            önemli" demek olurdu — ki değil. */}
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          <article className="rounded-panel border border-line bg-surface p-6 shadow-subtle transition-shadow duration-200 ease-out-soft hover:shadow-raised lg:col-span-2 lg:p-8">
            <div className="max-w-md">
              <span className="flex size-10 items-center justify-center rounded-control bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
                <IconWorkspace className="size-5" />
              </span>
              <h3 className="mt-4 text-lg font-semibold text-strong">Çoklu çalışma alanı</h3>
              <p className="mt-2 text-sm text-pretty text-muted">
                Bireysel bütçeniz ve şirketiniz ayrı çalışma alanlarında durur, aralarında tek
                tıkla geçersiniz. Veriler alanlar arasında sorgu seviyesinde yalıtılmıştır — biri
                diğerinin kaydını hiçbir yoldan göremez.
              </p>
            </div>

            {/* Dekoratif ama ANLAMLI: iki çalışma alanı çipi, aktif olan işaretli. */}
            <div aria-hidden="true" className="mt-6 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 rounded-control border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 dark:border-brand-800 dark:bg-brand-950 dark:text-brand-200">
                <span className="size-1.5 rounded-full bg-brand-500" />
                Acme A.Ş.
              </span>
              <span className="inline-flex items-center gap-2 rounded-control border border-line bg-surface-muted px-3 py-2 text-sm text-muted">
                Bireysel bütçe
              </span>
              <span className="inline-flex items-center gap-2 rounded-control border border-dashed border-line px-3 py-2 text-sm text-faint">
                <IconPlus className="size-4" />
                Yeni alan
              </span>
            </div>
          </article>

          <article className="rounded-panel border border-line bg-surface p-6 shadow-subtle transition-shadow duration-200 ease-out-soft hover:shadow-raised">
            <span className="flex size-10 items-center justify-center rounded-control bg-mint-50 text-mint-700 dark:bg-mint-950 dark:text-mint-300">
              <IconTransactions className="size-5" />
            </span>
            <h3 className="mt-4 text-base font-semibold text-strong">Gelir ve gider takibi</h3>
            <p className="mt-2 text-sm text-pretty text-muted">
              Her hareket hesabına ve kategorisine bağlanır; tutarlar kuruş hassasiyetini korur.
            </p>
            <div aria-hidden="true" className="mt-5 space-y-2">
              <PreviewLine label="Danışmanlık" amount="+24.000,00" tone="in" />
              <PreviewLine label="Mart kirası" amount="−8.500,00" tone="out" />
            </div>
          </article>

          <article className="rounded-panel border border-line bg-surface p-6 shadow-subtle transition-shadow duration-200 ease-out-soft hover:shadow-raised">
            <span className="flex size-10 items-center justify-center rounded-control bg-iris-100 text-iris-600 dark:bg-iris-600/20 dark:text-iris-300">
              <IconTag className="size-5" />
            </span>
            <h3 className="mt-4 text-base font-semibold text-strong">Kategori yönetimi</h3>
            <p className="mt-2 text-sm text-pretty text-muted">
              Gelir ve gider için ayrı kategoriler. Bir kategoriyi silmek, ona bağlı hareketleri
              silmez.
            </p>
            <div aria-hidden="true" className="mt-5 flex flex-wrap gap-1.5">
              <Badge tone="brand">Kira</Badge>
              <Badge tone="mint">Hizmet geliri</Badge>
              <Badge tone="iris">Market</Badge>
              <Badge tone="outline">Kategorisiz</Badge>
            </div>
          </article>

          <article className="rounded-panel border border-line bg-surface p-6 shadow-subtle transition-shadow duration-200 ease-out-soft hover:shadow-raised lg:col-span-2">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-sm">
                <span className="flex size-10 items-center justify-center rounded-control bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
                  <IconUsers className="size-5" />
                </span>
                <h3 className="mt-4 text-base font-semibold text-strong">Ekip ve roller</h3>
                <p className="mt-2 text-sm text-pretty text-muted">
                  Ekibinizi e-posta ile davet edin. Kimin ne görebileceğine ve
                  değiştirebileceğine rolü karar verir; yetki arayüzde gizlenmekle kalmaz,
                  sunucuda zorlanır.
                </p>
              </div>

              <div aria-hidden="true" className="grid shrink-0 gap-2 sm:w-56">
                <RoleLine name="Elif" role="OWNER" tone="brand" />
                <RoleLine name="Mert" role="ADMIN" tone="iris" />
                <RoleLine name="Deniz" role="MEMBER" tone="neutral" />
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

function PreviewLine({
  label,
  amount,
  tone,
}: {
  label: string;
  amount: string;
  tone: "in" | "out";
}) {
  return (
    <span className="flex items-center justify-between gap-3 rounded-control bg-surface-muted px-3 py-2">
      <span className="truncate text-xs text-body">{label}</span>
      <span
        className={`text-xs font-medium tabular-nums ${
          tone === "in" ? "text-mint-700 dark:text-mint-300" : "text-strong"
        }`}
      >
        {amount}
      </span>
    </span>
  );
}

function RoleLine({
  name,
  role,
  tone,
}: {
  name: string;
  role: string;
  tone: "brand" | "iris" | "neutral";
}) {
  const swatches = {
    brand: "bg-brand-100 dark:bg-brand-900",
    iris: "bg-iris-200 dark:bg-iris-600/30",
    neutral: "bg-surface-inset",
  } as const;

  return (
    <span className="flex items-center gap-2.5 rounded-control border border-line bg-surface px-3 py-2">
      <span className={`size-6 rounded-badge ${swatches[tone]}`} />
      <span className="text-sm text-body">{name}</span>
      <span className="ml-auto font-mono text-[0.7rem] tracking-wide text-faint">{role}</span>
    </span>
  );
}

/* ============================================================================================
 * Güven paneli — koyu yüzey
 * ========================================================================================= */

/**
 * GÜVENLİK BURADA BİR PAZARLAMA CÜMLESİ DEĞİL, ÜRÜNÜN GERÇEK BİR ÖZELLİĞİ.
 *
 * Dört maddenin hepsinin arkasında kod ve testi var (bkz. `docs/security-invariants.md`,
 * `security/*.spec.ts`). Bir finans uygulamasında bunu söylemek, "kolay kullanım" demekten
 * daha ayırt edicidir.
 *
 * Bölüm KOYU yüzeyde: sayfa boyunca açık zeminlerden sonra tek bir koyu blok ritmi kırar ve
 * marka renginin en güçlü göründüğü yer olur.
 */
const TRUST_POINTS: ReadonlyArray<{ title: string; description: string }> = [
  {
    title: "Çalışma alanları sorgu seviyesinde yalıtık",
    description:
      "Her sorgu aktif çalışma alanıyla kapsanır; istemciden gelen bir kimlik asla kaynak kabul edilmez.",
  },
  {
    title: "Yetki sunucuda zorlanır",
    description:
      "Rol matrisi backend'de tanımlıdır. Arayüzde bir düğmeyi gizlemek koruma sayılmaz.",
  },
  {
    title: "Şifre değişince oturumlar düşer",
    description:
      "Kritik bir credential değişikliğinden önce üretilmiş oturumlar sonraki istekte geçersizleşir.",
  },
  {
    title: "Tutarlar kuruşu kaybetmez",
    description:
      "Para hiçbir katmanda kayan noktaya çevrilmez; veritabanından arayüze kadar tam duyarlıkla taşınır.",
  },
];

function TrustPanel() {
  return (
    <section className="border-b border-line bg-shell">
      <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] lg:gap-16">
          <div>
            <span className="inline-flex items-center gap-2 rounded-badge border border-shell-line bg-shell-raised px-2.5 py-1 text-xs font-medium text-shell-muted">
              <IconShield className="size-3.5 text-mint-400" />
              Güvenlik
            </span>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight text-balance text-shell-text sm:text-3xl">
              Finansal veri, sonradan eklenecek bir özellik gibi korunmaz.
            </h2>
            <p className="mt-4 max-w-md text-pretty text-shell-muted">
              Bu maddeler bir vaat listesi değil; her biri kodda zorlanır ve saldırgan bakışıyla
              yazılmış testlerle korunur.
            </p>
          </div>

          <ul className="grid gap-px overflow-hidden rounded-panel border border-shell-line bg-shell-line sm:grid-cols-2">
            {TRUST_POINTS.map((point) => (
              <li key={point.title} className="bg-shell-raised p-5">
                <h3 className="text-sm font-semibold text-shell-text">{point.title}</h3>
                <p className="mt-1.5 text-sm text-pretty text-shell-muted">{point.description}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ============================================================================================
 * Kapanış
 * ========================================================================================= */

function ClosingCta({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
      <div className="relative overflow-hidden rounded-showcase border border-line bg-surface px-6 py-12 text-center shadow-raised sm:px-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-24 mx-auto size-72 rounded-full bg-brand-400/20 blur-3xl dark:bg-brand-500/15"
        />

        <div className="relative">
          <h2 className="text-2xl font-semibold tracking-tight text-balance text-strong sm:text-3xl">
            Bugünkü hareketinizi kaydetmekle başlayın.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-pretty text-muted">
            Kurulum yok, kredi kartı yok. Bir çalışma alanı açın ve ilk hesabınızı tanımlayın.
          </p>

          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            {isAuthenticated ? (
              <PrimaryLink href="/dashboard" size="lg">
                Panele Git
              </PrimaryLink>
            ) : (
              <>
                <PrimaryLink href="/signup" size="lg">
                  Ücretsiz Başla
                </PrimaryLink>
                <SecondaryLink href="/login">Giriş Yap</SecondaryLink>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function LandingFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
        <span className="flex items-center gap-2.5">
          <BrandMark />
          <span className="text-sm font-semibold text-strong">FinansMax</span>
        </span>

        <nav aria-label="Alt bağlantılar" className="flex items-center gap-2">
          <QuietLink href="/login">Giriş Yap</QuietLink>
          <QuietLink href="/signup">Kayıt Ol</QuietLink>
        </nav>
      </div>
    </footer>
  );
}

/* ============================================================================================
 * Sunum parçaları
 *
 * `BrandMark` DIŞARI AÇILDI: auth ekranları da aynı markayı gösteriyor ve iki ayrı kopya,
 * logo değiştiğinde birinin geride kalması demekti. Geri kalanlar yalnızca bu sayfada
 * kullanılıyor ve burada duruyor — bu repo kullanılmayan soyutlama getirmiyor.
 * ========================================================================================= */

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs font-semibold tracking-[0.12em] text-brand-600 uppercase dark:text-brand-300">
      {children}
    </span>
  );
}

function PrimaryLink({
  href,
  children,
  size = "md",
}: {
  href: string;
  children: ReactNode;
  size?: "md" | "lg";
}) {
  return (
    <Link
      href={href}
      className={`group inline-flex items-center justify-center gap-1.5 rounded-control bg-brand-600 font-medium text-white shadow-raised transition-colors duration-150 ease-out-soft hover:bg-brand-700 ${
        size === "lg" ? "w-full px-5 py-3 text-sm sm:w-auto sm:text-base" : "px-3.5 py-2 text-sm"
      }`}
    >
      {children}
      {size === "lg" ? (
        // Okun hover'da kayması: "bir yere gidiyorsun" sinyali. Mesafe 2px — fark edilir ama
        // dikkati çalmaz.
        <IconArrowUpRight className="size-4 transition-transform duration-150 ease-out-soft group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      ) : null}
    </Link>
  );
}

function SecondaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex w-full items-center justify-center rounded-control border border-line-strong bg-surface px-5 py-3 text-sm font-medium text-strong transition-colors duration-150 ease-out-soft hover:bg-surface-muted sm:w-auto sm:text-base"
    >
      {children}
    </Link>
  );
}

function QuietLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-control px-2.5 py-1.5 text-sm font-medium text-muted transition-colors duration-150 ease-out-soft hover:bg-surface-muted hover:text-strong"
    >
      {children}
    </Link>
  );
}
