"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * "Tüm cihazlardan çıkış yap" düğmesi (Issue #186).
 *
 * MEVCUT ROUTE'A GERÇEK HTTP İSTEĞİ ATAR, Server Action DEĞİL — `module-toggle.tsx` ve auth
 * ekranlarındaki (#36) aynı gerekçe: Server Action, route seviyesindeki guard katmanını
 * (`requireUser` + rate limit) atlar ve korumaların tek kapıdan geçmesi kuralını zayıflatırdı.
 *
 * ONAY ZORUNLUDUR ve iki adımlıdır (`window.confirm()` DEĞİL — `module-toggle.tsx` ile aynı
 * duruş: tarayıcı diyaloğu stillenemez, ekran okuyucuda bağlam taşımaz). Buradaki işlem
 * kapatmadan da ağırdır: kullanıcı KENDİ oturumundan da düşer ve tekrar giriş yapmak zorunda
 * kalır. Onay metni bunu ÖNCEDEN söyler; sürpriz bir 401, kullanıcıya ürün hatası gibi görünür.
 *
 * BAŞARIDAN SONRA SADECE `router.refresh()` YETMEZ: bu istekten sonra elimizdeki session
 * cookie'si ARTIK GEÇERSİZDİR ve kullanıcı korumalı bir ekranda duruyordur; yerinde yenilemek
 * onu yarı bozuk bir sayfada bırakırdı. Bu yüzden `replace()` + `refresh()` birlikte kullanılır:
 * `replace()` (`push()` DEĞİL) geri tuşuyla artık erişilemeyen ekrana dönülmesini engeller,
 * `refresh()` ise istemci router cache'indeki authenticated RSC yüklerini atar — aksi halde
 * tarayıcı, oturumu kapatılmış bir kullanıcıya önbellekten eski ekranı gösterebilirdi.
 *
 * `window.location.assign()` REDDEDİLDİ: doğru sonucu verirdi ama Next.js'in
 * `no-location-assign-relative-destination` kuralını ihlal ediyor ve istemci router'ını
 * tamamen atlayarak uygulamanın navigasyon modelinden sapıyor.
 */
export function RevokeSessionsButton() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function messageForStatus(status: number): string {
    switch (status) {
      case 401:
        return "Oturumunuz zaten kapanmış. Lütfen tekrar giriş yapın.";
      case 429:
        // Sayaç/limit/IP YAZILMAZ (invariant #7) — yalnızca "sonra dene".
        return "Çok fazla deneme yapıldı. Lütfen bir süre sonra tekrar deneyin.";
      default:
        return "Oturumlar kapatılamadı. Lütfen daha sonra tekrar deneyin.";
    }
  }

  async function revoke() {
    setError(null);
    setPending(true);

    try {
      const response = await fetch("/api/auth/revoke-sessions", { method: "POST" });

      if (!response.ok) {
        setError(messageForStatus(response.status));
        setPending(false);
        return;
      }

      // `setPending(false)` YOK: sayfa birazdan zaten değişecek, düğmeyi tekrar aktif etmek
      // kullanıcıya ikinci kez basma fırsatı verirdi.
      router.replace("/login");
      router.refresh();
    } catch {
      setError(messageForStatus(0));
      setPending(false);
    }
  }

  if (confirming) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-pretty text-muted">
          Tüm cihazlardaki oturumlar kapanacak — <span className="font-medium text-strong">bu
          cihaz dahil</span>. İşlemden sonra tekrar giriş yapmanız gerekir. Verileriniz
          etkilenmez.
        </p>
        <div className="flex flex-wrap gap-2">
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
            onClick={revoke}
            disabled={pending}
            className="rounded-control bg-danger-600 px-3 py-1.5 text-sm font-medium text-white transition-colors duration-150 ease-out-soft hover:bg-danger-700 disabled:opacity-60"
          >
            {pending ? "Kapatılıyor…" : "Evet, tüm oturumları kapat"}
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
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-control border border-line px-3 py-1.5 text-sm font-medium text-body transition-colors duration-150 ease-out-soft hover:bg-surface-muted"
      >
        Tüm cihazlardan çıkış yap
      </button>
      {error ? (
        <p role="alert" className="text-sm text-pretty text-danger-600 dark:text-danger-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
