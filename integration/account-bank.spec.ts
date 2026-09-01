import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { prisma } from "../src/lib/prisma";
import { createAccount, listAccounts, updateAccount } from "../src/lib/finance/account";
import {
  BANKS,
  BANK_GROUP_LABELS,
  BANK_GROUP_ORDER,
  bankName,
  groupedBanks,
  isValidBankCode,
} from "../src/lib/finance/banks";

/**
 * Hesabın bankası — iş kuralları ve banka listesinin kendi tutarlılığı (Issue #148).
 *
 * Yetkilendirme burada test EDİLMEZ (bkz. `security/account-security.spec.ts`). Buradaki konu:
 * allowlist doğrulaması, `bankCode`un yalnızca `BANK` türünde anlamlı olması ve tür değişiminde
 * temizlenmesi.
 */

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

test.afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

async function seedTenant(): Promise<string> {
  const tenant = await prisma.tenant.create({
    data: { name: "Banka Testi", slug: `bank-${randomUUID()}` },
    select: { id: true },
  });
  createdTenantIds.push(tenant.id);
  return tenant.id;
}

async function seedActor(): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `bank-actor-${randomUUID()}@example.com` },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  return user.id;
}

function input(overrides: Record<string, unknown> = {}) {
  return { name: `Hesap ${randomUUID()}`, type: "BANK", currency: "TRY", ...overrides };
}

test.describe("Banka listesi — kendi tutarlılığı", () => {
  test("liste boş değil ve taranabiliyor (test kendi kendini doğruluyor)", () => {
    // Bu kontrol olmadan, liste yanlışlıkla boşalsa bile aşağıdaki döngüler sessizce geçerdi.
    expect(BANKS.length).toBeGreaterThanOrEqual(20);
  });

  test("kodlar BENZERSİZ ve boş değil", () => {
    // Kod, DB'de saklanan değerdir: iki bankanın aynı kodu paylaşması, verinin hangi bankaya
    // ait olduğunu geri döndürülemez biçimde belirsizleştirirdi.
    const codes = BANKS.map((bank) => bank.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const bank of BANKS) {
      expect(bank.code.trim().length).toBeGreaterThan(0);
      expect(bank.name.trim().length).toBeGreaterThan(0);
    }
  });

  test('"Diğer" seçeneği VARDIR ve kaldırılmamalıdır', () => {
    // Liste elle bakılan bir anlık görüntüdür; kaçış kapısı olmadan kullanıcı "bankam listede
    // yok" diye tıkanırdı.
    expect(isValidBankCode("OTHER")).toBe(true);
    expect(bankName("OTHER")).toBe("Diğer");
  });

  test("her bankanın grubu tanımlı ve seçicide görünüyor", () => {
    for (const bank of BANKS) {
      expect(BANK_GROUP_ORDER).toContain(bank.group);
      expect(BANK_GROUP_LABELS[bank.group]).toBeTruthy();
    }

    // Gruplama HİÇBİR bankayı düşürmemeli ve tekrarlamamalı: seçicide görünmeyen bir banka,
    // listede olmayan bir bankadır.
    const grouped = groupedBanks().flatMap((entry) => entry.banks.map((bank) => bank.code));
    expect(grouped.sort()).toEqual(BANKS.map((bank) => bank.code).sort());
  });

  test("isValidBankCode yalnızca TAM eşleşmeyi kabul eder", () => {
    expect(isValidBankCode("ZIRAAT")).toBe(true);
    // Serbest metnin engellendiği yer burasıdır: küçük harf, boşluklu ya da uydurma bir değer
    // kabul edilmez, aksi halde "Garanti" ve "garanti" iki ayrı banka olurdu.
    expect(isValidBankCode("ziraat")).toBe(false);
    expect(isValidBankCode(" ZIRAAT ")).toBe(false);
    expect(isValidBankCode("Ziraat Bankası")).toBe(false);
    expect(isValidBankCode("")).toBe(false);
    expect(isValidBankCode(null)).toBe(false);
    expect(isValidBankCode(42)).toBe(false);
  });

  test("bankName bilinmeyen kod için null döner (ham kod basılmaz)", () => {
    expect(bankName("ZIRAAT")).toBe("Ziraat Bankası");
    expect(bankName("KAPANMIS_BANKA")).toBeNull();
  });
});

test.describe("createAccount() — banka", () => {
  test("BANK hesapta geçerli banka kodu saklanıyor", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    const result = await createAccount(tenantId, actorId, input({ bankCode: "GARANTI" }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.account.bankCode).toBe("GARANTI");

    const row = await prisma.account.findUniqueOrThrow({ where: { id: result.account.id } });
    expect(row.bankCode).toBe("GARANTI");
  });

  test("banka VERİLMEDEN de banka hesabı açılabilir (sözleşme geriye dönük uyumlu)", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    // Alanı zorunlu yapmak, #148 öncesindeki istemcileri ve kayıtları kırardı. Zorunluluk
    // ARAYÜZDEDİR (bkz. README, "#148 kararları").
    const result = await createAccount(tenantId, actorId, input());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.account.bankCode).toBeNull();
  });

  test("açıkça null gönderilen banka 'belirtilmedi' sayılır (400 DEĞİL)", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    // `balance`taki katı `null` reddinin aksine: "bankası belirtilmemiş banka hesabı" MEŞRU
    // bir durumdur.
    const result = await createAccount(tenantId, actorId, input({ bankCode: null }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.account.bankCode).toBeNull();
  });

  test("listede olmayan kod 400 alır ve hesap OLUŞMAZ", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    for (const bad of ["ziraat", "Ziraat Bankası", "UYDURMA", " ZIRAAT "]) {
      const result = await createAccount(tenantId, actorId, input({ bankCode: bad }));
      expect(result.ok, `beklenen 400: ${bad}`).toBe(false);
      if (result.ok) continue;
      expect(result.status).toBe(400);
    }

    expect(await prisma.account.count({ where: { tenantId } })).toBe(0);
  });

  test("KASA hesabında banka gönderimi 400 alır (sessizce yok sayılmaz)", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    // Sessizce yok saymak, kullanıcının seçtiği bankanın kaybolduğu bir kayıt üretirdi.
    const result = await createAccount(
      tenantId,
      actorId,
      input({ type: "CASH", bankCode: "ZIRAAT" }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(await prisma.account.count({ where: { tenantId } })).toBe(0);
  });

  test("KASA hesabı bankasız açılabiliyor (kontrol grubu)", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();

    const result = await createAccount(tenantId, actorId, input({ type: "CASH" }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.account.bankCode).toBeNull();
  });

  test("listAccounts banka kodunu döndürüyor", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    await createAccount(tenantId, actorId, input({ bankCode: "ISBANK" }));

    const accounts = await listAccounts(tenantId);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].bankCode).toBe("ISBANK");
  });
});

test.describe("updateAccount() — banka", () => {
  async function seedBankAccount(tenantId: string, actorId: string, bankCode?: string) {
    const result = await createAccount(
      tenantId,
      actorId,
      input(bankCode ? { bankCode } : {}),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    return result.account.id;
  }

  test("banka sonradan seçilebiliyor (eski kayıtların doldurulması)", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedBankAccount(tenantId, actorId);

    const result = await updateAccount(tenantId, accountId, actorId, { bankCode: "AKBANK" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.account.bankCode).toBe("AKBANK");
  });

  test("banka null ile temizlenebiliyor", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedBankAccount(tenantId, actorId, "AKBANK");

    const result = await updateAccount(tenantId, accountId, actorId, { bankCode: null });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.account.bankCode).toBeNull();
  });

  test("tür KASA'ya çevrilince banka OTOMATİK temizlenir (istemci göndermese bile)", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedBankAccount(tenantId, actorId, "AKBANK");

    // `bankCode` HİÇ gönderilmiyor. Temizlenmeseydi kasa hâline gelmiş bir hesapta eski banka
    // kodu asılı kalır ve ileride banka bazlı her toplama onu sayardı.
    const result = await updateAccount(tenantId, accountId, actorId, { type: "CASH" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.account.type).toBe("CASH");
    expect(result.account.bankCode).toBeNull();
  });

  test("tür KASA'ya çevrilirken banka göndermek 400 alır", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedBankAccount(tenantId, actorId, "AKBANK");

    const result = await updateAccount(tenantId, accountId, actorId, {
      type: "CASH",
      bankCode: "ZIRAAT",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);

    // Hiçbir alan değişmemeli: doğrulama YAZMADAN ÖNCE yapılır.
    const row = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(row.type).toBe("BANK");
    expect(row.bankCode).toBe("AKBANK");
  });

  test("MEVCUT kasa hesabına banka yazmak 400 alır (tür gönderilmese bile)", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const created = await createAccount(tenantId, actorId, input({ type: "CASH" }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Tür bu istekte verilmiyor; etkin tür KAYITTAN okunmalı, aksi halde bir kasa hesabına
    // banka yazılabilirdi.
    const result = await updateAccount(tenantId, created.account.id, actorId, {
      bankCode: "ZIRAAT",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  test("tür BANK'a çevrilirken banka aynı istekte verilebiliyor", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const created = await createAccount(tenantId, actorId, input({ type: "CASH" }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await updateAccount(tenantId, created.account.id, actorId, {
      type: "BANK",
      bankCode: "VAKIFBANK",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.account.type).toBe("BANK");
    expect(result.account.bankCode).toBe("VAKIFBANK");
  });

  test("geçersiz kod 400 alır ve mevcut değer korunur", async () => {
    const tenantId = await seedTenant();
    const actorId = await seedActor();
    const accountId = await seedBankAccount(tenantId, actorId, "AKBANK");

    const result = await updateAccount(tenantId, accountId, actorId, { bankCode: "UYDURMA" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);

    const row = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(row.bankCode).toBe("AKBANK");
  });

  test("BAŞKA tenant'ın hesabına banka yazılamaz (404, kayıt değişmez)", async () => {
    const actorId = await seedActor();
    const mine = await seedTenant();
    const theirs = await seedTenant();
    const theirAccountId = await seedBankAccount(theirs, actorId, "AKBANK");

    // Tür gönderilmiyor → servis etkin türü okumak için kayda bakıyor; o okuma da
    // `tenantScoped()` üzerinden geçtiği için komşunun kaydı hiç bulunamaz.
    const result = await updateAccount(mine, theirAccountId, actorId, { bankCode: "ZIRAAT" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Var olmayan hesapla aynı yanıt — enumeration engeli.
    expect(result.status).toBe(404);

    const row = await prisma.account.findUniqueOrThrow({ where: { id: theirAccountId } });
    expect(row.bankCode).toBe("AKBANK");
  });
});
