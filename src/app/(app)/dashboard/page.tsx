import type { Metadata } from "next";

import { requirePageUser } from "@/lib/auth/page-guard";

export const metadata: Metadata = {
  title: "Genel Bakış",
};

/**
 * Korumalı alanın giriş sayfası (Issue #39).
 *
 * İÇERİK KASITLI OLARAK BOŞTUR: özet kartları ve grafikler Epic 7'nin (Issue #62/#63) işidir.
 * Bu sayfanın görevi, kabuğun ve guard'ın çalıştığını gösteren gerçek bir korumalı rota
 * sağlamaktır.
 *
 * `requirePageUser()` layout'ta zaten çağrıldığı hâlde BURADA DA çağrılır: layout'lar istemci
 * tarafı gezinmelerde yeniden render edilmediği ve alt segmentlerin render'ını engelleyemediği
 * için layout kontrolü tek başına yeterli değildir (bkz. `src/lib/auth/page-guard.ts`).
 * Aynı istekte ikinci bir DB sorgusuna yol açmaz — sonuç `cache()` ile paylaşılır.
 */
export default async function DashboardPage() {
  const user = await requirePageUser();

  return (
    <section className="space-y-2">
      <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Genel Bakış</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Hoş geldiniz, {user.email}. Finansal özet ekranları sonraki sürümlerde burada
        görünecek.
      </p>
    </section>
  );
}
