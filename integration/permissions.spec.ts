import { MembershipRole } from "@prisma/client";
import { expect, test } from "@playwright/test";

import {
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  PERMISSIONS,
  type Permission,
} from "../src/lib/authz/permissions";

const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

const MANAGEMENT_PERMISSIONS: Permission[] = [
  PERMISSIONS.UPDATE_TENANT_SETTINGS,
  PERMISSIONS.UPDATE_MEMBER_ROLE,
  PERMISSIONS.REMOVE_MEMBER,
  PERMISSIONS.SEND_INVITE,
  PERMISSIONS.CANCEL_INVITE,
  PERMISSIONS.VIEW_AUDIT_LOG,
  // Hesap yönetimi (Issue #46) da bir yönetim iznidir: MEMBER hesapları görebilir ama
  // oluşturamaz/silemez/bakiyesini değiştiremez.
  PERMISSIONS.MANAGE_ACCOUNTS,
];

test.describe("hasPermission() — tablo-driven matris", () => {
  const cases: Array<{ role: MembershipRole; permission: Permission; expected: boolean }> = [
    // OWNER: tüm permission'lara sahip.
    ...ALL_PERMISSIONS.map((permission) => ({
      role: MembershipRole.OWNER,
      permission,
      expected: true,
    })),

    // ADMIN: OWNER-only (tenant ayarları) hariç hepsine sahip.
    { role: MembershipRole.ADMIN, permission: PERMISSIONS.VIEW_TENANT, expected: true },
    { role: MembershipRole.ADMIN, permission: PERMISSIONS.VIEW_MEMBERS, expected: true },
    { role: MembershipRole.ADMIN, permission: PERMISSIONS.UPDATE_MEMBER_ROLE, expected: true },
    { role: MembershipRole.ADMIN, permission: PERMISSIONS.REMOVE_MEMBER, expected: true },
    { role: MembershipRole.ADMIN, permission: PERMISSIONS.SEND_INVITE, expected: true },
    { role: MembershipRole.ADMIN, permission: PERMISSIONS.CANCEL_INVITE, expected: true },
    { role: MembershipRole.ADMIN, permission: PERMISSIONS.VIEW_AUDIT_LOG, expected: true },
    { role: MembershipRole.ADMIN, permission: PERMISSIONS.VIEW_ACCOUNTS, expected: true },
    { role: MembershipRole.ADMIN, permission: PERMISSIONS.MANAGE_ACCOUNTS, expected: true },
    { role: MembershipRole.ADMIN, permission: PERMISSIONS.UPDATE_TENANT_SETTINGS, expected: false },

    // MEMBER: sadece temel görüntüleme.
    { role: MembershipRole.MEMBER, permission: PERMISSIONS.VIEW_TENANT, expected: true },
    { role: MembershipRole.MEMBER, permission: PERMISSIONS.VIEW_MEMBERS, expected: true },
    { role: MembershipRole.MEMBER, permission: PERMISSIONS.UPDATE_TENANT_SETTINGS, expected: false },
    { role: MembershipRole.MEMBER, permission: PERMISSIONS.UPDATE_MEMBER_ROLE, expected: false },
    { role: MembershipRole.MEMBER, permission: PERMISSIONS.REMOVE_MEMBER, expected: false },
    { role: MembershipRole.MEMBER, permission: PERMISSIONS.SEND_INVITE, expected: false },
    { role: MembershipRole.MEMBER, permission: PERMISSIONS.CANCEL_INVITE, expected: false },
    { role: MembershipRole.MEMBER, permission: PERMISSIONS.VIEW_AUDIT_LOG, expected: false },
    // Hesaplar (Issue #46): görüntüleme VAR, yönetim YOK.
    { role: MembershipRole.MEMBER, permission: PERMISSIONS.VIEW_ACCOUNTS, expected: true },
    { role: MembershipRole.MEMBER, permission: PERMISSIONS.MANAGE_ACCOUNTS, expected: false },
  ];

  for (const { role, permission, expected } of cases) {
    test(`${role} + ${permission} => ${expected}`, () => {
      expect(hasPermission(role, permission)).toBe(expected);
    });
  }
});

test.describe("Kritik matris kararları", () => {
  test("1. OWNER kritik tenant yönetimi permission'ına (UPDATE_TENANT_SETTINGS) sahip", () => {
    expect(hasPermission(MembershipRole.OWNER, PERMISSIONS.UPDATE_TENANT_SETTINGS)).toBe(true);
  });

  test("2. ADMIN bazı yönetim permission'larına sahip (rol değiştirme, üye çıkarma)", () => {
    expect(hasPermission(MembershipRole.ADMIN, PERMISSIONS.UPDATE_MEMBER_ROLE)).toBe(true);
    expect(hasPermission(MembershipRole.ADMIN, PERMISSIONS.REMOVE_MEMBER)).toBe(true);
  });

  test("3. ADMIN, OWNER-only permission'a (tenant ayarları güncelleme) sahip değil", () => {
    expect(hasPermission(MembershipRole.ADMIN, PERMISSIONS.UPDATE_TENANT_SETTINGS)).toBe(false);
  });

  test("4. MEMBER hiçbir yönetim permission'ına sahip değil", () => {
    for (const permission of MANAGEMENT_PERMISSIONS) {
      expect(hasPermission(MembershipRole.MEMBER, permission)).toBe(false);
    }
  });

  test("5. MEMBER temel görüntüleme permission'larına (tenant + üyeler) sahip", () => {
    expect(hasPermission(MembershipRole.MEMBER, PERMISSIONS.VIEW_TENANT)).toBe(true);
    expect(hasPermission(MembershipRole.MEMBER, PERMISSIONS.VIEW_MEMBERS)).toBe(true);
  });

  test("6. OWNER beklenen tüm Epic 1 permission'larına sahip", () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(hasPermission(MembershipRole.OWNER, permission)).toBe(true);
    }
  });

  test("7. Matris yanlışlıkla tüm rollere açık hale gelmemiş (en az bir kısıtlı permission var)", () => {
    expect(hasPermission(MembershipRole.OWNER, PERMISSIONS.UPDATE_TENANT_SETTINGS)).toBe(true);
    expect(hasPermission(MembershipRole.ADMIN, PERMISSIONS.UPDATE_TENANT_SETTINGS)).toBe(false);
    expect(hasPermission(MembershipRole.MEMBER, PERMISSIONS.UPDATE_TENANT_SETTINGS)).toBe(false);
  });
});

test.describe("hasAnyPermission() / hasAllPermissions()", () => {
  test("hasAnyPermission: verilenlerden en az biri varsa true", () => {
    expect(
      hasAnyPermission(MembershipRole.MEMBER, [
        PERMISSIONS.UPDATE_TENANT_SETTINGS,
        PERMISSIONS.VIEW_TENANT,
      ]),
    ).toBe(true);
  });

  test("hasAnyPermission: hiçbiri yoksa false", () => {
    expect(
      hasAnyPermission(MembershipRole.MEMBER, [
        PERMISSIONS.UPDATE_TENANT_SETTINGS,
        PERMISSIONS.REMOVE_MEMBER,
      ]),
    ).toBe(false);
  });

  test("hasAllPermissions: hepsi varsa true", () => {
    expect(
      hasAllPermissions(MembershipRole.OWNER, [
        PERMISSIONS.VIEW_TENANT,
        PERMISSIONS.UPDATE_TENANT_SETTINGS,
      ]),
    ).toBe(true);
  });

  test("hasAllPermissions: biri eksikse false", () => {
    expect(
      hasAllPermissions(MembershipRole.ADMIN, [
        PERMISSIONS.VIEW_TENANT,
        PERMISSIONS.UPDATE_TENANT_SETTINGS,
      ]),
    ).toBe(false);
  });
});
