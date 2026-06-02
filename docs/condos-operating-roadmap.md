# CONDOS Operating Roadmap

This is the current source of truth for building CONDOS into a real condo-board operating system. The north star is simple: reduce front-desk confusion, resident WhatsApps, unresolved maintenance, unclear money, and board conflict.

## Buyer Promise

Every shipped feature must improve at least one promise:

- Front desk knows who can enter.
- Residents know what needs action.
- Admin knows what needs attention.
- Board can explain money and decisions.

## Market Defaults

- First buyer: condo management agencies and selected private buildings reached through direct sales.
- First markets: Brazil and Ecuador.
- First revenue wedge: operations trust.
- Signup model: private B2B activation for new buildings; residents and guards join through building/admin invites.
- Payments and AI become stronger once daily workflows are reliable.

## Execution Order

1. **Daily utility and command centers**
   - Role-scoped action feed for residents, admins, and guards.
   - Resident quick actions for visitors, packages, dues, reservations, votes, and tickets.
   - Admin command center for approvals, urgent tickets, overdue dues, proposal budget gaps, reservation conflicts, and meetings.
   - Guard command center for expected visitors, pending approvals, packages, parties, and resident contact fallback.

2. **Real document vault and evidence storage**
   - Add Cloudflare R2-backed uploads.
   - Store bylaws, rules, minutes, contracts, insurance, warranties, receipts, ticket photos, work-order photos, and payment proofs.
   - Keep link-based documents as an option, but do not depend on external links for real pilots.

3. **Money trust before full accounting**
   - Add resident payment-proof submission.
   - Add admin approval/rejection queue.
   - Add budget vs actual, receipt coverage, and transparent expense explanations.
   - Defer live processors until the workflow is trusted.

4. **Maintenance as work orders**
   - Ticket timeline events, quote comparison, quote decisions, recurring problem detection, vendor follow-up health, SLA alerts, resident-safe progress visibility, executive report snapshots, agency/building PDF reports, per-building monthly maintenance/finance scoreboards, portfolio trends, work-order story, visual operational health scorecards, and record-level portfolio scorecard drilldowns are in place.
   - Remaining work: agency-level owners, due dates, and follow-up states for portfolio risk items.

5. **Brazil + Ecuador readiness**
   - Building-level country, currency, timezone, locale, and governance mode are in place.
   - Finance defaults now follow the building currency.
   - Remaining work: legal/governance copy, date/time formatting sweeps, production seed-content cleanup, and market-specific sales/onboarding material.
   - Keep Portuguese, Spanish, English, and French clean, with no cross-language leak.

6. **Concierge and visitor operations 2.0**
   - Add arrival/check-in history, resident notification fallback, party guest search, and package/delivery handoff audit.

7. **AI moat on trusted workflows**
   - Add cited Building Memory answers, explain-expense, incident mode, and deeper board packet automation.

8. **Production reliability and pilot operations**
   - Add health/integration status, backup checks, Sentry/PostHog routines, production smoke gates, and pilot-safe mode.

9. **Revenue packaging**
   - Add Brazil/Ecuador landing copy, pricing, pilot onboarding checklist, 15-minute sales script, and ROI proof.

10. **Management-company expansion**
   - Add portfolio dashboards, staff permissions, white-label basics, cross-building vendor intelligence, and multi-building monthly reports on top of the single-building workflows.

## Current Slice

Enterprise-private readiness plus market hardening:

- Keep production quality gates green, especially production-safe i18n sweeps.
- Gate new building creation behind private setup codes by default outside development/test.
- Add agency records, portfolio metrics, visual per-building health scorecards, a prioritized attention queue, pilot readiness checklist, monthly agency report, private setup-code controls with activation tracking, staff email invites, scoped staff building assignments, permission review, assigned-building switching, and role-aware scoped portfolio/operations CSV exports above existing building workflows.
- Enforce scoped agency staff capabilities on server routes and board navigation so finance, maintenance, concierge, document/report, and building-admin access stay separated by role and assigned building.
- Keep `/board/portfolio` as the shared agency entry point while scoped staff are redirected away from board pages outside their lane.
- Add building-level Brazil/Ecuador market settings and currency defaults.
- Surface production integration readiness from `/board/portfolio`.
- Keep public login available, but remove the assumption that anyone can freely create a real production building.
- Keep login/signup/onboarding language aligned with private activation whenever setup codes are required.
- Keep maintenance decisions auditable: one selected quote per ticket, quote decision history in the admin timeline, and residents shielded from private vendor notes.
- Surface recurring maintenance clusters in agency portfolio metrics, attention priorities, CSV exports, and monthly reports so managers can spot repeat building issues.
- Surface stale vendor follow-ups in agency portfolio metrics, attention priorities, CSV exports, monthly reports, and pilot-readiness checks so managers can chase quiet vendors before a board meeting.
- Surface exact risky records inside agency scorecards so managers can jump from health score to urgent tickets, overdue dues, vendor follow-ups, pending residents, and proposals missing budgets.
- Let agency managers track each portfolio risk with an owner, due date, status, and note directly from the command center, with building/capability scope enforced server-side.
- Summarize each building's monthly maintenance movement in agency reports: opened/resolved tickets, urgent tickets, work-order movement, stale vendor follow-ups, spend, and top categories.
- Gate proposal voting behind a readiness score covering scope, budget, analysis, risks/impact, and a future voting deadline so residents vote with decision-grade context.
