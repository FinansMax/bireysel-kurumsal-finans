import { NextResponse } from "next/server";

import { checkReadiness } from "@/lib/health/readiness";

/**
 * Derin sağlık kontrolü — Issue #184.
 *
 * `/api/health` (sığ) "süreç ayakta mı" sorusunu yanıtlar ve load balancer onu kullanır.
 * Bu endpoint "istek karşılayabilir mi" sorusunu yanıtlar: DB erişimi + migration durumu.
 *
 * KİMLİK DOĞRULAMASI YOK: izleme sistemleri (uptime robot, k8s probe, load balancer) kimlik
 * taşıyamaz. Bunun bedeli, yanıtın BİLİNÇLİ OLARAK FAKİR olmasıdır — hangi kontrolün
 * düştüğünden fazlası yazılmaz: bağlantı dizesi, host, sürüm, SQL, stack trace yok
 * (invariant #7). Ayrıntı sunucu logunda.
 *
 * RATE LIMIT YOK ve bu gerekçelidir (invariant #9 gerekçe yazılmasını ister): endpoint state
 * DEĞİŞTİRMEZ ve ucuzdur (tek `SELECT 1` + küçük bir tablo okuması), yani #9'un hedeflediği
 * "public VEYA pahalı state değiştiren" sınıfına girmez. Dahası limit koymak zararlı olurdu:
 * sağlık kontrolü 429 alan bir load balancer, sağlıklı bir instance'ı ölü sayardı. Kötüye
 * kullanım riski deployment tarafında (probe'u iç ağa kısıtlayarak) ele alınır.
 *
 * GET YAN ETKİSİZDİR (invariant #4): yalnızca okuma yapılır.
 */
export async function GET() {
  const result = await checkReadiness();

  // 503: "şu an istek karşılayamıyorum, trafiği başka yere gönder". 500 DEĞİL — 500,
  // endpoint'in kendisinin bozuk olduğunu ima ederdi ve izleme sistemi bu ikisini ayırt
  // edemezdi.
  return NextResponse.json(result, { status: result.status === "ok" ? 200 : 503 });
}
