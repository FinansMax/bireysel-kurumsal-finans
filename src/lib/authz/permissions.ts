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
  ],
  // MEMBER hesapları GÖRÜR ama yönetemez (Issue #46): finansal kayıtları okumak ekibin
  // günlük işidir; hesap açmak/silmek ve bakiyeyi elle değiştirmek yönetim işidir.
  [MembershipRole.MEMBER]: [
    PERMISSIONS.VIEW_TENANT,
    PERMISSIONS.VIEW_MEMBERS,
    PERMISSIONS.VIEW_ACCOUNTS,
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
