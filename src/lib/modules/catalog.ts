import type { Prisma } from "@prisma/client";

import { PERMISSIONS, type Permission } from "@/lib/authz/permissions";

/**
 * Modül katalogu (Issue #151).
 *
 * KURAL: hangi modüllerin VAR OLDUĞUNU kod bilir, hangi tenant'ta hangisinin AÇIK olduğunu
 * veritabanı bilir. Bu ayrım, modül tanımının (izinler, bağımlılıklar, menü) kod incelemesinden
 * geçmesini ve derleme zamanında tip denetlenmesini sağlar; veritabanı yalnızca tenant başına
 * "açık mı" durumunu taşır.
 *
 * BU MODÜL SAFTIR: DB çağrısı yapmaz, request/session okumaz, side effect içermez —
 * `src/lib/authz/permissions.ts` ile aynı sözleşme. Böylece hem sunucu bileşenlerinden hem
 * route'lardan hem de testlerden serbestçe okunabilir.
 */

export const MODULES = {
  CRM: "crm",
  COLLECTIONS: "collections",
} as const;

export type ModuleKey = (typeof MODULES)[keyof typeof MODULES];

export type ModuleNavItem = {
  href: string;
  label: string;
  /** Menü öğesi yalnızca bu izne sahip role gösterilir. */
  permission: Permission;
};

/**
 * Bir modül bir tenant'ta İLK KEZ açıldığında çalışan varsayılan veri kurulumu (Issue #154).
 *
 * `tx` ZORUNLUDUR, `prisma` DEĞİL: seed, modülü açan transaction'ın İÇİNDE çalışmalıdır.
 * Ayrı bir bağlantıda çalıştırmak, seed başarılı olup modülün açılmaması (ya da tersi)
 * durumunu mümkün kılardı — ikisi tek bir atomik karardır.
 *
 * SEED KENDİ BAŞINA DA IDEMPOTENT yazılır (savunmanın ikinci katmanı): unique
 * constraint'lere dayanır, "önce say sonra ekle" YAPMAZ. Birinci katman `seededAt`tir.
 */
export type ModuleSeed = (tx: Prisma.TransactionClient, tenantId: string) => Promise<void>;

export type ModuleDefinition = {
  key: ModuleKey;
  label: string;
  description: string;
  /**
   * Bu modülün ÇALIŞMASI için açık olması gereken modüller.
   *
   * Bağımlılık OTOMATİK AÇILMAZ (bkz. `setModuleEnabled`): kullanıcı ne açtığını bilmelidir.
   * Sessizce ikinci bir modül açmak, tenant'ın ürün yüzeyini kullanıcının farkında olmadığı
   * bir şekilde genişletirdi.
   */
  dependsOn: readonly ModuleKey[];
  /**
   * Modülün getirdiği izinler.
   *
   * ŞU AN BOŞ ve bu bilinçlidir: izinler, ilgili modülün kendi issue'sunda (CRM için #156+,
   * tahsilat için #165+) `permissions.ts`'e eklendiğinde buraya da yazılır. Bugün uydurma
   * izin adları yazmak, var olmayan bir yetkiye referans veren ve derlenmeyen bir katalog
   * üretirdi.
   */
  permissions: readonly Permission[];
  /**
   * Modül açıkken menüye eklenecek öğeler.
   *
   * ŞU AN BOŞ ve aynı gerekçeyle: ekranlar henüz yok (#160+). Var olmayan bir yola link
   * vermek, kullanıcıyı 404'e götürürdü — sidebar'ın `href: null` placeholder kararıyla aynı
   * duruş. Menüyü modül-farkında kılan mekanizma #152'nin konusudur; bu alan onun sözleşmesidir.
   */
  nav: readonly ModuleNavItem[];
  /**
   * Varsayılan veri kurulumu (Issue #154). OPSİYONELDİR ve bugün hiçbir modülde TANIMLI
   * DEĞİL — mekanizma hazır, ama kurulacak veri henüz yok: CRM'in aşama şablonu kendi
   * modellerini bekliyor (#157), tahsilatın varsayılanı yok. Uydurma bir seed yazmak,
   * var olmayan tablolara referans veren ve derlenmeyen bir katalog üretirdi (`permissions`
   * ve `nav` alanlarının başlangıçta boş bırakılmasıyla aynı gerekçe).
   */
  seed?: ModuleSeed;
};

/**
 * `Record<ModuleKey, ModuleDefinition>`: `MODULES`a yeni bir anahtar eklendiğinde tanımını
 * yazmayı DERLEME ZAMANINDA zorunlu kılar — rol→izin matrisindeki `Record<MembershipRole, ...>`
 * ile birebir aynı gerekçe.
 */
export const MODULE_CATALOG: Record<ModuleKey, ModuleDefinition> = {
  [MODULES.CRM]: {
    key: MODULES.CRM,
    label: "CRM & Süreç Takibi",
    description:
      "Kurumlar, kişiler ve satış süreçleri; aşama takibi ve görüşme zaman çizelgesi.",
    dependsOn: [],
    permissions: [],
    nav: [],
  },
  [MODULES.COLLECTIONS]: {
    key: MODULES.COLLECTIONS,
    label: "Tahsilat & Ödeme Planı",
    description:
      "Ödeme planları, taksitler ve çek portföyü; tahsilat işaretleme ve vade takibi.",
    // Tahsilat, tahsil edilecek şeyin (bir süreç/anlaşma) var olmasına dayanır; CRM olmadan
    // "kimden neyi tahsil ediyoruz" sorusunun kayıtta karşılığı yoktur.
    dependsOn: [MODULES.CRM],
    // #165 ile tahsilat izinleri `permissions.ts`e girdi; bu alanın sözleşmesi gereği buraya
    // da yazılır. Katalog bugün bu listeyi OKUYAN bir yer içermez — yetkilendirme her zaman
    // `requirePermission()` üzerinden yapılır (invariant #3). Buradaki liste, "bu modül açılırsa
    // hangi yetenekler görünür olur" sorusunun tek yerden yanıtıdır.
    permissions: [PERMISSIONS.VIEW_COLLECTIONS, PERMISSIONS.MANAGE_COLLECTIONS],
    nav: [],
  },
};

/** Katalogdaki tüm tanımlar, tanım sırasında. */
export const MODULE_DEFINITIONS: readonly ModuleDefinition[] = Object.values(MODULE_CATALOG);

/**
 * Bilinen bir modül anahtarı mı?
 *
 * Yazma tarafında bu kontrol ZORUNLUDUR (katalogda olmayan anahtar 400 alır). Okuma tarafında
 * ise katalogda olmayan DB satırları sessizce YOK SAYILIR — katalogdan kaldırılmış eski bir
 * modülün satırı, uygulamayı kırmak yerine görünmez olmalıdır.
 */
export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === "string" && Object.hasOwn(MODULE_CATALOG, value);
}

/** `key`e BAĞIMLI olan modüller (yani `key` kapatılırsa bozulacaklar). */
export function modulesDependingOn(key: ModuleKey): readonly ModuleDefinition[] {
  return MODULE_DEFINITIONS.filter((definition) => definition.dependsOn.includes(key));
}
