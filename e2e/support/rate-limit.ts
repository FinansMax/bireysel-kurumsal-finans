import { randomUUID } from "node:crypto";

/**
 * Testler arasında (ve aynı test içindeki bağımsız denemeler arasında) rate-limit bucket
 * çakışmasını önlemek için benzersiz bir sahte istemci IP'si üretir.
 *
 * Bu bir production bypass'ı DEĞİLDİR: gerçek rate limiter mantığını hiç atlamaz, sadece
 * gerçek trafikte doğal olarak var olacak "farklı istemciler farklı IP'lerden gelir" durumunu
 * testlerde simüle eder — Issue #27 ile IP+endpoint bazlı rate limiting eklendiğinden beri,
 * aynı endpoint'e çok sayıda istek atan mevcut testlerin (ör. signup/signin/forgot-password
 * HTTP testleri) birbirinin (ve kendi içindeki ardışık denemelerinin) bucket'ını yanlışlıkla
 * tüketmemesi için gereklidir.
 *
 * NEDEN GERÇEK BİR IPv6 ADRESİ (Issue #182): bu fonksiyon eskiden `test-<uuid>` döndürüyordu.
 * O zaman çalışıyordu çünkü `getClientIp()` header'ı opak bir string olarak kabul ediyordu —
 * ve bu, tam olarak #182'de kapatılan açıktı: rastgele stringler sınırsız bucket üretiyordu.
 * Artık `getClientIp()` biçim doğrulaması yapıyor; geçersiz bir değer paylaşılan `unknown`
 * bucket'ına düşer. Eski hâli bırakılsaydı TÜM testler aynı bucket'ı paylaşır ve birbirini
 * 429'a düşürürdü — yani helper'ın var olma sebebi ortadan kalkardı.
 *
 * `2001:db8::/32`, RFC 3849'un DOKÜMANTASYON için ayırdığı bloktur; gerçek bir hedefe
 * yönlenmez. UUID'nin 128 bitinin 96'sı adrese taşınır, yani çakışma pratikte imkânsızdır.
 */
export function uniqueTestClientIp(): string {
  const hex = randomUUID().replace(/-/g, "");
  const groups = [
    hex.slice(0, 4),
    hex.slice(4, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 24),
  ];
  return `2001:db8:${groups.join(":")}`;
}
