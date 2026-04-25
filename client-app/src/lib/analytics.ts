// PostHog wrapper. Lazy-loaded so it doesn't bloat the initial bundle —
// posthog-js (~175KB) only ships when VITE_POSTHOG_KEY is set, and only
// after the first paint. No-ops when the key is missing.

const KEY  = import.meta.env.VITE_POSTHOG_KEY  as string | undefined;
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://us.i.posthog.com';

type PostHog = typeof import('posthog-js').default;
let phPromise: Promise<PostHog> | null = null;

function ph(): Promise<PostHog> | null {
  if (!KEY) return null;
  if (phPromise) return phPromise;
  phPromise = import('posthog-js').then((m) => {
    m.default.init(KEY!, {
      api_host: HOST,
      person_profiles: 'identified_only',
      capture_pageview: false,
      capture_pageleave: true,
      autocapture: false,
    });
    // Tag every event so CondoOS data is filterable in shared PostHog projects.
    m.default.register({ app_name: 'condoos' });
    return m.default;
  });
  return phPromise;
}

/** Initialize once on app boot. Safe to call repeatedly. No-op without a key. */
export function initAnalytics() {
  // Defer to next tick so we never block first paint on the import.
  if (KEY) setTimeout(() => { ph(); }, 0);
}

/**
 * Identify a user after auth. We use `user_<id>` as the distinct_id so we
 * never send raw email as the join key; the email is sent as a property.
 */
export function identify(user: { id: number | string; email?: string; role?: string; condominium_id?: number | null }) {
  ph()?.then((p) => p.identify(`user_${user.id}`, {
    email: user.email,
    role: user.role,
    condominium_id: user.condominium_id ?? null,
  }));
}

export function reset() {
  ph()?.then((p) => p.reset());
}

/** Funnel events — keep names stable, they become PostHog dashboard primary keys. */
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

export function track(event: AnalyticsEvent, properties?: Record<string, unknown>) {
  ph()?.then((p) => p.capture(event, properties));
}
