import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/authz/authorize";
import type { Permission } from "@/lib/authz/permissions";
import type { ActiveTenantContext } from "@/lib/tenants/tenant-context";

import type { ModuleKey } from "./catalog";
import { isModuleEnabled } from "./tenant-module";

/**
 * Modül guard'ları (Issue #152).
 *
 * `src/lib/authz/authorize.ts` ile AYNI konumdadır: `src/lib/**` içinden HTTP/rotalama bilen
 * bilinçli istisna katman (bkz. `docs/architecture.md` → "Bağımlılık yönü").
 *
 * ---
 *
 * SIRA KRİTİKTİR: önce `requirePermission()` (kimlik → aktif tenant → CANLI membership → rol →
 * izin), SONRA `isModuleEnabled()`. Ters sıra, kimliği doğrulanmamış bir isteğin bir tenant'ın
 * hangi modülleri açtığını YOKLAMASINA izin verirdi — yanıt kodu, kimlik kontrolünden önce
 * modül durumuna göre değişirdi.
 *
 * KAPALI MODÜL → 404, 403 DEĞİL. Kapalı bir modül o tenant için VAR OLMAYAN bir yüzeydir;
 * `docs/architecture.md`'nin status sözlüğünde 404 zaten "yok ya da senin değil" anlamındadır.
 * 403 dönmek, "bu özellik var ama sen açmamışsın" bilgisini sızdırırdı — aynı gerekçeyle
 * cross-tenant kayıtlar da 404 alır (enumeration engeli, invariant #7).
 *
 * MODÜL DURUMU HER İSTEKTE DB'DEN OKUNUR. Aktif tenant cookie'sinin yalnızca bir İPUCU olması
 * ve membership'in her istekte doğrulanmasıyla aynı duruş: kapatılan bir modül, kullanıcının
 * elindeki bir sonraki istekte kapalıdır. Cache eklenirse ayrı bir issue ve ayrı bir karar
 * (#152 "Scope Dışı").
 */

type RequireModuleResult =
  | { context: ActiveTenantContext; response: null }
  | { context: null; response: NextResponse };

/** Kapalı modülün yanıtı, var olmayan bir kaynağınkiyle AYNIDIR. */
const NOT_FOUND_RESPONSE = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/**
 * Route handler'lar için: kimlik + yetki + MODÜL kontrolü.
 *
 * Kullanım (mevcut `requirePermission()` ile birebir aynı şekil):
 *   const { context, response } = await requireModule(MODULES.CRM, PERMISSIONS.VIEW_CRM, tenantId);
 *   if (!context) return response;
 */
export async function requireModule(
  moduleKey: ModuleKey,
  permission: Permission,
  expectedTenantId: string,
): Promise<RequireModuleResult> {
  const { context, response } = await requirePermission(permission, expectedTenantId);
  if (!context) {
    return { context: null, response };
  }

  // Scope'un kaynağı `context.tenant.id` — URL parametresi DEĞİL (Issue #13).
  if (!(await isModuleEnabled(context.tenant.id, moduleKey))) {
    return { context: null, response: NOT_FOUND_RESPONSE() };
  }

  return { context, response: null };
}

/**
 * Sunucu bileşenleri (sayfa) için: `requireModule()`in sayfa karşılığı.
 *
 * `page-guard.ts`'teki `requirePageUser()` deseninin aynısı — orada sonuç bir 401 yanıt, burada
 * yönlendirmedir. Kapalı modülün sayfası `/dashboard`'a yönlenir: kullanıcıya boş ya da hatalı
 * bir ekran göstermek yerine, var olduğunu bildiği bir yere geri konur.
 *
 * YÖNLENDİRME BİR YETKİLENDİRME DEĞİLDİR: sayfanın çektiği her veri, kendi API/servis
 * katmanında ayrıca korunur (invariant #3). Buradaki karar bir UX kararıdır.
 *
 * Fonksiyon kapalı modülde DÖNMEZ (`redirect()` fırlatır).
 */
export async function requirePageModule(
  tenantId: string,
  moduleKey: ModuleKey,
): Promise<void> {
  if (!(await isModuleEnabled(tenantId, moduleKey))) {
    redirect("/dashboard");
  }
}
