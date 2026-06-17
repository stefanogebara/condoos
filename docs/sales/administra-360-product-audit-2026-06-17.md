# CONDOS product audit for Administra 360

Audit date: 2026-06-17

Purpose: verify the web app before updating the Administra 360 presentation, especially AI, vendor/contact workflows, reservations, guard flow, finance transparency, and language quality.

## Verification results

- `npm test` - passed, 133/133 server tests.
- `npm run build` - passed, client and server production build completed.
- `npm run agent:eval` - passed, 20/20 AI agent evaluation cases.
- Targeted local E2E audit - passed, 34 passed and 1 skipped.
  - Covered BoardAgent kill switch, ticket dispatch queue, AI proposal/meeting/assembly flows, amenities CRUD, reservation capacity blocking, admin current reservations, concierge permissions, guard notifications, dashboard actions, document upload/download, payment-proof review, board packet export, and EN/ES i18n leak sweeps.
- `npm run test:e2e:pilot` - passed, 90/90.
  - Covered onboarding, admin dashboard and service network, AI agent, residents, amenities, reservations, guard/concierge, visitors, parties, recurring visitors, finance transparency, proposals, and UI walkthroughs.
- `npm run test:e2e:prod:smoke` - passed, 17 passed and 9 skipped.
  - Production public/login/signup language and routing smoke checks passed.
- `npm run test:e2e:prod:safe:desktop` - passed, 21 passed and 68 skipped.
  - Production-safe checks passed. Mutating authenticated flows are intentionally skipped against live production.
- `npm run audit:prod:hardening:warn` - passed.
  - API health and DB ok.
  - Email verification required before create-building.
  - Private setup code required before create-building.
  - Client CSP supports Turnstile.
- `npm run audit:ops:backup-restore` - passed.
  - Local backup/restore dry run produced a readable restored SQLite snapshot.

## Issue fixed during audit

The i18n audit found one leak from AI-generated assembly agenda fallback text: `Prestação de contas` appeared in non-PT flows. Fixed by adding translations and dynamic translation patterns for assembly agenda fallback text in EN/ES/FR/PT and aligning server fallback descriptions.

## Product capabilities verified

### AI and vendor operations

- Admin AI agent can generate operational plans from building context.
- Agent output shows server-derived evidence cards, not only model prose.
- Agent runs are persisted with status, model/fallback state, timing, plan JSON, trace/errors, and usage data.
- Agent safety checks reject out-of-scope input and unclear requests instead of inventing vendors or actions.
- Agent can search saved service contacts and past operational history.
- Agent can prepare vendor outreach in the correct language.
- Auto-dispatch is gated. Model confidence alone is not enough.
- Dispatch requires evidence and compatible saved service contact or a specific urgent-safety path.
- WhatsApp/email delivery depends on configured provider credentials; without them, outbox rows queue or fallback copy remains visible.

Presentation-safe wording: CONDOS can let AI recommend, draft, and, when integrations plus safety gates are configured, dispatch vendor outreach to the saved electrician, plumber, elevator tech, security provider, or other service contact. It should not be described as uncontrolled autonomous vendor messaging.

### Reservations and amenities

- Admin can create, edit, deactivate, and view bookable amenities.
- Admin controls availability windows, slot length, capacity, and approval requirements.
- Residents can reserve from available slots.
- Reservation capacity and same-slot conflicts are enforced server-side.
- Residents can cancel reservations.
- Admin sees current reservations.
- Party/guest-list reservations are supported for amenities such as event rooms.
- Booking window policy is implemented: weekly slots open on Sunday at midday for the upcoming week.

### Guard and visitor operations

- Guard/concierge has a separate role and dashboard.
- Guard sees expected visitors, party guests, packages/deliveries, and resident contact information.
- Guard can notify resident about an arriving visitor.
- Resident approval updates the flow; guard can record arrival after approval.
- Guard can create an unlisted walk-up visitor for resident approval.
- Guard cannot approve visitors by themselves.
- Party guest lists and recurring visitor permission appear in concierge flow.

### Finance and transparency

- Residents can view spending transparency.
- Admin can create dues, generate receivables, and record payments.
- Payment proof upload/review flow is implemented.
- Admin can reject payment proofs through a review modal.
- Budget summary, expense categories, receipts, and resident statements are available.
- Board packet export works.

### Documents and evidence

- Document vault supports link-based and uploaded documents.
- Uploaded documents can be downloaded by permitted users.
- Board-only documents stay hidden from residents.
- File metadata and visibility controls are enforced.

### Private enterprise readiness

- Production requires verified email and private setup code before public building creation.
- Production safe audit confirms basic public/login routing and language.
- Full destructive flows are tested locally and intentionally skipped in production-safe audit.

## Caveats to keep honest in the deck

- Live AI quality requires `OPENROUTER_API_KEY` or configured AI provider in the environment. Tests also verify fallback mode.
- Live WhatsApp/vendor messaging requires provider credentials. Without them, the app queues/skips delivery and keeps the plan actionable.
- Production-safe audit does not create or modify live resident/admin data. Those flows are verified locally in the pilot suite.
- Current PDF should sell a private pilot and operational workflows, not claim fully autonomous unbounded AI.

## Recommended presentation angle

CONDOS is strongest when shown as a connected operating loop:

1. Resident, guard, or admin creates a real operational signal.
2. CONDOS links that signal to building context, history, service contacts, documents, expenses, and proposals.
3. AI reads that building memory and prepares the next action.
4. Admin confirms or the configured safety gate dispatches to the right saved vendor.
5. Work progress, cost, evidence, and decisions become visible to the right people.
6. Board and management get a report without reconstructing everything from WhatsApp.

