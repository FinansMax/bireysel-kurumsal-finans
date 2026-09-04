import { PrismaClient } from "@prisma/client";

import { getRuntimeDatabaseUrl, withConnectionLimit } from "@/lib/config/database";

/**
 * Uygulama genelinde tek `PrismaClient` (singleton).
 *
 * ÇALIŞMA ZAMANI ADRESİ HAVUZLANMIŞ OLABİLİR (Issue #187): `DATABASE_POOL_URL` tanımlıysa
 * client onu kullanır; tanımsızsa şemadaki `DATABASE_URL`'e düşer ve davranış BİREBİR
 * bugünküyle aynı kalır (lokal geliştirme ve CI etkilenmez).
 *
 * MIGRATION'LAR BU YOLDAN GEÇMEZ: `prisma migrate`/`generate` şemadaki `datasource`'u okur ve
 * o DAİMA `DATABASE_URL`'dir — yani doğrudan bağlantı. Gerekçe `src/lib/config/database.ts`'te
 * yazılıdır (pooler transaction modunda prepared statement ve oturum durumu desteklemez).
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const pooledUrl = getRuntimeDatabaseUrl();

  if (!pooledUrl) {
    return new PrismaClient();
  }

  return new PrismaClient({ datasourceUrl: withConnectionLimit(pooledUrl) });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// Dev'de hot-reload her modül yeniden yüklendiğinde YENİ bir client üretirdi; her biri kendi
// havuzunu açar ve birkaç dakikada `too many connections` alınır. Production'da global'e
// yazılmaz: orada modül bir kez yüklenir ve global'i kirletmenin bir faydası yoktur.
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
