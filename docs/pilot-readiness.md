# CondoOS Pilot Readiness

Use this checklist before showing CondoOS to a building manager, cofounder, or early pilot. It focuses on the first ten minutes: create the building, invite residents, prove daily operations, and show transparency.

## Local Verification Gate

Run these from the repo root:

```bash
npm test
npm run build
npm run test:e2e:pilot
```

`test:e2e:pilot` runs the critical desktop path across onboarding, board admin, resident, concierge, amenities, visitors, parties, budget transparency, proposal costs, and advanced proposal actions. Use `npm run test:e2e:full` when you need the full desktop and mobile matrix.

## Demo Accounts

| Role | Email | Password | What to prove |
| --- | --- | --- | --- |
| Board admin | `admin@condoos.dev` | `admin123` | setup, residents, proposals, services, amenities, concierge staff, transparency |
| Resident | `resident@condoos.dev` | `resident123` | visitors, parties, packages, reservations, proposals, announcements |
| Concierge | `porteiro@condoos.dev` | `porteiro123` | today's arrivals, visitor decisions, packages, delivery handoff |

## Pilot Walkthrough

1. Start at `/onboarding` and create a building with a mixed apartment layout, no-unit admin support, service contacts, amenities, and the final resident invite/share link.
2. Sign in as the board admin and confirm the sidebar reaches residents, building layout, service network, amenities, proposals, meetings, announcements, finance transparency, and concierge staff.
3. Add or review an amenity with slot times and capacity, then confirm the resident can reserve without exceeding capacity.
4. Sign in as a resident and pre-approve a future visitor, announce a party with a guest list, check packages, submit a suggestion, and vote or comment on a proposal.
5. Sign in as concierge and confirm the interface is intentionally simple: arrivals, visitors, packages, and decisions without board-only controls.
6. Return to the admin proposal view and confirm expensive fixes include cost/budget context before voting.
7. Open the transparency view and confirm expenses have receipt/context fields so residents can understand where money is going.

## Production-Safe Checks

Before using live Vercel/Fly in front of someone, run:

```bash
npm run audit:prod:hardening:warn
npm run test:e2e:prod:smoke
npm run test:e2e:prod:safe:desktop
```

Use `npm run test:e2e:prod:safe` when mobile production coverage is needed too. Do not run the full mutating E2E suite against production unless the database is disposable or a cleanup plan exists.
For a real non-demo production launch, run `npm run audit:prod:hardening`
instead; it must pass with email verification, Turnstile keys, and the client
CSP allowing Turnstile.

## Current Watch Items

- The main app bundle is currently above Vite's default 500 kB warning threshold. This is not blocking, but code-splitting should be a polish task before heavier pilots.
- Demo credentials must stay disabled in real production unless `DEMO_AUTH_ENABLED` is intentionally set for a disposable demo environment.
- Live email, WhatsApp, Google, PostHog, and LLM behavior depends on configured provider secrets. Local tests cover graceful fallbacks, but a real pilot should verify the exact deployment environment.
