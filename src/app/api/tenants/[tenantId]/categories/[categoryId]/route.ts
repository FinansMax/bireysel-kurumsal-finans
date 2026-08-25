import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/authz/authorize";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { deleteCategory, updateCategory } from "@/lib/finance/category";
import { isValidId } from "@/lib/tenants/validation";

type RouteParams = { params: Promise<{ tenantId: string; categoryId: string }> };

async function resolveParams(params: RouteParams["params"]) {
  const { tenantId, categoryId } = await params;
  if (!isValidId(tenantId) || !isValidId(categoryId)) {
    return null;
  }
  return { tenantId, categoryId };
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const ids = await resolveParams(params);
  if (!ids) {
    return NextResponse.json({ error: "Invalid tenant or category id" }, { status: 400 });
  }

  const { context, response } = await requirePermission(
    PERMISSIONS.MANAGE_CATEGORIES,
    ids.tenantId,
  );
  if (!context) {
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

  const { name, type } = body as Record<string, unknown>;

  // Trusted tenantId `context.tenant.id`dir; `actorUserId` de aynı context'ten gelir (audit).
  // Body'deki olası `tenantId`/`id` alanları servise HİÇ geçirilmez.
  const result = await updateCategory(context.tenant.id, ids.categoryId, context.user.id, {
    name,
    type,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ category: result.category });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const ids = await resolveParams(params);
  if (!ids) {
    return NextResponse.json({ error: "Invalid tenant or category id" }, { status: 400 });
  }

  const { context, response } = await requirePermission(
    PERMISSIONS.MANAGE_CATEGORIES,
    ids.tenantId,
  );
  if (!context) {
    return response;
  }

  const result = await deleteCategory(context.tenant.id, ids.categoryId, context.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return new NextResponse(null, { status: 204 });
}
