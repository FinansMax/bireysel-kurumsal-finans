import { MembershipRole } from "@prisma/client";

/**
 * Epic 1 kapsamında (mevcut + yakın issue'lar: #9 membership, #14 davet, #15 audit log,
 * tenant ayarları) gerçekten ihtiyaç duyulan permission'ların merkezi tanımı.
 *
 * Bu modül SADECE saf permission tanımı ve kontrol fonksiyonlarını içerir:
 * - DB çağrısı yapmaz
 * - request/session okumaz
 * - side effect içermez
 *
 * Gerçek route enforcement Issue #12'nin kapsamındadır.
 */
export const PERMISSIONS = {
  VIEW_TENANT: "tenant:view",
  UPDATE_TENANT_SETTINGS: "tenant:update-settings",
  VIEW_MEMBERS: "members:view",
  UPDATE_MEMBER_ROLE: "members:update-role",
  REMOVE_MEMBER: "members:remove",
  SEND_INVITE: "invites:send",
  CANCEL_INVITE: "invites:cancel",
  VIEW_AUDIT_LOG: "audit-log:view",
  // Finansal hesaplar (Issue #46). GÖRÜNTÜLEME ile YÖNETİM ayrı izinlerdir: tenant'ın her
  // üyesi hesapları görebilir, ama oluşturma/güncelleme/silme yönetim yetkisi ister.
  VIEW_ACCOUNTS: "accounts:view",
  MANAGE_ACCOUNTS: "accounts:manage",
  // Gelir/gider kategorileri (Issue #49). Hesaplarla AYNI ayrım: kategori listesini görmek
  // her üyenin işidir (işlem kaydederken seçecektir), kategori açmak/yeniden adlandırmak/
  // silmek ise tenant'ın sınıflandırma şemasını değiştirmektir — yönetim işi.
  VIEW_CATEGORIES: "categories:view",
  MANAGE_CATEGORIES: "categories:manage",
  // Gelir/gider işlemleri (Issue #53). Hesap ve kategorilerle AYNI ayrım ve AYNI gerekçe:
  // bir işlem kaydetmek/düzeltmek/silmek, dayandığı hesabın BAKİYESİNİ değiştirir — yani
  // yukarıda MEMBER'dan esirgenen "bakiyeyi elle değiştirmek" işinin ta kendisidir. Okumak
  // ise ekibin günlük işidir. (Bu, matristeki en tartışmaya açık karardır; gerekçesi ve
  // gevşetme yolu README'de yazılıdır.)
  VIEW_TRANSACTIONS: "transactions:view",
  MANAGE_TRANSACTIONS: "transactions:manage",
  // Borç/alacak kayıtları (Issue #70). Hesap/kategori/işlemle AYNI ayrım: bir yükümlülüğü
  // görmek ekibin günlük işidir; kaydetmek, tutarını düşürmek ya da "kapandı" işaretlemek
  // yönetim işidir. Özellikle "kapandı" işareti, ödenmemiş bir borcu ödenmiş göstermenin en
  // kolay yoludur ve bu yüzden MEMBER'a verilmez.
  VIEW_DEBT_CREDITS: "debt-credits:view",
  MANAGE_DEBT_CREDITS: "debt-credits:manage",
  // Modül sistemi (Issue #151). GÖRÜNTÜLEME her role verilir — menüyü kurabilmek için hangi
  // modüllerin açık olduğunu BİLMEK gerekir; bu bilgi bir sır değildir.
  //
  // YÖNETİM YALNIZ OWNER'DADIR ve bu, matristeki genel "OWNER+ADMIN yönetir" kalıbının
  // BİLİNÇLİ istisnasıdır: bir modülü açmak tenant'ın ÜRÜN YÜZEYİNİ değiştirir (yeni ekranlar,
  // yeni izinler, yeni veri). Bu, `UPDATE_TENANT_SETTINGS` ile aynı sınıfta bir karardır —
  // matriste bugün OWNER-only olan tek izin odur.
  // Tenant verisini disa aktarma (Issue #194). MANAGE_MODULES ve UPDATE_TENANT_SETTINGS ile
  // AYNI SINIFTA, OWNER-only bir izindir: disa aktarma tenant'in TUM verisini - uye
  // e-postalari ve audit log dahil - tek bir dosyada disariya cikarir. Bir ADMIN'in gunluk
  // operasyon yetkisi bunu kapsamaz; bu bir SAHIPLIK kararidir.
  EXPORT_TENANT_DATA: "tenant:export",
  VIEW_MODULES: "modules:view",
  MANAGE_MODULES: "modules:manage",
} as const;

/** Geçerli permission string literal'lerinin union tipi — rastgele string kabul edilmez. */
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/**
 * Rol → izin matrisi. `Record<MembershipRole, ...>` kullanımı, Prisma'daki `MembershipRole`
 * enum'ına yeni bir rol eklendiğinde bu matrisin güncellenmesini derleme zamanında ZORUNLU
 * kılar (MembershipRole ile permission tipleri arasındaki açık ilişki budur).
 *
 * Roller arası prensip:
 * - OWNER: tenant yönetim izinlerinin tamamı.
 * - ADMIN: OWNER'a özel (ownership-kritik) izinler HARİÇ operasyonel yönetim izinleri.
 *   Şu an tek OWNER-only izin: tenant ayarlarını güncelleme.
 * - MEMBER: sadece temel görüntüleme (tenant'ı ve üye listesini görme); hiçbir yönetim
 *   izni yok.
 */
const ROLE_PERMISSIONS: Record<MembershipRole, readonly Permission[]> = {
  [MembershipRole.OWNER]: [
    PERMISSIONS.VIEW_TENANT,
    PERMISSIONS.UPDATE_TENANT_SETTINGS,
    PERMISSIONS.VIEW_MEMBERS,
    PERMISSIONS.UPDATE_MEMBER_ROLE,
    PERMISSIONS.REMOVE_MEMBER,
    PERMISSIONS.SEND_INVITE,
    PERMISSIONS.CANCEL_INVITE,
    PERMISSIONS.VIEW_AUDIT_LOG,
    PERMISSIONS.VIEW_ACCOUNTS,
    PERMISSIONS.MANAGE_ACCOUNTS,
    PERMISSIONS.VIEW_CATEGORIES,
    PERMISSIONS.MANAGE_CATEGORIES,
    PERMISSIONS.VIEW_TRANSACTIONS,
    PERMISSIONS.MANAGE_TRANSACTIONS,
    PERMISSIONS.VIEW_DEBT_CREDITS,
    PERMISSIONS.MANAGE_DEBT_CREDITS,
    PERMISSIONS.VIEW_MODULES,
    PERMISSIONS.MANAGE_MODULES,
    PERMISSIONS.EXPORT_TENANT_DATA,
  ],
  [MembershipRole.ADMIN]: [
    PERMISSIONS.VIEW_TENANT,
    PERMISSIONS.VIEW_MEMBERS,
    PERMISSIONS.UPDATE_MEMBER_ROLE,
    PERMISSIONS.REMOVE_MEMBER,
    PERMISSIONS.SEND_INVITE,
    PERMISSIONS.CANCEL_INVITE,
    PERMISSIONS.VIEW_AUDIT_LOG,
    PERMISSIONS.VIEW_ACCOUNTS,
    PERMISSIONS.MANAGE_ACCOUNTS,
    PERMISSIONS.VIEW_CATEGORIES,
    PERMISSIONS.MANAGE_CATEGORIES,
    PERMISSIONS.VIEW_TRANSACTIONS,
    PERMISSIONS.MANAGE_TRANSACTIONS,
    PERMISSIONS.VIEW_DEBT_CREDITS,
    PERMISSIONS.MANAGE_DEBT_CREDITS,
    // ADMIN modülleri GÖRÜR ama AÇAMAZ: ürün yüzeyini değiştirmek OWNER kararıdır.
    PERMISSIONS.VIEW_MODULES,
  ],
  // MEMBER hesapları GÖRÜR ama yönetemez (Issue #46): finansal kayıtları okumak ekibin
  // günlük işidir; hesap açmak/silmek ve bakiyeyi elle değiştirmek yönetim işidir.
  [MembershipRole.MEMBER]: [
    PERMISSIONS.VIEW_TENANT,
    PERMISSIONS.VIEW_MEMBERS,
    PERMISSIONS.VIEW_ACCOUNTS,
    PERMISSIONS.VIEW_CATEGORIES,
    PERMISSIONS.VIEW_TRANSACTIONS,
    PERMISSIONS.VIEW_DEBT_CREDITS,
    PERMISSIONS.VIEW_MODULES,
  ],
};

/** Bir rolün belirli bir izne sahip olup olmadığını kontrol eder. Tamamen pure'dur. */
export function hasPermission(role: MembershipRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Verilen izinlerden EN AZ BİRİNE sahipse true döner. */
export function hasAnyPermission(role: MembershipRole, permissions: readonly Permission[]): boolean {
  return permissions.some((permission) => hasPermission(role, permission));
}

/** Verilen izinlerin TAMAMINA sahipse true döner. */
export function hasAllPermissions(role: MembershipRole, permissions: readonly Permission[]): boolean {
  return permissions.every((permission) => hasPermission(role, permission));
}
