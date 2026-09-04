/**
 * Veritabanı bağlantı adresi çözümlemesi (Issue #187).
 *
 * SORUN: her istekte session revocation için bir `User` sorgusu atılıyor (doğru bir karar,
 * bkz. README "Session Revocation"). Bu, uygulamanın en sıcak sorgusudur ve serverless bir
 * deployment'ta Prisma + Postgres bağlantı limiti klasik duvardır: her instance kendi
 * havuzunu açar, `max_connections` hızla dolar ve uygulama `too many connections` ile çöker.
 * Trafik artınca ANİDEN ortaya çıkar; önceden yapılandırılmazsa ilk yoğun günde yaşanır.
 *
 * ---
 *
 * İKİ AYRI ADRES, İKİ AYRI İŞ:
 *
 * - `DATABASE_URL` — DOĞRUDAN bağlantı. Migration'lar ve `prisma generate` bunu kullanır.
 * - `DATABASE_POOL_URL` — HAVUZLANMIŞ bağlantı (Neon pooled endpoint). Uygulama çalışma
 *   zamanı bunu kullanır.
 *
 * MIGRATION'LAR POOLER ÜZERİNDEN ÇALIŞTIRILMAZ. Neon'un pooler'ı (PgBouncer, transaction
 * modu) prepared statement'ları ve oturum düzeyi durumu desteklemez; Prisma Migrate advisory
 * lock alır ve DDL'i tek bir oturumda yürütür — pooler üzerinden bu davranış bozulur ve
 * migration yarıda kalabilir. Bu yüzden `prisma/schema.prisma`'daki `datasource` BİLEREK
 * `DATABASE_URL`'e bağlı kalır; havuzlanmış adres yalnızca çalışma zamanında, `PrismaClient`
 * yapıcısına `datasourceUrl` olarak verilir.
 *
 * NEDEN ŞEMADA `directUrl` DEĞİL: `directUrl` kullanmak `url`'i `DATABASE_POOL_URL`'e bağlamayı
 * gerektirirdi ve o değişken tanımsız olduğunda (lokal geliştirme, CI) Prisma HİÇ çalışmazdı —
 * `env()` içinde geri düşüş ifade edilemez. Programatik çözüm, havuz yokken davranışı
 * BİREBİR bugünküyle aynı bırakır.
 */

/**
 * Uygulama çalışma zamanının kullanacağı adres.
 *
 * `null` = havuz yapılandırılmamış; `PrismaClient` şemadaki `DATABASE_URL`'i kullanır
 * (bugünkü davranış, lokal ve CI için doğru olan).
 */
export function getRuntimeDatabaseUrl(): string | null {
  const pooled = process.env.DATABASE_POOL_URL?.trim();
  return pooled && pooled.length > 0 ? pooled : null;
}

/**
 * Havuzlanmış bir adres, aynı zamanda uygulama başına bağlantı sayısını da sınırlamalıdır.
 *
 * NEDEN: pooler tarafındaki limit sunucu genelindedir; istemci tarafında sınır koymazsak tek
 * bir instance havuzun tamamını tüketebilir ve diğer instance'lar aç kalır. Neon'un pooled
 * endpoint'i zaten çok sayıda istemciyi karşılar, ama Prisma'nın kendi havuzu varsayılan
 * olarak `num_cpus * 2 + 1` bağlantı açar — serverless'ta bu, instance sayısıyla çarpılır.
 *
 * Adreste zaten bir `connection_limit` varsa DOKUNULMAZ: operatörün açık tercihi, buradaki
 * varsayılandan önceliklidir.
 */
export const DEFAULT_CONNECTION_LIMIT = 5;

export function withConnectionLimit(url: string, limit = DEFAULT_CONNECTION_LIMIT): string {
  // Geçersiz bir adresi burada düzeltmeye çalışmayız; Prisma zaten açık bir hata verir.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  if (parsed.searchParams.has("connection_limit")) {
    return url;
  }

  parsed.searchParams.set("connection_limit", String(limit));
  return parsed.toString();
}
