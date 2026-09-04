import { NextRequest, NextResponse } from "next/server";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { checkRateLimit } from "@/lib/rate-limit/guard";
import { RATE_LIMIT_BUCKETS, RATE_LIMIT_POLICIES } from "@/lib/rate-limit/policies";
import { requireModule } from "@/lib/modules/guard";
import { MODULES } from "@/lib/modules/catalog";
import { validateUpdatePaymentPlan } from "@/lib/collections/validation";
import { getPaymentPlan, updatePaymentPlan } from "@/lib/collections/payment-plan";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "@/lib/audit/actions";

export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ tenantId: string; planId: string }> }
) {
  const params = await props.params;

  const authResult = await requireModule(MODULES.COLLECTIONS, PERMISSIONS.VIEW_COLLECTIONS, params.tenantId);
  if (authResult.response) return authResult.response;

  const serviceResult = await getPaymentPlan(authResult.context.tenant.id, params.planId);
  if (!serviceResult.ok) {
    return NextResponse.json({ error: serviceResult.error }, { status: serviceResult.status });
  }

  return NextResponse.json(serviceResult.data, { status: 200 });
}

export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ tenantId: string; planId: string }> }
) {
  const params = await props.params;

  const rateLimitResult = await checkRateLimit(
    request,
    RATE_LIMIT_BUCKETS.COLLECTIONS_MANAGE,
    RATE_LIMIT_POLICIES.COLLECTIONS_MANAGE
  );
  if (rateLimitResult) return rateLimitResult;

  const authResult = await requireModule(MODULES.COLLECTIONS, PERMISSIONS.MANAGE_COLLECTIONS, params.tenantId);
  if (authResult.response) return authResult.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz JSON gövdesi." }, { status: 400 });
  }

  const validation = validateUpdatePaymentPlan(body);
  if (!validation.valid) {
    return NextResponse.json({ error: "Doğrulama hatası", details: validation.errors }, { status: 400 });
  }

  const serviceResult = await updatePaymentPlan(authResult.context.tenant.id, params.planId, validation.data.notes);
  if (!serviceResult.ok) {
    return NextResponse.json({ error: serviceResult.error }, { status: serviceResult.status });
  }

  await writeAuditLog({
    actorUserId: authResult.context.user.id,
    tenantId: authResult.context.tenant.id,
    action: AUDIT_ACTIONS.COLLECTION_PLAN_UPDATED,
    targetType: AUDIT_TARGET_TYPES.PAYMENT_PLAN,
    targetId: serviceResult.data.id,
    metadata: {
      notesUpdated: true,
    },
  });

  return NextResponse.json(serviceResult.data, { status: 200 });
}
