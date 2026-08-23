"use client";

import { useState, type FormEvent } from "react";

import { AuthCard, AuthLink, FormError, SubmitButton, TextField } from "@/components/auth-form";

/**
 * "Şifremi unuttum" ekranı (Issue #37).
 *
 * Login/signup ile AYNI gerekçeyle client component'tir: istek mevcut HTTP endpoint'ine
 * gider, böylece forgot-password rate limiti (IP başına 5/15dk, Issue #27) uygulanır.
 * Servis fonksiyonunu bir Server Action'dan doğrudan çağırmak o korumayı baypas ederdi
 * (bkz. `src/app/login/page.tsx` ve `integration/auth-ui-pattern.spec.ts`).
 */

/**
 * KRİTİK — user enumeration: Bu mesaj, e-posta kayıtlı OLSA DA OLMASA DA aynen gösterilir.
 * Backend zaten her iki durumda da aynı 200 yanıtını döner (bkz. README "Şifre sıfırlama");
 * arayüzün bunu "e-posta bulunamadı" gibi bir varyasyona çevirmesi, backend'de kapatılmış
 * olan sızıntıyı UI katmanında yeniden açardı. Bu yüzden başarı durumunda status'a göre
 * DALLANMA YAPILMAZ — tek mesaj vardır.
 */
const GENERIC_SUCCESS_MESSAGE =
  "Eğer bu e-posta adresine ait bir hesap varsa, şifre sıfırlama bağlantısı gönderildi. " +
  "Lütfen e-posta kutunuzu kontrol edin.";

const RATE_LIMITED_MESSAGE = "Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.";
const UNAVAILABLE_MESSAGE = "İstek gönderilemedi. Lütfen daha sonra tekrar deneyin.";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (response.status === 429) {
        setError(RATE_LIMITED_MESSAGE);
        return;
      }

      if (!response.ok) {
        // 400 (ör. boş e-posta) dahil diğer tüm hatalar. Burada da e-postanın kayıtlı olup
        // olmadığına dair bir bilgi verilmez.
        setError(UNAVAILABLE_MESSAGE);
        return;
      }

      setSent(true);
    } catch {
      setError(UNAVAILABLE_MESSAGE);
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard
      title="Şifremi unuttum"
      description="Hesabınıza ait e-posta adresini girin; size bir sıfırlama bağlantısı gönderelim."
      footer={
        <>
          Şifrenizi hatırladınız mı? <AuthLink href="/login">Giriş yapın</AuthLink>
        </>
      }
    >
      {sent ? (
        <p
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300"
        >
          {GENERIC_SUCCESS_MESSAGE}
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <TextField
            id="email"
            label="E-posta"
            type="email"
            autoComplete="email"
            value={email}
            onChange={setEmail}
            disabled={pending}
          />

          <FormError message={error} />

          <SubmitButton pending={pending}>
            {pending ? "Gönderiliyor…" : "Sıfırlama bağlantısı gönder"}
          </SubmitButton>
        </form>
      )}
    </AuthCard>
  );
}
