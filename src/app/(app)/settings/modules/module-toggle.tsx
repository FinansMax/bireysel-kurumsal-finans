"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Bir modülü açıp kapatan anahtar (Issue #153).
 *
 * MEVCUT ROUTE'A GERÇEK HTTP İSTEĞİ ATAR, Server Action DEĞİL — auth ekranlarındaki (#36) aynı
 * gerekçe: Server Action, route seviyesindeki guard katmanını (`requirePermission`) atlar ve
 * yetkilendirmenin tek kapıdan geçmesi kuralını (invariant #3) zayıflatırdı.
 *
 * KAPATMA ONAY İSTER, AÇMA İSTEMEZ. Asimetri bilinçli: açmak geri alınabilir ve bir şey
 * kaybettirmez; kapatmak ise bir ekibin çalıştığı yüzeyi ortadan kaldırır. Onay metni,
 * kullanıcının en çok korktuğu soruyu ÖNCEDEN yanıtlar — "verilerim silinir mi".
 *
 * ONAY İKİ ADIMLIDIR, `window.confirm()` DEĞİL (`delete-with-confirm.tsx` ile aynı duruş):
 * tarayıcı diyaloğu stillenemez, ekran okuyucuda bağlam taşımaz ve sonucu anlatacak yer
 * bırakmaz.
 *
 * HATA MESAJLARI TÜRKÇEDİR ve backend'in İngilizce iç metinleri kullanıcıya GÖSTERİLMEZ.
 * Bağımlılık hatasında (409) engelin ADI da yazılır; bunun için gereken etiketler prop olarak
 * SUNUCUDAN gelir — istemci katalogdan bilgi türetmez.
 */

export function ModuleToggle({
  tenantId,
  moduleKey,
  label,
  enabled,
  requires,
  requiredBy,
}: {
  tenantId: string;
  moduleKey: string;
  label: string;
  enabled: boolean;
  /** Bu modülün AÇILMASI için gereken modüllerin görünen adları. */
  requires: readonly string[];
  /** Bu modüle bağımlı olan modüllerin görünen adları (kapatmayı engelleyebilirler). */
  requiredBy: readonly string[];
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function messageForStatus(status: number): string {
    switch (status) {
      case 409:
        // Engelin ADINI yazmak, kullanıcıyı deneme-yanılmadan kurtarır.
        return enabled
          ? `Bu modülü kapatmak için önce şunları kapatın: ${requiredBy.join(", ")}.`
          : `Bu modülü açmak için önce şunları açın: ${requires.join(", ")}.`;
      case 403:
        return "Bu çalışma alanında modül yönetme yetkiniz yok.";
      case 503:
        // Geçici bir yazma çakışması (bkz. `runSerializable`); iş kuralı ihlali DEĞİL.
        return "Şu anda yoğunluk var. Birkaç saniye sonra tekrar deneyin.";
      default:
        return "Modül durumu değiştirilemedi. Lütfen daha sonra tekrar deneyin.";
    }
  }

  async function apply(next: boolean) {
    setError(null);
    setPending(true);

    try {
      const response = await fetch(`/api/tenants/${tenantId}/modules/${moduleKey}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });

      if (!response.ok) {
        setError(messageForStatus(response.status));
        return;
      }

      setConfirming(false);
      // Sayfa sunucuda render ediliyor; menü de layout'ta modül durumundan kuruluyor.
      // `refresh()` ikisini birden tazeler.
      router.refresh();
    } catch {
      setError(messageForStatus(0));
    } finally {
      setPending(false);
    }
  }

  if (confirming) {
    return (
      <div className="space-y-2 text-right">
        <p className="text-sm text-pretty text-muted">
          {/* Kullanıcının en çok korktuğu soruya ÖNCEDEN cevap. */}
          Modül kapatıldığında verileriniz silinmez; yalnızca erişim kapanır.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            className="rounded-control px-3 py-1.5 text-sm font-medium text-muted transition-colors duration-150 ease-out-soft hover:text-strong disabled:opacity-60"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={() => apply(false)}
            disabled={pending}
            className="rounded-control bg-danger-600 px-3 py-1.5 text-sm font-medium text-white transition-colors duration-150 ease-out-soft hover:bg-danger-700 disabled:opacity-60"
          >
            {pending ? "Kapatılıyor…" : `Evet, kapat`}
          </button>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-danger-600 dark:text-danger-300">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2 text-right">
      <button
        type="button"
        onClick={() => (enabled ? setConfirming(true) : apply(true))}
        disabled={pending}
        // Erişilebilir ad modülün adını içerir: sayfada çok sayıda "Aç"/"Kapat" düğmesi olur.
        aria-label={enabled ? `${label} modülünü kapat` : `${label} modülünü aç`}
        className={
          enabled
            ? "rounded-control border border-line px-3 py-1.5 text-sm font-medium text-body transition-colors duration-150 ease-out-soft hover:bg-surface-muted disabled:opacity-60"
            : "rounded-control bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors duration-150 ease-out-soft hover:bg-brand-700 disabled:opacity-60"
        }
      >
        {pending ? "Açılıyor…" : enabled ? "Kapat" : "Aç"}
      </button>

      {error ? (
        <p role="alert" className="text-sm text-pretty text-danger-600 dark:text-danger-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
