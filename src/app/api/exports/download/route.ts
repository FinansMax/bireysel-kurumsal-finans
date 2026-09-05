import { NextResponse } from "next/server";

import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "@/lib/audit/actions";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { consumeExportDownload } from "@/lib/export/tenant-export-service";
import { checkRateLimit } from "@/lib/rate-limit/guard";
import { RATE_LIMIT_BUCKETS, RATE_LIMIT_POLICIES } from "@/lib/rate-limit/policies";

/**
 * Dışa aktarma dosyasını indirir ve token'ı TÜKETİR (Issue #194).
 *
 * ---
 * POST'TUR, "İNDİRME BAĞLANTISI" DEĞİL — ve bu, bu issue'daki tek gerçek gerilimin çözümüdür.
 *
 * Issue iki şey istiyor: (a) indirme bağlantısı TEK KULLANIMLIK olsun, (b) invariant #6'nın
 * token desenine uysun. Ama tek kullanımlık olmak, `downloadedAt`'i yazmak demektir — yani
 * bir YAN ETKİ. Bunu bir GET'e koymak invariant #4'ü ("GET/HEAD yan etkisizdir") ihlal
 * ederdi ve `integration/get-side-effect-free-pattern.spec.ts` haklı olarak kırmızıya dönerdi.
 *
 * İnvariant'ı gevşetmek yerine BİÇİM değiştirildi: indirme bir POST'tur. Kaybedilen tek şey,
 * adres çubuğuna yapıştırılabilen bir bağlantıdır; kazanılan şey, hem tek kullanımlılık hem
 * de yan etkisiz GET kuralının bozulmamasıdır.
 *
 * TOKEN GÖVDEDE, URL'DE DEĞİL: URL'ler sunucu erişim loglarına, proxy loglarına ve tarayıcı
 * geçmişine yazılır. Tenant'ın tüm verisini açan bir anahtarın oralarda durmaması gerekir.
 * ---
 *
 * KİMLİK İSTEMEZ: token'ın kendisi yetkidir (şifre sıfırlama linkiyle aynı model). Talebi
 * yapan OWNER dosyayı başka bir cihazda açabilmelidir.
 */
export async function POST(request: Request) {
  // Rate limit en üstte (invariant #9): endpoint public'tir ve token brute-force'unu
  // yavaşlatır. Token 256 bit olduğu için brute-force birincil tehdit DEĞİLDİR; amaç
  // kimliksiz ve her çağrıda DB'ye yazan bir ucun sınırsız çağrılmasını engellemektir.
  const rateLimitResponse = await checkRateLimit(
    request,
    RATE_LIMIT_BUCKETS.DATA_EXPORT,
    RATE_LIMIT_POLICIES.DATA_EXPORT,
  );
  if (rateLimitResponse) {
    return rateLimitResponse;
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

  const result = await consumeExportDownload(token);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Audit, tüketimden SONRA ve best-effort (invariant #8). Olay burada yazılır çünkü VERİ
  // ASIL BURADA DIŞARI ÇIKAR — talep anında değil.
  await writeAuditLog({
    actorUserId: result.requestedByUserId,
    tenantId: result.tenantId,
    action: AUDIT_ACTIONS.TENANT_DATA_EXPORTED,
    targetType: AUDIT_TARGET_TYPES.TENANT,
    targetId: result.tenantId,
    metadata: { byteSize: result.zip.byteLength },
  });

  return new NextResponse(new Uint8Array(result.zip), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(result.zip.byteLength),
      // Dosya adı ID taşır, slug DEĞİL: slug kullanıcı girdisidir ve bu başlıkta kaçırılması
      // gereken karakterler içerebilir.
      "Content-Disposition": `attachment; filename="${result.fileName}"`,
      // Tenant'ın tüm verisi: hiçbir ara katman bunu saklamamalıdır.
      "Cache-Control": "no-store",
    },
  });
}
