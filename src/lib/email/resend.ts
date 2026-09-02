import { EMAIL_PROVIDERS, resolveEmailConfig } from "@/lib/config/email";

/**
 * Resend HTTP API transport'u (Issue #180).
 *
 * NEDEN SDK DEĞİL, DÜZ `fetch`: Resend'in `resend` npm paketi tek yaptığı şey bu tek POST
 * isteğini sarmalamaktır. `docs/conventions.md` → "Bağımlılıklar": bu repo şifre hash'i için
 * `bcrypt` yerine Node `crypto`, doğrulama için `zod` yerine elle yazılmış saf fonksiyonlar
 * kullanıyor. On beş satırlık bir HTTP çağrısı için bağımlılık eklemek o duruşla çelişirdi ve
 * ayrıca açık onay gerektirirdi. `fetch` Node 20'de yerleşiktir.
 *
 * NEDEN SMTP DEĞİL: SMTP bir kütüphane (`nodemailer`) ve credential yönetimi gerektirir,
 * ayrıca serverless ortamlarda giden 587/465 portu sık sık kapalıdır. HTTP API her yerde
 * çalışır. Karar ve reddedilen alternatifler README'de.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Gönderim zaman aşımı.
 *
 * NEDEN GEREKLİ: bu çağrı, kullanıcının beklediği bir HTTP isteğinin (şifre sıfırlama, davet)
 * ORTASINDA yapılır. Sağlayıcı yanıt vermezse istek süresiz asılı kalır ve kullanıcı bozuk bir
 * sayfa görür. Gönderim zaten "best-effort"tur (aşağıya bak), o yüzden beklemektense
 * vazgeçmek doğrudur.
 */
const SEND_TIMEOUT_MS = 10_000;

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

/**
 * Tek denemelik gönderim. Kuyruk/retry KURULMAZ (Issue #180 "Scope Dışı").
 *
 * SÖZLEŞME: bu fonksiyon **throw etmez**, `boolean` döner. Gönderim hatası çağıran akışı
 * düşürmemelidir — `forgot-password` kayıtlı/kayıtsız e-posta için aynı yanıtı dönmeye devam
 * etmek zorundadır (invariant #7, user enumeration). Sağlayıcı 500 dönerse kullanıcının
 * gördüğü şey değişmez; olay yalnızca sunucuda loglanır.
 *
 * LOG KURALI: hata logu ne API key'i ne de e-posta gövdesini içerir. Gövde raw token taşıyan
 * mutlak linki içerir (bkz. `src/lib/auth/email.ts`'teki aynı kural) ve `Authorization`
 * başlığı sırdır. Loglanan tek şey: alıcı, konu ve sağlayıcının durum kodu.
 */
export async function sendViaResend(email: OutgoingEmail): Promise<boolean> {
  const config = resolveEmailConfig();

  // Savunma amaçlı: bu transport yalnızca `resend` yapılandırmasıyla çağrılmalıdır. Çağıran
  // taraf zaten sağlayıcıya göre seçiliyor; buradaki kontrol, ileride yanlış bir yerden
  // çağrılırsa sessizce yanlış davranmak yerine açıkça durmak içindir.
  if (config.provider !== EMAIL_PROVIDERS.RESEND) {
    throw new Error("sendViaResend() called while EMAIL_PROVIDER is not 'resend'.");
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        // API key YALNIZCA burada kullanılır; hiçbir log satırına girmez.
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: config.from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Yanıt gövdesi OKUNMAZ ve loglanmaz: sağlayıcılar hata gövdesinde isteğin bir kısmını
      // yankılayabilir ve bu, raw token taşıyan linki loga taşıyabilirdi.
      console.error("[email:resend] provider rejected the message", {
        to: email.to,
        subject: email.subject,
        status: response.status,
      });
      return false;
    }

    return true;
  } catch (error) {
    // Ağ hatası, DNS, zaman aşımı. `error` nesnesi istek gövdesini taşımaz, ama yine de
    // yalnızca adı/mesajı loglanır.
    console.error("[email:resend] send failed", {
      to: email.to,
      subject: email.subject,
      error: error instanceof Error ? error.message : "unknown error",
    });
    return false;
  }
}
