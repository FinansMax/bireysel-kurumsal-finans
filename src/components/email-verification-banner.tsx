import Link from "next/link";

import { ResendVerificationButton } from "@/components/resend-verification-button";

/**
 * Kalıcı "e-postanı doğrula" uyarı şeridi (Issue #190).
 *
 * NEDEN VAR: doğrulama kapısı (#190) çalışma alanı kurmayı ve davet kabul etmeyi engelliyor, ama
 * kullanıcı bunu ancak o işlemi DENEDİĞİNDE öğreniyordu. Yeni kaydolmuş bir kullanıcı panele
 * girip hiçbir uyarı görmeden dolaşıyor, ilk çalışma alanını kurmaya çalıştığında duvara
 * çarpıyordu. #232/#233 o duvara anlamlı bir mesaj koydu; bu şerit ise engeli ortaya ÇIKTIĞI ana
 * değil, VAR OLDUĞU ana bağlar.
 *
 * NEDEN KABUKTA, NEDEN TEK BİR SAYFADA DEĞİL: engel bir SAYFAYA değil HESABA aittir; kullanıcı
 * hangi ekranda olursa olsun geçerlidir. Kabuk, bu durumun görünmesi gereken tek yerdir.
 *
 * NEDEN KAPATILABİLİR DEĞİL: kapatılabilir bir uyarı ilk gün kapatılır ve engel geri döndüğünde
 * kullanıcı yine hazırlıksız yakalanır. Şerit doğrulama tamamlandığı anda ZATEN kaybolur —
 * kullanıcının onu kapatmasına gerek yok, yapması gereken şeyi yapması yeterli.
 *
 * NEDEN `danger` RENGİ DEĞİL: bu bir HATA değil, tamamlanmamış bir adım. `globals.css`'te kırmızı
 * bilerek "gerçek hatalar" için ayrılmış (yorumu orada yazılı); her uyarıyı alarma çevirmek,
 * gerçek hataları görünmez kılar. Yeni bir `warning` rampası eklemek de reddedildi: tek bir
 * şerit için palete kalıcı bir renk eklemek, tasarım sisteminde gerekçesiz bir borç bırakırdı.
 * Mevcut nötr yüzey tokenları yeterli — şeridin dikkat çekmesini sağlayan şey rengi değil,
 * sayfanın en üstünde ve KALICI olması.
 *
 * SUNUCU BİLEŞENİ: doğrulama durumu her istekte sunucuda okunur (`isEmailVerified()`); istemciye
 * "doğrulandı mı" bayrağı gönderilip ona güvenilmez. Yalnızca yeniden gönderme aksiyonu istemci
 * tarafındadır.
 *
 * BU BİR YETKİLENDİRME DEĞİLDİR (invariant #3): asıl kapı `POST /api/tenants` ve
 * `POST /api/invitations/accept` içindeki `isEmailVerified()` kontrolüdür. Şeridi gizlemek ya da
 * göstermek hiçbir yetkiyi değiştirmez; bu bir UX kararıdır.
 */
export function EmailVerificationBanner({ email }: { email: string }) {
  return (
    <div
      // `role="status"`, `role="alert"` DEĞİL: alert, ekran okuyucunun o anda okuduğu şeyi KESER.
      // Bu şerit her sayfa yüklemesinde var; kesmek, sayfayı her ziyarette kullanıcının sözünü
      // ağzına tıkamak olurdu.
      role="status"
      className="border-b border-line bg-surface-muted px-5 py-3 sm:px-8"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2">
        <p className="min-w-0 flex-1 text-sm text-pretty text-body">
          <span className="font-medium text-strong">E-posta adresiniz doğrulanmadı.</span>{" "}
          <span className="break-all">{email}</span> adresine gönderdiğimiz bağlantıya tıklayana
          kadar çalışma alanı oluşturamaz ve davetleri kabul edemezsiniz.
        </p>

        <div className="flex flex-wrap items-start gap-3">
          <ResendVerificationButton email={email} />

          {/*
            Doğrulama bağlantısı zaten elindeyse kullanıcıyı yeni bir e-posta beklemeye
            zorlamamak için: `/verify-email` token'ı URL'den okur.
          */}
          <Link
            href="/verify-email"
            className="self-center text-sm font-medium text-brand-600 hover:underline"
          >
            Bağlantım var
          </Link>
        </div>
      </div>
    </div>
  );
}
