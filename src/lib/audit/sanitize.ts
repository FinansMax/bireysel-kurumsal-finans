/**
 * Audit metadata'sı için defense-in-depth redaksiyon (Issue #15).
 *
 * Çağıran koda güvenmek yerine (o da hassas bir alanı yanlışlıkla metadata'ya koyabilir),
 * `writeAuditLog()` bu sanitize fonksiyonunu DB insert'inden ÖNCE her zaman uygular — nested
 * object/array içindeki hassas key'ler de dahil. Generic bir "PII framework'ü" DEĞİLDİR;
 * sadece key ismine bakan basit, tahmin edilebilir bir redaksiyon kuralıdır.
 */
const REDACTED = "[REDACTED]";

// Anahtar ismi normalize edildikten (lowercase + alfanumerik dışını at) SONRA bu alt
// dizgilerden herhangi birini İÇERİYORSA değer redakte edilir. Örn. "resetToken",
// "invitationToken", "sessionToken", "api_key", "Authorization" hepsi eşleşir.
const SENSITIVE_KEY_SUBSTRINGS = [
  "password",
  "token",
  "secret",
  "authorization",
  "cookie",
  "apikey",
  "credential",
  "oauth",
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SENSITIVE_KEY_SUBSTRINGS.some((substring) => normalized.includes(substring));
}

// Makul olmayan derinlikte/döngüsel metadata'ya karşı ucuz bir güvenlik supabı — audit
// metadata'sı her zaman çağıran kodun elle kurduğu küçük, düz nesnelerdir, bu yüzden pratikte
// hiç tetiklenmez.
const MAX_DEPTH = 8;

export function sanitizeMetadata(value: unknown, depth = 0): unknown {
  if (depth >= MAX_DEPTH) {
    return REDACTED;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMetadata(item, depth + 1));
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      result[key] = isSensitiveKey(key) ? REDACTED : sanitizeMetadata(nested, depth + 1);
    }
    return result;
  }

  return value;
}
