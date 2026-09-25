import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * TOTP sırrının şifrelenmesi (Issue #193).
 *
 * NEDEN HASH DEĞİL ŞİFRELEME: şifreler ve token'lar tek yönlü hash'lenir çünkü doğrulama
 * "aynı şeyi hash'le, karşılaştır" ile yapılır. TOTP'de bu mümkün DEĞİLDİR — kod, sırdan
 * HESAPLANIR, yani sır doğrulama anında geri okunmak zorundadır. Bu yüzden yapılabilecek en
 * iyi şey, DB dump'ı sızdığında sırların `AUTH_SECRET` olmadan işe yaramaz olmasıdır.
 *
 * NE KORUR, NE KORUMAZ: yalnızca veritabanı sızıntısını korur. Uygulama sunucusu ele
 * geçirilirse `AUTH_SECRET` de saldırgandadır ve sırlar açılabilir. Bu, sunucuda çözülmesi
 * gereken her sır için geçerli olan kaçınılmaz sınırdır ve kabul edilmiştir.
 *
 * AES-256-GCM: kimlik doğrulamalı şifreleme. CBC gibi bir mod, DB'ye yazma erişimi olan
 * birinin ciphertext'i değiştirmesini fark ettirmezdi; GCM'in auth tag'i çözmeyi başarısız
 * kılar.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 12; // GCM için önerilen uzunluk.
const AUTH_TAG_LENGTH = 16;

/**
 * Anahtar `AUTH_SECRET`'ten HKDF ile türetilir, DOĞRUDAN kullanılmaz.
 *
 * NEDEN: `AUTH_SECRET` zaten JWT imzalama/şifrelemede kullanılıyor. Aynı ham anahtar
 * malzemesini iki farklı kriptografik amaçla kullanmak, bir kullanımdaki zayıflığın
 * diğerine taşınmasına yol açabilir (key separation ilkesi). Sabit ve amaca özel bir `info`
 * etiketi, iki kullanımın anahtarlarını birbirinden bağımsız kılar.
 */
const HKDF_INFO = "finansmax:totp-secret:v1";

function getEncryptionKey(): Buffer {
  const secret = process.env.AUTH_SECRET?.trim();

  if (!secret) {
    // Bilerek fırlatılır: TOTP sırlarını şifrelenmemiş saklamaktansa özelliğin
    // çalışmaması yeğdir. `AUTH_SECRET` zaten uygulamanın çalışması için zorunludur.
    throw new Error(
      "AUTH_SECRET is not set. It is required to derive the encryption key for TOTP secrets.",
    );
  }

  // Salt boş bırakılır: HKDF'in salt'ı gizli olmak zorunda değildir ve burada tek bir
  // deterministik anahtar gerekiyor — her satır için farklı bir salt saklamak, çözme için
  // onu da okumayı gerektirirdi ve ek bir güvenlik sağlamazdı (asıl gizlilik AUTH_SECRET'te).
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), HKDF_INFO, KEY_LENGTH));
}

/**
 * Şifreler. Çıktı biçimi: `v1.<iv>.<authTag>.<ciphertext>` (hepsi base64url).
 *
 * SÜRÜM ÖN EKİ (`v1`): ileride algoritma veya türetme değişirse, eski satırların hangi
 * şemayla yazıldığı okunabilir olmalıdır. Bunu sonradan eklemek, sürümsüz satırları
 * tahmin etmeyi gerektirirdi.
 */
export function encryptTotpSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Çözer. Bozuk, kurcalanmış veya farklı bir `AUTH_SECRET` ile yazılmış değerde `null` döner.
 *
 * THROW ETMEZ: çözülemeyen bir sır, kullanıcının 2FA'sının çalışmaması demektir — bu bir
 * doğrulama başarısızlığı olarak ele alınmalı ve kullanıcı kurtarma koduyla girebilmelidir.
 * Uygulamayı 500 ile düşürmek, `AUTH_SECRET` döndürülmüş bir ortamda tüm giriş akışını
 * kilitlerdi.
 */
export function decryptTotpSecret(payload: string): string | null {
  const parts = payload.split(".");

  if (parts.length !== 4 || parts[0] !== "v1") {
    return null;
  }

  try {
    const iv = Buffer.from(parts[1], "base64url");
    const authTag = Buffer.from(parts[2], "base64url");
    const ciphertext = Buffer.from(parts[3], "base64url");

    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
      return null;
    }

    const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // GCM auth tag doğrulaması başarısız (kurcalanmış veya yanlış anahtar) — ayrıştırılmaz.
    return null;
  }
}
