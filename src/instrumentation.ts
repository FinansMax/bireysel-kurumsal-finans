/**
 * Next.js instrumentation giriş noktası (Issue #183).
 *
 * Next 16, sunucu ve edge Sentry yapılandırmalarını bu dosya üzerinden yükler; kök dizindeki
 * `sentry.server.config.ts`/`sentry.edge.config.ts` doğrudan bundle'a girmez.
 * (bkz. `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md`)
 *
 * `NEXT_RUNTIME` ayrımı zorunludur: edge bundle'ına Node-only bir modül girerse build kırılır.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}
