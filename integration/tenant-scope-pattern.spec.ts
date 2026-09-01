import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

/**
 * Tenant isolation code-review koruması (Issue #13): tenant-scoped membership
 * sorgularının merkezi `tenantScoped()` helper'ı (`src/lib/tenancy/scope.ts`) üzerinden
 * geçtiğini statik olarak doğrular. Bu bir lint/AST aracı DEĞİLDİR — regresyonu (birinin
 * tekrar `where: { id }` yazmasını) yakalayan basit bir kaynak-metni pattern testidir.
 *
 * Yeni tenant-scoped modeller (Budget/Invoice ...) eklendiğinde bu dosyaya benzer bir kontrol
 * eklenmesi önerilir.
 */

const MEMBERSHIP_SOURCE_PATH = path.join(__dirname, "..", "src", "lib", "tenants", "membership.ts");
const MEMBERSHIP_SOURCE = readFileSync(MEMBERSHIP_SOURCE_PATH, "utf-8");

const ACCOUNT_SOURCE_PATH = path.join(__dirname, "..", "src", "lib", "finance", "account.ts");
const ACCOUNT_SOURCE = readFileSync(ACCOUNT_SOURCE_PATH, "utf-8");

const CATEGORY_SOURCE_PATH = path.join(__dirname, "..", "src", "lib", "finance", "category.ts");
const CATEGORY_SOURCE = readFileSync(CATEGORY_SOURCE_PATH, "utf-8");

const TRANSACTION_SOURCE_PATH = path.join(
  __dirname,
  "..",
  "src",
  "lib",
  "finance",
  "transaction.ts",
);
const TRANSACTION_SOURCE = readFileSync(TRANSACTION_SOURCE_PATH, "utf-8");

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

/**
 * Aynı koruma, ikinci tenant-scoped model olan `Account` için (Issue #46). Yeni finansal
 * modeller (Budget/Invoice ...) eklendikçe bu blok çoğaltılmalıdır.
 */
test.describe("Tenant scoping pattern koruması — account.ts", () => {
  test("tenantScoped() import edilip her sorguda kullanılıyor", () => {
    expect(ACCOUNT_SOURCE).toContain('from "@/lib/tenancy/scope"');

    const usageCount = ACCOUNT_SOURCE.match(/tenantScoped\(/g)?.length ?? 0;
    // listAccounts (1) + updateAccount (updateMany + findFirstOrThrow = 2) +
    // deleteAccount (1) = en az 4 kullanım.
    expect(usageCount).toBeGreaterThanOrEqual(4);
  });

  test("tenant-scoped resource id'siyle sadece-id update/delete/findUnique kullanılmıyor", () => {
    expect(ACCOUNT_SOURCE).not.toMatch(/\.account\.update\(/);
    expect(ACCOUNT_SOURCE).not.toMatch(/\.account\.delete\(/);
    expect(ACCOUNT_SOURCE).not.toMatch(/\.account\.findUnique\(/);

    expect(ACCOUNT_SOURCE).not.toMatch(/where:\s*\{\s*id:\s*accountId\s*\}/);
  });

  test("create sırasında tenantId açıkça yazılıyor (client input'tan türetilmiyor)", () => {
    // `account.create` tek istisnadır (yeni kayıtta scope filtrelenmez, ATANIR): bu yüzden
    // `data`'da tenantId'nin açıkça geçtiği doğrulanır — aksi halde kayıt tenant'sız veya
    // yanlış tenant'la oluşabilirdi.
    expect(ACCOUNT_SOURCE).toMatch(/data:\s*\{\s*tenantId/);
  });
});

/**
 * Aynı koruma, üçüncü tenant-scoped model olan `Category` için (Issue #49). Yeni finansal
 * modeller (Budget/Invoice ...) eklendikçe bu blok çoğaltılmalıdır.
 */
test.describe("Tenant scoping pattern koruması — category.ts", () => {
  test("tenantScoped() import edilip her sorguda kullanılıyor", () => {
    expect(CATEGORY_SOURCE).toContain('from "@/lib/tenancy/scope"');

    const usageCount = CATEGORY_SOURCE.match(/tenantScoped\(/g)?.length ?? 0;
    // listCategories (1) + updateCategory (updateMany + findFirstOrThrow = 2) +
    // deleteCategory (1) = en az 4 kullanım.
    expect(usageCount).toBeGreaterThanOrEqual(4);
  });

  test("tenant-scoped resource id'siyle sadece-id update/delete/findUnique kullanılmıyor", () => {
    expect(CATEGORY_SOURCE).not.toMatch(/\.category\.update\(/);
    expect(CATEGORY_SOURCE).not.toMatch(/\.category\.delete\(/);
    expect(CATEGORY_SOURCE).not.toMatch(/\.category\.findUnique\(/);

    expect(CATEGORY_SOURCE).not.toMatch(/where:\s*\{\s*id:\s*categoryId\s*\}/);
  });

  test("create sırasında tenantId açıkça yazılıyor (client input'tan türetilmiyor)", () => {
    expect(CATEGORY_SOURCE).toMatch(/data:\s*\{\s*tenantId/);
  });

  test("tür filtresi tenant filtresinin YERİNE geçmiyor", () => {
    // `Category`ye özgü risk: `listCategories()` opsiyonel bir `type` filtresi alır. Birinin
    // bu filtreyi `where`'e DOĞRUDAN yazıp tenant filtresini düşürmesi, listeyi tüm
    // tenant'lara açardı. Filtre daima `tenantScoped()`in ÜZERİNE verilir.
    expect(CATEGORY_SOURCE).not.toMatch(/where:\s*\{\s*type\s*\}/);
    expect(CATEGORY_SOURCE).toMatch(/tenantScoped\(tenantId,\s*type\s*\?/);
  });
});

/**
 * Aynı koruma, dördüncü tenant-scoped model olan `Transaction` için (Issue #53).
 *
 * Burada risk daha yüksektir: işlem yalnızca kendi satırını değil, BAĞLI OLDUĞU HESABIN
 * BAKİYESİNİ de yazar. Yani scope'u kaçırılmış tek bir sorgu, başka bir tenant'ın parasını
 * oynatır.
 */
test.describe("Tenant scoping pattern koruması — transaction.ts", () => {
  test("tenantScoped() import edilip her sorguda kullanılıyor", () => {
    expect(TRANSACTION_SOURCE).toContain('from "@/lib/tenancy/scope"');

    const usageCount = TRANSACTION_SOURCE.match(/tenantScoped\(/g)?.length ?? 0;
    // shiftBalance (1) + requireAccount (1) + requireCategory (1) + listTransactions (1) +
    // updateTransaction (findFirst + updateMany + findFirstOrThrow = 3) +
    // deleteTransaction (findFirst + deleteMany = 2) = en az 9 kullanım.
    expect(usageCount).toBeGreaterThanOrEqual(9);
  });

  test("tenant-scoped resource id'siyle sadece-id update/delete/findUnique kullanılmıyor", () => {
    expect(TRANSACTION_SOURCE).not.toMatch(/\.transaction\.update\(/);
    expect(TRANSACTION_SOURCE).not.toMatch(/\.transaction\.delete\(/);
    expect(TRANSACTION_SOURCE).not.toMatch(/\.transaction\.findUnique\(/);

    expect(TRANSACTION_SOURCE).not.toMatch(/where:\s*\{\s*id:\s*transactionId\s*\}/);
  });

  test("BAKİYE yazan sorgu da tenant ile scope'lanıyor", () => {
    // Bu modelin en tehlikeli sorgusu kendi tablosunda değil, `Account` üzerindedir: `balance`
    // güncellemesi. `where: { id: accountId }` yazmak, gövdeden gelen bir id ile başka
    // tenant'ın bakiyesini değiştirmeye kapı açardı.
    expect(TRANSACTION_SOURCE).not.toMatch(/where:\s*\{\s*id:\s*accountId\s*\}/);
    expect(TRANSACTION_SOURCE).not.toMatch(/where:\s*\{\s*id:\s*categoryId\s*\}/);

    // Bu dosyadaki HER `account` yazımı tenantScoped() ile başlamalı; başka bir modelin
    // tablosuna yazan tek yer burasıdır ve gözden kaçması kolaydır.
    const accountWrites = TRANSACTION_SOURCE.match(/\.account\.\w+\(\{[\s\S]{0,80}?where:[^\n]*/g);
    expect(accountWrites?.length ?? 0).toBeGreaterThanOrEqual(1);
    for (const write of accountWrites ?? []) {
      expect(write).toContain("tenantScoped(");
    }
  });

  test("create sırasında tenantId açıkça yazılıyor (client input'tan türetilmiyor)", () => {
    expect(TRANSACTION_SOURCE).toMatch(/data:\s*\{\s*tenantId/);
  });

  test("liste filtreleri tenant filtresinin YERİNE geçmiyor", () => {
    // `Category`nin `?type` filtresindeki aynı risk, burada beş katı: `listTransactions()`
    // tarih aralığı, hesap, kategori ve serbest metin filtresi alır (#56). Birinin bu
    // filtreleri `where`'e DOĞRUDAN yazıp tenant koşulunu düşürmesi, listeyi tüm tenant'lara
    // açardı.
    expect(TRANSACTION_SOURCE).not.toMatch(/where:\s*\{\s*\.\.\.\(filters/);

    // Doğru desen: filtreler daima `tenantScoped()`in İÇİNE verilir.
    expect(TRANSACTION_SOURCE).toMatch(/tenantScoped\(tenantId,\s*\{[\s\S]{0,240}\.\.\.\(filters/);
  });
});

/**
 * Aynı koruma, tenant-scoped verinin ÖZETİNİ üreten `dashboard.ts` için (Issue #62).
 *
 * Buradaki risk diğerlerinden farklıdır: bu modül tek satır YAZMAZ, ama tenant'ın TÜM finansal
 * verisini tek bir yanıtta toplar. Scope'u kaçırılmış bir `count`/`groupBy`, hiçbir kaydı
 * bozmadan başka tenant'ların bakiyelerini ve ciro büyüklüğünü sızdırırdı — üstelik sessizce,
 * çünkü sayılar "biraz büyük" görünmekten başka bir belirti vermez.
 */
test.describe("Tenant scoping pattern koruması — dashboard.ts", () => {
  const DASHBOARD_SOURCE = readFileSync(
    path.join(__dirname, "..", "src", "lib", "finance", "dashboard.ts"),
    "utf-8",
  );

  test("tenantScoped() import edilip her sorguda kullanılıyor", () => {
    expect(DASHBOARD_SOURCE).toContain('from "@/lib/tenancy/scope"');

    const usageCount = DASHBOARD_SOURCE.match(/tenantScoped\(/g)?.length ?? 0;
    // 3 adet count + bakiye groupBy + aylık groupBy + hesap/para-birimi haritası = en az 6.
    expect(usageCount).toBeGreaterThanOrEqual(6);
  });

  test("İSTİSNASIZ her `where` tenantScoped() üzerinden geçiyor", () => {
    const whereUsages = DASHBOARD_SOURCE.match(/where:[^\n]*/g) ?? [];

    // Test kendi kendini doğrular: tarama bozulup 0 eşleşme bulsa aşağıdaki döngü sessizce
    // geçerdi.
    expect(whereUsages.length).toBeGreaterThanOrEqual(6);

    for (const usage of whereUsages) {
      expect(usage, "tenant filtresi olmayan sorgu").toContain("tenantScoped(");
    }
  });

  test("özet modülü SALT OKUNURDUR — hiçbir yazma çağrısı içermez", () => {
    // Panel bir rapordur. Buraya bir yazma girerse (ör. "son görüntülenme" damgası), hem
    // GET'in yan etkisizliği (invariant #4) hem de bu modülün sözleşmesi bozulurdu.
    expect(DASHBOARD_SOURCE).not.toMatch(
      /\.(create|createMany|update|updateMany|upsert|delete|deleteMany|executeRaw|executeRawUnsafe)\s*\(/,
    );
  });

  test("tenant-scoped id'lerle yalnız-id sorgusu kullanılmıyor", () => {
    expect(DASHBOARD_SOURCE).not.toMatch(/\.account\.findUnique\(/);
    expect(DASHBOARD_SOURCE).not.toMatch(/\.transaction\.findUnique\(/);
    expect(DASHBOARD_SOURCE).not.toMatch(/where:\s*\{\s*id:\s*accountId\s*\}/);
  });
});

/**
 * Aynı koruma, ikinci salt-okunur özet modülü olan `spending-by-category.ts` için (Issue #65).
 *
 * `dashboard.ts` ile aynı risk: tek satır yazmaz ama tenant'ın harcama profilini bütün olarak
 * açar. Buradaki ek yüzey KATEGORİ ADLARIDIR — scope'u kaçırılmış bir `category.findMany`,
 * tutarları sızdırmasa bile başka bir tenant'ın gider kategorilerinin ADLARINI dilim
 * etiketlerine yazardı.
 */
test.describe("Tenant scoping pattern koruması — spending-by-category.ts", () => {
  const SPENDING_SOURCE = readFileSync(
    path.join(__dirname, "..", "src", "lib", "finance", "spending-by-category.ts"),
    "utf-8",
  );

  test("tenantScoped() import edilip her sorguda kullanılıyor", () => {
    expect(SPENDING_SOURCE).toContain('from "@/lib/tenancy/scope"');

    const usageCount = SPENDING_SOURCE.match(/tenantScoped\(/g)?.length ?? 0;
    // transaction.groupBy + account.findMany + category.findMany = en az 3.
    expect(usageCount).toBeGreaterThanOrEqual(3);
  });

  test("İSTİSNASIZ her `where` tenantScoped() üzerinden geçiyor", () => {
    const whereUsages = SPENDING_SOURCE.match(/where:[^\n]*/g) ?? [];

    // Test kendi kendini doğrular.
    expect(whereUsages.length).toBeGreaterThanOrEqual(3);

    for (const usage of whereUsages) {
      expect(usage, "tenant filtresi olmayan sorgu").toContain("tenantScoped(");
    }
  });

  test("dağılım modülü SALT OKUNURDUR — hiçbir yazma çağrısı içermez", () => {
    expect(SPENDING_SOURCE).not.toMatch(
      /\.(create|createMany|update|updateMany|upsert|delete|deleteMany|executeRaw|executeRawUnsafe)\s*\(/,
    );
  });

  test("tarih aralığının üst sınırı ORTAK nextDay() kuralını kullanıyor", () => {
    // Kendi `lte`/`+1 gün` hesabını yazan bir kopya, "15 Mart'a kadar"ın iki ekranda iki farklı
    // sonuç vermesi demekti (bkz. transaction.ts -> nextDay).
    expect(SPENDING_SOURCE).toContain('from "./transaction"');
    expect(SPENDING_SOURCE).toMatch(/lt:\s*nextDay\(/);
  });
});

/**
 * Aynı koruma, üçüncü salt-okunur özet modülü olan `income-expense-report.ts` için (Issue #67).
 *
 * Buradaki yüzey en geniştir: rapor tek yanıtta tutarları, KATEGORİ ADLARINI ve HESAP ADLARINI
 * birlikte açar. Scope'u kaçırılmış tek bir sorgu, başka bir tenant'ın gider kalemlerini ve
 * banka hesabı adlarını tablolara yazardı.
 */
test.describe("Tenant scoping pattern koruması — income-expense-report.ts", () => {
  const REPORT_SOURCE = readFileSync(
    path.join(__dirname, "..", "src", "lib", "finance", "income-expense-report.ts"),
    "utf-8",
  );

  test("tenantScoped() import edilip her sorguda kullanılıyor", () => {
    expect(REPORT_SOURCE).toContain('from "@/lib/tenancy/scope"');

    const usageCount = REPORT_SOURCE.match(/tenantScoped\(/g)?.length ?? 0;
    // transaction.groupBy + account.findMany + category.findMany = en az 3.
    expect(usageCount).toBeGreaterThanOrEqual(3);
  });

  test("İSTİSNASIZ her `where` tenantScoped() üzerinden geçiyor", () => {
    const whereUsages = REPORT_SOURCE.match(/where:[^\n]*/g) ?? [];

    // Test kendi kendini doğrular.
    expect(whereUsages.length).toBeGreaterThanOrEqual(3);

    for (const usage of whereUsages) {
      expect(usage, "tenant filtresi olmayan sorgu").toContain("tenantScoped(");
    }
  });

  test("rapor modülü SALT OKUNURDUR — hiçbir yazma çağrısı içermez", () => {
    expect(REPORT_SOURCE).not.toMatch(
      /\.(create|createMany|update|updateMany|upsert|delete|deleteMany|executeRaw|executeRawUnsafe)\s*\(/,
    );
  });

  test("tarih aralığının üst sınırı ORTAK nextDay() kuralını kullanıyor", () => {
    expect(REPORT_SOURCE).toContain('from "./transaction"');
    expect(REPORT_SOURCE).toMatch(/lt:\s*nextDay\(/);
  });
});

/**
 * Aynı koruma, beşinci tenant-scoped model olan `DebtCredit` için (Issue #70).
 *
 * `Transaction`dan farkı, paranın HENÜZ HAREKET ETMEMİŞ olmasıdır — dolayısıyla başka bir
 * modelin tablosuna yazmaz. Ama kayıtlar bir YÜKÜMLÜLÜĞÜ temsil eder: scope'u kaçırılmış tek
 * bir mutation, başka bir tenant'ın borcunu "kapandı" işaretleyebilir.
 */
test.describe("Tenant scoping pattern koruması — debt-credit.ts", () => {
  const DEBT_SOURCE = readFileSync(
    path.join(__dirname, "..", "src", "lib", "finance", "debt-credit.ts"),
    "utf-8",
  );

  test("tenantScoped() import edilip her sorguda kullanılıyor", () => {
    expect(DEBT_SOURCE).toContain('from "@/lib/tenancy/scope"');

    const usageCount = DEBT_SOURCE.match(/tenantScoped\(/g)?.length ?? 0;
    // list (1) + update (updateMany + findFirstOrThrow = 2) + delete (1) = en az 4.
    expect(usageCount).toBeGreaterThanOrEqual(4);
  });

  test("tenant-scoped resource id'siyle sadece-id update/delete/findUnique kullanılmıyor", () => {
    expect(DEBT_SOURCE).not.toMatch(/\.debtCredit\.update\(/);
    expect(DEBT_SOURCE).not.toMatch(/\.debtCredit\.delete\(/);
    expect(DEBT_SOURCE).not.toMatch(/\.debtCredit\.findUnique\(/);

    expect(DEBT_SOURCE).not.toMatch(/where:\s*\{\s*id:\s*debtCreditId\s*\}/);
  });

  test("create sırasında tenantId açıkça yazılıyor (client input'tan türetilmiyor)", () => {
    expect(DEBT_SOURCE).toMatch(/data:\s*\{\s*\n?\s*tenantId/);
  });

  test("İSTİSNASIZ her `where` tenantScoped() üzerinden geçiyor", () => {
    // Tarama SATIR BAŞINDAN yapılır (yukarıdaki salt-okunur modüllerdeki serbest regex'ten
    // farklı): bu dosyanın yorumları `where: { id }` desenini örnek olarak ANIYOR ve serbest
    // bir eşleme, kodu değil yorumu denetlerdi. Kod tarafında `where:` daima satırın ilk
    // sözcüğüdür; yorum satırları `*` veya `//` ile başlar ve elenir.
    const whereUsages = DEBT_SOURCE.split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("where:"));

    // Test kendi kendini doğrular.
    expect(whereUsages.length).toBeGreaterThanOrEqual(4);

    for (const usage of whereUsages) {
      expect(usage, "tenant filtresi olmayan sorgu").toContain("tenantScoped(");
    }
  });
});

/**
 * Aynı koruma, altıncı tenant-scoped model olan `TenantModule` için (Issue #151).
 *
 * Buradaki risk finansal değil YAPISALDIR: scope'u kaçırılmış tek bir yazma, BAŞKA bir
 * tenant'ın ürün yüzeyini değiştirir (ekran açar/kapatır). Okuma tarafında ise sızıntı,
 * komşunun hangi modülleri kullandığını açığa çıkarır.
 */
test.describe("Tenant scoping pattern koruması — tenant-module.ts", () => {
  const MODULE_SOURCE = readFileSync(
    path.join(__dirname, "..", "src", "lib", "modules", "tenant-module.ts"),
    "utf-8",
  );

  test("tenantScoped() import edilip okuma sorgularında kullanılıyor", () => {
    expect(MODULE_SOURCE).toContain('from "@/lib/tenancy/scope"');

    const usageCount = MODULE_SOURCE.match(/tenantScoped\(/g)?.length ?? 0;
    // listTenantModules (1) + isModuleEnabled (1) + setModuleEnabled'ın okuması (1) = en az 3.
    expect(usageCount).toBeGreaterThanOrEqual(3);
  });

  test("yalnız-anahtar sorgusu yok: her `where` tenant'ı taşıyor", () => {
    // `upsert` TEK istisnadır ve güvenlidir: `where` bileşik unique'i
    // (`tenantId_moduleKey`) kullanır, yani tenantId zaten anahtarın parçasıdır.
    const whereUsages = MODULE_SOURCE.split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("where:"));

    // Test kendi kendini doğrular.
    expect(whereUsages.length).toBeGreaterThanOrEqual(4);

    for (const usage of whereUsages) {
      const scoped = usage.includes("tenantScoped(") || usage.includes("tenantId_moduleKey");
      expect(scoped, `tenant filtresi olmayan sorgu: ${usage}`).toBe(true);
    }
  });

  test("tenant-scoped satıra yalnız-id ile update/delete/findUnique yapılmıyor", () => {
    expect(MODULE_SOURCE).not.toMatch(/\.tenantModule\.update\(/);
    expect(MODULE_SOURCE).not.toMatch(/\.tenantModule\.delete\(/);
    expect(MODULE_SOURCE).not.toMatch(/\.tenantModule\.findUnique\(/);
    expect(MODULE_SOURCE).not.toMatch(/where:\s*\{\s*id:/);
  });

  test("create/upsert sırasında tenantId açıkça yazılıyor", () => {
    expect(MODULE_SOURCE).toMatch(/create:\s*\{\s*\n?\s*tenantId/);
  });

  test("bağımlılık kontrolü retry'lı Serializable içinde yapılıyor", () => {
    // Okumaya bağlı invariant: `prisma.$transaction` + Serializable'ı DOĞRUDAN çağırmak
    // retry'ı atlar ve serialization failure kullanıcıya 500 olarak döner (#122).
    expect(MODULE_SOURCE).toContain("runSerializable(");
    expect(MODULE_SOURCE).not.toMatch(/prisma\.\$transaction\(/);
  });
});

/**
 * Modül guard'ının SIRA invariant'ı (Issue #152).
 *
 * Bu bir tenant-scope kontrolü değil ama aynı sınıfta bir regresyon korumasıdır: guard'ın
 * adımları yer değiştirirse hiçbir test kırılmaz, yalnızca kimliksiz bir istek bir tenant'ın
 * hangi modülleri açtığını YOKLAYABİLİR hâle gelir. Statik kontrol, o sessiz gerilemeyi yakalar.
 */
test.describe("Modül guard'ı — sıra ve yanıt invariant'ları", () => {
  const GUARD_SOURCE = readFileSync(
    path.join(__dirname, "..", "src", "lib", "modules", "guard.ts"),
    "utf-8",
  );

  test("önce requirePermission(), SONRA isModuleEnabled() çağrılıyor", () => {
    const permissionAt = GUARD_SOURCE.indexOf("await requirePermission(");
    const moduleAt = GUARD_SOURCE.indexOf("await isModuleEnabled(");

    // Test kendi kendini doğrular: iki çağrı da gerçekten var olmalı.
    expect(permissionAt).toBeGreaterThan(-1);
    expect(moduleAt).toBeGreaterThan(-1);

    // Ters sıra, kimliği doğrulanmamış bir isteğe modül durumunu yoklatırdı.
    expect(permissionAt).toBeLessThan(moduleAt);
  });

  test("kapalı modül 404 döner, 403 DEĞİL", () => {
    // Kapalı modül o tenant için VAR OLMAYAN bir yüzeydir; 403 "bu var ama sana kapalı"
    // bilgisini sızdırırdı (invariant #7, cross-tenant kayıtlarla aynı duruş).
    expect(GUARD_SOURCE).toMatch(/status:\s*404/);
    expect(GUARD_SOURCE).not.toMatch(/status:\s*403/);
  });

  test("modül durumu her istekte DB'den okunuyor (cache yok)", () => {
    // Cache eklenirse ayrı bir issue ve ayrı bir karar (#152 "Scope Dışı"). Sessizce bir
    // bellek cache'i girerse, kapatılan bir modül bir süre daha açık davranırdı.
    expect(GUARD_SOURCE).toContain("isModuleEnabled(");
    expect(GUARD_SOURCE).not.toMatch(/cache\(|unstable_cache|revalidate/);
  });

  test("scope'un kaynağı context.tenant.id, URL parametresi DEĞİL", () => {
    expect(GUARD_SOURCE).toContain("context.tenant.id");
  });
});
