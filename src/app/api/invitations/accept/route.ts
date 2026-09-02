import { NextResponse } from "next/server";

import { isEmailVerified } from "@/lib/auth/email-verification";
import { requireUser } from "@/lib/auth/guard";
import { acceptInvitation } from "@/lib/tenants/invitation";

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

  const { token } = body as Record<string, unknown>;

  // Tenant oluşturmayla AYNI kural ve aynı gerekçe (Issue #190): doğrulanmamış hesap ekip
  // verisine katılamaz. Kontrol token TÜKETİLMEDEN önce yapılır — aksi halde geçerli bir
  // davet, kabul edilemeden yanardı.
  if (!(await isEmailVerified(user.id))) {
    return NextResponse.json(
      { error: "Please verify your e-mail address before accepting an invitation." },
      { status: 403 },
    );
  }

  const result = await acceptInvitation(user.id, user.email, token);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ membership: result.membership }, { status: 200 });
}
