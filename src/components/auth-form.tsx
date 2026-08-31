import Link from "next/link";
import type { ReactNode } from "react";

import { BrandMark } from "@/components/ui/brand-mark";
import { IconShield, IconTag, IconTransactions, IconWallet } from "@/components/ui/icons";

/**
 * Login, signup ve şifre sıfırlama ekranlarının paylaştığı sunum bileşenleri (Issue #36).
 *
 * Kasıtlı olarak küçük tutulmuştur: bir UI kütüphanesi veya design system DEĞİLDİR
 * (bkz. Issue #34 "Yeni ağır UI kütüphanesi zorunlu değil"). Yalnızca ekranlar arasında birebir
 * tekrar eden markup'ı toplar. Bu bileşenler saf sunumdur — state, fetch veya yönlendirme
 * içermez; o mantık sayfaların kendisindedir.
 *
 * KAPSAM NOTU (Issue #42): `TextField`/`FormError`/`SubmitButton` kabuk içindeki formlarda da
 * (ör. tenant oluşturma, hesap/kategori/işlem formları) kullanılıyor; `AuthCard`/`AuthLink` ise
 * yalnızca public auth ekranlarına aittir. Dosya adı bilinçli olarak DEĞİŞTİRİLMEDİ.
 */

/**
 * Auth ekranlarının iki kolonlu düzeni.
 *
 * NEDEN SPLIT: beyaz bir zeminde ortada duran bir form, ürünle hiçbir bağ kurmaz — kullanıcı
 * açılış sayfasından gelir ve aynı markanın devamı olduğunu görmelidir. Sol kolon marka
 * dünyasını (koyu yüzey, ürünün gerçek yetenekleri) taşır; sağ kolon YALNIZCA formdur.
 *
 * MOBİLDE SOL KOLON HİÇ RENDER EDİLMEZ (`hidden lg:flex`), gizlenmiş ama DOM'da duran bir
 * dekorasyon değil: küçük ekranda tek iş formu doldurmaktır ve kaydırılacak bir tanıtım
 * paneli o işin önüne geçerdi. Kullanılabilirlik görselliğin önünde.
 */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-1 bg-canvas">
      <AuthBrandPanel />

      <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          {/* Mobilde marka yalnızca burada görünür — sol panel yok. */}
          <Link href="/" className="mb-8 inline-flex items-center gap-2.5 lg:hidden">
            <BrandMark />
            <span className="text-base font-semibold tracking-tight text-strong">FinansMax</span>
          </Link>

          <div className="rounded-panel border border-line bg-surface p-6 shadow-raised sm:p-8">
            <h1 className="text-xl font-semibold tracking-tight text-strong">{title}</h1>
            <p className="mt-1.5 text-sm text-pretty text-muted">{description}</p>

            <div className="mt-6">{children}</div>
          </div>

          <p className="mt-6 text-center text-sm text-muted">{footer}</p>
        </div>
      </div>
    </main>
  );
}

/**
 * Sol marka paneli.
 *
 * İçerideki maddeler ÜRÜNDE GERÇEKTEN VAR OLAN yeteneklerdir — auth ekranı, henüz hesabı
 * olmayan birinin ürünle ikinci teması; burada verilen yanlış bir söz, açılış sayfasındakinden
 * daha pahalıya patlar.
 */
function AuthBrandPanel() {
  return (
    <aside className="relative hidden w-[46%] max-w-xl flex-col justify-between overflow-hidden bg-shell p-10 lg:flex xl:p-12">
      {/* Dekoratif ışık lekeleri — açılış sayfasının hero zeminiyle aynı dil. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 -left-16 size-80 rounded-full bg-brand-500/25 blur-3xl" />
        <div className="absolute right-0 bottom-0 size-72 rounded-full bg-mint-500/15 blur-3xl" />
      </div>

      <Link href="/" className="relative flex items-center gap-2.5">
        <BrandMark className="size-8" />
        <span className="text-base font-semibold tracking-tight text-shell-text">FinansMax</span>
      </Link>

      <div className="relative">
        <p className="text-2xl leading-snug font-semibold tracking-tight text-balance text-shell-text">
          Gelirinizi ve giderinizi tek bir yerden takip edin.
        </p>

        <ul className="mt-8 space-y-4">
          {[
            { icon: <IconWallet className="size-4.5" />, text: "Banka ve kasa hesapları, kuruşu kaybetmeyen bakiyeler" },
            { icon: <IconTransactions className="size-4.5" />, text: "Gelir ve gider hareketleri, tarih ve hesap bazlı arama" },
            { icon: <IconTag className="size-4.5" />, text: "Gelir ve gider için ayrı kategoriler" },
            { icon: <IconShield className="size-4.5" />, text: "Çalışma alanları birbirinden tamamen yalıtık" },
          ].map((item) => (
            <li key={item.text} className="flex items-start gap-3">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-control bg-shell-raised text-brand-300">
                {item.icon}
              </span>
              <span className="text-sm text-pretty text-shell-muted">{item.text}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="relative text-xs text-shell-muted/80">
        Bireysel bütçeniz ve şirketiniz, ayrı çalışma alanlarında.
      </p>
    </aside>
  );
}

/**
 * Form alanlarının PAYLAŞILAN sınıfı.
 *
 * Dışa açılması bilinçli: bu uygulamada seçici (`select`) alanlar da var — hesap türü,
 * kategori türü, işlemin hesabı — ve onlar `TextField` bileşenini kullanamaz. Sınıf dizisi
 * her formda elle tekrarlandığında kaçınılmaz olarak ayrışıyordu: bir ekranda kenarlık başka
 * tonda, diğerinde odak rengi hiç yok. Tek sabit, girdi ile seçicinin AYNI görünmesini
 * garanti eder.
 */
export const FIELD_CLASS =
  "w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-strong transition-colors duration-150 ease-out-soft outline-none placeholder:text-faint focus:border-brand-500 disabled:opacity-60";

/** Alan etiketlerinin paylaşılan sınıfı — aynı gerekçe. */
export const LABEL_CLASS = "block text-sm font-medium text-strong";

export function TextField({
  id,
  label,
  type,
  autoComplete,
  value,
  onChange,
  disabled,
  required = true,
  hint,
}: {
  id: string;
  label: string;
  type: "email" | "password" | "text";
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  /** Varsayılan `true` — auth ekranlarındaki tüm alanlar zorunludur (davranış değişmedi). */
  required?: boolean;
  /** Alanın altında gösterilen açıklama (ör. "boş bırakılırsa isimden türetilir"). */
  hint?: string;
}) {
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className="space-y-1.5">
      {/* `htmlFor`/`id` eşleşmesi: etikete tıklamak alanı odaklar ve ekran okuyucular alanı
          doğru isimlendirir. E2E testleri de alanları bu erişilebilir isimle bulur. */}
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        required={required}
        // `aria-describedby`: açıklama metni ekran okuyucuda alanla BİRLİKTE okunur; yalnızca
        // görsel olarak alt satıra koymak bu bağı kurmazdı.
        aria-describedby={hintId}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        // Odak halkası global olarak `:focus-visible` ile veriliyor (bkz. globals.css); burada
        // yalnızca kenarlığın marka rengine dönmesi var. İkisini de yerelde tanımlamak,
        // bir bileşende unutulduğunda klavye kullanıcısının o alanı kaybetmesi demekti.
        className={FIELD_CLASS}
      />
      {hint && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * Hata kutusu. `role="alert"` sayesinde mesaj, ekran okuyucularda odak değişmeden duyurulur;
 * E2E testleri de hatayı bu rol üzerinden bulur (metne birebir bağımlı kalmadan).
 */
export function FormError({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <p
      role="alert"
      className="rounded-control border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:border-danger-900 dark:bg-danger-900/30 dark:text-danger-200"
    >
      {message}
    </p>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-control bg-brand-600 px-3 py-2.5 text-sm font-medium text-white shadow-raised transition-colors duration-150 ease-out-soft hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}

export function AuthLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="font-medium text-brand-600 underline-offset-4 hover:underline dark:text-brand-300"
    >
      {children}
    </Link>
  );
}
