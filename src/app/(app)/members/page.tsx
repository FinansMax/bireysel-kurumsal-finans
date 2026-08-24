import type { Metadata } from "next";
import Link from "next/link";
import { MembershipRole } from "@prisma/client";

import { requirePageUser } from "@/lib/auth/page-guard";
import { hasPermission, PERMISSIONS } from "@/lib/authz/permissions";
import { listMembers } from "@/lib/tenants/membership";
import { resolveActiveTenantForUser } from "@/lib/tenants/tenant-context";

import { MembersTable } from "./members-table";

export const metadata: Metadata = {
  title: "Üyeler",
};

/**
 * Aktif çalışma alanının üye yönetimi ekranı (Issue #43).
 *
 * NEDEN URL'DE `tenantId` YOK: hangi tenant'ın üyeleri gösterileceğinin tek kaynağı AKTİF
 * TENANT'tır (Issue #10 cookie'si, her istekte membership'i DB'den doğrulanır). URL'e bir
 * tenantId koymak, "adres çubuğundaki değeri değiştirip başka tenant'ı görme" denemelerine
 * davetiye çıkarırdı — backend bunu zaten 403'le reddediyor (bkz. `requirePermission()`'ın
 * `expectedTenantId` kontrolü), ama en baştan böyle bir parametre sunmamak daha temizdir.
 *
 * KAPSAM NOTU — issue metninden bilinçli sapma: Issue #43'ün kabul kriteri "OWNER olmayan
 * kullanıcı bu ekrana erişemiyor" der; ancak o metin, izin matrisinin (Issue #11/#12) yazılmasından
 * ÖNCEDİR ve matris yetkili kaynaktır: `MEMBER` rolü `VIEW_MEMBERS` iznine SAHİPTİR. Bu yüzden
 * ekran listeyi tüm üyelere gösterir, YÖNETİM aksiyonlarını ise yalnızca izni olan role
 * (`UPDATE_MEMBER_ROLE` / `REMOVE_MEMBER`) render eder. Matrisi gevşetmek yerine matrisi
 * uygulamak doğrudur; ayrıca UI'da gizlemek bir güvenlik kontrolü DEĞİLDİR — asıl kontrol
 * route'lardaki `requirePermission()`'dır (kanıt: `security/tenant-membership-authorization-security.spec.ts`).
 */
export default async function MembersPage() {
  const user = await requirePageUser();
  const active = await resolveActiveTenantForUser(user.id);

  // Aktif tenant yoksa liste sorgusu bile yapılmaz: hangi tenant'ın üyeleri sorusunun cevabı
  // yoktur. Kullanıcı seçiciyi (Issue #40) kullanmaya yönlendirilir.
  if (!active) {
    return (
      <section className="space-y-2">
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Üyeler</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Önce üstteki menüden bir çalışma alanı seçin.{" "}
          <Link href="/tenants/new" className="underline underline-offset-4">
            Yeni bir tane oluşturabilirsiniz.
          </Link>
        </p>
      </section>
    );
  }

  const { tenant, role } = active;

  // Görüntüleme izni de matristen okunur; şu an tüm roller `VIEW_MEMBERS`'a sahiptir, ama
  // kontrol "bugün öyle" varsayımına değil matrise bağlanır — matris değişirse ekran da
  // otomatik olarak doğru davranır.
  if (!hasPermission(role, PERMISSIONS.VIEW_MEMBERS)) {
    return (
      <section className="space-y-2">
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Üyeler</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Bu çalışma alanının üyelerini görüntüleme yetkiniz yok.
        </p>
      </section>
    );
  }

  const members = await listMembers(tenant.id);
  const ownerCount = members.filter((member) => member.role === MembershipRole.OWNER).length;

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Üyeler</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">{tenant.name}</span>{" "}
          çalışma alanındaki kişiler. Bu alandaki rolünüz: {role}.
        </p>
      </div>

      <MembersTable
        tenantId={tenant.id}
        viewerUserId={user.id}
        viewerRole={role}
        canUpdateRole={hasPermission(role, PERMISSIONS.UPDATE_MEMBER_ROLE)}
        canRemove={hasPermission(role, PERMISSIONS.REMOVE_MEMBER)}
        ownerCount={ownerCount}
        members={members.map((member) => ({
          id: member.id,
          role: member.role,
          userId: member.userId,
          email: member.user.email,
          name: member.user.name,
        }))}
      />
    </section>
  );
}
