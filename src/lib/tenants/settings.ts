import { Prisma } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "@/lib/audit/actions";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { isValidCurrency, normalizeCurrency } from "@/lib/finance/validation";
import { prisma } from "@/lib/prisma";

import { isValidName, MAX_NAME_LENGTH, MIN_NAME_LENGTH } from "./validation";

/**
 * Tenant'ın temel ayarları: ad ve varsayılan para birimi (Issue #86).
 *
 * YETKİ OWNER-ONLY (`UPDATE_TENANT_SETTINGS`): matris bu kararı `MANAGE_MODULES` ve
 * `EXPORT_TENANT_DATA` ile aynı sınıfa koyar — bkz. `src/lib/authz/permissions.ts`. Issue
 * #86'nın gövdesi "#43 ile aynı desen (OWNER/ADMIN)" diyor ama bu, matrisin daha sonra
 * verdiği bilinçli kararla ÇELİŞİYOR; matris bu kod tabanında yetkili kaynaktır (CLAUDE.md
 * §4.3) ve burada o esas alınır (aynı durum #244'te de yaşandı).
 *
 * MUTASYON `updateMany` + `count === 1` İLE YAPILIR: `Tenant` başka bir tenant'a ait
 * DEĞİLDİR (kendisi tenant'tır), yani `tenantScoped()` burada uygulanacak ayrı bir kapsam
 * yoktur; yine de bare `update({ where: { id } })` yerine bu deseni kullanmak, kod tabanının
 * geri kalanıyla (bkz. `src/lib/export/tenant-export-service.ts`, Issue #259) aynı atomik
 * yazım disiplinini sürdürür ve `id`nin gerçekten var olduğunu tek sorguda doğrular.
 */

export type UpdateTenantSettingsInput = {
  name?: unknown;
  defaultCurrency?: unknown;
};

export type TenantSettingsView = {
  id: string;
  name: string;
  defaultCurrency: string;
};

export type UpdateTenantSettingsResult =
  | { ok: true; tenant: TenantSettingsView }
  | { ok: false; status: 400 | 404; error: string };

const INVALID_NAME_ERROR = `Name must be between ${MIN_NAME_LENGTH} and ${MAX_NAME_LENGTH} characters`;
const INVALID_CURRENCY_ERROR = "Currency must be a 3-letter ISO 4217 code";
const NO_FIELDS_ERROR = "No updatable fields provided";
const NOT_FOUND_ERROR = "Tenant not found";

export async function updateTenantSettings(
  tenantId: string,
  actorUserId: string,
  input: UpdateTenantSettingsInput,
): Promise<UpdateTenantSettingsResult> {
  const data: Prisma.TenantUpdateManyMutationInput = {};

  if (input.name !== undefined) {
    if (typeof input.name !== "string") {
      return { ok: false, status: 400, error: INVALID_NAME_ERROR };
    }
    const name = input.name.trim();
    if (!isValidName(name)) {
      return { ok: false, status: 400, error: INVALID_NAME_ERROR };
    }
    data.name = name;
  }

  if (input.defaultCurrency !== undefined) {
    if (typeof input.defaultCurrency !== "string") {
      return { ok: false, status: 400, error: INVALID_CURRENCY_ERROR };
    }
    const defaultCurrency = normalizeCurrency(input.defaultCurrency);
    if (!isValidCurrency(defaultCurrency)) {
      return { ok: false, status: 400, error: INVALID_CURRENCY_ERROR };
    }
    data.defaultCurrency = defaultCurrency;
  }

  if (Object.keys(data).length === 0) {
    return { ok: false, status: 400, error: NO_FIELDS_ERROR };
  }

  // `update({ where: { id } })` DEĞİL: `id` var olmasa bile Prisma bir hata fırlatır, ama
  // "önce bul sonra yaz" iki ayrı sorgu demektir. `updateMany` + `count` tek sorguda hem
  // yazar hem de satırın var olduğunu doğrular.
  const { count } = await prisma.tenant.updateMany({
    where: { id: tenantId },
    data,
  });

  if (count !== 1) {
    return { ok: false, status: 404, error: NOT_FOUND_ERROR };
  }

  const tenant = await prisma.tenant.findFirstOrThrow({
    where: { id: tenantId },
    select: { id: true, name: true, defaultCurrency: true },
  });

  await writeAuditLog({
    actorUserId,
    tenantId,
    action: AUDIT_ACTIONS.TENANT_SETTINGS_UPDATED,
    targetType: AUDIT_TARGET_TYPES.TENANT,
    targetId: tenant.id,
    // Hangi ALANLARIN değiştiği kaydedilir, yeni değerlerin tamamı değil — `ACCOUNT_UPDATED`
    // ile aynı gerekçe: audit "kim neyi ne zaman değiştirdi" sorusunu yanıtlar, ikinci bir
    // veri kopyası tutmaz.
    metadata: { updatedFields: Object.keys(data) },
  });

  return { ok: true, tenant };
}
