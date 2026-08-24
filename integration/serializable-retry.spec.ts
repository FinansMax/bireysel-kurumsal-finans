import { Prisma } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { prisma } from "../src/lib/prisma";
import {
  DEFAULT_MAX_ATTEMPTS,
  runSerializable,
  SerializationConflictError,
} from "../src/lib/db/serializable";

/**
 * `runSerializable()` davranış testleri (Issue #122).
 *
 * Transaction'lar GERÇEKTİR (mock yok): yalnızca içeride fırlatılan hata sentetiktir, çünkü
 * gerçek bir serialization failure'ı istenen anda tetiklemek deterministik değildir. Gerçek
 * çakışma altındaki davranış ayrıca `integration/membership-concurrency.spec.ts`'te test edilir.
 *
 * Bu dosyanın asıl konusu: NEYİN yeniden denendiği ve — daha önemlisi — NEYİN DENENMEDİĞİ.
 */

test.afterAll(async () => {
  await prisma.$disconnect();
});

/** Prisma'nın serialization failure hatasının birebir aynısı (kod: P2034). */
function serializationFailure(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "Transaction failed due to a write conflict or a deadlock. Please retry your transaction",
    { code: "P2034", clientVersion: Prisma.prismaVersion.client },
  );
}

class DomainError extends Error {}

test.describe("runSerializable() — yeniden deneme", () => {
  test("P2034 sonrası yeniden dener ve sonunda başarılı olur", async () => {
    let attempts = 0;

    const result = await runSerializable(async () => {
      attempts += 1;
      if (attempts < 3) {
        throw serializationFailure();
      }
      return "tamam";
    });

    expect(result).toBe("tamam");
    expect(attempts).toBe(3);
  });

  test("ilk denemede başarılıysa tekrar çalıştırılmaz", async () => {
    let attempts = 0;

    await runSerializable(async () => {
      attempts += 1;
      return null;
    });

    expect(attempts).toBe(1);
  });

  test("denemeler tükenirse SerializationConflictError fırlatır (ham Prisma hatası DEĞİL)", async () => {
    let attempts = 0;

    await expect(
      runSerializable(async () => {
        attempts += 1;
        throw serializationFailure();
      }),
    ).rejects.toThrow(SerializationConflictError);

    // Sınır: tam olarak `maxAttempts` kadar denenir, bir fazla değil.
    expect(attempts).toBe(DEFAULT_MAX_ATTEMPTS);
  });

  test("maxAttempts parametresi dikkate alınır", async () => {
    let attempts = 0;

    await expect(
      runSerializable(async () => {
        attempts += 1;
        throw serializationFailure();
      }, 2),
    ).rejects.toThrow(SerializationConflictError);

    expect(attempts).toBe(2);
  });
});

test.describe("runSerializable() — yeniden DENENMEYENLER", () => {
  test("domain hatası (ör. NotFound) yeniden denenmez, olduğu gibi yukarı çıkar", async () => {
    let attempts = 0;

    await expect(
      runSerializable(async () => {
        attempts += 1;
        throw new DomainError("kayit bulunamadi");
      }),
    ).rejects.toThrow(DomainError);

    // KRİTİK: 1 — kalıcı bir durum (kayıt yok) üç kez denenirse hem gecikme hem de yanıltıcı
    // log üretir; üstelik gerçek hata `SerializationConflictError` ile maskelenirdi.
    expect(attempts).toBe(1);
  });

  test("başka bir Prisma hatası (P2002 unique constraint) yeniden denenmez", async () => {
    let attempts = 0;

    await expect(
      runSerializable(async () => {
        attempts += 1;
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: Prisma.prismaVersion.client,
        });
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    expect(attempts).toBe(1);
  });
});

test.describe("runSerializable() — gerçek transaction semantiği", () => {
  test("başarılı transaction'ın yazdığı veri kalıcıdır", async () => {
    const slug = `serializable-ok-${Date.now()}-${Math.round(Math.random() * 1e9)}`;

    const tenantId = await runSerializable(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: "Serializable OK", slug },
        select: { id: true },
      });
      return tenant.id;
    });

    try {
      expect(await prisma.tenant.count({ where: { id: tenantId } })).toBe(1);
    } finally {
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
  });

  test("hata fırlatan transaction geri alınır (yeniden denemede kalıntı kalmaz)", async () => {
    const slug = `serializable-rollback-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    let attempts = 0;

    // İlk denemede kayıt oluşturulur ve serialization failure fırlatılır; transaction rollback
    // olduğu için ikinci deneme AYNI slug'ı tekrar kullanabilmelidir. Rollback çalışmasaydı
    // ikinci deneme unique constraint'e (P2002) takılırdı.
    const tenantId = await runSerializable(async (tx) => {
      attempts += 1;
      const tenant = await tx.tenant.create({
        data: { name: "Serializable Rollback", slug },
        select: { id: true },
      });

      if (attempts === 1) {
        throw serializationFailure();
      }

      return tenant.id;
    });

    try {
      expect(attempts).toBe(2);
      expect(await prisma.tenant.count({ where: { slug } })).toBe(1);
    } finally {
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
  });
});
