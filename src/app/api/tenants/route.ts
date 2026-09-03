import { NextResponse } from "next/server";

import { isEmailVerified } from "@/lib/auth/email-verification";
import { requireUser } from "@/lib/auth/guard";
import { checkRateLimit } from "@/lib/rate-limit/guard";
import { RATE_LIMIT_BUCKETS, RATE_LIMIT_POLICIES } from "@/lib/rate-limit/policies";
import { createTenant } from "@/lib/tenants/create-tenant";
import { listTenantsForUser } from "@/lib/tenants/user-tenants";

export async function GET() {
  const { user, response } = await requireUser();
  if (!user) {
    return response;
  }

  const tenants = await listTenantsForUser(user.id);
  return NextResponse.json({ tenants });
}

export async function POST(request: Request) {
  // Rate-limit kontrolü authentication'dan ÖNCE uygulanır (Issue #27) — IP-bazlı olduğu için
  // authenticated/unauthenticated ayrımı yapmadan, spam trafiğini en erken noktada sınırlar.
  const rateLimitResponse = await checkRateLimit(
    request,
    RATE_LIMIT_BUCKETS.TENANT_CREATE,
    RATE_LIMIT_POLICIES.TENANT_CREATE,
  );
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

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

  const { name, slug } = body as Record<string, unknown>;

  // DOĞRULANMAMIŞ HESAP TENANT OLUŞTURAMAZ (Issue #190).
  //
  // Gerekçe: doğrulama, hesabın sahibine gerçekten ulaşılabildiğini kanıtlar; para ve ekip
  // verisi ancak o noktadan sonra devreye girmelidir. Girişi TAMAMEN engellemek
  // reddedildi — e-posta gecikmesinde (spam kutusu, kurumsal gateway) kullanıcıyı
  // hesabından kilitlerdi.
  //
  // 403, 401 DEĞİL: kimlik doğrulanmış, yetki eksik (bkz. `docs/architecture.md` status
  // sözlüğü). Mesaj ANLAŞILIR olmalı — kullanıcı ne yapması gerektiğini bilmeli.
  if (!(await isEmailVerified(user.id))) {
    return NextResponse.json(
      { error: "Please verify your e-mail address before creating a workspace." },
      { status: 403 },
    );
  }

  const result = await createTenant(user.id, { name, slug });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ tenant: result.tenant }, { status: 201 });
}
