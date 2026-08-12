import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/guard";
import { listMembers } from "@/lib/tenants/membership";
import { isValidId } from "@/lib/tenants/validation";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const { user, response } = await requireUser();
  if (!user) {
    return response;
  }

  const { tenantId } = await params;
  if (!isValidId(tenantId)) {
    return NextResponse.json({ error: "Invalid tenant id" }, { status: 400 });
  }

  const result = await listMembers(tenantId, user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ members: result.members });
}
