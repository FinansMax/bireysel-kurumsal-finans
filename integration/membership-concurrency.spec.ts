import { randomUUID } from "node:crypto";

import { MembershipRole } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { prisma } from "../src/lib/prisma";
import { removeMember, updateMemberRole } from "../src/lib/tenants/membership";

/**
 * Eşzamanlılık regresyon testi (Issue #122).
 *
 * `updateMemberRole()`/`removeMember()` Serializable izolasyonda çalışır ve "son OWNER" gibi
 * OKUMAYA BAĞLI invariant'ları korur. Serializable izolasyonun sözleşmesi şudur: eşzamanlı
 * transaction'lar birbirini geçersiz kılarsa veritabanı **serialization failure** (Prisma
 * `P2034`) döner ve çağıranın transaction'ı YENİDEN DENEMESİ beklenir.
 *
 * Retry katmanı olmadan bu hata handler'a kadar çıkıp 500'e dönüşüyordu — yani meşru bir
 * kullanıcı, sadece aynı anda başka birinin de rol değiştirmesi yüzünden sunucu hatası
 * alıyordu (bkz. Issue #122; PR #121'de tam E2E suite'inde iki kez üst üste görüldü).
 *
 * DUYARLILIK: `runSerializable()` içindeki retry kaldırılırsa bu dosya kırmızıya döner —
 * testin varlık sebebi budur.
 */

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

test.afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

/** Tek tenant + verilen sayıda OWNER üye (hepsi aynı tenant'ta, çakışmayı garantilemek için). */
async function createTenantWithOwners(ownerCount: number) {
  const tenant = await prisma.tenant.create({
    data: { name: "Concurrency", slug: `conc-${randomUUID()}` },
    select: { id: true },
  });
  createdTenantIds.push(tenant.id);

  const memberships: Array<{ membershipId: string; userId: string }> = [];

  for (let i = 0; i < ownerCount; i++) {
    const user = await prisma.user.create({
      data: { email: `conc-${randomUUID()}@example.com` },
      select: { id: true },
    });
    createdUserIds.push(user.id);

    const membership = await prisma.membership.create({
      data: { userId: user.id, tenantId: tenant.id, role: MembershipRole.OWNER },
      select: { id: true },
    });

    memberships.push({ membershipId: membership.id, userId: user.id });
  }

  return { tenantId: tenant.id, memberships };
}

test.describe("Eşzamanlı membership mutation'ları (Issue #122)", () => {
  test("aynı anda gelen rol düşürmeleri 500 yerine tanımlı sonuç döner", async () => {
    // OWNER sayısı bilerek yüksek: her düşürme, "son OWNER mı?" sorusu için tenant genelinde
    // bir `count()` (predicate read) yapar — Serializable izolasyonda çakışmayı tetikleyen
    // tam olarak budur.
    const { tenantId, memberships } = await createTenantWithOwners(6);
    const actor = memberships[0];

    const results = await Promise.all(
      memberships
        .slice(1)
        .map((target) =>
          updateMemberRole(
            tenantId,
            target.membershipId,
            actor.userId,
            MembershipRole.OWNER,
            MembershipRole.MEMBER,
          ),
        ),
    );

    // Hiçbir çağrı FIRLATMAMALI (fırlatsaydı `Promise.all` reddederdi ve test burada
    // patlardı) — retry öncesinde tam olarak bu oluyordu: ham `P2034` handler'a kadar çıkıp
    // 500'e dönüşüyordu. Dönen her sonuç tanımlı union'dan biri olmalı.
    for (const result of results) {
      if (!result.ok) {
        // Meşru sonuçlar: son OWNER koruması (409), yarışta kaybedip hedefi bulamama (404)
        // ve — çok yoğun çakışmada — denemelerin tükenmesi (503). 503 bir HATA DEĞİL, tanımlı
        // ve geçici bir yanıttır; asıl mesele 500 almamaktır.
        expect([404, 409, 503]).toContain(result.status);
      }
    }

    // İLERLEME KANITI: "hepsi başarısız oldu ama düzgün başarısız oldu" durumu kabul edilemez;
    // en az bir işlem gerçekten tamamlanmış olmalı.
    expect(results.some((result) => result.ok)).toBe(true);

    // İnvariant korunmuş olmalı: tenant'ta en az bir OWNER kaldı.
    const remainingOwners = await prisma.membership.count({
      where: { tenantId, role: MembershipRole.OWNER },
    });
    expect(remainingOwners).toBeGreaterThanOrEqual(1);
  });

  test("hafif çakışmada (2 eşzamanlı istek) her iki işlem de BAŞARIYLA tamamlanıyor", async () => {
    // Retry'ın gerçekten iş gördüğünün kanıtı: yukarıdaki testler "500 almıyoruz"u gösterir,
    // bu test "çakışan istekler kaybolmuyor, ikisi de tamamlanıyor"u gösterir. Hiçbir şey
    // yapmayan bir retry implementasyonu bu testi GEÇEMEZ.
    const { tenantId, memberships } = await createTenantWithOwners(4);
    const actor = memberships[0];

    const results = await Promise.all(
      memberships.slice(1, 3).map((target) =>
        updateMemberRole(
          tenantId,
          target.membershipId,
          actor.userId,
          MembershipRole.OWNER,
          MembershipRole.MEMBER,
        ),
      ),
    );

    expect(results.every((result) => result.ok)).toBe(true);

    const remainingOwners = await prisma.membership.count({
      where: { tenantId, role: MembershipRole.OWNER },
    });
    expect(remainingOwners).toBe(2);
  });

  test("aynı anda gelen üye çıkarmaları 500 yerine tanımlı sonuç döner", async () => {
    const { tenantId, memberships } = await createTenantWithOwners(6);

    const results = await Promise.all(
      memberships
        .slice(1)
        .map((target) => removeMember(tenantId, target.membershipId, MembershipRole.OWNER)),
    );

    for (const result of results) {
      if (!result.ok) {
        expect([404, 409, 503]).toContain(result.status);
      }
    }

    const remainingOwners = await prisma.membership.count({
      where: { tenantId, role: MembershipRole.OWNER },
    });
    expect(remainingOwners).toBeGreaterThanOrEqual(1);
  });

  test("karışık (rol değiştirme + çıkarma) eşzamanlı yükte de invariant korunuyor", async () => {
    const { tenantId, memberships } = await createTenantWithOwners(8);
    const actor = memberships[0];

    const operations = memberships.slice(1).map((target, index) =>
      index % 2 === 0
        ? updateMemberRole(
            tenantId,
            target.membershipId,
            actor.userId,
            MembershipRole.OWNER,
            MembershipRole.MEMBER,
          )
        : removeMember(tenantId, target.membershipId, MembershipRole.OWNER),
    );

    const results = await Promise.all(operations);

    for (const result of results) {
      if (!result.ok) {
        expect([404, 409, 503]).toContain(result.status);
      }
    }

    const remainingOwners = await prisma.membership.count({
      where: { tenantId, role: MembershipRole.OWNER },
    });
    expect(remainingOwners).toBeGreaterThanOrEqual(1);
  });
});
