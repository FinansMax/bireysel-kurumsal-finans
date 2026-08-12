import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/guard";
import { setActiveTenantCookie } from "@/lib/tenants/active-tenant";
import { prisma } from "@/lib/prisma";
import { isValidId } from "@/lib/tenants/validation";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user) {
    return response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { tenantId } = body as Record<string, unknown>;

  if (!isValidId(tenantId)) {
    return NextResponse.json({ error: "Invalid tenantId" }, { status: 400 });
  }

  // İstemciden gelen tenantId'ye güvenilmez: kullanıcının bu tenant'ta gerçekten bir
  // membership'i olduğu her zaman DB'den doğrulanır. "Tenant yok" ile "üye değilsin"
  // durumları aynı 403 ile sonuçlanır (enumeration'a izin vermemek için).
  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: user.id, tenantId } },
    select: { tenantId: true },
  });

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const res = NextResponse.json({ tenantId }, { status: 200 });
  await setActiveTenantCookie(res, tenantId);
  return res;
}
