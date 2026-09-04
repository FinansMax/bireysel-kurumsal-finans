import type { Metadata } from "next";

import { requirePageUser } from "@/lib/auth/page-guard";

import { CreateTenantForm } from "./create-tenant-form";

export const metadata: Metadata = {
  title: "Yeni Çalışma Alanı",
};

/**
 * Yeni çalışma alanı (tenant) oluşturma ekranı (Issue #42).
 *
 * Sayfa bir SUNUCU bileşenidir ve `requirePageUser()`'ı kendi çağırır — layout'taki kontrol
 * tek başına yeterli değildir (gerekçe: `src/lib/auth/page-guard.ts`). Formun kendisi
 * etkileşim gerektirdiği için ayrı bir client component'tir; aynı ayrım `/reset-password`
 * ekranında da kullanılır.
 */
export default async function NewTenantPage() {
  // Kullanıcının e-postası forma PROP olarak geçer: doğrulanmamış hesap 403 aldığında sunulan
  // "tekrar gönder" aksiyonu, mevcut `POST /api/auth/resend-verification` endpoint'ini çağırır
  // ve o endpoint gövdede `email` bekler (Issue #232). Oturumdaki kullanıcıya göre çalışan
  // ikinci bir endpoint AÇILMADI — gerekçesi `create-tenant-form.tsx`te.
  //
  // Sızıntı değildir: kullanıcının KENDİ adresi, kendi oturumunda, kabukta zaten görünür.
  const user = await requirePageUser();

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight text-strong sm:text-2xl">
          Yeni çalışma alanı
        </h1>
        <p className="max-w-prose text-sm text-pretty text-muted">
          Bireysel bütçeniz veya şirketiniz için ayrı bir çalışma alanı oluşturun. Oluşturan
          kişi o alanın sahibi (OWNER) olur.
        </p>
      </div>

      <CreateTenantForm userEmail={user.email} />
    </section>
  );
}
