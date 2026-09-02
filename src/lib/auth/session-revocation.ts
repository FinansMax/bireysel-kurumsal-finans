/**
 * JWT session revocation — kritik credential değişikliklerinden (şifre değişikliği) ÖNCE
 * üretilmiş session'ların artık kabul edilmemesini sağlar (Issue #26).
 *
 * Mimari: database session / refresh token / blacklist YOKTUR. Mevcut Auth.js v5 stateless
 * JWT stratejisi korunur; tek ek kontrol, `session` callback'inde (bkz. `src/lib/auth/config.ts`)
 * `token.iat`'in `User.credentialsChangedAt`'ten ESKİ olup olmadığını karşılaştırmaktır.
 *
 * KRİTİK — hassasiyet (precision) uyuşmazlığı: JWT `iat`, Unix SANİYE (tam sayı) hassasiyetinde
 * tutulur (bkz. jose'nin `EncryptJWT.setIssuedAt()`'i); `credentialsChangedAt` ise Postgres
 * `TIMESTAMP(3)` — MİLİSANİYE hassasiyetindedir. Naif bir `credentialsChangedAt > iat*1000`
 * karşılaştırması, token'ın gerçek üretim anı (`iat`'in temsil ettiği saniye İÇİNDE herhangi bir
 * milisaniye olabilir) `credentialsChangedAt`'ten SONRA olsa bile — sırf aynı saniyeye
 * denk geldiği için — o token'ı YANLIŞLIKLA revoke edebilir. Bu, "password reset sonrası hemen
 * yapılan yeni login'in de revoke edilmesi" gibi ciddi bir kullanılabilirlik hatasına yol açar.
 *
 * Çözüm: token'ın `iat` saniyesinin TAMAMI (o saniyenin son milisaniyesine kadar) hâlâ geçerli
 * kabul edilir. Bir token, sadece `credentialsChangedAt` o saniyenin TAMAMEN bittiği ana
 * (`(iat + 1) * 1000` ms) ULAŞMIŞ veya GEÇMİŞSE revoke edilir. Bu, en fazla ~1 saniyelik bilinçli
 * bir "grace window" bırakır (bir token, teorik olarak credential change'den <1sn ÖNCE üretilmiş
 * olsa bile aynı saniyede ise geçerli sayılabilir) — ama YANLIŞ POZİTİF (geçerli/yeni bir session'ı
 * hatalı şekilde revoke etmek) asla oluşmaz. "Fail open by at most one second" yaklaşımı,
 * "accidentally lock out a legitimate new session" riskinden bilinçli olarak tercih edilmiştir.
 */
export function isSessionRevoked(
  tokenIssuedAtSeconds: number | null | undefined,
  credentialsChangedAt: Date | null | undefined,
  sessionsRevokedAt?: Date | null | undefined,
): boolean {
  /**
   * İKİ AYRI OLAY, TEK EŞİK (Issue #186).
   *
   * `credentialsChangedAt` şifre değişimini, `sessionsRevokedAt` ise kullanıcının kendi
   * iradesiyle yaptığı "tüm oturumları kapat" işlemini taşır. İkisi ŞEMADA ayrı tutulur
   * (farklı olaylardır; audit ve ileride bildirim bu ayrımı ister) ama revocation kararı
   * ikisinin EN BÜYÜĞÜNE bakar: hangisi daha yeniyse, ondan önceki her token geçersizdir.
   *
   * `Math.max` KULLANILMAZ, `null` olabilen iki değer açıkça ele alınır: `Math.max(null, x)`
   * `null`'ı 0'a çevirir ve "hiç olmadı"yı "1970'te oldu" gibi davranarak sessizce yanlış
   * sonuç üretebilir.
   */
  const thresholds = [credentialsChangedAt, sessionsRevokedAt].filter(
    (value): value is Date => value instanceof Date,
  );

  if (thresholds.length === 0) {
    // Kullanıcı ne credential değiştirmiş ne de toplu iptal yapmış (migration sonrası mevcut
    // kullanıcılar dahil) — hiçbir session revoke edilmez.
    return false;
  }

  const revokedAt = thresholds.reduce((latest, current) =>
    current.getTime() > latest.getTime() ? current : latest,
  );

  if (typeof tokenIssuedAtSeconds !== "number" || !Number.isFinite(tokenIssuedAtSeconds)) {
    // Auth.js'in ürettiği her JWT'de `iat` her zaman set edilir (bkz. yukarıdaki dokümantasyon);
    // bu dal pratikte tetiklenmez. Eksikse fail-safe-open bırakılır — birincil kimlik doğrulama
    // (imza/şifre çözme/`exp`) zaten Auth.js tarafından bu noktadan ÖNCE uygulanmıştır; bu
    // fonksiyon SADECE ek bir credential-freshness katmanıdır.
    return false;
  }

  const tokenIssuedAtSecondEndMs = (tokenIssuedAtSeconds + 1) * 1000;
  return revokedAt.getTime() >= tokenIssuedAtSecondEndMs;
}
