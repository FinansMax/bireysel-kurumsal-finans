import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/authz/authorize";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { createCategory, listCategories } from "@/lib/finance/category";
import { isValidCategoryType } from "@/lib/finance/validation";
import { isValidId } from "@/lib/tenants/validation";

type RouteParams = { params: Promise<{ tenantId: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  const { tenantId } = await params;
  if (!isValidId(tenantId)) {
    return NextResponse.json({ error: "Invalid tenant id" }, { status: 400 });
  }

  // `?type=INCOME|EXPENSE` opsiyoneldir. Geçersiz bir değer SESSİZCE YOK SAYILMAZ (400):
  // sessizce yok saymak, filtre uygulandığını sanan bir istemciye tüm listeyi döndürürdü —
  // işlem formunda gider işlemine gelir kategorisi seçtirmek bunun ilk sonucu olurdu.
  const typeParam = new URL(request.url).searchParams.get("type");
  if (typeParam !== null && !isValidCategoryType(typeParam)) {
    return NextResponse.json({ error: "Type must be one of INCOME, EXPENSE" }, { status: 400 });
  }

  const { context, response } = await requirePermission(PERMISSIONS.VIEW_CATEGORIES, tenantId);
  if (!context) {
    return response;
  }

  // Sorgu scope'unun kaynağı `context.tenant.id`dir (requirePermission'ın DB'den canlı
  // doğruladığı aktif tenant) — URL parametresi DEĞİL (Issue #13).
  const categories = await listCategories(context.tenant.id, typeParam ?? undefined);
  return NextResponse.json({ categories });
}

export async function POST(request: Request, { params }: RouteParams) {
  const { tenantId } = await params;
  if (!isValidId(tenantId)) {
    return NextResponse.json({ error: "Invalid tenant id" }, { status: 400 });
  }

  const { context, response } = await requirePermission(PERMISSIONS.MANAGE_CATEGORIES, tenantId);
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

  const result = await createCategory(context.tenant.id, context.user.id, { name, type });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ category: result.category }, { status: 201 });
}
