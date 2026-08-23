import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Login ve signup ekranlarının paylaştığı minimal sunum bileşenleri (Issue #36).
 *
 * Kasıtlı olarak küçük tutulmuştur: bir UI kütüphanesi veya design system DEĞİLDİR
 * (bkz. Issue #34 "Yeni ağır UI kütüphanesi zorunlu değil"). Yalnızca iki ekran arasında
 * birebir tekrar eden markup'ı toplar. Bu bileşenler saf sunumdur — state, fetch veya
 * yönlendirme içermez; o mantık sayfaların kendisindedir.
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
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-12 dark:bg-black">
      <div className="w-full max-w-sm">
        <div className="rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">{title}</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{description}</p>

          <div className="mt-6">{children}</div>
        </div>

        <p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">{footer}</p>
      </div>
    </main>
  );
}

export function TextField({
  id,
  label,
  type,
  autoComplete,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  type: "email" | "password";
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1.5">
      {/* `htmlFor`/`id` eşleşmesi: etikete tıklamak alanı odaklar ve ekran okuyucular alanı
          doğru isimlendirir. E2E testleri de alanları bu erişilebilir isimle bulur. */}
      <label htmlFor={id} className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        required
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-800"
      />
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
      className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
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
      className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
    >
      {children}
    </button>
  );
}

export function AuthLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100">
      {children}
    </Link>
  );
}
