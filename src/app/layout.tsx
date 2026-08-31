import type { Metadata } from "next";
import "./globals.css";

/**
 * Kök layout.
 *
 * WEBFONT YOKTUR — bilinçli (Issue #131). Proje `create-next-app` iskeletinden `next/font/google`
 * ile `Geist`/`Geist Mono` taşıyordu ve bu iki maliyeti ödüyordu:
 *
 * 1. **Build ağa çıkıyordu.** `next/font/google` fontu build sırasında Google'ın sunucularından
 *    indirir; erişimin kesildiği bir anda deploy hattı, uygulamada hiçbir şey değişmemişken
 *    kırılır. Bu bir kez gözlendi (bkz. issue).
 * 2. **Ziyaretçi iki woff2 indiriyordu ve hiçbiri render edilmiyordu.** Tarayıcıda ölçüldü:
 *    `<html>` Geist alıyordu ama `globals.css` `body`'ye `Arial` yazdığı ve görünen her şey
 *    `body` içinde olduğu için `h1`/`label`/`button` dâhil TÜMÜ Arial'la çiziliyordu. Font
 *    yalnızca `<html>`de "kullanıldığı" için indiriliyor, sıfır glif basıyordu.
 *
 * Yani ortada korunacak bir görünüm yoktu; fontu self-host etmek, kullanılmayan bir varlığı
 * repoya taşımak olurdu. Onun yerine açık bir sistem font yığını tanımlandı (`globals.css`) —
 * ekrandaki görünüm birebir korundu, iki indirme ve ağ bağımlılığı ortadan kalktı.
 *
 * Bir gün gerçekten marka fontu istenirse: `next/font/local` + repoya alınmış woff2 dosyaları
 * kullanılmalı ve `body`'deki yığın o değişkene çevrilmelidir. `next/font/google`a DÖNÜLMEMELİ —
 * build zamanı ağ bağımlılığı geri gelir.
 */

export const metadata: Metadata = {
  title: "Bireysel ve Kurumsal Finans",
  description: "Bireysel ve Kurumsal Finans SaaS Platformu",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
