import { ResetPasswordForm } from "./reset-password-form";

/**
 * Şifre sıfırlama sayfası (Issue #37).
 *
 * NEDEN SUNUCU BİLEŞENİ: Token URL'den (`?token=...`) okunur. Bunu bir client component'te
 * `useSearchParams()` ile yapmak, Next.js'te sayfanın bir `<Suspense>` sınırıyla sarılmasını
 * gerektirir (aksi halde prerender aşamasında uyarı/hata üretir). Sayfayı sunucu bileşeni
 * tutup `searchParams`'ı burada çözmek bu tuzağı tamamen ortadan kaldırır; form ise
 * etkileşim gerektirdiği için ayrı bir client component'tir.
 *
 * Next.js 16'da `searchParams` bir `Promise`'tir ve `await` edilmelidir (bkz.
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`).
 *
 * Token'ın prop olarak client'a geçmesi ek bir sızıntı DEĞİLDİR: değer zaten kullanıcının
 * adres çubuğundadır. `Referrer-Policy: strict-origin-when-cross-origin` (bkz. README
 * "Güvenlik Header'ları") token'ın Referer üzerinden üçüncü taraflara gitmesini engeller.
 */
export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const { token } = await searchParams;

  // `?token=a&token=b` gibi tekrarlı parametrelerde Next `string[]` verir; belirsiz bir
  // durumdur ve geçersiz kabul edilir.
  const rawToken = typeof token === "string" && token.length > 0 ? token : null;

  return <ResetPasswordForm token={rawToken} />;
}
