"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { FIELD_CLASS, FormError, LABEL_CLASS, SubmitButton, TextField } from "@/components/auth-form";

/**
 * Tenant ayarları formu (Issue #86).
 *
 * MEVCUT ROUTE'A GERÇEK HTTP İSTEĞİ ATAR, Server Action DEĞİL — `module-toggle.tsx` ile aynı
 * gerekçe: Server Action, route seviyesindeki `requirePermission()` guard katmanını atlar ve
 * yetkilendirmenin tek kapıdan geçmesi kuralını (invariant #3) zayıflatırdı.
 */

function messageForStatus(status: number): string {
  switch (status) {
    case 400:
      return "Bilgileri kontrol edin: ad 2-100 karakter, para birimi 3 harf (TRY).";
    case 403:
      return "Bu çalışma alanında ayarları değiştirme yetkiniz yok.";
    case 404:
      return "Bu çalışma alanı artık mevcut değil. Sayfayı yenileyin.";
    default:
      return "Ayarlar kaydedilemedi. Lütfen daha sonra tekrar deneyin.";
  }
}

export function TenantSettingsForm({
  tenantId,
  name: initialName,
  defaultCurrency: initialDefaultCurrency,
}: {
  tenantId: string;
  name: string;
  defaultCurrency: string;
}) {
  const router = useRouter();

  const [name, setName] = useState(initialName);
  const [defaultCurrency, setDefaultCurrency] = useState(initialDefaultCurrency);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setPending(true);

    try {
      const response = await fetch(`/api/tenants/${tenantId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, defaultCurrency }),
      });

      if (!response.ok) {
        setError(messageForStatus(response.status));
        return;
      }

      setSaved(true);
      // Tenant adı sidebar'daki tenant seçicide de görünür; `refresh()` sunucu bileşenlerini
      // (kabuk dahil) tazeler.
      router.refresh();
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
      // `saved` alan değiştikçe geçersiz kılınır — kullanıcı bir alanı değiştirdikten sonra
      // eski bir başarı mesajının ekranda asılı kalması yanıltıcı olurdu.
      onChange={() => setSaved(false)}
    >
      <TextField
        id="tenant-name"
        label="Ad"
        type="text"
        autoComplete="off"
        value={name}
        onChange={setName}
        disabled={pending}
      />

      <div className="space-y-1.5">
        <label htmlFor="tenant-default-currency" className={LABEL_CLASS}>
          Varsayılan para birimi
        </label>
        <input
          id="tenant-default-currency"
          type="text"
          autoComplete="off"
          value={defaultCurrency}
          onChange={(event) => setDefaultCurrency(event.target.value)}
          disabled={pending}
          className={FIELD_CLASS}
        />
        <p className="text-xs text-muted">
          ISO 4217 kodu, ör. TRY, USD, EUR. Yeni hesap oluştururken önerilen değerdir; mevcut
          hesapların kendi para birimini DEĞİŞTİRMEZ.
        </p>
      </div>

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
