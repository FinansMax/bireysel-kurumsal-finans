import type { MembershipRole } from "@prisma/client";

import type { OutgoingEmail } from "./resend";

/**
 * E-posta şablonları (Issue #180).
 *
 * ŞABLON MOTORU KURULMAZ (`handlebars`, `mjml`, `react-email` …). İki şablon var ve ikisi de
 * bir başlık, bir paragraf ve bir linkten ibaret; motor eklemek bağımlılık yüzeyini büyütür
 * ve `docs/conventions.md` → "Bağımlılıklar" duruşuyla çelişirdi. Üçüncü/dördüncü şablon
 * geldiğinde bu karar yeniden değerlendirilir.
 *
 * HER E-POSTA HEM DÜZ METİN HEM HTML TAŞIR: bazı istemciler HTML'i engeller, bazı kurumsal
 * gateway'ler yalnız-HTML mesajları spam olarak işaretler. Düz metin sürümü olmayan bir
 * şifre sıfırlama e-postası, kullanıcının hesabına hiç giremediği anlamına gelebilir.
 */

/**
 * HTML'e gömülen değerler için minimal kaçış.
 *
 * Bugün gömülen tek değişken değer, bizim ürettiğimiz mutlak link (`resetUrl`/`acceptUrl`)
 * ve bir enum (`role`) — yani ikisi de güvenilir. Kaçış yine de UYGULANIR: bu fonksiyona
 * ileride kullanıcı kaynaklı bir değer (tenant adı, davet notu) eklendiğinde, kaçışın
 * eklenmesi UNUTULABİLİR. Kural baştan burada olsun ki eklemek değil, kaldırmak bilinçli bir
 * hareket olsun.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Ortak HTML iskeleti — iki şablon da aynı gövdeyi paylaşır. */
function htmlDocument(heading: string, paragraphs: readonly string[], actionLabel: string, actionUrl: string): string {
  const safeUrl = escapeHtml(actionUrl);
  const body = paragraphs.map((line) => `    <p style="margin:0 0 16px;">${escapeHtml(line)}</p>`).join("\n");

  return `<!doctype html>
<html lang="tr">
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111;">
    <div style="max-width:520px;margin:0 auto;padding:24px;background:#fff;border-radius:8px;">
    <h1 style="margin:0 0 16px;font-size:20px;">${escapeHtml(heading)}</h1>
${body}
    <p style="margin:24px 0;">
      <a href="${safeUrl}" style="display:inline-block;padding:12px 20px;background:#111;color:#fff;text-decoration:none;border-radius:6px;">${escapeHtml(actionLabel)}</a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:#555;">Buton çalışmazsa bu adresi tarayıcınıza yapıştırın:</p>
    <p style="margin:0;font-size:13px;color:#555;word-break:break-all;">${safeUrl}</p>
    </div>
  </body>
</html>`;
}

/**
 * Şifre sıfırlama e-postası.
 *
 * Süre (30 dakika) metne YAZILIR: kullanıcı linke geç tıklayıp "çalışmıyor" sanmasın.
 * Değer `password-reset.ts`'teki `RESET_TOKEN_TTL_MS` ile elle tutarlı tutulur — tek satırlık
 * bir metin için oradan tip düzeyinde bir bağ kurmak, kazandığından fazla dolaylılık getirirdi.
 */
export function passwordResetEmail(to: string, resetUrl: string): OutgoingEmail {
  const paragraphs = [
    "Hesabınızın şifresini sıfırlamak için bir talep aldık.",
    "Aşağıdaki bağlantı 30 dakika boyunca geçerlidir ve yalnızca bir kez kullanılabilir.",
    "Bu talebi siz yapmadıysanız bu e-postayı yok sayabilirsiniz; şifreniz değişmez.",
  ];

  return {
    to,
    subject: "FinansMax — şifre sıfırlama",
    text: [
      "Hesabınızın şifresini sıfırlamak için bir talep aldık.",
      "",
      "Şifrenizi sıfırlamak için:",
      resetUrl,
      "",
      "Bu bağlantı 30 dakika boyunca geçerlidir ve yalnızca bir kez kullanılabilir.",
      "Bu talebi siz yapmadıysanız bu e-postayı yok sayabilirsiniz; şifreniz değişmez.",
    ].join("\n"),
    html: htmlDocument("Şifre sıfırlama", paragraphs, "Şifremi sıfırla", resetUrl),
  };
}

/** Rol adlarının kullanıcıya gösterilen Türkçe karşılığı. */
const ROLE_LABELS: Record<MembershipRole, string> = {
  OWNER: "Sahip",
  ADMIN: "Yönetici",
  MEMBER: "Üye",
};

/**
 * Tenant daveti e-postası.
 *
 * TENANT ADI GEÇMEZ: `InvitationEmailPayload` yalnızca `tenantId` taşır ve Issue #180
 * "Kapsam" maddesi arayüzlerin DEĞİŞMEYECEĞİNİ söylüyor. Ham `tenantId`'yi metne basmak
 * kullanıcıya hiçbir şey ifade etmez, üstelik iç tanımlayıcıyı dışarı taşır. Tenant adını
 * göstermek arayüz değişikliği gerektirir ve ayrı bir issue'nun konusudur.
 */
export function invitationEmail(to: string, role: MembershipRole, acceptUrl: string): OutgoingEmail {
  const roleLabel = ROLE_LABELS[role];
  const paragraphs = [
    `FinansMax üzerinde bir çalışma alanına ${roleLabel} rolüyle davet edildiniz.`,
    "Aşağıdaki bağlantı 7 gün boyunca geçerlidir ve yalnızca bir kez kullanılabilir.",
    "Bu daveti beklemiyorduysanız bu e-postayı yok sayabilirsiniz.",
  ];

  return {
    to,
    subject: "FinansMax — çalışma alanı daveti",
    text: [
      `FinansMax üzerinde bir çalışma alanına ${roleLabel} rolüyle davet edildiniz.`,
      "",
      "Daveti kabul etmek için:",
      acceptUrl,
      "",
      "Bu bağlantı 7 gün boyunca geçerlidir ve yalnızca bir kez kullanılabilir.",
      "Bu daveti beklemiyorduysanız bu e-postayı yok sayabilirsiniz.",
    ].join("\n"),
    html: htmlDocument("Çalışma alanı daveti", paragraphs, "Daveti kabul et", acceptUrl),
  };
}

/**
 * E-posta doğrulama (Issue #190).
 *
 * Süre (24 saat) metne YAZILIR — kullanıcı linke geç tıklayıp "çalışmıyor" sanmasın.
 * Şifre sıfırlamanın 30 dakikasından uzun olmasının gerekçesi
 * `src/lib/auth/email-verification.ts`'te yazılıdır.
 */
export function emailVerificationEmail(to: string, verifyUrl: string): OutgoingEmail {
  const paragraphs = [
    "FinansMax hesabınızı oluşturdunuz. E-posta adresinizi doğrulamak için aşağıdaki bağlantıya tıklayın.",
    "Bağlantı 24 saat boyunca geçerlidir ve yalnızca bir kez kullanılabilir.",
    "Bu hesabı siz oluşturmadıysanız bu e-postayı yok sayabilirsiniz.",
  ];

  return {
    to,
    subject: "FinansMax — e-posta adresinizi doğrulayın",
    text: [
      "FinansMax hesabınızı oluşturdunuz.",
      "",
      "E-posta adresinizi doğrulamak için:",
      verifyUrl,
      "",
      "Bu bağlantı 24 saat boyunca geçerlidir ve yalnızca bir kez kullanılabilir.",
      "Bu hesabı siz oluşturmadıysanız bu e-postayı yok sayabilirsiniz.",
    ].join("\n"),
    html: htmlDocument("E-posta doğrulama", paragraphs, "E-postamı doğrula", verifyUrl),
  };
}
