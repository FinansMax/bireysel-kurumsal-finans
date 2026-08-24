"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { FormError, SubmitButton, TextField } from "@/components/auth-form";

/**
 * Yeni çalışma alanı (tenant) oluşturma formu (Issue #42).
 *
 * Mevcut `POST /api/tenants` endpoint'ine GERÇEK bir HTTP isteği atar. `createTenant()`
 * servisi bir Server Action'dan doğrudan çağrılMAZ: tenant oluşturma rate limiti (Issue #27)
 * route seviyesinde uygulanır, servis fonksiyonunda değil — servisi doğrudan çağırmak
 * otomatik tenant üretimine karşı korumayı baypas ederdi. Aynı gerekçe auth ekranları için de
 * geçerlidir (bkz. README "Auth Ekranları").
 */

/**
 * Backend hata metinleri (İngilizce, ör. "Slug is already taken") kullanıcıya OLDUĞU GİBİ
 * gösterilmez; arayüz Türkçedir ve backend'in iç ifadeleri bir UI sözleşmesi değildir.
 *
 * `409` burada AYRI ve açık bir mesaj alır: slug bir gizlilik sınırı değil, global ve
 * kullanıcıya görünür bir adres parçasıdır ("bu ad alınmış" bilgisi zaten adresin kendisinden
 * öğrenilebilir). Bu, auth ekranlarındaki enumeration duruşuyla çelişmez — orada gizlenen şey
 * bir HESABIN varlığıydı.
 */
function messageForStatus(status: number): string {
  switch (status) {
    case 400:
      return "Ad 2-100 karakter olmalı ve adres için en az 2 harf/rakam içermeli.";
    case 409:
      return "Bu adres zaten kullanılıyor. Farklı bir ad veya adres deneyin.";
    case 429:
      return "Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.";
    default:
      return "Çalışma alanı oluşturulamadı. Lütfen daha sonra tekrar deneyin.";
  }
}

export function CreateTenantForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const response = await fetch("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Boş slug GÖNDERİLMEZ (`undefined` ile alan tamamen düşer): backend, slug boş
        // olduğunda onu isimden türetir. Boş string göndermek bu davranışı değil, "geçersiz
        // slug" dalını tetiklerdi.
        body: JSON.stringify({ name, slug: slug.trim() === "" ? undefined : slug }),
      });

      if (!response.ok) {
        setError(messageForStatus(response.status));
        return;
      }

      // Oluşturan kullanıcı OWNER olur (bkz. `createTenant()`), ancak yeni tenant otomatik
      // olarak AKTİF YAPILMAZ: aktif tenant seçimi kullanıcının açık eylemidir (seçici,
      // Issue #40) ve burada sessizce ikinci bir state değişikliği yapmak, başarısız olması
      // hâlinde kullanıcıya açıklaması zor bir yarı-durum bırakırdı.
      router.push("/dashboard");
      router.refresh();
    } catch {
      // Ağ hatası: istek sunucuya hiç ulaşmadı.
      setError(messageForStatus(0));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-sm space-y-4" noValidate>
      <TextField
        id="name"
        label="Çalışma alanı adı"
        type="text"
        autoComplete="organization"
        value={name}
        onChange={setName}
        disabled={pending}
      />
      <TextField
        id="slug"
        label="Adres (isteğe bağlı)"
        type="text"
        autoComplete="off"
        value={slug}
        onChange={setSlug}
        disabled={pending}
        required={false}
        hint="Boş bırakılırsa addan türetilir. Yalnızca küçük harf, rakam ve tire."
      />

      <FormError message={error} />

      <SubmitButton pending={pending}>{pending ? "Oluşturuluyor…" : "Oluştur"}</SubmitButton>
    </form>
  );
}
