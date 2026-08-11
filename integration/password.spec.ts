import { expect, test } from "@playwright/test";

import { hashPassword, verifyPassword } from "../src/lib/auth/password";

test.describe("Password hashing helper", () => {
  test("doğru şifre, kendi hash'ine karşı doğrulanabiliyor", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    await expect(verifyPassword("correct-horse-battery-staple", hash)).resolves.toBe(true);
  });

  test("yanlış şifre reddediliyor", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  test("aynı şifre için üretilen hash'ler farklıdır (rastgele salt)", async () => {
    const [hashA, hashB] = await Promise.all([
      hashPassword("same-password"),
      hashPassword("same-password"),
    ]);

    expect(hashA).not.toBe(hashB);
    await expect(verifyPassword("same-password", hashA)).resolves.toBe(true);
    await expect(verifyPassword("same-password", hashB)).resolves.toBe(true);
  });

  test("plaintext şifre hash içinde görünmüyor", async () => {
    const hash = await hashPassword("plaintext-should-not-leak");
    expect(hash).not.toContain("plaintext-should-not-leak");
  });

  test("bozuk/geçersiz formatlı hash false döner, hata fırlatmaz", async () => {
    await expect(verifyPassword("anything", "not-a-valid-hash")).resolves.toBe(false);
  });
});
