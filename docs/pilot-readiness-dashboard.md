# CONDOS Pilot Readiness Dashboard

This document separates what is real today from what still needs production wiring. Use it when preparing a buyer demo or deciding the next implementation slice.

## Real Today

- Admin onboarding with building layout, residents, service contacts, amenities, and invite/share link.
- Resident signup/join with invite code and Google option when configured.
- Resident visitors, parties, recurring visitors, packages, amenity reservations, suggestions, proposals, meetings, tickets, documents, transparency, and settings.
- Guard dashboard for visitors, parties, packages, resident contact fallback, walk-up visitor notification, package handoff, and search.
- Admin residents, pending approvals, proposals, assemblies, meetings, announcements, amenities, building layout, services, tickets, finance, documents, Building Memory, reports, and concierge staff.
- Manual dues/invoices/payments, expense transparency, vendor scorecards, work orders, audit log, and monthly board packet Markdown export.
- In-app dashboard actions for resident/admin/guard command centers.

## Demo-Only Or Partially Wired

- Document vault currently supports external links. Real uploads need storage provider wiring.
- Payments are manual. Live payment providers are deferred.
- WhatsApp/email/Google/AI depend on environment secrets and must degrade gracefully when missing.
- Board packet PDF export is not implemented yet; Markdown copy/download/print exists.
- Management-company portfolio mode is planned, not ready.

## Env Secrets To Verify Before A Real Demo

- `GOOGLE_CLIENT_ID` and optional `VITE_GOOGLE_CLIENT_ID`
- `RESEND_API_KEY`, `EMAIL_PROVIDER`, `EMAIL_FROM`, `APP_ORIGIN`
- `WHATSAPP_PROVIDER` plus Twilio or WAHA credentials
- `OPENROUTER_API_KEY`
- `SENTRY_DSN`
- `VITE_POSTHOG_KEY`
- Future storage env vars for Cloudflare R2

## Not Production-Ready Yet

- Real file uploads and permissioned storage.
- Resident payment-proof upload/approval.
- Full ticket timeline events and vendor quote comparison.
- Building-level Brazil/Ecuador country, currency, timezone, locale, and governance mode.
- Incident mode.
- Portfolio dashboard for management companies.

## Next Pilot Upgrade

The next buyer-visible upgrade after the Week 1 command center should be Cloudflare R2 file storage, because documents, receipts, ticket photos, work-order proof, and payment proofs all depend on it.
