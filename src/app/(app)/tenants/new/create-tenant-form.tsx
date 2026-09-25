"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { API_ERROR_CODES, toApiErrorCode, type ApiErrorCode } from "@/lib/api/error-codes";
import { FormError, SubmitButton, TextField } from "@/components/auth-form";
import { ResendVerificationButton } from "@/components/resend-verification-button";

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
 * `403` STATÜYE DEĞİL, YANITTAKİ `code` ALANINA GÖRE AYRIŞTIRILIR (Issue #232).
 *
 * İlk çözüm "bu endpoint'te 403'ün tek kaynağı e-posta doğrulama kapısıdır" varsayımına
 * dayanıyordu. Bu bugün doğruydu ama bir sözleşme değildi: route'a bir bakım modu ya da yeni
 * bir RBAC kapısı eklendiği gün form, alakasız bir hataya "e-postanızı doğrulayın" demeye
 * başlardı ve hiçbir test kırılmazdı. Artık doğrulama dalı YALNIZCA sunucu
 * `EMAIL_NOT_VERIFIED` kodunu gönderdiğinde açılır; tanınmayan her 403 genel yetkisizlik
 * metnine düşer (bkz. `src/lib/api/error-codes.ts`).
 *
 * Kararın diğer yarısı korunur: dallanma `code`a bakar, EKRANA BASILAN metin ise sunucunun
 * İngilizce `error` alanı değil, onun Türkçe karşılığıdır.
 *
 * "LÜTFEN DAHA SONRA TEKRAR DENEYİN" YALNIZCA GERÇEKTEN GEÇİCİ DURUMLARA AİTTİR (5xx ve ağ
 * hatası). Doğrulanmamış e-postada bu cümle aktif bir yanlış yönlendirmeydi: beklemek durumu
 * düzeltmez, kullanıcının bir eylem yapması gerekir. Bir hata mesajının en kötü hâli yanlış
 * olanı değil, kullanıcıyı işe yaramaz bir eyleme yönlendirenidir.
 */
const TEMPORARY_FAILURE_MESSAGE =
  "Çalışma alanı oluşturulamadı. Lütfen daha sonra tekrar deneyin.";

/**
 * Beklenmeyen ama GEÇİCİ OLMAYAN statüler (ör. 404) için: "sonra dene" sözü verilmez, çünkü
 * verilecek bir söz yok. Bu dal bugün pratikte boştur; var olma sebebi, ileride yeni bir statü
 * eklendiğinde sessizce yanlış vaatte bulunan dala düşmemesidir.
 */
const UNEXPECTED_FAILURE_MESSAGE = "Çalışma alanı oluşturulamadı.";

/** Tanınmayan bir 403: sebebini bilmiyoruz, o yüzden UYDURMUYORUZ. */
const FORBIDDEN_MESSAGE = "Bu işlem için yetkiniz yok.";

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

/**
 * Yanıttaki makine kodunu okur.
 *
 * Gövde JSON olmayabilir (proxy'den dönen bir HTML hata sayfası, boş gövde): o durumda "kod
 * yok" denir ve çağıran taraf genel dala düşer. Burada throw etmek, asıl hatayı bir JSON
 * ayrıştırma hatasına çevirirdi.
 */
async function readErrorCode(response: Response): Promise<ApiErrorCode | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null || !("code" in body)) {
      return null;
    }

    // `toApiErrorCode()` daraltmayı TEK yerde yapar: aşağıdaki karşılaştırma böylece iki
    // `string` arasında değil, union üzerinde olur ve yanlış/eskimiş bir koda bakan dal
    // derlenmez (bkz. `src/lib/api/error-codes.ts`).
    return toApiErrorCode((body as { code: unknown }).code);
  } catch {
    return null;
  }
}

function failureFor(status: number, code: ApiErrorCode | null): SubmitFailure {
  switch (status) {
    case 400:
      return {
        message: "Ad 2-100 karakter olmalı ve adres için en az 2 harf/rakam içermeli.",
        emailNotVerified: false,
      };
    case 403:
      return code === API_ERROR_CODES.EMAIL_NOT_VERIFIED
        ? { message: EMAIL_NOT_VERIFIED_MESSAGE, emailNotVerified: true }
        : { message: FORBIDDEN_MESSAGE, emailNotVerified: false };
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

export function CreateTenantForm({ userEmail }: { userEmail: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [failure, setFailure] = useState<SubmitFailure | null>(null);
  const [pending, setPending] = useState(false);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(null);
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
        setFailure(failureFor(response.status, await readErrorCode(response)));
        return;
      }

      // Oluşturan kullanıcı OWNER olur (bkz. `createTenant()`), ancak yeni tenant otomatik
      // olarak AKTİF YAPILMAZ: aktif tenant seçimi kullanıcının açık eylemidir (seçici,
      // Issue #40) ve burada sessizce ikinci bir state değişikliği yapmak, başarısız olması
      // hâlinde kullanıcıya açıklaması zor bir yarı-durum bırakırdı.
      router.push("/dashboard");
      router.refresh();
    } catch {
      // Ağ hatası: istek sunucuya hiç ulaşmadı, dolayısıyla okunacak bir kod da yok.
      setFailure(failureFor(NETWORK_ERROR_STATUS, null));
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

      <FormError message={failure?.message ?? null} />

      {/*
        Aksiyon PAYLAŞILAN bileşendedir (`components/resend-verification-button.tsx`): aynı
        düğme kabuktaki kalıcı uyarı şeridinde de kullanılıyor (#190) ve iki kopya, birinde
        düzeltilen bir davranışın diğerinde eski kalması demekti.
      */}
      {failure?.emailNotVerified ? <ResendVerificationButton email={userEmail} /> : null}

      <SubmitButton pending={pending}>{pending ? "Oluşturuluyor…" : "Oluştur"}</SubmitButton>
    </form>
  );
}
