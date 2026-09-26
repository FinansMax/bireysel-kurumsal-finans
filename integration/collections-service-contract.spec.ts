import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import type { CollectionServiceResult } from "../src/lib/collections/payment-plan";

/**
 * Tahsilat servis sözleşmesinin korunması (Issue #205).
 *
 * `docs/architecture.md` → "Servis katmanı sözleşmesi": beklenen hataları result union'ı,
 * beklenmeyenleri framework taşır. Union'a `500` koymak bu ayrımı bozar: bir `catch` bloğu
 * beklenmeyen bir hatayı `{ ok: false, status: 500 }`e çevirir, çağıran taraf onu olağan bir
 * sonuç sayar ve hata hiçbir yere yükselmeden — stack'i, Sentry kaydı ve nedeni olmadan —
 * yutulur.
 *
 * NEDEN AYRI DOSYA: bu kontrol bir tenant-scope ya da iş kuralı testi değil, tip seviyesinde bir
 * sözleşme korumasıdır; #205'in diğer gruplarıyla aynı dosyaya yazmak, birbirinden bağımsız
 * PR'ları gereksiz yere çakıştırırdı.
 */

type FailureStatus = Extract<CollectionServiceResult<unknown>, { ok: false }>["status"];

/**
 * DERLEME ZAMANI KORUMASI — asıl savunma budur.
 *
 * `@ts-expect-error`, altındaki satır hata VERMEZSE kendisi hata verir. Yani biri union'a `500`
 * geri eklerse atama geçerli hale gelir, beklenen hata kaybolur ve `npm run typecheck` kırılır.
 * Aşağıdaki metin taraması yalnızca ikinci hattır: tipi doğru bırakıp gövdede `status: 500`
 * dönmeyi yakalar.
 */
// @ts-expect-error — `500` bu union'da OLMAMALIDIR; eklenirse bu satır derlenir ve test kırılır.
const FORBIDDEN_INTERNAL_STATUS: FailureStatus = 500;

/**
 * Kaynak metni — YORUMLAR ÇIKARILMIŞ hâlde.
 *
 * Şart: union'ın üzerindeki açıklama, `500`'ün neden yasak olduğunu anlatırken `status: 500`
 * ifadesini örnek olarak geçiriyor. Yorumları saymak, kuralın gerekçesini yazmayı testi kırmak
 * hâline getirirdi — bu repo'da yorum yazmak teşvik edilir, cezalandırılmaz.
 */
const SERVICE_SOURCE = readFileSync(
  path.join(__dirname, "..", "src", "lib", "collections", "payment-plan.ts"),
  "utf-8",
)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

test.describe("CollectionServiceResult — beklenmeyen hata union'da yok", () => {
  test("`500` union'a atanamıyor (derleme zamanı iddiası gerçekten çalıştı)", () => {
    // Bu beklenti, yukarıdaki `@ts-expect-error` satırının silinmediğini de garanti eder:
    // sabit kaldırılsaydı dosya derlenmez, test hiç koşmazdı.
    expect(FORBIDDEN_INTERNAL_STATUS).toBe(500);
  });

  test("servis gövdesinde `status: 500` dönülmüyor", () => {
    expect(SERVICE_SOURCE).not.toMatch(/status:\s*500/);
  });

  test("KONTROL GRUBU: `503` hâlâ ulaşılabilir bir sonuç", () => {
    // "500 yok" tek başına yetmez: union tamamen boşaltılsaydı da geçerdi. `503`, retry'lar
    // tükendiğinde dönülen TANIMLI bir sonuçtur (`runSerializable()` sözleşmesi) ve kalmalıdır.
    const reachable: FailureStatus[] = [400, 403, 404, 409, 503];
    expect(reachable).toHaveLength(5);

    expect(SERVICE_SOURCE).toMatch(/status:\s*503/);
  });
});
