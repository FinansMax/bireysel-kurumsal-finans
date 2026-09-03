import { prisma } from "../../src/lib/prisma";

/**
 * Test KURULUMU için bir hesabı doğrulanmış işaretler (Issue #190).
 *
 * NEDEN GEREKLİ: #190 ile doğrulanmamış hesaplar çalışma alanı oluşturamıyor ve davet kabul
 * edemiyor. E2E suite'inin neredeyse tamamı "kaydol → çalışma alanı kur → ekranı test et"
 * akışıyla başlıyor; bu testlerin KONUSU doğrulama DEĞİL, doğrulama onların ÖN KOŞULU.
 *
 * BU BİR GÜVENLİK BYPASS'I DEĞİLDİR ve `docs/testing.md` #3'ün ("güvenlik mekanizmaları
 * mock'lanmaz") istisnası da değildir: doğrulama akışının KENDİSİ gerçek HTTP üzerinden
 * `security/email-verification-security.spec.ts` ve `integration/email-verification.spec.ts`
 * içinde uçtan uca test edilir — gating'in çalıştığı (403) ve doğrulamadan SONRA çalışma alanı
 * kurulabildiği orada kanıtlanır. Burada yapılan şey, ilgisiz bir testin ön koşulunu
 * hazırlamaktır; tıpkı testin doğrudan `prisma.tenant.create()` ile veri hazırlaması gibi.
 *
 * Alternatif — her testte outbox'tan token okuyup `/api/auth/verify-email` çağırmak —
 * reddedildi: 26 çağrı yerine ekstra iki HTTP round-trip ekler, suite süresini uzatır ve
 * testin asıl konusunu gölgeler.
 */
export async function markEmailVerified(email: string): Promise<void> {
  await prisma.user.updateMany({
    where: { email: email.toLowerCase() },
    data: { emailVerified: new Date() },
  });
}
