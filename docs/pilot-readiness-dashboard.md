# CONDOS Pilot Readiness Dashboard

This document separates what is real today from what still needs production wiring. Use it when preparing a buyer demo or deciding the next implementation slice.

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
- Private B2B building activation with setup-code gate when `PRIVATE_CREATE_BUILDING_REQUIRED=1`.
- Agency portfolio foundation: agency records, agency/building links, agency memberships, scoped staff building assignments, staff email invites with one-time manual link fallback, assigned-building switch into board workflows, `/api/agencies/portfolio`, `/board/portfolio` risk summary, recurring maintenance risk detection, vendor follow-up health, prioritized attention queue, pilot readiness checklist, monthly agency Markdown report with per-building maintenance summaries, permission review, server-enforced role capability guardrails, frontend sidebar/route filtering for scoped staff, recent audit preview, agency selector, private setup-code management with activation tracking, staff controls, role-aware portfolio/report export controls, and scoped operational exports for residents, finance, tickets, work orders, and audit rows.

## Demo-Only Or Partially Wired

- Document vault supports both external HTTPS links and uploaded files. Production needs Cloudflare R2 env secrets before relying on durable storage.
- Payments are manual. Live payment providers are deferred.
- WhatsApp/email/Google/AI depend on environment secrets and must degrade gracefully when missing.
- Board packet PDF export is not implemented yet; Markdown copy/download/print exists.
- Management-company portfolio mode is still early. Agency admins can manage private activation codes, invite or scope staff accounts to buildings, see permission review and pilot-readiness flags, act on a prioritized portfolio attention queue, download a monthly Markdown agency report, and export key operational CSVs. Server-side capability checks, frontend board navigation, and export-family limits now respect scoped agency lanes, but polished report packaging still needs hardening.

## Env Secrets To Verify Before A Real Demo

- `GOOGLE_CLIENT_ID` and optional `VITE_GOOGLE_CLIENT_ID`
- `RESEND_API_KEY`, `EMAIL_PROVIDER`, `EMAIL_FROM`, `APP_ORIGIN`
- `EMAIL_VERIFICATION_REQUIRED`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `CREATE_BUILDING_CAPTCHA_REQUIRED`
- `PRIVATE_CREATE_BUILDING_REQUIRED` and either DB-backed `private_setup_codes` or temporary `PRIVATE_SETUP_CODES`
- `WHATSAPP_PROVIDER` plus Twilio or WAHA credentials
- `OPENROUTER_API_KEY`
- `SENTRY_DSN`
- `VITE_POSTHOG_KEY`
- `FILE_STORAGE_DRIVER`, `FILE_UPLOAD_MAX_MB`
- `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_REGION`

## Not Production-Ready Yet

- Production R2 bucket/CORS/secrets must pass `npm run audit:prod:uploads` before a real building uses uploads.
- Turnstile keys are not installed in the current demo deployment, so create-building captcha is not active yet. `npm run audit:prod:hardening` should fail until those keys are set.
- If `PRIVATE_CREATE_BUILDING_REQUIRED` is not set in production, random signed-in users can still attempt create-building. Private sales deployments should fail closed with setup codes; public login/signup copy now reflects private activation when the gate is enabled.
- Ticket timeline events, SLA escalation rules, vendor quote comparison, quote selection/rejection decisions, recurring maintenance risk detection, vendor follow-up health, and per-building maintenance summaries are real. Remaining maintenance hardening is more polished report packaging and visual report sections.
- Market settings exist, but the remaining localization hardening is legal/governance wording, date/time formatting sweeps, and production seed-content cleanup per market.
- Incident mode.
- Portfolio dashboard is not yet a full agency command center: agency setup-code controls, staff email invites, assigned-building switching, scoped staff controls, server capability guardrails, frontend role-specific navigation, permission review, pilot readiness checklist, prioritized attention queue, monthly Markdown report, and role-aware scoped CSV exports exist, but polished report packaging and richer multi-building reporting are still pending.

## Next Pilot Upgrade

The next buyer-visible upgrade should package the already-real maintenance workflow into stronger agency reporting: polished report packaging, visual maintenance sections, and a walkthrough-ready work-order story.
