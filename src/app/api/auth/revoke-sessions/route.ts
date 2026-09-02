import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/guard";
import { revokeUserSessions } from "@/lib/auth/revoke-sessions";
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "@/lib/audit/actions";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { checkRateLimit } from "@/lib/rate-limit/guard";
import { RATE_LIMIT_BUCKETS, RATE_LIMIT_POLICIES } from "@/lib/rate-limit/policies";

/**
 * "Tüm cihazlardan çıkış yap" (Issue #186).
 *
 * POST'tur, GET DEĞİL: state değiştirir (invariant #4). Bir GET olsaydı, `SameSite=Lax`
 * top-level cross-site GET'leri engellemediği için herhangi bir sitedeki `<img>` etiketi
 * kullanıcıyı tüm cihazlarından atabilirdi.
 *
 * GÖVDESİZDİR: hangi kullanıcının oturumlarının kapatılacağı YALNIZCA trusted session'dan
 * (`user.id`) gelir. Body'de gönderilen bir userId/email asla kaynak değildir (invariant #2) —
 * aksi halde bu endpoint, herhangi bir kullanıcıyı sistemden atmanın yolu olurdu.
 */
export async function POST(request: Request) {
  // Rate limit her şeyden ÖNCE (invariant #9). Endpoint authenticated olmasına rağmen limit
  // gerekir: çalınmış bir cookie'yle tekrar tekrar çağrılırsa meşru kullanıcı sürekli dışarı
  // atılır (bkz. `policies.ts`'teki REVOKE_SESSIONS gerekçesi).
  const rateLimitResponse = await checkRateLimit(
    request,
    RATE_LIMIT_BUCKETS.REVOKE_SESSIONS,
    RATE_LIMIT_POLICIES.REVOKE_SESSIONS,
  );
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const { user, response } = await requireUser();
  if (!user) {
    return response;
  }

  const result = await revokeUserSessions(user.id);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Audit YAZIMI, yazma işleminden SONRA ve best-effort (invariant #8). `actorUserId`
  // doldurulur: istek authenticated'dır, dolayısıyla `change-password`'deki kararla aynı
  // şekilde bir enumeration sinyali taşımaz.
  await writeAuditLog({
    actorUserId: user.id,
    action: AUDIT_ACTIONS.AUTH_SESSIONS_REVOKED,
    targetType: AUDIT_TARGET_TYPES.USER,
    targetId: user.id,
    // Zaman damgası dışında metadata YOK: burada saklanabilecek her şey (IP, user-agent)
    // hassas veridir ve bu issue'nun kapsamında bir ihtiyaç yoktur.
    metadata: { revokedAt: result.revokedAt.toISOString() },
  });

  // Çağıranın kendi oturumu da düştü — yanıt bunu AÇIKÇA söyler. Stateless JWT'de "bu isteği
  // yapan token"ı ayrıcalıklı kılmanın yolu yoktur; `change-password` de aynı nedenle aynı
  // şeyi söyler. Kullanıcıyı sessizce 401'e düşürmek, hatayı ürün hatası sanmasına yol açardı.
  return NextResponse.json(
    { message: "All sessions have been closed. Please sign in again." },
    { status: 200 },
  );
}
