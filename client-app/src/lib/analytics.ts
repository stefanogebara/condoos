// Lightweight PostHog event tracker — direct POST to /i/v0/e/.
// No session recording, no surveys, no autocapture. Just funnel events.
// Avoids posthog-js SDK quirks where captures silently no-op despite
// _loaded + opted_out=false. ~1KB instead of 175KB.
//
// No-ops cleanly when VITE_POSTHOG_KEY is missing.

const KEY  = import.meta.env.VITE_POSTHOG_KEY  as string | undefined;
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://us.i.posthog.com';

const STORAGE_KEY = 'condoos_ph_distinct_id';
let distinctId: string | null = null;
let identifiedId: string | null = null;
let userProps: Record<string, unknown> | null = null;

function uuid(): string {
  // RFC4122 v4-ish — good enough for distinct_id generation.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'anon-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getDistinctId(): string {
  if (identifiedId) return identifiedId;
  if (distinctId) return distinctId;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) { distinctId = stored; return stored; }
  } catch { /* localStorage may be disabled */ }
  const fresh = uuid();
  distinctId = fresh;
  try { localStorage.setItem(STORAGE_KEY, fresh); } catch { /* ignore */ }
  return fresh;
}

export function initAnalytics() {
  if (!KEY) return;
  // Eagerly read/generate the distinct_id so we have a stable id before the
  // first track() call.
  getDistinctId();
}

export function identify(user: { id: number | string; email?: string; role?: string; condominium_id?: number | null }) {
  if (!KEY) return;
  identifiedId = `user_${user.id}`;
  userProps = {
    email: user.email,
    role: user.role,
    condominium_id: user.condominium_id ?? null,
  };
  // Send a $identify event so PostHog associates the anonymous distinct_id
  // with the new user_<id> identity.
  send('$identify', { $set: userProps, $anon_distinct_id: distinctId });
}

export function reset() {
  identifiedId = null;
  userProps = null;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  distinctId = null;
}

export type AnalyticsEvent =
  | 'landing_view'
  | 'cta_clicked'
  | 'signup_started'
  | 'signup_completed'
  | 'onboarding_view'
  | 'onboarding_join_clicked'
  | 'onboarding_create_clicked'
  | 'onboarding_join_succeeded'
  | 'onboarding_create_succeeded'
  | 'proposal_drafted'
  | 'proposal_published'
  | 'vote_cast'
  | 'assembly_created'
  | 'assembly_convoked'
  | 'whatsapp_optin_set';

export function track(event: AnalyticsEvent | string, properties?: Record<string, unknown>) {
  send(event, properties);
}

function send(event: string, properties?: Record<string, unknown>) {
  if (!KEY) return;
  const body = {
    api_key: KEY,
    event,
    distinct_id: getDistinctId(),
    timestamp: new Date().toISOString(),
    properties: {
      // Kept for backward-compat with any legacy filters in the dashboard.
      // The new dedicated CondoOS project means filtering is no longer required.
      app_name: 'condoos',
      ...(userProps || {}),
      ...(properties || {}),
      $current_url: typeof window !== 'undefined' ? window.location.href : undefined,
      $host: typeof window !== 'undefined' ? window.location.host : undefined,
    },
  };

  // Use sendBeacon when leaving the page so the request survives unload.
  // Otherwise use fetch with keepalive (also survives unload, but lets us
  // see the request in DevTools / Playwright network listeners).
  const url = `${HOST}/i/v0/e/`;
  try {
    const blob = JSON.stringify(body);
    if (typeof navigator !== 'undefined' && (document.visibilityState === 'hidden' || (window as any).__phUnloading)) {
      navigator.sendBeacon?.(url, new Blob([blob], { type: 'application/json' }));
      return;
    }
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: blob,
      keepalive: true,
      mode: 'cors',
      credentials: 'omit',
    }).catch(() => { /* swallow — analytics must never break the app */ });
  } catch { /* ignore */ }
}

// Hook page-unload so any final track() in flight uses sendBeacon.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { (window as any).__phUnloading = true; });
}
