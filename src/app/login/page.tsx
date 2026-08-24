"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { AuthCard, AuthLink, FormError, SubmitButton, TextField } from "@/components/auth-form";

/**
 * Giriş ekranı (Issue #36).
 *
 * NEDEN CLIENT COMPONENT + `next-auth/react`'in `signIn`'i — ve NEDEN bir Server Action DEĞİL:
 *
 * `next-auth`'un SUNUCU tarafı `signIn()`'i (bkz. `node_modules/next-auth/lib/actions.js`)
 * bellekte bir `Request` nesnesi üretip `Auth()`'u DOĞRUDAN çağırır ve üstelik
 * `skipCSRFCheck` geçer. Yani istek hiçbir zaman HTTP üzerinden gitmez ve
 * `src/app/api/auth/[...nextauth]/route.ts` ÇALIŞMAZ. Bu route, sign-in rate limitinin
 * (Issue #27) uygulandığı tek yerdir — bir Server Action'a geçmek, brute-force korumasını
 * ve Auth.js'in kendi CSRF kontrolünü sessizce devre dışı bırakırdı.
 *
 * İstemci tarafı `signIn()` ise önce CSRF token'ı alır, sonra
 * `/api/auth/callback/credentials`'a GERÇEK bir HTTP POST atar — yani mevcut route'tan,
 * dolayısıyla rate limitten geçer.
 *
 * Bu, bir stil tercihi değil güvenlik gereğidir; regresyon testi:
 * `integration/auth-ui-pattern.spec.ts`.
 */

// Kullanıcı adı/şifre hatalarında TEK ve genel mesaj: "e-posta kayıtlı değil" ile "şifre
// yanlış" ayrımı yapılmaz (user enumeration engeli — bkz. README "Giriş (sign-in)").
const INVALID_CREDENTIALS_MESSAGE = "E-posta veya şifre hatalı.";

// Rate limit (429) ve ağ hatası aynı mesaja düşer; ikisi de "şu an giriş yapılamıyor, sonra
// dene" anlamına gelir. Ayrıştırılamamalarının teknik nedeni aşağıda `catch` bloğunda.
const UNAVAILABLE_MESSAGE = "Giriş yapılamadı. Lütfen biraz sonra tekrar deneyin.";

export default function LoginPage() {
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
      const result = await signIn("credentials", { email, password, redirect: false });

      if (!result || result.error) {
        setError(INVALID_CREDENTIALS_MESSAGE);
        return;
      }

      // Oturum cookie'si yanıtla birlikte tarayıcıya yazıldı; `refresh()`, sunucu
      // bileşenlerinin yeni oturumla yeniden render edilmesini sağlar.
      // Hedef `/` değil `/dashboard`: korumalı kabuk Issue #39 ile eklendi.
      router.push("/dashboard");
      router.refresh();
    } catch {
      // `next-auth/react`'in `signIn`'i, yanıt gövdesinde `url` alanı olmayan durumlarda
      // (bizim 429 gövdemiz gibi: `{ error: "Too many requests..." }`) `new URL(undefined)`
      // çağırdığı için TypeError FIRLATIR — hata döndürmez. Bu yüzden çağrı try/catch
      // içindedir; bu blok kaldırılırsa rate limit'e takılan kullanıcı boş bir ekranla kalır.
      setError(UNAVAILABLE_MESSAGE);
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard
      title="Giriş yap"
      description="Hesabınıza erişmek için e-posta ve şifrenizi girin."
      footer={
        <>
          Hesabınız yok mu? <AuthLink href="/signup">Kayıt olun</AuthLink>
          <br />
          <AuthLink href="/forgot-password">Şifremi unuttum</AuthLink>
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
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          disabled={pending}
        />

        <FormError message={error} />

        <SubmitButton pending={pending}>{pending ? "Giriş yapılıyor…" : "Giriş yap"}</SubmitButton>
      </form>
    </AuthCard>
  );
}
