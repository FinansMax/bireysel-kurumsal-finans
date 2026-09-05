import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { EmptyState } from "@/components/ui/empty-state";
import { IconShield, IconWorkspace } from "@/components/ui/icons";
import { PageHeader, Panel } from "@/components/ui/surfaces";
import { Table, TableScroll, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { decodeAuditLogCursor } from "@/lib/audit/audit-log-cursor";
import { listAuditLog } from "@/lib/audit/list-audit-log";
import { requirePageUser } from "@/lib/auth/page-guard";
import { hasPermission, PERMISSIONS } from "@/lib/authz/permissions";
import { resolveActiveTenantForUser } from "@/lib/tenants/tenant-context";
import { formatDateInTimeZone } from "@/lib/time/tenant-time";

export const metadata: Metadata = {
  title: "Denetim Kaydı",
};

/**
 * Denetim kaydı listesi (Issue #78).
 *
 * YETKİ SAYFADA DA ZORLANIR: `VIEW_AUDIT_LOG` yoksa `/dashboard`'a yönlendirilir — bu bir UX
 * kararıdır, asıl koruma `GET /api/tenants/:tenantId/audit-log` içindedir (invariant #3).
 *
 * VERİ SUNUCUDA OKUNUR, API'den DEĞİL: sayfa bir sunucu bileşeni ve servis fonksiyonunu doğrudan
 * çağırıyor. Bu, auth ekranlarındaki kuralla ÇELİŞMEZ — orada yasak olan şey, route seviyesindeki
 * RATE LİMİTİ atlamaktı (#36). Burada atlanacak bir rate limit yok: liste salt okunur ve
 * yetkilendirme zaten `hasPermission()` ile aynı trusted context üzerinden yapılıyor. Aynı desen
 * `/transactions`, `/members` ve `/settings/modules` ekranlarında da kullanılıyor.
 *
 * SAYFALAMA URL'DE (`?after=`): "daha fazla yükle" düğmesi bir LİNKTİR, istemci state'i değil.
 * Böylece sayfa paylaşılabilir, geri tuşu çalışır ve ekranın istemci bileşenine dönmesi
 * gerekmez. Bozuk imleç sessizce ilk sayfaya düşmez — 400 sayfası yerine açık bir uyarı gösterilir.
 */
export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePageUser();
  const active = await resolveActiveTenantForUser(user.id);

  if (!active) {
    return (
      <section className="space-y-8">
        <PageHeader title="Denetim kaydı" />
        <EmptyState
          icon={<IconWorkspace className="size-5" />}
          title="Çalışma alanı seçilmedi"
          description="Önce menüden bir çalışma alanı seçin. Denetim kaydı çalışma alanı başına tutulur."
          action={{ label: "Çalışma alanı oluştur", href: "/tenants/new" }}
        />
      </section>
    );
  }

  const { tenant, role } = active;

  if (!hasPermission(role, PERMISSIONS.VIEW_AUDIT_LOG)) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const afterRaw = typeof params.after === "string" ? params.after : null;
  const after = afterRaw ? decodeAuditLogCursor(afterRaw) : null;
  const cursorBroken = afterRaw !== null && after === null;

  const { entries, nextCursor } = await listAuditLog(tenant.id, after);

  return (
    <section className="space-y-8">
      <PageHeader
        title="Denetim kaydı"
        description={
          <>
            <span className="font-medium text-strong">{tenant.name}</span> çalışma alanında kim,
            ne zaman, neyi değiştirdi. Kayıtlar <span className="font-medium">silinemez</span> ve
            bu ekrandan değiştirilemez.
          </>
        }
      />

      {cursorBroken ? (
        <p role="alert" className="text-sm text-pretty text-danger-600 dark:text-danger-300">
          Sayfa bağlantısı geçersiz. Listenin başından devam ediliyor olabilir; aşağıdaki kayıtlar
          en yeniden başlar.
        </p>
      ) : null}

      {entries.length === 0 ? (
        <EmptyState
          icon={<IconShield className="size-5" />}
          title="Henüz kayıt yok"
          description="Çalışma alanında bir değişiklik yapıldığında burada görünecek."
        />
      ) : (
        <Panel>
          <TableScroll>
            <Table>
              <Thead>
                <Th>Tarih</Th>
                <Th>Olay</Th>
                <Th>Kim</Th>
                <Th>Hedef</Th>
              </Thead>
              <Tbody>
                {entries.map((entry) => (
                  <Tr key={entry.id}>
                    {/* `createdAt` bir ANDIR: hangi güne düştüğü tenant'ın saat diliminde
                        yorumlanır (#134). */}
                    <Td className="whitespace-nowrap text-faint">
                      {formatDateInTimeZone(entry.createdAt, tenant.timeZone)}
                    </Td>
                    {/* Action SABİT bir olay adıdır (`src/lib/audit/actions.ts`) ve olduğu gibi
                        gösterilir: Türkçeye çevirmek, kaydın aranabilir tek kimliğini ekrandan
                        silerdi. Bir destek talebinde "AUTH_LOGIN_SUCCESS" yazan satır, koddaki
                        sabitle birebir aynı olmalı. */}
                    <Td className="font-mono text-xs text-strong">{entry.action}</Td>
                    <Td className="break-all">{entry.actorEmail ?? "—"}</Td>
                    <Td className="text-muted">
                      {entry.targetType ? (
                        <span className="font-mono text-xs">
                          {entry.targetType}
                          {entry.targetId ? `:${entry.targetId}` : ""}
                        </span>
                      ) : (
                        "—"
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </TableScroll>
        </Panel>
      )}

      {nextCursor ? (
        <Link
          href={`/settings/audit-log?after=${encodeURIComponent(nextCursor)}`}
          className="inline-block rounded-control border border-line px-3 py-1.5 text-sm font-medium text-body transition-colors duration-150 ease-out-soft hover:bg-surface-muted"
        >
          Daha eski kayıtlar
        </Link>
      ) : null}
    </section>
  );
}
