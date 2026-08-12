/**
 * Tenant-scoped sorgular için merkezi, minimal helper (Issue #13).
 *
 * Bu modül Prisma'yı sarmalamaz, bir repository framework'ü DEĞİLDİR ve generic bir
 * `tenantRepository<T>()` soyutlaması sunmaz. Tek amacı: tenant-owned bir modele ait
 * sorguda `tenantId` filtresinin YANLIŞLIKLA unutulmasını zorlaştırmaktır. `where`
 * objesine `tenantId`'yi merge eder; çağıran taraf normal Prisma `where` sözdizimini
 * kullanmaya devam eder.
 *
 * Kural (bkz. CLAUDE.md "Tenant Veri İzolasyonu"): tenant-owned bir kaynağa resource
 * ID (örn. membershipId) ile erişilen HER sorguda (lookup, update, delete) `where`
 * `tenantScoped()` üzerinden geçmelidir. Yalnızca `{ id }` ile sorgulama
 * (`findUnique`/`update`/`delete` by id) tenant-scoped modeller için GÜVENLİ KABUL
 * EDİLMEZ — Tenant B'ye ait geçerli bir ID, Tenant A context'inde yanlışlıkla eşleşebilir.
 *
 * Prisma `update()`/`delete()` yalnızca unique alanları `where`'de kabul eder; `id` +
 * `tenantId` birlikte bir unique alan olmadığından, tenant-scoped update/delete
 * `updateMany`/`deleteMany` + `result.count === 1` kontrolü ile yapılmalıdır (bkz.
 * `src/lib/tenants/membership.ts` örneği — gelecekteki tenant-scoped modeller aynı
 * deseni takip etmelidir).
 */
export function tenantScoped<Where extends Record<string, unknown>>(
  tenantId: string,
  where: Where,
): Where & { tenantId: string } {
  return { ...where, tenantId };
}
