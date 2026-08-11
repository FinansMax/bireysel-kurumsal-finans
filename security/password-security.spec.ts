import { expect, test } from "@playwright/test";

import { hashPassword, verifyPassword } from "../src/lib/auth/password";

test.describe("Password hashing security", () => {
  test("hash plaintext şifreyi içermiyor", async () => {
    const hash = await hashPassword("S3curePassw0rd!");
    expect(hash).not.toContain("S3curePassw0rd!");
  });

  test("doğru şifre kendi hash'ine karşı doğrulanıyor", async () => {
    const hash = await hashPassword("S3curePassw0rd!");
    await expect(verifyPassword("S3curePassw0rd!", hash)).resolves.toBe(true);
  });

  test("yanlış şifre reddediliyor", async () => {
    const hash = await hashPassword("S3curePassw0rd!");
    await expect(verifyPassword("WrongPassword!", hash)).resolves.toBe(false);
  });

  test("aynı şifre iki kez hash'lenince farklı salt/hash üretiliyor", async () => {
    const [hashA, hashB] = await Promise.all([
      hashPassword("same-password-123"),
      hashPassword("same-password-123"),
    ]);

    expect(hashA).not.toBe(hashB);

    const [saltA] = hashA.split(":");
    const [saltB] = hashB.split(":");
    expect(saltA).not.toBe(saltB);

    await expect(verifyPassword("same-password-123", hashA)).resolves.toBe(true);
    await expect(verifyPassword("same-password-123", hashB)).resolves.toBe(true);
  });

  test("bozuk formatlı (malformed) hash güvenli şekilde reddediliyor, hata fırlatmıyor", async () => {
    await expect(verifyPassword("anything", "not-a-valid-hash-format")).resolves.toBe(false);
    await expect(verifyPassword("anything", "")).resolves.toBe(false);
    await expect(verifyPassword("anything", "onlysalt:")).resolves.toBe(false);
  });
});
