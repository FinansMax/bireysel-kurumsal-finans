import type { MembershipRole } from "@prisma/client";

import { hasPermission } from "@/lib/authz/permissions";

import { MODULE_CATALOG, type ModuleDefinition, type ModuleKey } from "./catalog";

/**
 * Modül menüsünün kurulumu (Issue #152).
 *
 * SAF FONKSİYON: DB'ye gitmez, oturum okumaz, `next/headers` kullanmaz. Girdisi "hangi modüller
 * açık" + "kullanıcının rolü"; çıktısı menüye eklenecek linkler. Bu ayrım sayesinde kural
 * gerçek bir tarayıcı ya da veritabanı olmadan test edilebilir — `permissions.ts` ile aynı
 * sözleşme.
 *
 * ⚠️ MENÜDE LİNKİ GİZLEMEK YETKİLENDİRME DEĞİLDİR (invariant #3). Buradaki filtreleme bir UX
 * kararıdır: kullanıcıya kesin 404/403 alacağı bir yol gösterilmez. Gerçek koruma
 * `requireModule()` (API) ve `requirePageModule()` (sayfa) guard'larındadır ve ikisi de
 * ayrıca test edilir.
 */

export type ModuleNavLink = {
  href: string;
  label: string;
};

/**
 * Açık modüllerin, kullanıcının görebileceği menü linkleri.
 *
 * `definitions` ENJEKTE EDİLEBİLİR ve varsayılanı gerçek katalogdur: katalog bugün (#151)
 * bilerek boş `nav` listeleriyle geliyor — modül ekranları kendi issue'larında doğacak. Kuralı
 * o güne kadar test edilemez bırakmamak için testler kendi sentetik kataloglarını verir.
 *
 * İKİ FİLTRE VARDIR ve ikisi de gereklidir:
 * 1. Modül KAPALIYSA hiçbir linki görünmez (tenant o yüzeyi hiç satın almamıştır).
 * 2. Modül açık olsa bile, linkin istediği izne sahip olmayan role gösterilmez (ör. yalnızca
 *    yöneticinin gireceği bir ekran).
 */
export function buildModuleNavLinks(
  enabledModuleKeys: Iterable<ModuleKey>,
  role: MembershipRole,
  definitions: Readonly<Record<ModuleKey, ModuleDefinition>> = MODULE_CATALOG,
): ModuleNavLink[] {
  const enabled = new Set(enabledModuleKeys);
  const links: ModuleNavLink[] = [];

  // Sıra KATALOĞUN sırasıdır: menüdeki yerleşim bir ürün kararıdır ve hangi modülün önce
  // açıldığına bağlı olmamalıdır.
  for (const definition of Object.values(definitions)) {
    if (!enabled.has(definition.key)) {
      continue;
    }
    for (const item of definition.nav) {
      if (!hasPermission(role, item.permission)) {
        continue;
      }
      links.push({ href: item.href, label: item.label });
    }
  }

  return links;
}
