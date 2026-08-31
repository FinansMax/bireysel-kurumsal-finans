/**
 * Marka işareti — yükselen üç çubuk.
 *
 * Harici bir logo dosyası ya da ikon kütüphanesi yok; inline SVG. Gerçek bir logo geldiğinde
 * dokunulacak TEK yer burasıdır.
 *
 * NEDEN AYRI DOSYA: açılış sayfası, auth ekranları ve uygulama sidebar'ı aynı işareti
 * gösteriyor. Bunu bir sayfa modülünden (`app/page.tsx`) dışa açmak cazipti ama bir SAYFAYI
 * import etmek, o sayfanın sunucuya özgü kodunu (oturum okuma) istemci bundle'ına taşırdı.
 */
export function BrandMark({ className = "size-7" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-control bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-subtle ${className}`}
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-[62%]" strokeWidth="2.5">
        <path d="M6 17.5v-4m6 4v-9m6 9v-6" stroke="currentColor" strokeLinecap="round" />
      </svg>
    </span>
  );
}
