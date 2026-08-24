import { AppShell } from "@/components/app-shell";
import { requirePageUser } from "@/lib/auth/page-guard";

/**
 * Korumalı route group'un layout'u (Issue #39).
 *
 * `(app)` bir ROUTE GROUP'tur: parantezli klasör adı URL'e yansımaz, yalnızca kendi altındaki
 * sayfaların bu layout'u paylaşmasını sağlar. Böylece `/login`, `/signup` gibi public ekranlar
 * (root layout'un altında kalır) kabuğu HİÇ almaz; yeni bir korumalı ekran eklemek için tek
 * gereken dosyayı bu klasörün altına koymaktır.
 *
 * Buradaki `requirePageUser()` kabuğun ihtiyaç duyduğu kullanıcıyı okur ve oturum yoksa
 * `/login`'e yönlendirir; ancak bu TEK kontrol değildir — aynı guard her korumalı sayfada da
 * çağrılır (gerekçesi: `src/lib/auth/page-guard.ts`).
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requirePageUser();

  return <AppShell userEmail={user.email}>{children}</AppShell>;
}
