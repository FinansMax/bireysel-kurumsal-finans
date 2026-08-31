import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { getCurrentUser } from "@/lib/auth/current-user";

export const metadata: Metadata = {
  title: "FinansMax — Finansınızı tek bir yerden yönetin",
  description:
    "Gelirlerinizi, giderlerinizi, hesaplarınızı ve ekibinizi tek bir çalışma alanından takip edin.",
};

/**
 * Public açılış sayfası.
 *
 * NEDEN `(app)` DIŞINDA: bu dosya root layout'un altındadır, `src/app/(app)/` altında değil.
 * Uygulama kabuğu (header + "Ana menü" navigasyonu) yalnızca o route group'un layout'undadır,
 * dolayısıyla burada HİÇ render edilmez — ayrıca bir "kabuğu gizle" koşuluna gerek yoktur.
 * Aynı ayrım `/login`, `/signup`, `/forgot-password`, `/reset-password` için de geçerlidir.
 *
 * OTURUM OKUNUR AMA YÖNLENDİRME YAPILMAZ: `getCurrentUser()` kullanılır, `requirePageUser()`
 * DEĞİL. İkincisi oturum yoksa `/login`'e yönlendirir; bu sayfanın işi ise tam tersidir —
 * oturumsuz ziyaretçiye ürünü anlatmak. Oturum varsa yalnızca header'daki eylem değişir
 * ("Panele Git"); kullanıcı zorla panele ATILMAZ, çünkü giriş yapmış birinin ana sayfayı
 * (ör. bir paylaşılan linkten) görmek istemesi meşrudur.
 *
 * BU SAYFA DİNAMİKTİR (oturum cookie'si okuduğu için) ama oturumsuz ziyaretçide DB'ye
 * gitmez: cookie yoksa Auth.js JWT'yi hiç çözmez, dolayısıyla `callbacks.jwt` içindeki
 * session-revocation sorgusu da çalışmaz. Maliyet yalnızca giriş yapmış ziyaretçidedir.
 */
export default async function LandingPage() {
  const user = await getCurrentUser();
  const isAuthenticated = user !== null;

  return (
    <div className="flex flex-1 flex-col bg-white dark:bg-zinc-950">
      <LandingHeader isAuthenticated={isAuthenticated} />

      <main className="flex-1">
        <Hero isAuthenticated={isAuthenticated} />
        <Features />
      </main>

      <LandingFooter />
    </div>
  );
}

function LandingHeader({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    // `sticky` + yarı saydam zemin: sayfa kaydıkça eylemler erişilebilir kalır. `backdrop-blur`
    // olmadan saydam bir header, altından kayan metni okunmaz hâle getirirdi.
    <header className="sticky top-0 z-10 border-b border-zinc-200/80 bg-white/80 backdrop-blur dark:border-zinc-800/80 dark:bg-zinc-950/80">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-50"
        >
          <BrandMark />
          FinansMax
        </Link>

        {/* Oturum durumuna göre eylemler. Bu bir güvenlik kontrolü DEĞİLDİR — yalnızca doğru
            eylemi göstermektir; `/dashboard` kendi `requirePageUser()` guard'ını çalıştırır. */}
        <nav aria-label="Hesap" className="flex items-center gap-2 sm:gap-3">
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

function Hero({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <section className="relative overflow-hidden border-b border-zinc-200 dark:border-zinc-800">
      {/* Dekoratif zemin: ürün ekran görüntüsü YERİNE bilinçli olarak soyut. Sahte bir arayüz
          görseli, henüz var olmayan ekranları varmış gibi gösterirdi. `aria-hidden` çünkü
          hiçbir bilgi taşımıyor. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(24,24,27,0.06),transparent_70%)] dark:bg-[radial-gradient(60%_50%_at_50%_0%,rgba(255,255,255,0.07),transparent_70%)]"
      />

      <div className="relative mx-auto w-full max-w-3xl px-6 py-20 text-center sm:py-28">
        <h1 className="text-4xl font-semibold tracking-tight text-balance text-zinc-950 sm:text-5xl dark:text-zinc-50">
          Finansınızı tek bir yerden yönetin.
        </h1>

        <p className="mx-auto mt-5 max-w-xl text-lg text-pretty text-zinc-600 dark:text-zinc-400">
          Gelirlerinizi, giderlerinizi, hesaplarınızı ve finansal süreçlerinizi daha kolay takip
          edin.
        </p>

        <div className="mt-9 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          {isAuthenticated ? (
            <PrimaryLink href="/dashboard" size="lg">
              Panele Git
            </PrimaryLink>
          ) : (
            <>
              {/* Ana CTA mevcut signup akışına gider; auth route adları DEĞİŞTİRİLMEDİ. */}
              <PrimaryLink href="/signup" size="lg">
                Ücretsiz Başlayın
              </PrimaryLink>
              <SecondaryLink href="/login">Giriş Yap</SecondaryLink>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Özellikler — hepsi ÜRÜNDE GERÇEKTEN VAR OLAN ekranlara karşılık gelir.
 *
 * Her maddenin arkasında çalışan bir ekran ve API vardır; kasıtlı olarak DIŞARIDA bırakılanlar:
 * finansal özet/rapor ve grafikler (`/dashboard` henüz boş, Issue #62/#63), bildirimler,
 * içe/dışa aktarma, fatura ve borç/alacak takibi. Bunlar backlog'dadır ve burada anılmazlar —
 * bir açılış sayfasını doldurmak için verilmiş söz, ürünün kendisinden önce güveni tüketir.
 */
const FEATURES: ReadonlyArray<{ title: string; description: string; icon: ReactNode }> = [
  {
    title: "Gelir ve gider takibi",
    description:
      "Her hareketi hesabı, kategorisi ve tarihiyle kaydedin; tarih aralığı, hesap, kategori ve açıklamada arama ile filtreleyin.",
    icon: <IconArrows />,
  },
  {
    title: "Hesaplar ve bakiyeler",
    description:
      "Banka ve kasa hesaplarınızı tanımlayın. Bakiye, kaydettiğiniz her işlemle birlikte kuruş hassasiyetinde güncellenir.",
    icon: <IconWallet />,
  },
  {
    title: "Kategori yönetimi",
    description:
      "Gelir ve gider için ayrı kategoriler tanımlayın. Bir kategoriyi silmek, ona bağlı işlemleri silmez.",
    icon: <IconTag />,
  },
  {
    title: "Çoklu çalışma alanı",
    description:
      "Bireysel bütçenizi ve şirketinizi ayrı çalışma alanlarında tutun, aralarında tek tıkla geçin. Veriler alanlar arasında tamamen yalıtılmıştır.",
    icon: <IconLayers />,
  },
  {
    title: "Ekip ve roller",
    description:
      "Ekibinizi e-posta ile davet edin; her üyenin ne görebileceğini ve değiştirebileceğini rolü belirler.",
    icon: <IconUsers />,
  },
];

function Features() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
      <div className="max-w-2xl">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl dark:text-zinc-50">
          Günlük finans işleriniz için gereken kadarı.
        </h2>
        <p className="mt-3 text-pretty text-zinc-600 dark:text-zinc-400">
          Ürünün bugün sunduğu yetenekler — fazlası değil.
        </p>
      </div>

      {/* Kartlar AYRI AYRI çerçevelenir, aralarında boşlukla. Bitişik (`gap-px`) bir ızgara daha
          "premium" duruyordu ama özellik sayısı sütun sayısının katı olmadığında son satırda
          BOŞ BİR HÜCRE bırakıyor ve sayfa yarım kalmış gibi görünüyordu. Bu düzen, listeye
          özellik eklenip çıkarıldığında da bozulmaz. */}
      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <li
            key={feature.title}
            className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900/40"
          >
            <div className="flex size-9 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {feature.icon}
            </div>
            <h3 className="mt-4 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              {feature.title}
            </h3>
            <p className="mt-2 text-sm text-pretty text-zinc-600 dark:text-zinc-400">
              {feature.description}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LandingFooter() {
  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
        <span className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <BrandMark />
          FinansMax
        </span>

        <nav aria-label="Alt bağlantılar" className="flex items-center gap-5 text-sm">
          <QuietLink href="/login">Giriş Yap</QuietLink>
          <QuietLink href="/signup">Kayıt Ol</QuietLink>
        </nav>
      </div>
    </footer>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Sunum parçaları. `src/components/` altına TAŞINMADI: tek bir sayfa kullanıyor ve bu repo
 * kullanılmayan soyutlama getirmiyor (bkz. `auth-form.tsx`'in başındaki aynı not). İkinci bir
 * public sayfa geldiğinde ortak olanlar oraya taşınmalı.
 * ------------------------------------------------------------------------------------------ */

/** Marka işareti — harici bir ikon bağımlılığı eklemeden, inline SVG. */
function BrandMark() {
  return (
    <span
      aria-hidden="true"
      className="flex size-6 items-center justify-center rounded-md bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-4" strokeWidth="2.5">
        <path d="M6 18V9m6 9V6m6 12v-5" stroke="currentColor" strokeLinecap="round" />
      </svg>
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
  // Renkler `SubmitButton` ile aynı: aynı üründe iki farklı "birincil eylem" rengi olmamalı.
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center rounded-md bg-zinc-900 font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 ${
        size === "lg" ? "w-full px-5 py-2.5 text-sm sm:w-auto sm:text-base" : "px-3.5 py-2 text-sm"
      }`}
    >
      {children}
    </Link>
  );
}

function SecondaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-5 py-2.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-50 sm:w-auto sm:text-base dark:border-zinc-700 dark:bg-transparent dark:text-zinc-100 dark:hover:bg-zinc-900"
    >
      {children}
    </Link>
  );
}

function QuietLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md px-2 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50"
    >
      {children}
    </Link>
  );
}

/* İkonlar: inline SVG, `currentColor` ile renklenir — yeni bir bağımlılık eklenmedi
   (CLAUDE.md §4 "Ek kural"). */

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: "size-4.5",
  "aria-hidden": true,
};

function IconArrows() {
  return (
    <svg {...iconProps}>
      <path d="M7 17V7m0 0L4 10m3-3 3 3" />
      <path d="M17 7v10m0 0 3-3m-3 3-3-3" />
    </svg>
  );
}

function IconWallet() {
  return (
    <svg {...iconProps}>
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H18a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8.5Z" />
      <path d="M16.5 12h.5" />
    </svg>
  );
}

function IconTag() {
  return (
    <svg {...iconProps}>
      <path d="M11.5 3.5H19a1.5 1.5 0 0 1 1.5 1.5v7.5a2 2 0 0 1-.6 1.4l-6 6a2 2 0 0 1-2.8 0l-6.5-6.5a2 2 0 0 1 0-2.8l6-6a2 2 0 0 1 1.4-.6Z" />
      <path d="M16.5 8h.01" />
    </svg>
  );
}

function IconLayers() {
  return (
    <svg {...iconProps}>
      <path d="M12 3 3 7.5 12 12l9-4.5L12 3Z" />
      <path d="M3 12.5 12 17l9-4.5" />
      <path d="M3 17 12 21.5 21 17" />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg {...iconProps}>
      <path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1" />
      <circle cx="9.5" cy="7.5" r="3.5" />
      <path d="M17 11a3 3 0 1 0 0-6" />
      <path d="M21 19v-1a4 4 0 0 0-3-3.87" />
    </svg>
  );
}
