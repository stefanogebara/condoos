# CONDOS Pilot Readiness Dashboard

This document separates what is real today from what still needs production wiring. Use it when preparing a buyer demo or deciding the next implementation slice.

## Currently Green On Prod (2026-05-20)

- `npm run audit:prod:hardening` — 5/5 checks pass, 0 warnings (health, email verification, private setup code, Turnstile config, Turnstile CSP).
- `npm run audit:prod:uploads` (with `PROD_UPLOAD_EMAIL`/`PASSWORD`) — R2 PUT presign roundtrip verified.
- Nightly Production E2E workflow at 06:00 UTC runs `safe-desktop` against the deployed stack with private pilot creds (6 GitHub secrets wired).
- Three private pilot accounts seeded in prod: `e2e-admin@condoos.test`, `e2e-resident@condoos.test`, `e2e-concierge@condoos.test` (live in "E2E Test Condo" with default amenities + 2 buildings + units).
- Strong agent audit shipped end-to-end: prompt-injection delimiter, vendor binding by DB id (SEC-2), urgent-safety evidence gate (SEC-5), SSRF guard, separate `VENDOR_TOKEN_SECRET`, durable dispatch queue (ARC-R2), orphaned-run reaper, per-condo kill switch with audit-logged toggle, BoardAgent ops panel with auto-refreshing queue health (`/api/admin/agent/queue/status`).
- Login auto-routing — returning admin/resident with an existing condo skips onboarding wizards regardless of which hero CTA they clicked.

## Real Today

- Admin onboarding with building layout, residents, service contacts, amenities, and invite/share link.
- Resident signup/join with invite code and Google option when configured.
- Resident visitors, parties, recurring visitors, packages, amenity reservations, suggestions, proposals, meetings, tickets, documents, transparency, and settings.
- Guard dashboard for visitors, parties, packages, resident contact fallback, walk-up visitor notification, package handoff, and search.
- Admin residents, pending approvals, proposals, assemblies, meetings, announcements, amenities, building layout, services, tickets, finance, documents, Building Memory, reports, and concierge staff.
- Manual dues/invoices/payments, expense transparency, vendor scorecards, work orders, vendor quote decisions, audit log, and monthly board packet Markdown export.
- Resident payment-proof upload plus admin approval/rejection queue. Approved proofs create payment records and overpayment is blocked.
- In-app dashboard actions for resident/admin/guard command centers.
- File upload registry with local/dev storage and Cloudflare R2-compatible presigned upload support for documents, receipts, and ticket evidence.
- Building-level Brazil/Ecuador market settings: country, currency, timezone, locale, and governance mode. Finance defaults now follow the building currency.
- Private B2B building activation with setup-code gate that fails closed by default outside development/test, with `PRIVATE_CREATE_BUILDING_REQUIRED=0` reserved for disposable demo/e2e environments.
- Agency portfolio foundation: agency records, agency/building links, agency memberships, scoped staff building assignments, staff email invites with one-time manual link fallback, assigned-building switch into board workflows, `/api/agencies/portfolio`, `/board/portfolio` risk summary, recurring maintenance risk detection, vendor follow-up health, cross-building vendor intelligence, prioritized attention queue, cross-building escalation view, per-building operational health scorecards with maintenance/finance/community sub-scores and next actions, pilot readiness checklist, monthly agency Markdown/PDF reports with executive snapshot, health score, per-building maintenance/finance scoreboards and open risk follow-ups, permission review, server-enforced role capability guardrails, frontend sidebar/route filtering for scoped staff, recent audit preview, agency selector, private setup-code management with activation tracking, staff controls, role-aware portfolio/report export controls, and scoped operational exports for residents, finance, tickets, work orders, and audit rows.

## Demo-Only Or Partially Wired

- Document vault supports both external HTTPS links and uploaded files. Cloudflare R2 env secrets are now wired on prod (`npm run audit:prod:uploads` passes — confirmed 94-byte roundtrip via PUT presign on 2026-05-20). Schema enforces "external link OR uploaded file" via the Phase 1 migration.
- Payments are manual. Live payment providers are deferred.
- WhatsApp/email/Google/AI depend on environment secrets and must degrade gracefully when missing.
- Building-level board packet PDF export, Markdown copy/download, and print are implemented. Agency monthly reports also have a PDF download for private management-company reviews.
- Management-company portfolio mode is still early. Agency admins can manage private activation codes, invite or scope staff accounts to buildings, see permission review and pilot-readiness flags, act on a prioritized portfolio attention queue, review cross-building escalations, compare cross-building vendor performance, assign owner/date/status follow-ups, filter open commitments by status/building, bulk-complete/reassign/redate the filtered queue through the audited follow-up endpoint, compare per-building operational health scorecards, download monthly Markdown/PDF agency reports with board-ready tables and follow-up commitments, and export key operational CSVs. Server-side capability checks, frontend board navigation, and export-family limits now respect scoped agency lanes, but richer multi-building reporting still needs hardening.

## Env Secrets To Verify Before A Real Demo

- `GOOGLE_CLIENT_ID` and optional `VITE_GOOGLE_CLIENT_ID`
- `RESEND_API_KEY`, `EMAIL_PROVIDER`, `EMAIL_FROM`, `APP_ORIGIN`
- `EMAIL_VERIFICATION_REQUIRED`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `CREATE_BUILDING_CAPTCHA_REQUIRED`
- DB-backed `private_setup_codes` or temporary `PRIVATE_SETUP_CODES` for approved private activations
- `WHATSAPP_PROVIDER` plus Twilio or WAHA credentials
- `OPENROUTER_API_KEY`
- `SENTRY_DSN`
- `VITE_POSTHOG_KEY`
- `FILE_STORAGE_DRIVER`, `FILE_UPLOAD_MAX_MB`
- `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_REGION`

## Not Production-Ready Yet

- Production create-building fails closed when `PRIVATE_CREATE_BUILDING_REQUIRED` is unset. Only set `PRIVATE_CREATE_BUILDING_REQUIRED=0` on disposable demo/e2e deployments; public login/signup copy reflects private activation when the gate is enabled.
- Ticket timeline events, SLA escalation rules, vendor quote comparison, quote selection/rejection decisions, recurring maintenance risk detection, vendor follow-up health, per-building maintenance summaries, executive report snapshots, agency/building PDF reports, portfolio trend reporting, walkthrough work-order story, visual operational health scorecards, maintenance/finance scoreboards, and record-level portfolio scorecard drilldowns are real.
- Market settings exist, but the remaining localization hardening is legal/governance wording, date/time formatting sweeps, and production seed-content cleanup per market.
- Incident mode.
- Portfolio dashboard is not yet a full agency command center: agency setup-code controls, staff email invites, assigned-building switching, scoped staff controls, server capability guardrails, frontend role-specific navigation, permission review, pilot readiness checklist, prioritized attention queue, cross-building escalation view, escalation aging/filtering, cross-building vendor intelligence, owner/date/status risk follow-ups, status/building follow-up filters, bulk completion/reassignment/due-date updates for the filtered queue, monthly Markdown/PDF report, portfolio trends, work-order story, visual health scorecards, record-level scorecard drilldowns, and role-aware scoped CSV exports exist. Remaining hardening is richer SLA automation, incident response, and deeper reporting.

## Next Pilot Upgrade

The next buyer-visible upgrade should add deeper SLA escalation automation, incident response, and richer vendor scorecards for agency command centers.
