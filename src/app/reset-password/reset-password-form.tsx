"use client";

import { useState, type FormEvent } from "react";

import { AuthCard, AuthLink, FormError, SubmitButton, TextField } from "@/components/auth-form";

/**
 * Yeni şifre belirleme formu (Issue #37).
 *
 * Token, sayfanın SUNUCU bileşeninden prop olarak gelir (bkz. `./page.tsx`) — bu bileşen
 * URL'i kendisi okumaz. Login/signup ile aynı gerekçeyle client component'tir: istek mevcut
 * HTTP endpoint'ine gider, böylece reset-password rate limiti (Issue #27) uygulanır.
 */

/**
 * Backend, token'ın "bulunamadı" / "süresi dolmuş" / "zaten kullanılmış" durumlarını BİLİNÇLİ
 * olarak ayrıştırmaz — hepsi aynı genel 400'e düşer (bkz. README "Şifre sıfırlama"). Arayüz
 * de bu duruşu korur: tek bir mesaj gösterir, "bu token daha önce kullanılmış" gibi bir ayrım
 * yapmaz.
 */
const INVALID_TOKEN_MESSAGE =
  "Bu bağlantı geçersiz veya süresi dolmuş. Lütfen yeni bir sıfırlama bağlantısı isteyin.";

const WEAK_PASSWORD_MESSAGE = "Şifreniz en az 8 karakter olmalı.";
const RATE_LIMITED_MESSAGE = "Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.";
const UNAVAILABLE_MESSAGE = "Şifre değiştirilemedi. Lütfen daha sonra tekrar deneyin.";

const MIN_PASSWORD_LENGTH = 8;

export function ResetPasswordForm({ token }: { token: string | null }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      if (response.ok) {
        setDone(true);
        return;
      }

      if (response.status === 429) {
        setError(RATE_LIMITED_MESSAGE);
        return;
      }

      if (response.status === 400) {
        // Backend 400'ü hem geçersiz token hem zayıf şifre için kullanır ve gövdedeki metne
        // güvenmek istemiyoruz (İngilizce ve UI sözleşmesi değil). Şifre uzunluğu istemcide
        // de bilindiği için hangi mesajın gösterileceğine burada karar verilir.
        setError(
          password.length < MIN_PASSWORD_LENGTH ? WEAK_PASSWORD_MESSAGE : INVALID_TOKEN_MESSAGE,
        );
        return;
      }

      setError(UNAVAILABLE_MESSAGE);
    } catch {
      setError(UNAVAILABLE_MESSAGE);
    } finally {
      setPending(false);
    }
  }

  // URL'de token yoksa form hiç gösterilmez: sunucuya gereksiz (ve kesin başarısız) bir istek
  // atmak yerine kullanıcı doğrudan yeni bağlantı istemeye yönlendirilir.
  if (!token) {
    return (
      <AuthCard
        title="Şifre sıfırlama"
        description="Bağlantıda bir sorun var."
        footer={
          <>
            Yeni bağlantı için <AuthLink href="/forgot-password">şifremi unuttum</AuthLink>
          </>
        }
      >
        <FormError message={INVALID_TOKEN_MESSAGE} />
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard
        title="Şifreniz güncellendi"
        description="Yeni şifrenizle giriş yapabilirsiniz."
        footer={<AuthLink href="/login">Giriş sayfasına git</AuthLink>}
      >
        <p
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300"
        >
          Şifreniz başarıyla değiştirildi. Güvenliğiniz için eski oturumlarınız kapatıldı.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Yeni şifre belirle"
      description="Hesabınız için yeni bir şifre girin."
      footer={
        <>
          Vazgeçtiniz mi? <AuthLink href="/login">Giriş yapın</AuthLink>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <TextField
          id="password"
          label="Yeni şifre"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          disabled={pending}
        />

        <FormError message={error} />

        <SubmitButton pending={pending}>
          {pending ? "Kaydediliyor…" : "Şifreyi güncelle"}
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
