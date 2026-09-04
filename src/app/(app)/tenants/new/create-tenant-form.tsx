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
 *
 * ---
 *
 * `403` DE AYRI BİR DAL ALIR (Issue #232) ve bu, "hata mesajlarını ayrıştırma" kuralının
 * istisnası DEĞİLDİR: gizlenmesi gereken bir iç durum yoktur, çünkü bu endpoint'te 403'ün
 * bugün TEK bir kaynağı vardır — #190'ın e-posta doğrulama kapısı. Kimlik yoksa
 * `requireUser()` 401 döner, girdi/çakışma hataları `createTenant()`ten 400/409 olarak gelir.
 * Yani statü tek başına ayırt edicidir; arayüz bir tahmin ÜRETMEZ, sunucunun zaten söylediği
 * şeyi kullanıcının dilinde tekrar eder.
 *
 * Sunucunun `error` metni doğrudan basılMAZ (yukarıdaki karar): İngilizcedir ve UI sözleşmesi
 * değildir. Kullanıcıya gösterilen, aynı talimatın Türkçe karşılığıdır.
 *
 * "LÜTFEN DAHA SONRA TEKRAR DENEYİN" ARTIK YALNIZCA GERÇEKTEN GEÇİCİ DURUMLARA AİTTİR
 * (5xx ve ağ hatası). Doğrulanmamış e-postada bu cümle aktif bir yanlış yönlendirmeydi:
 * beklemek durumu düzeltmez, kullanıcının bir eylem yapması gerekir. Bir hata mesajının en
 * kötü hâli yanlış olanı değil, kullanıcıyı işe yaramaz bir eyleme yönlendirenidir.
 */
const TEMPORARY_FAILURE_MESSAGE =
  "Çalışma alanı oluşturulamadı. Lütfen daha sonra tekrar deneyin.";

/**
 * Beklenmeyen ama GEÇİCİ OLMAYAN statüler (ör. 404) için: "sonra dene" sözü verilmez, çünkü
 * verilecek bir söz yok. Bu dal bugün pratikte boştur; var olma sebebi, ileride yeni bir statü
 * eklendiğinde sessizce yanlış vaatte bulunan dala düşmemesidir.
 */
const UNEXPECTED_FAILURE_MESSAGE = "Çalışma alanı oluşturulamadı.";

const EMAIL_NOT_VERIFIED_MESSAGE =
  "Çalışma alanı oluşturmak için önce e-posta adresinizi doğrulamanız gerekiyor. " +
  "Size gönderdiğimiz doğrulama bağlantısına tıklayın.";

type SubmitFailure = {
  message: string;
  /** Hata kutusunun altında "tekrar gönder" aksiyonu gösterilsin mi? */
  emailNotVerified: boolean;
};

/** Ağ hatası (istek sunucuya hiç ulaşmadı) için kullanılan sözde statü. */
const NETWORK_ERROR_STATUS = 0;

function failureForStatus(status: number): SubmitFailure {
  switch (status) {
    case 400:
      return {
        message: "Ad 2-100 karakter olmalı ve adres için en az 2 harf/rakam içermeli.",
        emailNotVerified: false,
      };
    case 403:
      return { message: EMAIL_NOT_VERIFIED_MESSAGE, emailNotVerified: true };
    case 409:
      return {
        message: "Bu adres zaten kullanılıyor. Farklı bir ad veya adres deneyin.",
        emailNotVerified: false,
      };
    case 429:
      // Sayaç/limit/IP YAZILMAZ (invariant #7) — yalnızca "sonra dene".
      return {
        message: "Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.",
        emailNotVerified: false,
      };
    default:
      return {
        message:
          status === NETWORK_ERROR_STATUS || status >= 500
            ? TEMPORARY_FAILURE_MESSAGE
            : UNEXPECTED_FAILURE_MESSAGE,
        emailNotVerified: false,
      };
  }
}

/**
 * Doğrulama e-postasını yeniden gönderme durumu.
 *
 * "sent" NÖTR BİR ONAYDIR: `POST /api/auth/resend-verification` bilerek DAİMA aynı yanıtı
 * döner (invariant #7 — "kayıtlı ve doğrulanmamışsa gönderildi"). Arayüz o yanıtı ayrıştırıp
 * "gönderildi" / "zaten doğrulanmış" ayrımı yapmaya ÇALIŞMAZ; yapsaydı endpoint'in bilinçli
 * olarak kapattığı oracle'ı arayüz tarafında yeniden açardı.
 */
type ResendState = "idle" | "pending" | "sent" | "rateLimited" | "failed";

const RESEND_MESSAGES: Record<Exclude<ResendState, "idle" | "pending">, string> = {
  sent: "Doğrulama e-postası gönderildi. Gelen kutunuzu ve spam klasörünü kontrol edin.",
  rateLimited: "Çok fazla istek gönderildi. Lütfen biraz sonra tekrar deneyin.",
  failed: "Doğrulama e-postası gönderilemedi. Lütfen daha sonra tekrar deneyin.",
};

export function CreateTenantForm({ userEmail }: { userEmail: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [failure, setFailure] = useState<SubmitFailure | null>(null);
  const [pending, setPending] = useState(false);
  const [resend, setResend] = useState<ResendState>("idle");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(null);
    // Yeni bir deneme, önceki gönderim bildirimini geçersiz kılar: kullanıcı e-postasını
    // doğrulayıp tekrar denediyse eski "gönderildi" satırı ekranda kalmamalı.
    setResend("idle");
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
        setFailure(failureForStatus(response.status));
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
      setFailure(failureForStatus(NETWORK_ERROR_STATUS));
    } finally {
      setPending(false);
    }
  }

  /**
   * MEVCUT endpoint'e gerçek istek atar; yeni bir "oturumdaki kullanıcıya tekrar gönder"
   * endpoint'i AÇILMADI. Yeniden gönderme rate limiti (`RESEND_VERIFICATION`, 3/15dk) o
   * route'ta yaşıyor; ikinci bir kapı açmak, her çağrısı bir e-posta üreten bu işlemi
   * limitsiz hâle getirirdi.
   */
  async function resendVerification() {
    setResend("pending");

    try {
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: userEmail }),
      });

      if (response.ok) {
        setResend("sent");
        return;
      }

      setResend(response.status === 429 ? "rateLimited" : "failed");
    } catch {
      setResend("failed");
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

      <FormError message={failure?.message ?? null} />

      {failure?.emailNotVerified ? (
        <div className="space-y-2">
          {/*
            Düğme `type="button"`: form içinde kalır (hata kutusunun hemen yanında olması,
            ekran okuyucuda da bağlamı korur) ama formu GÖNDERMEZ — aksi halde doğrulama hâlâ
            eksikken ikinci bir 403 üretirdi.
          */}
          <button
            type="button"
            onClick={resendVerification}
            disabled={resend === "pending"}
            className="rounded-control border border-line px-3 py-1.5 text-sm font-medium text-body transition-colors duration-150 ease-out-soft hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {resend === "pending" ? "Gönderiliyor…" : "Doğrulama e-postasını tekrar gönder"}
          </button>

          {resend === "sent" ? (
            <p role="status" className="text-sm text-pretty text-muted">
              {RESEND_MESSAGES.sent}
            </p>
          ) : null}

          {/*
            `role="alert"` YALNIZCA gerçek hatalarda: başarı satırı `role="status"` kullanır,
            aksi halde ekran okuyucu "gönderildi" bildirimini de bir hata gibi kesip okurdu.
          */}
          {resend === "rateLimited" || resend === "failed" ? (
            <p role="alert" className="text-sm text-pretty text-danger-600 dark:text-danger-300">
              {RESEND_MESSAGES[resend]}
            </p>
          ) : null}
        </div>
      ) : null}

      <SubmitButton pending={pending}>{pending ? "Oluşturuluyor…" : "Oluştur"}</SubmitButton>
    </form>
  );
}
