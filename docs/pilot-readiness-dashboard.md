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
- File upload registry with local/dev storage and Cloudflare R2-compatible presigned upload support for documents, receipts, and ticket evidence.

## Demo-Only Or Partially Wired

- Document vault supports both external HTTPS links and uploaded files. Production needs Cloudflare R2 env secrets before relying on durable storage.
- Payments are manual. Live payment providers are deferred.
- WhatsApp/email/Google/AI depend on environment secrets and must degrade gracefully when missing.
- Board packet PDF export is not implemented yet; Markdown copy/download/print exists.
- Management-company portfolio mode is planned, not ready.

## Env Secrets To Verify Before A Real Demo

- `GOOGLE_CLIENT_ID` and optional `VITE_GOOGLE_CLIENT_ID`
- `RESEND_API_KEY`, `EMAIL_PROVIDER`, `EMAIL_FROM`, `APP_ORIGIN`
- `EMAIL_VERIFICATION_REQUIRED`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `CREATE_BUILDING_CAPTCHA_REQUIRED`
- `WHATSAPP_PROVIDER` plus Twilio or WAHA credentials
- `OPENROUTER_API_KEY`
- `SENTRY_DSN`
- `VITE_POSTHOG_KEY`
- `FILE_STORAGE_DRIVER`, `FILE_UPLOAD_MAX_MB`
- `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_REGION`

## Not Production-Ready Yet

- Production R2 bucket/CORS/secrets must be configured and tested against Fly/Vercel before a real building uses uploads.
- Turnstile keys are not installed in the current demo deployment, so create-building captcha is not active yet. `npm run audit:prod:hardening` should fail until those keys are set.
- Resident payment-proof upload/approval.
- Full ticket timeline events and vendor quote comparison.
- Building-level Brazil/Ecuador country, currency, timezone, locale, and governance mode.
- Incident mode.
- Portfolio dashboard for management companies.

## Next Pilot Upgrade

The next buyer-visible upgrade after the upload foundation should be resident payment-proof submission and admin approval, because payment receipts now have a real place to live.
