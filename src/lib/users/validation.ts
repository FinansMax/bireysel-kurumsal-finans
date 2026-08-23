// Temel, bağımlılıksız input validasyonu (bkz. src/lib/auth/validation.ts ve
// src/lib/tenants/validation.ts deseni — aynı yaklaşım, ayrı domain).

export const MIN_NAME_LENGTH = 2;
export const MAX_NAME_LENGTH = 100;

/**
 * Kullanıcı profil adı için kabul kuralı. Uzunluk kontrolü TRIM'LENMİŞ değer üzerinden
 * yapılmalıdır (bkz. `normalizeName()`); aksi halde "   " gibi yalnızca boşluktan oluşan bir
 * girdi uzunluk kontrolünü geçerdi.
 *
 * Karakter kümesi kısıtlanmaz: isimler uluslararasıdır (aksan, kesme işareti, boşluk, farklı
 * alfabeler) ve bir regex ile "geçerli isim" tanımlamaya çalışmak meşru kullanıcıları dışlar.
 * Bu değer HTML olarak değil JSON olarak döndürülür; XSS koruması render katmanının
 * sorumluluğudur (React varsayılan olarak escape eder).
 */
export function isValidName(name: string): boolean {
  return name.length >= MIN_NAME_LENGTH && name.length <= MAX_NAME_LENGTH;
}

/** Baştaki/sondaki boşlukları temizler — saklanan değer her zaman normalize edilmiş olmalıdır. */
export function normalizeName(name: string): string {
  return name.trim();
}
