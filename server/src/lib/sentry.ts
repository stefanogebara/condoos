let initialized = false;
let sentry: typeof import('@sentry/node') | null = null;

function getSentry() {
  if (!sentry) {
    // Load Sentry only when a DSN is configured. In local/E2E runs the DSN is
    // absent, so a top-level observability import should never be able to
    // delay API startup.
    sentry = require('@sentry/node') as typeof import('@sentry/node');
  }
  return sentry;
}

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || initialized) return;
  getSentry().init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
  });
  initialized = true;
}

export function captureException(error: unknown) {
  if (!initialized || !sentry) return;
  sentry.captureException(error);
}
