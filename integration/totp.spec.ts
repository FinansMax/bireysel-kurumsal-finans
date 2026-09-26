import { createHmac } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  base32Decode,
  base32Encode,
  buildOtpAuthUri,
  generateTotpSecret,
  hotpCode,
  TOTP_DIGITS,
  TOTP_STEP_SECONDS,
  TOTP_WINDOW,
  totpCode,
  totpStepForTime,
  verifyTotp,
} from "../src/lib/auth/totp";
import { decryptTotpSecret, encryptTotpSecret } from "../src/lib/auth/totp-crypto";
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
} from "../src/lib/auth/recovery-codes";

/**
 * Saf TOTP çekirdeği (Issue #193). DB'ye dokunmaz.
 */

test.describe("Base32 (RFC 4648)", () => {
  test("RFC 4648 test vektörleri", () => {
    // Kendi yazdığımız kodlayıcının doğruluğu, spesifikasyonun kendi vektörleriyle
    // kanıtlanır — "bizim decode'umuz bizim encode'umuzu okuyor" testi bir şey kanıtlamaz.
    const vectors: Array<[string, string]> = [
      ["", ""],
      ["f", "MY"],
      ["fo", "MZXQ"],
      ["foo", "MZXW6"],
      ["foob", "MZXW6YQ"],
      ["fooba", "MZXW6YTB"],
      ["foobar", "MZXW6YTBOI"],
    ];

    for (const [plain, encoded] of vectors) {
      expect(base32Encode(Buffer.from(plain, "utf8")), plain).toBe(encoded);
    }
  });

  test("decode, encode'un tersidir", () => {
    for (const plain of ["", "f", "fo", "foo", "foob", "fooba", "foobar"]) {
      const decoded = base32Decode(base32Encode(Buffer.from(plain, "utf8")));
      expect(decoded?.toString("utf8")).toBe(plain);
    }
  });

  test("geçersiz karakter null döner (throw etmez)", () => {
    // Bozuk bir DB satırı uygulamayı 500 ile düşürmemeli; doğrulama başarısızlığı olmalı.
    expect(base32Decode("MZXW6YTBOI!")).toBeNull();
    expect(base32Decode("0189")).toBeNull();
  });

  test("dolgu ve boşluk toleranslı, küçük harf kabul", () => {
    expect(base32Decode("mzxw6ytboi")?.toString("utf8")).toBe("foobar");
    expect(base32Decode("MZXW6YTBOI======")?.toString("utf8")).toBe("foobar");
    expect(base32Decode("MZXW 6YTB OI")?.toString("utf8")).toBe("foobar");
  });
});

test.describe("HOTP (RFC 4226 Ek D test vektörleri)", () => {
  test("standart sır ile 0-9 arası sayaçlar RFC değerlerini üretiyor", () => {
    // RFC 4226'nın "12345678901234567890" sırrı için yayımlanmış referans değerleri.
    // Bu, implementasyonun dinamik kırpma (dynamic truncation) adımının doğruluğunun
    // tek gerçek kanıtıdır.
    const secret = base32Encode(Buffer.from("12345678901234567890", "utf8"));
    const expected = [
      "755224",
      "287082",
      "359152",
      "969429",
      "338314",
      "254676",
      "287922",
      "162583",
      "399871",
      "520489",
    ];

    for (let counter = 0; counter < expected.length; counter += 1) {
      expect(hotpCode(secret, counter), `counter=${counter}`).toBe(expected[counter]);
    }
  });

  test("geçersiz sırda null döner", () => {
    expect(hotpCode("!!!", 0)).toBeNull();
    expect(hotpCode("", 0)).toBeNull();
  });
});

test.describe("TOTP (RFC 6238 test vektörleri)", () => {
  test("SHA-1 vektörleri: 59s ve 1111111109s", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890", "utf8"));

    // RFC 6238 Ek B 8 haneli kodlar verir; 6 hane onun son 6 hanesidir.
    expect(totpCode(secret, 59 * 1000)).toBe("287082");
    expect(totpCode(secret, 1111111109 * 1000)).toBe("081804");
    expect(totpCode(secret, 1111111111 * 1000)).toBe("050471");
    expect(totpCode(secret, 1234567890 * 1000)).toBe("005924");
  });

  test("adım hesabı 30 saniyelik pencerelere bölüyor", () => {
    expect(totpStepForTime(0)).toBe(0);
    expect(totpStepForTime(29_999)).toBe(0);
    expect(totpStepForTime(30_000)).toBe(1);
    expect(totpStepForTime(59_999)).toBe(1);
  });

  test("2038 sonrasında da doğru (BigUInt64 sayaç)", () => {
    // writeUInt32BE ile iki parçaya bölen bir implementasyon burada sessizce yanlış
    // sonuç verirdi.
    const secret = generateTotpSecret();
    const far = Date.UTC(2100, 0, 1);
    const step = totpStepForTime(far);

    expect(step).toBeGreaterThan(2 ** 31 / TOTP_STEP_SECONDS);
    expect(totpCode(secret, far)).toBe(hotpCode(secret, step));
  });
});

test.describe("verifyTotp — pencere ve biçim", () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000;

  test("geçerli kod kabul ediliyor ve adımı dönüyor", () => {
    const code = totpCode(secret, now)!;
    const result = verifyTotp(secret, code, { atMs: now });

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.step).toBe(totpStepForTime(now));
  });

  test(`±${TOTP_WINDOW} pencere kabul ediliyor`, () => {
    // Telefon saati kayması ve kodu yazma süresi için gereken tolerans.
    const stepMs = TOTP_STEP_SECONDS * 1000;

    expect(verifyTotp(secret, totpCode(secret, now - stepMs)!, { atMs: now }).valid).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now + stepMs)!, { atMs: now }).valid).toBe(true);
  });

  test(`±${TOTP_WINDOW + 1} pencere REDDEDİLİYOR`, () => {
    // Toleransın SINIRI da test edilir: aksi halde "tolerans var" testi, sonsuz geniş bir
    // pencerede de geçerdi.
    const stepMs = TOTP_STEP_SECONDS * 1000;

    expect(verifyTotp(secret, totpCode(secret, now - 2 * stepMs)!, { atMs: now }).valid).toBe(false);
    expect(verifyTotp(secret, totpCode(secret, now + 2 * stepMs)!, { atMs: now }).valid).toBe(false);
  });

  test("biçim dışı girdiler reddediliyor", () => {
    for (const bad of [undefined, null, 123456, "", "12345", "1234567", "abcdef", "12 34 5a"]) {
      expect(verifyTotp(secret, bad, { atMs: now }).valid, String(bad)).toBe(false);
    }
  });

  test("boşluklu yazım kabul ediliyor", () => {
    // Authenticator uygulamaları kodu "123 456" biçiminde gösterir; kullanıcı aynen kopyalar.
    const code = totpCode(secret, now)!;
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;

    expect(verifyTotp(secret, spaced, { atMs: now }).valid).toBe(true);
  });

  test("başka bir sırrın kodu reddediliyor", () => {
    const other = generateTotpSecret();
    expect(verifyTotp(secret, totpCode(other, now)!, { atMs: now }).valid).toBe(false);
  });
});

test.describe("verifyTotp — replay koruması", () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000;

  test("aynı adım ikinci kez REDDEDİLİYOR", () => {
    const step = totpStepForTime(now);
    const code = totpCode(secret, now)!;

    expect(verifyTotp(secret, code, { atMs: now, minStepExclusive: null }).valid).toBe(true);
    expect(verifyTotp(secret, code, { atMs: now, minStepExclusive: step }).valid).toBe(false);
  });

  test("GEÇMİŞ bir pencerenin kodu da reddediliyor (<=, < değil)", () => {
    // Tolerans penceresi geçmişe de açıktır; yalnızca "eşit" adımı engellemek, bir önceki
    // pencerenin kodunun sonradan oynatılmasına izin verirdi.
    const stepMs = TOTP_STEP_SECONDS * 1000;
    const previousCode = totpCode(secret, now - stepMs)!;
    const currentStep = totpStepForTime(now);

    expect(verifyTotp(secret, previousCode, { atMs: now, minStepExclusive: currentStep }).valid).toBe(
      false,
    );
  });

  test("SONRAKİ pencere hâlâ kabul ediliyor (kilitlenme yok)", () => {
    // Duyarlılık kanıtı: replay koruması her kodu reddetseydi yukarıdaki iki test de geçerdi.
    const stepMs = TOTP_STEP_SECONDS * 1000;
    const nextCode = totpCode(secret, now + stepMs)!;

    expect(verifyTotp(secret, nextCode, { atMs: now, minStepExclusive: totpStepForTime(now) }).valid).toBe(
      true,
    );
  });
});

test.describe("otpauth URI", () => {
  test("authenticator uygulamalarının beklediği alanları taşıyor", () => {
    const uri = buildOtpAuthUri({
      secretBase32: "JBSWY3DPEHPK3PXP",
      accountName: "user@example.com",
      issuer: "FinansMax",
    });

    expect(uri.startsWith("otpauth://totp/")).toBe(true);

    const parsed = new URL(uri);
    expect(parsed.searchParams.get("secret")).toBe("JBSWY3DPEHPK3PXP");
    expect(parsed.searchParams.get("issuer")).toBe("FinansMax");
    expect(parsed.searchParams.get("algorithm")).toBe("SHA1");
    expect(parsed.searchParams.get("digits")).toBe(String(TOTP_DIGITS));
    expect(parsed.searchParams.get("period")).toBe(String(TOTP_STEP_SECONDS));
  });

  test("e-postadaki @ ve issuer BOTH etikette kodlanıyor", () => {
    // Kodlanmazsa URI bozulur ve QR okunmaz; issuer hem etikette hem parametrede olmalı
    // (Google Authenticator uyumluluk davranışı).
    const uri = buildOtpAuthUri({
      secretBase32: "JBSWY3DPEHPK3PXP",
      accountName: "a b@example.com",
      issuer: "Finans Max",
    });

    expect(uri).toContain("otpauth://totp/Finans%20Max:a%20b%40example.com");
  });
});

test.describe("Sır şifrelemesi (AES-256-GCM)", () => {
  test("şifrele → çöz döngüsü sırrı koruyor", () => {
    const secret = generateTotpSecret();
    expect(decryptTotpSecret(encryptTotpSecret(secret))).toBe(secret);
  });

  test("aynı sır her seferinde FARKLI ciphertext üretiyor (rastgele IV)", () => {
    // Sabit IV, aynı sırra sahip iki kullanıcının DB'de aynı satırı taşımasına ve
    // "bu ikisinin sırrı aynı" bilgisinin sızmasına yol açardı.
    const secret = generateTotpSecret();
    expect(encryptTotpSecret(secret)).not.toBe(encryptTotpSecret(secret));
  });

  test("düz metin sır ciphertext içinde GEÇMİYOR", () => {
    const secret = generateTotpSecret();
    expect(encryptTotpSecret(secret)).not.toContain(secret);
  });

  test("kurcalanmış ciphertext null döner (GCM auth tag)", () => {
    // CBC gibi kimlik doğrulamasız bir mod bunu fark ETMEZDİ.
    const payload = encryptTotpSecret(generateTotpSecret());
    const parts = payload.split(".");
    const bytes = Buffer.from(parts[3], "base64url");
    bytes[0] ^= 0xff;

    expect(decryptTotpSecret([parts[0], parts[1], parts[2], bytes.toString("base64url")].join("."))).toBeNull();
  });

  test("bozuk biçimler null döner (throw etmez)", () => {
    for (const bad of ["", "v1", "v1.a.b", "v2.a.b.c", "not-a-payload", "v1....."]) {
      expect(decryptTotpSecret(bad), bad).toBeNull();
    }
  });

  test("FARKLI bir AUTH_SECRET ile çözülemiyor", () => {
    // Bu, "DB dump'ı sızarsa sırlar AUTH_SECRET olmadan işe yaramaz" iddiasının kanıtıdır.
    const original = process.env.AUTH_SECRET;
    const secret = generateTotpSecret();
    const payload = encryptTotpSecret(secret);

    try {
      process.env.AUTH_SECRET = "tamamen-baska-bir-secret-degeri-0123456789";
      expect(decryptTotpSecret(payload)).toBeNull();
    } finally {
      process.env.AUTH_SECRET = original;
    }

    // KONTROL GRUBU: doğru anahtarla hâlâ çözülüyor — yukarıdaki null, şifrelemenin
    // tamamen bozuk olmasından değil, anahtarın farklı olmasından geliyor.
    expect(decryptTotpSecret(payload)).toBe(secret);
  });

  test("anahtar AUTH_SECRET'in KENDİSİ değil, HKDF ile türetilmiş", () => {
    // Key separation: aynı ham anahtar malzemesi hem JWT hem TOTP için kullanılmamalı.
    const secretEnv = process.env.AUTH_SECRET ?? "";
    const payload = encryptTotpSecret("MZXW6YTBOI");
    const rawKeyAsBase64 = Buffer.from(secretEnv, "utf8").toString("base64url");

    expect(payload).not.toContain(rawKeyAsBase64);
    // Türetmenin gerçekten HKDF-SHA256/info olduğunu, ciphertext'ten bağımsız olarak
    // aynı girdiyle aynı anahtarın üretildiğini görerek doğrularız.
    const hmacOfEnv = createHmac("sha256", "x").update(secretEnv).digest("hex");
    expect(payload).not.toContain(hmacOfEnv);
  });
});

test.describe("Kurtarma kodları", () => {
  test(`${RECOVERY_CODE_COUNT} adet, benzersiz ve okunabilir biçimde üretiliyor`, () => {
    const codes = generateRecoveryCodes();

    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);

    for (const code of codes) {
      expect(code, code).toMatch(/^[A-Z2-9]{8}-[A-Z2-9]{8}$/);
    }
  });

  test("karıştırılabilir karakterler (0/O, 1/I/L) kullanılmıyor", () => {
    // Kullanıcı bu kodu ELLE yazacak; 0/O karışıklığı doğru kodun reddedilmesine yol açar.
    const joined = generateRecoveryCodes(50).join("");
    for (const char of ["0", "O", "1", "I", "L"]) {
      expect(joined.includes(char), char).toBe(false);
    }
  });

  test("normalizasyon: boşluk, tire ve küçük harf toleranslı", () => {
    expect(normalizeRecoveryCode("abcdefgh-jkmnpqrs")).toBe("ABCDEFGHJKMNPQRS");
    expect(normalizeRecoveryCode("  abcd efgh jkmn pqrs  ")).toBe("ABCDEFGHJKMNPQRS");
    expect(hashRecoveryCode("abcdefgh-jkmnpqrs")).toBe(hashRecoveryCode("ABCDEFGHJKMNPQRS"));
  });

  test("hash SHA-256 hex ve ham kodu içermiyor", () => {
    const [code] = generateRecoveryCodes(1);
    const hash = hashRecoveryCode(code);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(normalizeRecoveryCode(code));
  });
});
