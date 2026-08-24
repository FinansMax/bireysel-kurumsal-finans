"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MembershipRole } from "@prisma/client";

/**
 * Üye listesi ve yönetim aksiyonları (Issue #43).
 *
 * Mevcut `PATCH/DELETE /api/tenants/:tenantId/members/:membershipId` endpoint'lerine gerçek
 * HTTP istekleri atar; servis fonksiyonları (`updateMemberRole`/`removeMember`) doğrudan
 * çağrılMAZ — yetkilendirme (`requirePermission()`) ve tenant sınırı kontrolü route
 * seviyesindedir.
 *
 * BURADAKİ TÜM "devre dışı" KURALLARI YALNIZCA GÖRÜNÜMDÜR. Tek doğruluk kaynağı backend'dir:
 * ADMIN'in bir OWNER'a dokunamaması, son OWNER'ın düşürülememesi/çıkarılamaması ve rol izinleri
 * `src/lib/tenants/membership.ts` + `src/lib/authz/` tarafından zorlanır (kanıt:
 * `security/tenant-membership-authorization-security.spec.ts`). Buradaki kurallar kullanıcıya
 * kesin başarısız olacak bir işlemi denetmemek içindir; kaldırılsalar bile güvenlik değişmez.
 */

/**
 * Rol seçenekleri. `@prisma/client`'ın RUNTIME enum'ı bilerek import EDİLMEZ (yalnızca `type`):
 * Prisma Client bir sunucu kütüphanesidir, istemci paketine girmemelidir. Değerler string
 * literal olarak yazılır ama `MembershipRole` tipiyle kontrol edilir — enum'a yeni bir rol
 * eklenirse bu dizi derleme zamanında uyumsuz hale gelmez, o yüzden aşağıdaki `satisfies`
 * ile en azından geçersiz bir değer yazılması engellenir.
 */
const ALL_ROLES = ["OWNER", "ADMIN", "MEMBER"] as const satisfies readonly MembershipRole[];

const ROLE_LABELS: Record<MembershipRole, string> = {
  OWNER: "Sahip (OWNER)",
  ADMIN: "Yönetici (ADMIN)",
  MEMBER: "Üye (MEMBER)",
};

export type MemberRow = {
  id: string;
  role: MembershipRole;
  userId: string;
  email: string;
  name: string | null;
};

function messageForStatus(status: number): string {
  switch (status) {
    case 400:
      return "Geçersiz istek.";
    case 403:
      return "Bu işlem için yetkiniz yok.";
    case 404:
      return "Üye bulunamadı; liste güncel olmayabilir. Sayfayı yenileyin.";
    case 409:
      return "Bu çalışma alanının tek sahibi (OWNER) düşürülemez veya çıkarılamaz.";
    default:
      return "İşlem tamamlanamadı. Lütfen tekrar deneyin.";
  }
}

export function MembersTable({
  tenantId,
  viewerUserId,
  viewerRole,
  canUpdateRole,
  canRemove,
  ownerCount,
  members,
}: {
  tenantId: string;
  viewerUserId: string;
  viewerRole: MembershipRole;
  canUpdateRole: boolean;
  canRemove: boolean;
  ownerCount: number;
  members: MemberRow[];
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState<{ membershipId: string; message: string } | null>(null);

  async function send(membershipId: string, request: () => Promise<Response>) {
    setError(null);
    setPendingId(membershipId);

    try {
      const response = await request();

      if (!response.ok) {
        setError({ membershipId, message: messageForStatus(response.status) });
        return;
      }

      // Liste sunucuda render edilir; `refresh()` sunucu bileşenini yeni veriyle yeniden
      // çalıştırır. Burada TAM SAYFA yükleme gerekmez (tenant switcher'dan farklı olarak
      // aktif tenant değişmiyor, yalnızca bu route'un verisi değişiyor).
      router.refresh();
      setConfirmingId(null);
    } catch {
      setError({ membershipId, message: messageForStatus(0) });
    } finally {
      setPendingId(null);
    }
  }

  function updateRole(membershipId: string, role: MembershipRole) {
    return send(membershipId, () =>
      fetch(`/api/tenants/${tenantId}/members/${membershipId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      }),
    );
  }

  function removeMember(membershipId: string) {
    return send(membershipId, () =>
      fetch(`/api/tenants/${tenantId}/members/${membershipId}`, { method: "DELETE" }),
    );
  }

  // ADMIN, OWNER rolünü hiç kimseye ATAYAMAZ (privilege escalation koruması, backend'de de
  // aynı kural var); bu yüzden seçenek listesinden çıkarılır.
  const assignableRoles: readonly MembershipRole[] =
    viewerRole === "OWNER" ? ALL_ROLES : ALL_ROLES.filter((role) => role !== "OWNER");

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <thead className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
          <tr>
            <th scope="col" className="py-2 pr-4 font-medium">Kişi</th>
            <th scope="col" className="py-2 pr-4 font-medium">Rol</th>
            <th scope="col" className="py-2 font-medium">İşlem</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const isLastOwner = member.role === "OWNER" && ownerCount <= 1;
            // ADMIN bir OWNER'ı ne düşürebilir ne çıkarabilir (ownership koruması).
            const isProtectedOwner = member.role === "OWNER" && viewerRole !== "OWNER";
            const locked = isLastOwner || isProtectedOwner;
            const lockReason = isProtectedOwner
              ? "Bir OWNER'ı yalnızca başka bir OWNER yönetebilir."
              : isLastOwner
                ? "Çalışma alanının tek sahibi (OWNER) düşürülemez veya çıkarılamaz."
                : undefined;

            const pending = pendingId === member.id;
            const rowError = error?.membershipId === member.id ? error.message : null;

            return (
              <tr key={member.id} className="border-t border-zinc-200 dark:border-zinc-800">
                <td className="py-3 pr-4 align-top">
                  <div className="font-medium text-zinc-900 dark:text-zinc-100">{member.email}</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    {member.name ?? "İsim girilmemiş"}
                    {member.userId === viewerUserId ? " · siz" : ""}
                  </div>
                  {rowError && (
                    <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">
                      {rowError}
                    </p>
                  )}
                </td>

                <td className="py-3 pr-4 align-top">
                  {canUpdateRole ? (
                    <>
                      <label htmlFor={`role-${member.id}`} className="sr-only">
                        {`${member.email} rolü`}
                      </label>
                      <select
                        id={`role-${member.id}`}
                        value={member.role}
                        disabled={pending || locked}
                        title={lockReason}
                        onChange={(event) =>
                          void updateRole(member.id, event.target.value as MembershipRole)
                        }
                        className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                      >
                        {/* Mevcut rol seçeneklerde yoksa (ör. ADMIN bir OWNER'a bakıyor) kutu
                            boş görünmesin diye o rol de eklenir — ama seçim kilitlidir. */}
                        {(assignableRoles.includes(member.role)
                          ? assignableRoles
                          : [member.role, ...assignableRoles]
                        ).map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <span className="text-zinc-700 dark:text-zinc-300">
                      {ROLE_LABELS[member.role]}
                    </span>
                  )}
                </td>

                <td className="py-3 align-top">
                  {!canRemove ? (
                    <span className="text-xs text-zinc-500 dark:text-zinc-500">—</span>
                  ) : confirmingId === member.id ? (
                    // Native `confirm()` yerine satır içi onay: tarayıcı diyaloğu testlerde ve
                    // ekran okuyucularda daha kırılgan, üstelik sayfa akışını bloke eder.
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-zinc-600 dark:text-zinc-400">Emin misiniz?</span>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => void removeMember(member.id)}
                        className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
                      >
                        {pending ? "Çıkarılıyor…" : "Evet, çıkar"}
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => setConfirmingId(null)}
                        className="rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700"
                      >
                        Vazgeç
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={pending || locked}
                      title={lockReason}
                      onClick={() => {
                        setError(null);
                        setConfirmingId(member.id);
                      }}
                      className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-900 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900"
                    >
                      Çıkar
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
