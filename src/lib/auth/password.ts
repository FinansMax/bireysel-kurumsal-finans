import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

const SALT_BYTES = 16;
const KEY_LENGTH = 64;

/**
 * Şifreyi rastgele salt ile scrypt kullanarak hash'ler.
 * Sonuç `${saltHex}:${derivedKeyHex}` formatında, User.passwordHash alanında saklanmaya uygundur.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

/**
 * Şifreyi daha önce `hashPassword` ile üretilmiş bir hash'e karşı zamanlama saldırılarına
 * dayanıklı (timing-safe) şekilde doğrular.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, key] = storedHash.split(":");
  if (!salt || !key) {
    return false;
  }

  const keyBuffer = Buffer.from(key, "hex");
  const derivedKey = (await scrypt(password, salt, keyBuffer.length)) as Buffer;

  if (derivedKey.length !== keyBuffer.length) {
    return false;
  }

  return timingSafeEqual(keyBuffer, derivedKey);
}
