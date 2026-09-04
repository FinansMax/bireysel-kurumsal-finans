import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * RFC 6238 TOTP — saf hesaplama katmanı (Issue #193).
 *
 * Bu modül DB bilmez, request bilmez, side effect içermez. Yalnızca "şu sır ve şu an için
 * geçerli kod nedir" sorusunu cevaplar. Depolama, replay koruması ve rate limit bir üst
 * katmandadır (`totp-enrollment.ts`, `totp-verification.ts`).
 *
 * BAĞIMLILIK EKLENMEDİ: RFC 6238'in tamamı HMAC + bir sayaçtır ve Node'un `crypto` modülü
 * ikisini de veriyor. Bu repo bilinçli olarak yalın (bkz. CLAUDE.md § 4).
 *
 * SHA-1 KULLANILIYOR VE BU DOĞRUDUR. SHA-1 çakışma saldırılarına karşı kırıktır, ama TOTP
 * onu bir HMAC anahtarıyla, tek yönlü ve kısa ömürlü bir kod üretmek için kullanır —
 * HMAC-SHA1'e karşı pratik bir saldırı yoktur. Daha önemlisi: SHA-1, RFC 6238'in
 * varsayılanıdır ve Google Authenticator/Authy/1Password dahil yaygın uygulamaların
 * TAMAMI bunu bekler. SHA-256'ya geçmek güvenliği ölçülebilir şekilde artırmaz ama
 * kullanıcıların yarısının uygulamasını bozar.
 */

/** RFC 6238 varsayılanı. Değiştirmek her authenticator uygulamasıyla uyumu bozar. */
export const TOTP_STEP_SECONDS = 30;

/** 6 hane — yaygın uygulamaların tamamının beklediği uzunluk. */
export const TOTP_DIGITS = 6;

/**
 * Sır uzunluğu: 20 bayt = 160 bit, RFC 4226'nın önerdiği HMAC-SHA1 anahtar boyutu.
 * Base32'de tam olarak 32 karaktere denk gelir ve dolgu (`=`) gerektirmez — elle
 * girmesi gereken kullanıcı için de temiz bir dize.
 */
const SECRET_BYTES = 20;

/**
 * ±1 pencere toleransı (yani ~30 sn geriye, ~30 sn ileriye).
 *
 * NEDEN 1: kullanıcının telefonu ile sunucunun saati arasındaki küçük kaymayı ve kodu
 * yazma süresini karşılar. Daha geniş bir pencere (±2, ±3) saldırı yüzeyini doğrudan
 * büyütür: yakalanan bir kodun geçerli kaldığı süre uzar ve brute-force için aynı anda
 * geçerli kod sayısı artar.
 */
export const TOTP_WINDOW = 1;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32 — authenticator uygulamalarının beklediği kodlama. Dolgu kullanılmaz. */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Base32 çözer. Geçersiz karakterde `null` döner — throw ETMEZ.
 *
 * NEDEN null: bu fonksiyonun girdisi (şifresi çözülmüş sır) her zaman bizim ürettiğimiz bir
 * değerdir, ama bozuk bir DB satırının uygulamayı 500 ile düşürmesindense çağıranın bunu
 * bir doğrulama başarısızlığı olarak ele alması yeğdir.
 */
export function base32Decode(input: string): Buffer | null {
  const normalized = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      return null;
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/** Yeni bir TOTP sırrı üretir (base32, authenticator'a verilecek biçimde). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

/** Verilen an için zaman penceresi indeksi. `Math.floor` negatif zamanlarda da doğrudur. */
export function totpStepForTime(atMs: number): number {
  return Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
}

/**
 * RFC 4226 HOTP: verilen sayaç için kod üretir.
 *
 * Sayaç 8 baytlık big-endian olarak yazılır. `writeBigUInt64BE` kullanılıyor çünkü
 * `writeUInt32BE` ile iki parçaya bölmek 2038 sonrasında sessizce yanlış sonuç verirdi.
 */
export function hotpCode(secretBase32: string, counter: number): string | null {
  const key = base32Decode(secretBase32);
  if (!key || key.length === 0) {
    return null;
  }

  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac("sha1", key).update(counterBuffer).digest();

  // RFC 4226 § 5.3 dinamik kırpma (dynamic truncation).
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return (binary % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, "0");
}

/** Verilen an için beklenen TOTP kodu. */
export function totpCode(secretBase32: string, atMs: number = Date.now()): string | null {
  return hotpCode(secretBase32, totpStepForTime(atMs));
}

export type TotpVerifyResult =
  | { valid: true; step: number }
  | { valid: false };

export type VerifyTotpOptions = {
  atMs?: number;
  /** Bu adım (dahil) ve öncesi REDDEDİLİR — replay koruması (bkz. `lastUsedStep`). */
  minStepExclusive?: number | null;
};

/**
 * Bir kodu doğrular ve HANGİ pencerede eşleştiğini döner.
 *
 * SABİT ZAMANLI KARŞILAŞTIRMA (`timingSafeEqual`): kodlar 6 hanedir, yani düşük entropilidir
 * ve `===` ile karşılaştırmak, ilk hanesi doğru bir tahminin ölçülebilir şekilde daha uzun
 * sürmesine yol açabilirdi. Bu, kodu haneyle brute-force etmeyi mümkün kılan klasik bir yan
 * kanaldır.
 *
 * PENCERELERİN TAMAMI DENENİR, ERKEN ÇIKILMAZ: ilk eşleşmede `break` etmek, "kod hangi
 * pencerede eşleşti" bilgisini zamanlama üzerinden sızdırırdı. Üç HMAC hesaplamak ucuzdur.
 *
 * `minStepExclusive` REPLAY'İ ENGELLER: aynı kod (aynı adım) ikinci kez kabul edilmez.
 * Karşılaştırma `<=` ile yapılır — geçmiş bir pencereye ait bir kod, sonradan gelse bile
 * kabul edilmemelidir.
 */
export function verifyTotp(
  secretBase32: string,
  candidate: unknown,
  options: VerifyTotpOptions = {},
): TotpVerifyResult {
  if (typeof candidate !== "string") {
    return { valid: false };
  }

  const normalized = candidate.replace(/\s+/g, "");
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(normalized)) {
    return { valid: false };
  }

  const currentStep = totpStepForTime(options.atMs ?? Date.now());
  const candidateBuffer = Buffer.from(normalized, "utf8");

  let matchedStep: number | null = null;

  for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset += 1) {
    const step = currentStep + offset;
    const expected = hotpCode(secretBase32, step);

    if (!expected) {
      continue;
    }

    const expectedBuffer = Buffer.from(expected, "utf8");
    if (
      expectedBuffer.length === candidateBuffer.length &&
      timingSafeEqual(expectedBuffer, candidateBuffer)
    ) {
      matchedStep = step;
    }
  }

  if (matchedStep === null) {
    return { valid: false };
  }

  const minStep = options.minStepExclusive;
  if (typeof minStep === "number" && matchedStep <= minStep) {
    // Aynı kod (veya daha eski bir pencere) yeniden kullanılmaya çalışılıyor.
    return { valid: false };
  }

  return { valid: true, step: matchedStep };
}

/**
 * Authenticator uygulamasının okuyacağı `otpauth://` URI'si.
 *
 * `issuer` HEM etikette HEM parametrede yazılır: bu, Google Authenticator'ın belgelediği
 * uyumluluk davranışıdır — bazı uygulamalar yalnızca etiketi, bazıları yalnızca parametreyi
 * okur. `encodeURIComponent` her iki alanda da zorunludur; aksi halde e-postadaki bir `@`
 * veya issuer'daki bir boşluk URI'yi bozar.
 */
export function buildOtpAuthUri(params: {
  secretBase32: string;
  accountName: string;
  issuer: string;
}): string {
  const label = `${encodeURIComponent(params.issuer)}:${encodeURIComponent(params.accountName)}`;
  const query = new URLSearchParams({
    secret: params.secretBase32,
    issuer: params.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });

  return `otpauth://totp/${label}?${query.toString()}`;
}
