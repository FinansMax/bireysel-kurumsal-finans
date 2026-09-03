import * as Sentry from "@sentry/nextjs";

import { buildSentryOptions, getSentryDsn } from "@/lib/observability/sentry-config";

/**
 * Sunucu tarafı Sentry başlatması (Issue #183).
 *
 * DSN YOKSA HİÇ ÇAĞRILMAZ: lokal geliştirme ve testler SDK'nın global hook'larından bile
 * etkilenmez (gerekçe `sentry-config.ts`'te).
 */
const dsn = getSentryDsn();

if (dsn) {
  Sentry.init(buildSentryOptions(dsn));
}
