"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { AuthCard, AuthLink, FormError, SubmitButton, TextField } from "@/components/auth-form";

/**
 * Kayıt ekranı (Issue #36).
 *
 * Mevcut `POST /api/auth/signup` endpoint'ine GERÇEK bir HTTP isteği atar (mock yok).
 * `registerUser()` bir Server Action'dan doğrudan çağrılMAZ: signup rate limiti (Issue #27)
 * route seviyesinde uygulanır, servis fonksiyonunda değil — servisi doğrudan çağırmak
 * otomatik hesap oluşturma korumasını baypas ederdi. Aynı gerekçe login ekranı için de
 * geçerlidir (bkz. `src/app/login/page.tsx`).
 *
 * Başarılı kayıt sonrası otomatik giriş YAPILMAZ; kullanıcı `/login`'e yönlendirilir
 * (Issue #36 kapsamı).
 */

/**
 * Backend hata metinleri (İngilizce, ör. "Password must be between 8 and 128 characters")
 * kullanıcıya OLDUĞU GİBİ gösterilmez: arayüz Türkçedir ve backend'in iç ifadeleri UI
 * sözleşmesi değildir. Bunun yerine status koduna göre eşlenir.
 *
 * `409`'un ayrı ve açık bir mesajı vardır — bu, Issue #106'da kayda geçmiş bilinçli bir
 * karardır: signup, hesabın varlığını zaten bildirir (bkz. README "User enumeration —
 * bilinçli bir tercih"). Buradaki mesaj o kararı yansıtır, yeni bir sızıntı yaratmaz.
 */
function messageForStatus(status: number): string {
  switch (status) {
    case 400:
      return "Geçerli bir e-posta adresi ve en az 8 karakterlik bir şifre girin.";
    case 409:
      return "Bu e-posta adresi zaten kayıtlı. Giriş yapmayı deneyin.";
    case 429:
      return "Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.";
    default:
      return "Kayıt yapılamadı. Lütfen daha sonra tekrar deneyin.";
  }
}

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        setError(messageForStatus(response.status));
        return;
      }

      router.push("/login");
    } catch {
      // Ağ hatası: sunucudan status alınamadı.
      setError(messageForStatus(0));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard
      title="Kayıt ol"
      description="E-posta ve şifrenizle yeni bir hesap oluşturun."
      footer={
        <>
          Zaten hesabınız var mı? <AuthLink href="/login">Giriş yapın</AuthLink>
        </>
      }
    >
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
        <TextField
          id="password"
          label="Şifre"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          disabled={pending}
        />

        <FormError message={error} />

        <SubmitButton pending={pending}>{pending ? "Kayıt yapılıyor…" : "Kayıt ol"}</SubmitButton>
      </form>
    </AuthCard>
  );
}
