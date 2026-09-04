import type { Prisma } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "@/lib/audit/actions";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { runSerializable, SerializationConflictError } from "@/lib/db/serializable";
import { prisma } from "@/lib/prisma";
import { tenantScoped } from "@/lib/tenancy/scope";

import {
  isModuleKey,
  MODULE_CATALOG,
  MODULE_DEFINITIONS,
  modulesDependingOn,
  type ModuleKey,
  type ModuleSeed,
} from "./catalog";

/**
 * Tenant başına modül durumu (Issue #151).
 *
 * TENANT İZOLASYONU: `src/lib/finance/*` ile aynı desen — her sorgu `tenantScoped()` üzerinden
 * geçer ve `tenantId` daima çağıranın `requirePermission()` context'inden gelir.
 *
 * Bu fonksiyonlar authorization kararı VERMEZ; kimin çağırabileceği route seviyesinde
 * `requirePermission(PERMISSIONS.VIEW_MODULES | MANAGE_MODULES, tenantId)` ile belirlenir.
 *
 * ---
 *
 * KATALOG + DB BİRLEŞTİRİLİR. Liste daima KATALOGDAN üretilir; DB yalnızca "açık mı" bilgisini
 * ekler. İki sonuç bunun doğrudan sonucudur:
 *
 * 1. DB'de satırı olmayan modül `enabled: false` görünür — satırın YOKLUĞU kapalı demektir ve
 *    bu, migration sonrası mevcut tenant'ların hiçbirinin etkilenmemesini sağlar.
 * 2. Katalogda olmayan bir DB satırı (katalogdan kaldırılmış eski bir modül) sessizce YOK
 *    SAYILIR — eski veri uygulamayı kırmamalı.
 */

export type TenantModuleView = {
  key: ModuleKey;
  label: string;
  description: string;
  enabled: boolean;
  dependsOn: readonly ModuleKey[];
  /** Modüle özel ayarlar; şeması bu katmanda doğrulanMAZ (bkz. şema notu). */
  settings: Prisma.JsonValue | null;
};

export async function listTenantModules(tenantId: string): Promise<TenantModuleView[]> {
  const rows = await prisma.tenantModule.findMany({
    where: tenantScoped(tenantId, {}),
    select: { moduleKey: true, enabled: true, settings: true },
  });

  const byKey = new Map(rows.map((row) => [row.moduleKey, row]));

  // Sıra KATALOĞUN sırasıdır, DB'nin değil: modüllerin arayüzdeki sırası bir ürün kararıdır ve
  // hangi satırın önce yazıldığına bağlı olmamalıdır.
  return MODULE_DEFINITIONS.map((definition) => {
    const row = byKey.get(definition.key);
    return {
      key: definition.key,
      label: definition.label,
      description: definition.description,
      enabled: row?.enabled ?? false,
      dependsOn: definition.dependsOn,
      settings: row?.settings ?? null,
    };
  });
}

/**
 * Guard'ların (#152) TEK okuma noktası.
 *
 * Katalogda olmayan bir anahtar için `false` döner — "bilinmeyen modül kapalıdır" güvenli
 * varsayılandır; bir yazım hatası, kapalı olması gereken bir yüzeyi açmamalıdır.
 */
export async function isModuleEnabled(tenantId: string, moduleKey: string): Promise<boolean> {
  if (!isModuleKey(moduleKey)) {
    return false;
  }

  const row = await prisma.tenantModule.findFirst({
    where: tenantScoped(tenantId, { moduleKey }),
    select: { enabled: true },
  });

  return row?.enabled ?? false;
}

export type SetModuleEnabledResult =
  | { ok: true; module: TenantModuleView }
  | { ok: false; status: 400 | 409 | 503; error: string };

const UNKNOWN_MODULE_ERROR = "Unknown module key";
const INVALID_ENABLED_ERROR = "enabled must be a boolean";
const SERIALIZATION_CONFLICT_ERROR = "Temporary write conflict, please retry";

/**
 * Seed başarısız olduğunda dönen hata (Issue #154).
 *
 * 500 DEĞİL: kullanıcı bir sunucu çökmesi değil, tamamlanmamış bir işlem görmeli. Transaction
 * ROLLBACK olduğu için modül AÇILMAMIŞTIR — yani durum tutarlıdır ve tekrar denemek
 * mantıklıdır. 409 da değil: bu bir iş kuralı ihlali değil, kurulum hatasıdır.
 *
 * BİLİNEN SINIR: kalıcı olarak başarısız olan bir seed her denemede aynı 503'ü döndürür;
 * gerçek neden yalnızca sunucu logundadır.
 */
const SEED_FAILED_ERROR = "Module could not be enabled: default data setup failed";

export type SetModuleEnabledOptions = {
  /**
   * Seed fonksiyonlarını katalog yerine buradan alır.
   *
   * NEDEN VAR: bugün katalogdaki hiçbir modülün seed'i yok (gerçek veri #157'yi bekliyor),
   * dolayısıyla mekanizmayı test etmenin başka yolu yok. Katalogu test içinde mutasyona
   * uğratmak REDDEDİLDİ: paylaşılan global durumu değiştirir ve testler arası sızıntı üretir.
   *
   * Bu bir BYPASS DEĞİLDİR — seed'i atlamaz, yalnızca kaynağını değiştirir; `seededAt`
   * mantığı, transaction sınırı ve rollback davranışı aynen çalışır (`emailSender` ve
   * `probeDatabase` seam'leriyle aynı desen).
   */
  seeds?: Partial<Record<ModuleKey, ModuleSeed>>;
};

function missingDependencyError(missing: readonly ModuleKey[]): string {
  return `Enable the required module(s) first: ${missing.join(", ")}`;
}

function blockingDependentError(dependents: readonly ModuleKey[]): string {
  return `Disable the dependent module(s) first: ${dependents.join(", ")}`;
}

/**
 * Bir modülü açar/kapatır.
 *
 * NEDEN `runSerializable`: bağımlılık kuralı OKUMAYA BAĞLI bir invariant'tır ("açarken bağımlı
 * modüller açık olmalı", "kapatırken buna bağımlı açık modül olmamalı"). İki eşzamanlı istek —
 * biri `crm`i kapatırken diğeri `collections`ı açarsa — ayrı ayrı okuyup ikisi de geçerli
 * görebilir ve sonuçta `collections` açık, `crm` kapalı kalırdı. `prisma.$transaction` +
 * `Serializable`ı DOĞRUDAN çağırmak yetmez: serialization failure'da retry atlanır ve kullanıcı
 * 500 alır (bkz. `src/lib/db/serializable.ts`, Issue #122).
 *
 * BAĞIMLILIK OTOMATİK AÇILMAZ. `collections` açılırken `crm` kapalıysa 409 döner — sessizce
 * `crm`i de açmak, tenant'ın ürün yüzeyini kullanıcının istemediği bir şekilde genişletirdi.
 * Aynı simetri kapatmada da geçerlidir: `crm` kapatılırken `collections` açıksa 409.
 */
export async function setModuleEnabled(
  tenantId: string,
  moduleKey: string,
  enabled: unknown,
  actorUserId: string,
  options: SetModuleEnabledOptions = {},
): Promise<SetModuleEnabledResult> {
  if (!isModuleKey(moduleKey)) {
    return { ok: false, status: 400, error: UNKNOWN_MODULE_ERROR };
  }
  if (typeof enabled !== "boolean") {
    return { ok: false, status: 400, error: INVALID_ENABLED_ERROR };
  }

  const definition = MODULE_CATALOG[moduleKey];
  const now = new Date();

  let conflict: string | null = null;
  // Seed hatasi `runSerializable`in retry'ina takilmasin diye bayrakla disariya tasinir:
  // ayni seed tekrar denendiginde ayni sekilde patlar, tekrar denemek bosunadir.
  let seedFailed = false;

  try {
    await runSerializable(async (tx) => {
      const rows = await tx.tenantModule.findMany({
        where: tenantScoped(tenantId, {}),
        select: { moduleKey: true, enabled: true, seededAt: true },
      });
      const enabledKeys = new Set(
        rows.filter((row) => row.enabled).map((row) => row.moduleKey),
      );

      if (enabled) {
        const missing = definition.dependsOn.filter((key) => !enabledKeys.has(key));
        if (missing.length > 0) {
          // İş kuralı ihlali transaction'ı ROLLBACK ETMEZ (yazma zaten yapılmadı); dışarıya
          // fırlatmak yerine bayrakla taşınır ki `runSerializable`ın retry'ı boşuna tetiklenmesin.
          conflict = missingDependencyError(missing);
          return;
        }
      } else {
        const blocking = modulesDependingOn(moduleKey)
          .map((dependent) => dependent.key)
          .filter((key) => enabledKeys.has(key));
        if (blocking.length > 0) {
          conflict = blockingDependentError(blocking);
          return;
        }
      }

      // `upsert` + `@@unique([tenantId, moduleKey])`: eşzamanlı iki isteğin ikinci satır
      // yaratması DB seviyesinde imkânsızdır.
      //
      // `tenantId` `where`de AÇIKÇA yer alır (bileşik unique'in parçası); güncelleme yalnızca
      // o tenant'ın satırına ulaşabilir.
      // VARSAYILAN VERİ KURULUMU (Issue #154).
      //
      // `seededAt` null ise ve modülün bir seed'i varsa, seed AYNI TRANSACTION içinde
      // çalışır ve `seededAt` aynı yazmada doldurulur. Ayrı bir yazmada doldurmak, arada
      // düşen bir istekte ÇİFT SEED üretirdi.
      //
      // Kapatıp tekrar açmak seed'i TEKRAR ÇALIŞTIRMAZ: `seededAt` bir kez dolduktan sonra
      // hiç temizlenmez. Kapatma zaten veri silmez.
      const existing = rows.find((row) => row.moduleKey === moduleKey);
      const seed = options.seeds?.[moduleKey as ModuleKey] ?? definition.seed;
      const shouldSeed = enabled && seed !== undefined && !existing?.seededAt;

      if (shouldSeed) {
        try {
          await seed(tx, tenantId);
        } catch (seedError) {
          // Seed hatası transaction'ı ROLLBACK ettirir: modül açılmaz, yarım veri kalmaz.
          // `runSerializable`ın retry'ı boşuna tetiklenmesin diye bayrakla taşınır.
          console.error("[modules] seed failed", {
            moduleKey,
            error: seedError instanceof Error ? seedError.message : "unknown error",
          });
          seedFailed = true;
          throw seedError;
        }
      }

      await tx.tenantModule.upsert({
        where: { tenantId_moduleKey: { tenantId, moduleKey } },
        create: {
          tenantId,
          moduleKey,
          enabled,
          ...(shouldSeed ? { seededAt: now } : {}),
          ...(enabled ? { enabledAt: now } : { disabledAt: now }),
        },
        update: {
          enabled,
          ...(shouldSeed ? { seededAt: now } : {}),
          ...(enabled ? { enabledAt: now } : { disabledAt: now }),
        },
      });
    });
  } catch (error) {
    if (seedFailed) {
      return { ok: false, status: 503, error: SEED_FAILED_ERROR };
    }

    if (error instanceof SerializationConflictError) {
      // GEÇİCİ bir sunucu durumu; iş kuralı ihlali (409) DEĞİL.
      return { ok: false, status: 503, error: SERIALIZATION_CONFLICT_ERROR };
    }
    throw error;
  }

  if (conflict !== null) {
    return { ok: false, status: 409, error: conflict };
  }

  // Audit yazımı transaction commit ettikten SONRA ve best-effort (Issue #15). `runSerializable`
  // yeniden deneyebildiği için içeriye KONULAMAZ — rollback olan bir denemenin audit'i kalırdı.
  await writeAuditLog({
    actorUserId,
    tenantId,
    action: enabled ? AUDIT_ACTIONS.MODULE_ENABLED : AUDIT_ACTIONS.MODULE_DISABLED,
    targetType: AUDIT_TARGET_TYPES.MODULE,
    // Satır id'si değil MODÜL ANAHTARI: kayıt, satır silinse bile anlamlı kalmalı.
    targetId: moduleKey,
  });

  const modules = await listTenantModules(tenantId);
  // `find` daima bulur: `moduleKey` katalogda olduğu doğrulandı ve liste katalogdan üretiliyor.
  return { ok: true, module: modules.find((entry) => entry.key === moduleKey)! };
}
