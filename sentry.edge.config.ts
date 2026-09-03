import * as Sentry from "@sentry/nextjs";

import { buildSentryOptions, getSentryDsn } from "@/lib/observability/sentry-config";

/**
 * Edge runtime Sentry başlatması (Issue #183).
 *
 * `src/proxy.ts` edge'de çalışır (bkz. README "Gözlemlenebilirlik"), bu yüzden ayrı bir
 * başlatma gerekir. Ayarlar sunucuyla AYNI kaynaktan gelir — üç dosyada üç farklı
 * yapılandırma, birinde `beforeSend`'i unutmak demekti.
 */
const dsn = getSentryDsn();

if (dsn) {
  Sentry.init(buildSentryOptions(dsn));
}
