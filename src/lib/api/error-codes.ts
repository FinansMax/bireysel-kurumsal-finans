/**
 * HTTP hata yanıtlarının MAKİNE TARAFINDAN OKUNABİLİR kodları (Issue #232).
 *
 * NEDEN VAR: arayüz bir hatanın SEBEBİNİ statüden tahmin ediyordu. "`POST /api/tenants`'ta
 * 403'ün tek kaynağı #190'ın e-posta doğrulama kapısıdır" varsayımı yazıldığı gün doğruydu ama
 * bir SÖZLEŞME değildi. O route'a bir bakım modu ya da yeni bir RBAC kapısı eklendiği gün form,
 * tamamen alakasız bir hataya "e-postanızı doğrulayın" demeye başlardı — ve HİÇBİR TEST
 * KIRILMAZDI. Yanlış mesaj gösteren bir arayüz, hata veren arayüzden daha kötüdür: kullanıcı
 * yanlış olduğunu anlayamaz.
 *
 * NEDEN `error` METNİNE BAKILMIYOR: `error` alanı İngilizce, insan okuru için ve serbest
 * metindir. Ona göre dallanmak, bir hata cümlesindeki yazım düzeltmesini kırıcı bir değişikliğe
 * çevirirdi. `code` tam tersidir: kararlıdır, çevrilmez ve YALNIZCA makine okur. Kullanıcıya
 * gösterilen metin arayüzde, Türkçe olarak kalır (dil kararı:
 * `src/app/(app)/tenants/new/create-tenant-form.tsx`).
 *
 * ENUMERATION SIZDIRMAZ ve invariant #7 ile çelişmez: kod, isteği YAPAN kullanıcının KENDİ
 * durumunu söyler ("senin e-postan doğrulanmamış"). Başka bir hesabın varlığı, rolü ya da bir
 * kaydın var olup olmadığı hakkında hiçbir şey söylemez. İnvariant #7'nin yasakladığı şey,
 * GEÇERSİZLİK SEBEBİNİ ayrıştırmanın saldırgana arama uzayı daraltmasıydı (ör. "bu e-posta
 * kayıtlı" / "token süresi dolmuş"); burada saldırganın öğrenebileceği tek şey, zaten kendi
 * oturumuna ait olan bir durumdur.
 *
 * YENİ KOD EKLERKEN: bir hataya kod vermek, "arayüzün bu durumu AYRI ele alması gerekiyor"
 * demektir. Her hata kod almaz — kod, yalnızca kullanıcının yapabileceği FARKLI bir eylem varsa
 * anlamlıdır. Kodsuz bir hata, arayüzde o statünün genel dalına düşer ve bu doğru davranıştır.
 */
export const API_ERROR_CODES = {
  /**
   * #190 kapısı: e-postası doğrulanmamış hesap çalışma alanı kuramaz ve davet kabul edemez.
   *
   * Kullanıcının yapabileceği farklı bir eylem VARDIR (doğrulama e-postasını tekrar istemek),
   * bu yüzden kod hak eder — genel bir "yetkiniz yok" mesajı burada işe yaramazdı.
   */
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];
