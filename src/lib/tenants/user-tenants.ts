import { prisma } from "@/lib/prisma";

export type UserTenant = {
  id: string;
  name: string;
  slug: string;
  role: string;
};

/**
 * Authenticated kullanıcının üyesi olduğu tenant'ları döner. Sorgu her zaman `userId` ile
 * scope'lanır — başka bir kullanıcının tenant'ları hiçbir koşulda bu fonksiyondan dönemez.
 */
export async function listTenantsForUser(userId: string): Promise<UserTenant[]> {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    select: {
      role: true,
      tenant: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return memberships.map((m) => ({ ...m.tenant, role: m.role }));
}
