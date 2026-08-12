import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

/**
 * Tenant isolation code-review koruması (Issue #13): tenant-scoped membership
 * sorgularının merkezi `tenantScoped()` helper'ı (`src/lib/tenancy/scope.ts`) üzerinden
 * geçtiğini statik olarak doğrular. Bu bir lint/AST aracı DEĞİLDİR — regresyonu (birinin
 * tekrar `where: { id }` yazmasını) yakalayan basit bir kaynak-metni pattern testidir.
 *
 * Yeni tenant-scoped modeller (Account/Transaction/Category/Budget/Invoice ...)
 * eklendiğinde bu dosyaya benzer bir kontrol eklenmesi önerilir.
 */

const MEMBERSHIP_SOURCE_PATH = path.join(__dirname, "..", "src", "lib", "tenants", "membership.ts");
const MEMBERSHIP_SOURCE = readFileSync(MEMBERSHIP_SOURCE_PATH, "utf-8");

test.describe("Tenant scoping pattern koruması — membership.ts", () => {
  test("tenantId filtresini zorlayan tenantScoped() helper'ı import edilip kullanılıyor", () => {
    expect(MEMBERSHIP_SOURCE).toContain('from "@/lib/tenancy/scope"');

    const usageCount = MEMBERSHIP_SOURCE.match(/tenantScoped\(/g)?.length ?? 0;
    // listMembers, updateMemberRole (findFirst + updateMany + findFirstOrThrow),
    // removeMember (findFirst + deleteMany) = en az 6 kullanım.
    expect(usageCount).toBeGreaterThanOrEqual(6);
  });

  test("tenant-scoped resource id'siyle sadece-id (tenantId'siz) update/delete/findUnique kullanılmıyor", () => {
    // update()/delete() Prisma'da yalnızca unique alan kabul eder (id burada tek başına
    // unique'dir) — tenant-scoped update/delete bu yüzden updateMany/deleteMany +
    // tenantScoped() ile yapılmalı, ASLA bare update()/delete() ile değil (bkz.
    // src/lib/tenancy/scope.ts dokümantasyonu).
    expect(MEMBERSHIP_SOURCE).not.toMatch(/\.membership\.update\(/);
    expect(MEMBERSHIP_SOURCE).not.toMatch(/\.membership\.delete\(/);
    expect(MEMBERSHIP_SOURCE).not.toMatch(/\.membership\.findUnique\(/);

    // Riskli literal desen: tenantId olmadan, sadece id ile where.
    expect(MEMBERSHIP_SOURCE).not.toMatch(/where:\s*\{\s*id:\s*membershipId\s*\}/);
  });
});
