import { VerifyEmailPanel } from "./verify-email-panel";

/**
 * E-posta doğrulama sayfası (Issue #190).
 *
 * `/reset-password` ile AYNI desen ve aynı gerekçelerle sunucu bileşenidir: token URL'den
 * okunur, `useSearchParams()` yerine `searchParams` çözülür (aksi halde sayfa bir
 * `<Suspense>` sınırı gerektirirdi). Next.js 16'da `searchParams` bir `Promise`'tir.
 *
 * Token'ın prop olarak client'a geçmesi ek bir sızıntı DEĞİLDİR: değer zaten kullanıcının
 * adres çubuğundadır ve `Referrer-Policy: strict-origin-when-cross-origin` üçüncü taraflara
 * gitmesini engeller.
 */
export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  const { token } = await searchParams;

  // Tekrarlı parametre (`?token=a&token=b`) belirsizdir ve geçersiz kabul edilir.
  const rawToken = typeof token === "string" && token.length > 0 ? token : null;

  return <VerifyEmailPanel token={rawToken} />;
}
