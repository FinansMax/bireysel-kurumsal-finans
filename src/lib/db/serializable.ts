import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * Serializable transaction + otomatik yeniden deneme (Issue #122).
 *
 * NEDEN GEREKLİ: `Serializable` izolasyon, okumaya bağlı invariant'ları (ör. "son OWNER
 * silinemez") eşzamanlı isteklere karşı koruyan doğru araçtır — ama sözleşmesi "hiç hata
 * almazsın" DEĞİLDİR. PostgreSQL, iki transaction birbirini geçersiz kılacak şekilde
 * çakıştığında birini **serialization failure** ile reddeder (Prisma `P2034`) ve çağıranın
 * transaction'ı YENİDEN DENEMESİNİ bekler. Bu hata beklenen ve GEÇİCİdir.
 *
 * Retry katmanı olmadan bu hata handler'a kadar çıkıp 500'e dönüşüyordu: meşru bir kullanıcı,
 * yalnızca aynı anda başka birinin de rol değiştirmesi yüzünden sunucu hatası alıyordu
 * (bkz. Issue #122). Bu, `CLAUDE.md` §Eşzamanlılık'ın kendi kuralıyla da çelişiyordu:
 * "okumaya bağlı invariant'lar için Serializable transaction **+ retry**".
 *
 * Bu yardımcı YENİ bir desen getirmez: `createInvitation()` içinde elle yazılmış olan retry
 * döngüsünün aynısıdır — tek farkı, tek bir yerde tanımlanmış ve test edilmiş olmasıdır.
 */

const SERIALIZATION_FAILURE_CODE = "P2034";

/**
 * Varsayılan deneme sayısı.
 *
 * Elle yazılmış önceki implementasyon (`createInvitation`) 3 kullanıyordu; ölçüldü ve
 * YETERSİZ olduğu görüldü: 5 eşzamanlı rol değişikliğinde bazı istekler üç denemeyi de
 * tüketiyordu (bkz. `integration/membership-concurrency.spec.ts`). 5, aşağıdaki backoff ile
 * birlikte aynı senaryoyu rahatça tamamlıyor; daha büyük bir sayı, gerçekten kilitlenmiş bir
 * durumda isteği gereksiz yere uzatırdı.
 */
export const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * Denemeler arası bekleme: `attempt * 10ms` + 0-10ms rastgele sapma.
 *
 * SABİT bekleme YETMEZ: çakışan istemcilerin hepsi aynı süre bekleyip AYNI ANDA tekrar dener
 * ve çakışma birebir tekrarlanır (thundering herd). Küçük bir rastgele sapma, contender'ları
 * birbirinden ayırır. En kötü durumda toplam bekleme ~100ms'dir — kullanıcı için görünmez,
 * ama 500 almaktan iyidir.
 */
function retryDelayMs(attempt: number): number {
  return attempt * 10 + Math.floor(Math.random() * 10);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Denemeler tükendiğinde fırlatılır.
 *
 * Çağıran servisler bunu yakalayıp KENDİ result union'larında `503`e çevirir — `409`a DEĞİL:
 * `409` bu kod tabanında "iş kuralı ihlali" (ör. son OWNER) anlamına gelir ve arayüz ona göre
 * mesaj gösterir. Retry tükenmesi bir iş kuralı ihlali değil, GEÇİCİ bir sunucu durumudur;
 * doğru mesaj "biraz sonra tekrar deneyin"dir.
 */
export class SerializationConflictError extends Error {
  constructor() {
    super("Transaction could not be serialized after multiple attempts");
    this.name = "SerializationConflictError";
  }
}

function isSerializationFailure(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === SERIALIZATION_FAILURE_CODE
  );
}

/**
 * `fn`'i `Serializable` izolasyonlu bir transaction içinde çalıştırır; yalnızca serialization
 * failure (`P2034`) durumunda yeniden dener.
 *
 * KRİTİK — NELER YENİDEN DENENMEZ: domain hataları (NotFound, LastOwner, ForbiddenOwnership
 * gibi transaction içinden fırlatılan sınıflar) ve diğer Prisma hataları (ör. unique constraint
 * `P2002`) OLDUĞU GİBİ yukarı fırlatılır. Aksi halde "kaydı bulamadım" gibi kalıcı bir durum
 * üç kez tekrar denenir ve gerçek hata gizlenirdi.
 *
 * YAN ETKİLER: `fn` yeniden çalıştırılabilir olmalıdır — yani transaction DIŞINDAKİ yan
 * etkiler (audit log yazımı, e-posta gönderimi) buraya KONULMAMALIDIR. Transaction rollback
 * olduğunda DB değişiklikleri geri alınır ama gönderilmiş bir e-posta geri alınamaz. Mevcut
 * çağıranların hepsi bu kurala uyar: audit log yazımı transaction commit ettikten SONRA,
 * dışarıda yapılır.
 */
export async function runSerializable<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isSerializationFailure(error)) {
        throw error;
      }

      if (attempt === maxAttempts) {
        // Ham Prisma hatası yerine typed bir hata: çağıran servisin 500 yerine tanımlı bir
        // sonuç (503) dönebilmesi için, ve Prisma detayının servis katmanına sızmaması için.
        throw new SerializationConflictError();
      }

      await delay(retryDelayMs(attempt));
    }
  }

  // Erişilemez: döngü ya değer döner ya fırlatır. TypeScript'in dönüş tipi analizi için.
  throw new SerializationConflictError();
}
