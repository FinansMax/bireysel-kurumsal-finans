"use client";

import { useState, type FormEvent } from "react";

import { FormError, SubmitButton } from "@/components/auth-form";

/**
 * Bildirim tercihi formu (Issue #88).
 *
 * MEVCUT ROUTE'A GERÇEK HTTP İSTEĞİ ATAR, Server Action DEĞİL — `module-toggle.tsx` ile aynı
 * gerekçe: Server Action, route seviyesindeki `requireUser()` guard katmanını atlar ve
 * yetkilendirmenin tek kapıdan geçmesi kuralını (invariant #3) zayıflatırdı.
 *
 * `router.refresh()` BİLEREK YOK: bu tercih hiçbir sunucu bileşeninin (kabuk, sidebar) gösterim
 * kararını etkilemez — yalnızca bu sayfanın kendi durumu güncellenir.
 */

function messageForStatus(status: number): string {
  switch (status) {
    case 400:
      return "Geçersiz değer. Sayfayı yenileyip tekrar deneyin.";
    case 404:
      return "Hesabınız artık mevcut değil. Sayfayı yenileyin.";
    default:
      return "Tercih kaydedilemedi. Lütfen daha sonra tekrar deneyin.";
  }
}

export function NotificationSettingsForm({
  notificationsEnabled: initialNotificationsEnabled,
}: {
  notificationsEnabled: boolean;
}) {
  const [notificationsEnabled, setNotificationsEnabled] = useState(initialNotificationsEnabled);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setPending(true);

    try {
      const response = await fetch("/api/users/me/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationsEnabled }),
      });

      if (!response.ok) {
        setError(messageForStatus(response.status));
        return;
      }

      setSaved(true);
    } catch {
      setError(messageForStatus(0));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      className="space-y-4"
      onChange={() => setSaved(false)}
    >
      <label htmlFor="notifications-enabled" className="flex items-start gap-3">
        <input
          id="notifications-enabled"
          type="checkbox"
          checked={notificationsEnabled}
          onChange={(event) => setNotificationsEnabled(event.target.checked)}
          disabled={pending}
          className="mt-0.5 size-4 rounded border-line-strong text-brand-600 focus:ring-brand-500 disabled:opacity-60"
        />
        <span className="space-y-1">
          <span className="block text-sm font-medium text-strong">Bildirimleri etkinleştir</span>
          <span className="block text-xs text-muted">
            Kapatırsanız uygulama içi ve e-posta bildirimleri gönderilmez.
          </span>
        </span>
      </label>

      <FormError message={error} />
      {saved && !error ? (
        <p role="status" className="text-sm text-muted">
          Kaydedildi.
        </p>
      ) : null}

      <SubmitButton pending={pending}>{pending ? "Kaydediliyor…" : "Kaydet"}</SubmitButton>
    </form>
  );
}
