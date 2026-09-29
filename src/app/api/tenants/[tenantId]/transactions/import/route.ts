import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/authz/authorize";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { importTransactionsCsv, MAX_IMPORT_BYTES } from "@/lib/import/transactions-csv";
import { checkRateLimit } from "@/lib/rate-limit/guard";
import { RATE_LIMIT_BUCKETS, RATE_LIMIT_POLICIES } from "@/lib/rate-limit/policies";
import { isValidId } from "@/lib/tenants/validation";

type RouteParams = { params: Promise<{ tenantId: string }> };

/**
 * İşlemleri CSV dosyasından toplu içe aktarır (Issue #83).
 *
 * GÖVDE DÜZ CSV METNİDİR (`Content-Type: text/csv`), multipart DEĞİL: tek bir dosya
 * gönderiliyor ve multipart ayrıştırması hiçbir güvenlik ya da kullanım kazancı getirmeden ikinci
 * bir girdi yüzeyi açardı. Arayüz dosyayı tarayıcıda okuyup metni gönderir.
 *
 * YETKİ: `MANAGE_TRANSACTIONS` — tek tek işlem kaydetmekle aynı izin. Toplu yazma yeni bir
 * yetenek değil, aynı yeteneğin hızlı yoludur; MEMBER'ın kaydedemediği işlemi dosyayla da
 * kaydedememesi gerekir.
 *
 * SIRA (CLAUDE.md §5): ucuz şekil kontrolü → rate limit → authz → gövde → servis. Boyut sınırı
 * iki kez uygulanır: `Content-Length` gövdeyi OKUMADAN reddeder; ama başlık yalan
 * söyleyebilir (ya da hiç olmayabilir), bu yüzden okunan metin de ölçülür.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { tenantId } = await params;
  if (!isValidId(tenantId)) {
    return NextResponse.json({ error: "Invalid tenant id" }, { status: 400 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("text/csv")) {
    return NextResponse.json({ error: "Content-Type must be text/csv" }, { status: 415 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMPORT_BYTES) {
    return NextResponse.json({ error: "File too large" }, { status: 413 });
  }

  const rateLimitResponse = await checkRateLimit(
    request,
    RATE_LIMIT_BUCKETS.TRANSACTION_IMPORT,
    RATE_LIMIT_POLICIES.TRANSACTION_IMPORT,
  );
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const { context, response } = await requirePermission(
    PERMISSIONS.MANAGE_TRANSACTIONS,
    tenantId,
  );
  if (!context) {
    return response;
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (Buffer.byteLength(text, "utf8") > MAX_IMPORT_BYTES) {
    return NextResponse.json({ error: "File too large" }, { status: 413 });
  }

  // Scope ve aktör `context`'ten — URL/gövde DEĞİL (invariant #2). Dosyadaki bir `tenant_id`
  // sütunu bilinmeyen sütun hatası alır; hiçbir satır tenant'ını kendisi seçemez.
  const result = await importTransactionsCsv(context.tenant.id, context.user.id, text);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, errors: result.errors },
      { status: result.status },
    );
  }

  return NextResponse.json({ imported: result.imported, errors: result.errors });
}
