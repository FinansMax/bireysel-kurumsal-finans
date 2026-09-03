import * as Sentry from "@sentry/nextjs";

import { buildSentryOptions, getSentryDsn } from "@/lib/observability/sentry-config";

/**
 * Tarayıcı tarafı Sentry başlatması (Issue #183).
 *
 * Next 16'da istemci instrumentation'ı bu dosyadan yüklenir (bkz.
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation-client.md`).
 *
 * DSN, `NEXT_PUBLIC_SENTRY_DSN`'den DEĞİL `SENTRY_DSN`'den okunur ve bu bilinçlidir: build
 * sırasında değer bundle'a gömülür. Sentry DSN'i teknik olarak public'tir (tarayıcıdan olay
 * göndermek için gerekir), ama `NEXT_PUBLIC_` öneki kullanmak, ileride oraya gerçekten gizli
 * bir değer konmasını normalleştirirdi — invariant #5 bu öneki secret'lardan uzak tutmayı
 * şart koşuyor.
 */
const dsn = getSentryDsn();

if (dsn) {
  Sentry.init(buildSentryOptions(dsn));
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
