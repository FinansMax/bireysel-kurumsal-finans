import { randomUUID } from "node:crypto";

import { MembershipRole } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { registerUser } from "../src/lib/auth/signup";
import { isSessionRevoked } from "../src/lib/auth/session-revocation";
import { updateMemberRole } from "../src/lib/tenants/membership";
import { prisma } from "../src/lib/prisma";

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function createUser() {
  const email = `revocation-${randomUUID()}@example.com`;
  const result = await registerUser({ email, password: "S3curePassw0rd!" });
  if (!result.ok) throw new Error("test setup failed: registerUser");
  return { id: result.user.id, email };
}

async function cleanup(userIds: string[], tenantIds: string[] = []) {
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

// Testlerde kullanılan sabit, rastgele-olmayan bir referans saniye (2024-01-01T00:00:00Z civarı) —
// gerçek saatle yarışmayan, deterministik boundary testleri için.
const REFERENCE_IAT_SECONDS = 1_704_067_200;

test.describe("isSessionRevoked() — temel davranış", () => {
  test("credentialsChangedAt null ise HİÇBİR iat için revoke edilmez", () => {
    expect(isSessionRevoked(REFERENCE_IAT_SECONDS, null)).toBe(false);
    expect(isSessionRevoked(REFERENCE_IAT_SECONDS, undefined)).toBe(false);
    expect(isSessionRevoked(0, null)).toBe(false);
    expect(isSessionRevoked(Date.now() / 1000, null)).toBe(false);
  });

  test("token açıkça credential change'den ÖNCE (erken bir saniyede) üretilmiş → revoke edilir", () => {
    const changedAt = new Date((REFERENCE_IAT_SECONDS + 5) * 1000); // 5 saniye SONRA değişti
    expect(isSessionRevoked(REFERENCE_IAT_SECONDS, changedAt)).toBe(true);
  });

  test("token açıkça credential change'den SONRA (geç bir saniyede) üretilmiş → revoke edilmez", () => {
    const changedAt = new Date((REFERENCE_IAT_SECONDS - 5) * 1000); // 5 saniye ÖNCE değişti
    expect(isSessionRevoked(REFERENCE_IAT_SECONDS, changedAt)).toBe(false);
  });

  test("iat undefined/null ise revoke edilmez (fail-safe-open — birincil kimlik doğrulama zaten Auth.js'te yapılmıştır)", () => {
    const changedAt = new Date();
    expect(isSessionRevoked(undefined, changedAt)).toBe(false);
    expect(isSessionRevoked(null, changedAt)).toBe(false);
  });
});

test.describe("isSessionRevoked() — saniye/milisaniye precision boundary'leri (Issue #26'nın kritik gereksinimi)", () => {
  test("credentialsChangedAt, iat'in AYNI saniyesinin başında ise revoke edilmez", () => {
    const changedAt = new Date(REFERENCE_IAT_SECONDS * 1000); // saniyenin tam başı (ms=0)
    expect(isSessionRevoked(REFERENCE_IAT_SECONDS, changedAt)).toBe(false);
  });

  test("credentialsChangedAt, iat'in AYNI saniyesinin sonunda (ms=999) ise revoke edilmez", () => {
    const changedAt = new Date(REFERENCE_IAT_SECONDS * 1000 + 999);
    expect(isSessionRevoked(REFERENCE_IAT_SECONDS, changedAt)).toBe(false);
  });

  test("credentialsChangedAt, iat'in saniyesinin ortasında (ms=500) ise revoke edilmez", () => {
    const changedAt = new Date(REFERENCE_IAT_SECONDS * 1000 + 500);
    expect(isSessionRevoked(REFERENCE_IAT_SECONDS, changedAt)).toBe(false);
  });

  test("credentialsChangedAt, bir SONRAKİ saniyenin tam başında (boundary) ise revoke edilir", () => {
    const changedAt = new Date((REFERENCE_IAT_SECONDS + 1) * 1000);
    expect(isSessionRevoked(REFERENCE_IAT_SECONDS, changedAt)).toBe(true);
  });

  test("credentialsChangedAt, sonraki saniye boundary'sinden 1ms ÖNCE ise revoke edilmez", () => {
    const changedAt = new Date((REFERENCE_IAT_SECONDS + 1) * 1000 - 1);
    expect(isSessionRevoked(REFERENCE_IAT_SECONDS, changedAt)).toBe(false);
  });

  test("credentialsChangedAt, sonraki saniye boundary'sinden 1ms SONRA ise revoke edilir", () => {
    const changedAt = new Date((REFERENCE_IAT_SECONDS + 1) * 1000 + 1);
    expect(isSessionRevoked(REFERENCE_IAT_SECONDS, changedAt)).toBe(true);
  });
});

test.describe("Role change regresyon testi — Issue #26 ile karışmamalı", () => {
  test("membership role değişikliği credentialsChangedAt'i DEĞİŞTİRMEZ (session revoke etmez)", async () => {
    const owner = await createUser();
    const member = await createUser();
    const tenant = await prisma.tenant.create({
      data: { name: "Revocation Regression Co", slug: `revocation-regression-${randomUUID()}` },
    });
    await prisma.membership.create({ data: { userId: owner.id, tenantId: tenant.id, role: MembershipRole.OWNER } });
    const membership = await prisma.membership.create({
      data: { userId: member.id, tenantId: tenant.id, role: MembershipRole.MEMBER },
    });

    try {
      const beforeTarget = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });
      const beforeActor = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
      expect(beforeTarget.credentialsChangedAt).toBeNull();
      expect(beforeActor.credentialsChangedAt).toBeNull();

      const result = await updateMemberRole(tenant.id, membership.id, owner.id, MembershipRole.OWNER, "ADMIN");
      expect(result.ok).toBe(true);

      // Ne hedefin (rolü değişen) ne de aktörün (değişikliği yapanın) credential'ları etkilenmedi.
      const afterTarget = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });
      const afterActor = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
      expect(afterTarget.credentialsChangedAt).toBeNull();
      expect(afterActor.credentialsChangedAt).toBeNull();
      expect(afterTarget.passwordHash).toBe(beforeTarget.passwordHash);
    } finally {
      await cleanup([owner.id, member.id], [tenant.id]);
    }
  });
});
