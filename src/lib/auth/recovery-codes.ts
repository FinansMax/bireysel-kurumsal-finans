import { createHash, randomBytes } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * Kurtarma kodları (Issue #193).
 *
 * TELEFONUNU KAYBEDEN KULLANICI KENDİ HESABINDAN KİLİTLENMEMELİDİR. Bu yüzden 2FA,
 * kurtarma kodları üretilmeden aktifleştirilemez (bkz. `totp-enrollment.ts`).
 */

/** 10 kod: kaybolma/tükenme riskine karşı yeterli, kullanıcının saklayamayacağı kadar çok değil. */
export const RECOVERY_CODE_COUNT = 10;

/**
 * Kod uzunluğu: 16 karakter (`XXXXXXXX-XXXXXXXX`).
 *
 * ENTROPİ, BAYT SAYISI DEĞİL KARAKTER SAYISIYLA ÖLÇÜLÜR: her karakter 31 sembollük
 * alfabeden seçilir, yani ~4.95 bit taşır. 16 karakter ≈ **79 bit** — şifre gibi düşük
 * entropili bir sır DEĞİLDİR ve brute-force edilebilirliği kendi entropisiyle sınırlıdır.
 * Bu yüzden hızlı SHA-256 yeterlidir (`PasswordResetToken` ile aynı gerekçe).
 *
 * `randomBytes` çıktısındaki bayt sayısını entropi olarak saymak YANILTICI olurdu: 256
 * değerlik bir bayt 31 sembole indirgendiğinde bilgi kaybeder.
 */
const RECOVERY_CODE_LENGTH = 16;

/** Görsel olarak ayrıştırılabilir Base32: `0/O` ve `1/I/L` karışıklığı yok. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Kullanıcı bu kodları ELLE yazacaktır. Bu yüzden normalleştirme cömerttir: boşluklar ve
 * tireler atılır, küçük harf büyütülür. Kabul edilen karakter kümesini daraltmak, kullanıcının
 * doğru kodu yazıp reddedilmesine yol açardı.
 */
export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[\s-]+/g, "").toUpperCase();
}

export function hashRecoveryCode(rawCode: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(rawCode)).digest("hex");
}

/** `XXXXXXXX-XXXXXXXX` biçiminde okunabilir bir kod üretir. */
function generateOne(): string {
  const bytes = randomBytes(RECOVERY_CODE_LENGTH);
  let out = "";

  for (const byte of bytes) {
    // Modulo sapması: 256 % 31 !== 0 olduğu için alfabenin ilk karakterleri çok az daha
    // olasıdır (256 = 8*31 + 8, yani ilk 8 sembol 9/256, kalanı 8/256). Etkisi entropiyi
    // ~79 bitten ölçülemeyecek kadar az düşürür ve bu bir kriptografik anahtar değil, tek
    // kullanımlık bir kurtarma dizesidir. Reddetme örneklemesi (rejection sampling) buraya
    // ölçülebilir bir güvenlik katmazdı.
    out += ALPHABET[byte % ALPHABET.length];
  }

  // Ortadaki tire yalnızca okunabilirlik içindir; `normalizeRecoveryCode()` onu atar.
  return `${out.slice(0, 8)}-${out.slice(8)}`;
}

export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, generateOne);
}

/**
 * Kullanıcının TÜM kurtarma kodlarını değiştirir — eskiler silinir, yenileri yazılır.
 *
 * `tx` ALIR: kod üretimi her zaman 2FA'nın açılması/yenilenmesiyle AYNI transaction'da
 * olmalıdır. Ayrı bir yazma, "2FA açıldı ama kurtarma kodu yok" (kullanıcı kilitlenir) ya da
 * "kodlar üretildi ama 2FA açılmadı" (kullanıcı işe yaramaz kodlar saklar) durumlarını
 * mümkün kılardı.
 */
export async function replaceRecoveryCodes(
  tx: Prisma.TransactionClient,
  userId: string,
  codes: string[],
): Promise<void> {
  await tx.userRecoveryCode.deleteMany({ where: { userId } });
  await tx.userRecoveryCode.createMany({
    data: codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code) })),
  });
}

/**
 * Bir kurtarma kodunu ATOMİK olarak tüketir. Başarılıysa `true`.
 *
 * EŞZAMANLILIK: tüketim tek bir koşullu `updateMany` ile yapılır
 * (WHERE userId = ? AND codeHash = ? AND usedAt IS NULL). Aynı kod aynı anda iki kez
 * gönderilse bile veritabanı seviyesinde yalnızca biri `count === 1` görür. "Önce oku, sonra
 * yaz" deseninin aksine bu, iki isteğin aynı kodu birlikte tüketmesini YAPISAL olarak
 * engeller (bkz. `password-reset.ts`'teki aynı desen).
 *
 * `userId` KOŞULA DAHİLDİR: `codeHash` zaten unique, ama sahibi de kontrol edilmezse bir
 * kullanıcının kodu başka bir kullanıcının girişinde tüketilebilirdi.
 */
export async function consumeRecoveryCode(userId: string, rawCode: unknown): Promise<boolean> {
  if (typeof rawCode !== "string") {
    return false;
  }

  const normalized = normalizeRecoveryCode(rawCode);
  if (normalized.length === 0) {
    return false;
  }

  const result = await prisma.userRecoveryCode.updateMany({
    where: { userId, codeHash: hashRecoveryCode(normalized), usedAt: null },
    data: { usedAt: new Date() },
  });

  return result.count === 1;
}

/** Kullanıcının kalan (kullanılmamış) kurtarma kodu sayısı. */
export async function countUnusedRecoveryCodes(userId: string): Promise<number> {
  return prisma.userRecoveryCode.count({ where: { userId, usedAt: null } });
}
