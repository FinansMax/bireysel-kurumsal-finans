"use client";

import { useState, type ChangeEvent } from "react";

/**
 * Kabuktaki aktif çalışma alanı (tenant) seçici (Issue #40).
 *
 * Seçenekler SUNUCUDA, oturum sahibinin membership'lerinden üretilir (bkz.
 * `src/app/(app)/layout.tsx` → `listTenantsForUser()`); bu bileşen kendi başına liste
 * ÇEKMEZ. Seçim ise mevcut `POST /api/tenants/active` endpoint'ine gider — orada kullanıcının
 * o tenant'ta gerçekten membership'i olduğu DB'den doğrulanır (üye değilse 403). Yani
 * "üyesi olmadığı tenant seçilemez" garantisi arayüzün listeyi kısıtlamasına DEĞİL, backend
 * kontrolüne dayanır; buradaki liste sadece kullanılabilirlik içindir.
 */

const SWITCH_FAILED_MESSAGE = "Çalışma alanı değiştirilemedi. Lütfen tekrar deneyin.";

export type SwitchableTenant = { id: string; name: string };

export function TenantSwitcher({
  tenants,
  activeTenantId,
}: {
  tenants: SwitchableTenant[];
  activeTenantId: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Hiç tenant yoksa seçici gösterilmez: boş bir açılır liste kullanıcıya hiçbir şey
  // söylemezdi. Tenant OLUŞTURMA arayüzü ayrı bir issue'dur (#42), bu yüzden burada
  // yalnızca durum bildirilir.
  if (tenants.length === 0) {
    return (
      <span className="block rounded-control border border-dashed border-shell-line px-3 py-2 text-sm text-shell-muted">Çalışma alanı yok</span>
    );
  }

  async function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    const tenantId = event.target.value;
    if (!tenantId || tenantId === activeTenantId) {
      return;
    }

    setError(null);
    setPending(true);

    try {
      const response = await fetch("/api/tenants/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });

      if (!response.ok) {
        // Backend'in hata metni (İngilizce, ör. "Forbidden") kullanıcıya olduğu gibi
        // gösterilmez; ayrıca 403 ile 404 ayrıştırılmaz — aradaki fark "bu tenant var ama
        // üyesi değilsin" bilgisini sızdırırdı (backend zaten ikisini aynı 403'e indiriyor).
        setError(SWITCH_FAILED_MESSAGE);
        // Seçim uygulanmadığı için kutu, sunucudan gelen gerçek duruma geri alınır.
        event.target.value = activeTenantId ?? "";
        setPending(false);
        return;
      }

      // NEDEN TAM SAYFA YÜKLEME, `router.refresh()` DEĞİL: `refresh()` istemci cache'ini
      // YALNIZCA mevcut route için temizler (bkz.
      // `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md`).
      // Aktif tenant değiştiğinde diğer route'ların cache'inde ESKİ tenant'ın verisi kalır ve
      // kullanıcı oraya geçtiğinde yanlış çalışma alanının verisini görürdü. Tam yükleme
      // cache'in tamamını atar; çok kiracılı bir üründe bu maliyet, yanlış veri göstermeye
      // yeğdir.
      window.location.reload();
    } catch {
      // Ağ hatası: seçim sunucuya ulaşmadı.
      setError(SWITCH_FAILED_MESSAGE);
      event.target.value = activeTenantId ?? "";
      setPending(false);
    }
  }

  return (
    <div className="space-y-1.5">
      {/* Etiket `sr-only` ile görsel olarak gizlenir ama DOM'da kalır: dar header'da yer
          kaplamadan, ekran okuyucular (ve E2E testleri) alanı gerçek bir isimle bulur.
          `aria-label` yerine gerçek bir `<label>` tercih edildi — `htmlFor`/`id` eşleşmesi
          etikete tıklamayı da çalıştırır. */}
      <label htmlFor="tenant-switcher" className="sr-only">
        Çalışma alanı
      </label>
      <select
        id="tenant-switcher"
        name="tenant-switcher"
        disabled={pending}
        defaultValue={activeTenantId ?? ""}
        onChange={handleChange}
        className="w-full rounded-control border border-shell-line bg-shell-raised px-3 py-2 text-sm font-medium text-shell-text transition-colors duration-150 ease-out-soft hover:border-brand-500/60 disabled:opacity-60"
      >
        {/* Aktif tenant yoksa seçilebilir bir placeholder gösterilir. Sunucunun sayfa
            render'ı sırasında "ilk tenant'ı otomatik aktif yap" YAPILAMAZ: bu bir GET
            isteğinde state değiştirmek (cookie yazmak) olurdu ve projenin
            "GET yan etkisizdir" invariant'ını (bkz. docs/security-invariants.md) ihlal
            ederdi. Seçimi kullanıcı yapar. */}
        {activeTenantId === null && (
          <option value="">Çalışma alanı seçin</option>
        )}
        {tenants.map((tenant) => (
          <option key={tenant.id} value={tenant.id}>
            {tenant.name}
          </option>
        ))}
      </select>

      {error && (
        <p role="alert" className="text-xs text-danger-300">
          {error}
        </p>
      )}
    </div>
  );
}
