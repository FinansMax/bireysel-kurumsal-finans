import { NextRequest, NextResponse } from "next/server";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { checkRateLimit } from "@/lib/rate-limit/guard";
import { RATE_LIMIT_BUCKETS, RATE_LIMIT_POLICIES } from "@/lib/rate-limit/policies";
import { requireModule } from "@/lib/modules/guard";
import { MODULES } from "@/lib/modules/catalog";
import { cancelPaymentPlan } from "@/lib/collections/payment-plan";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "@/lib/audit/actions";

export async function POST(
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

  const serviceResult = await cancelPaymentPlan(authResult.context.tenant.id, params.planId);
  if (!serviceResult.ok) {
    return NextResponse.json({ error: serviceResult.error }, { status: serviceResult.status });
  }

  await writeAuditLog({
    actorUserId: authResult.context.user.id,
    tenantId: authResult.context.tenant.id,
    action: AUDIT_ACTIONS.COLLECTION_PLAN_CANCELLED,
    targetType: AUDIT_TARGET_TYPES.PAYMENT_PLAN,
    targetId: serviceResult.data.id,
    metadata: {
      cancelledAt: new Date().toISOString(),
    },
  });

  return NextResponse.json(serviceResult.data, { status: 200 });
}
