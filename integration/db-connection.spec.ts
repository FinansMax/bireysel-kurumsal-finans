import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import {
  DEFAULT_CONNECTION_LIMIT,
  getRuntimeDatabaseUrl,
  withConnectionLimit,
} from "../src/lib/config/database";
import { prisma } from "../src/lib/prisma";

const ROOT = join(__dirname, "..");

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe("Çalışma zamanı veritabanı adresi (Issue #187)", () => {
  const original = process.env.DATABASE_POOL_URL;

  test.afterEach(() => {
    if (original === undefined) {
      delete process.env.DATABASE_POOL_URL;
    } else {
      process.env.DATABASE_POOL_URL = original;
    }
  });

  test("DATABASE_POOL_URL yoksa null döner (şemadaki DATABASE_URL'e düşülür)", () => {
    delete process.env.DATABASE_POOL_URL;
    expect(getRuntimeDatabaseUrl()).toBeNull();
  });

  test("yalnızca boşluktan oluşan değer yapılandırılmamış sayılır", () => {
    // Boş string'i "havuz var" saymak, Prisma'ya geçersiz bir adres vererek uygulamayı
    // ayağa kalkamaz hale getirirdi; sessiz yanlış yerine bilinen davranışa düşüyoruz.
    process.env.DATABASE_POOL_URL = "   ";
    expect(getRuntimeDatabaseUrl()).toBeNull();
  });

  test("tanımlıysa havuzlanmış adres döner", () => {
    process.env.DATABASE_POOL_URL = "postgresql://u:p@pooler.example:5432/db";
    expect(getRuntimeDatabaseUrl()).toBe("postgresql://u:p@pooler.example:5432/db");
  });
});

test.describe("connection_limit uygulaması", () => {
  test("limit yoksa varsayılan eklenir", () => {
    const result = withConnectionLimit("postgresql://u:p@pooler.example:5432/db");
    expect(new URL(result).searchParams.get("connection_limit")).toBe(
      String(DEFAULT_CONNECTION_LIMIT),
    );
  });

  test("mevcut sorgu parametreleri korunur", () => {
    const result = withConnectionLimit(
      "postgresql://u:p@pooler.example:5432/db?sslmode=require&schema=public",
    );
    const params = new URL(result).searchParams;
    expect(params.get("sslmode")).toBe("require");
    expect(params.get("schema")).toBe("public");
    expect(params.get("connection_limit")).toBe(String(DEFAULT_CONNECTION_LIMIT));
  });

  test("operatörün açık limiti EZİLMEZ", () => {
    // Bu, davranışın en kritik yarısı: bir operatör bilinçli olarak 20 yazdıysa bizim
    // varsayılanımız onu sessizce 5'e düşürmemelidir.
    const url = "postgresql://u:p@pooler.example:5432/db?connection_limit=20";
    expect(withConnectionLimit(url)).toBe(url);
  });

  test("ayrıştırılamayan adres olduğu gibi bırakılır", () => {
    expect(withConnectionLimit("bu-bir-url-degil")).toBe("bu-bir-url-degil");
  });
});

test.describe("Migration yolu havuzdan geçmez", () => {
  test("prisma/schema.prisma datasource'u DATABASE_URL'e bağlı kalır", () => {
    // NEDEN test: birisi "iki URL var, şemaya da koyalım" diye `url = env(\"DATABASE_POOL_URL\")`
    // yazarsa migration'lar pooler üzerinden koşar. PgBouncer transaction modunda advisory
    // lock ve prepared statement davranışı bozulur; migration yarıda kalabilir. Bu testin
    // görevi o değişikliği derleme değil, CI zamanında yakalamaktır.
    const schema = readFileSync(join(ROOT, "prisma", "schema.prisma"), "utf8");
    const datasource = /datasource\s+db\s*\{([\s\S]*?)\}/.exec(schema);

    expect(datasource, "schema.prisma içinde datasource db bloğu bulunamadı").not.toBeNull();

    const body = datasource![1];
    expect(body).toMatch(/url\s*=\s*env\("DATABASE_URL"\)/);
    expect(body).not.toContain("DATABASE_POOL_URL");
  });

  test(".env.example her iki adresi de açıklamasıyla belgeler", () => {
    const example = readFileSync(join(ROOT, ".env.example"), "utf8");
    expect(example).toContain("DATABASE_URL");
    expect(example).toContain("DATABASE_POOL_URL");
    // Açıklama olmadan iki URL, operatör için ayırt edilemez; hangisinin migration
    // hangisinin çalışma zamanı olduğu dosyada yazılı olmalıdır.
    expect(example.toLowerCase()).toContain("migration");
  });
});

test.describe("Eşzamanlı yük altında bağlantı davranışı", () => {
  test("50 eşzamanlı sorgu tek havuzdan hatasız tamamlanır", async () => {
    // Kabul kriteri (#187): 50 eşzamanlı istek altında `too many connections` alınmamalı.
    // Burada ölçülen katman Prisma havuzudur: 50 paralel sorgu, havuzun sınırlı sayıdaki
    // bağlantısı üzerinden SIRAYA GİRMELİ, yeni bağlantı açmaya çalışıp reddedilmemeli.
    const started = Date.now();
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () => prisma.user.count()),
    );
    const elapsed = Date.now() - started;

    const rejected = results.filter((r) => r.status === "rejected");
    expect(
      rejected.map((r) => String((r as PromiseRejectedResult).reason)),
      "eşzamanlı sorgularda hata",
    ).toEqual([]);
    expect(results).toHaveLength(50);
    // Havuz doyduğunda Prisma varsayılan olarak 10 sn bekler ve P2024 fırlatır; buraya
    // gelinmesi bile o eşiğe yaklaşılmadığını gösterir, ama ölçümü kayda geçiriyoruz.
    expect(elapsed).toBeLessThan(10_000);
  });
});
