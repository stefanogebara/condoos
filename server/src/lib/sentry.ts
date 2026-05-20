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

// Ops-event helper. Use for things that are NOT exceptions but want
// to surface in the dashboard for trend analysis — failed dispatches,
// kill-switch flips, lag thresholds tripped, etc. Severity defaults
// to 'warning' which is the right tone for "something needs attention
// but it's not an error". `extras` lands on the event so dashboards
// can group by ticket_id, condo_id, etc. No-op when Sentry is unconfigured
// so local dev + CI runs stay silent.
export function captureMessage(
  message: string,
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug' = 'warning',
  extras?: Record<string, unknown>,
) {
  if (!initialized || !sentry) return;
  sentry.withScope((scope) => {
    if (extras) {
      for (const [k, v] of Object.entries(extras)) scope.setExtra(k, v);
    }
    sentry!.captureMessage(message, level);
  });
}
