# Operations

## SQLite Backups

Local backup:

```bash
npm --prefix server run db:backup
```

Custom output directory:

```bash
npm --prefix server run db:backup -- ../backups
```

Restore from a backup:

```bash
npm --prefix server run db:restore -- ./backups/condoos-YYYYMMDD-HHMMSS.sqlite
```

The restore command first writes a safety copy beside the current DB as `*.pre-restore-*`, then copies the selected backup into place and runs `PRAGMA integrity_check`.

Production Fly backup workflow:

1. Open a Fly SSH console or use a one-off machine with the `/data` volume attached.
2. Run `npm --prefix server run db:backup -- --out-dir /data/backups`.
3. Pull the backup artifact off the machine before destructive migrations or large imports.

Required production secrets for external delivery:

```bash
flyctl secrets set -a condoos-api APP_ORIGIN=https://condoos-ten.vercel.app
flyctl secrets set -a condoos-api EMAIL_PROVIDER=resend
flyctl secrets set -a condoos-api EMAIL_FROM="CondoOS <noreply@your-domain.com>"
flyctl secrets set -a condoos-api RESEND_API_KEY=...
flyctl secrets set -a condoos-api EMAIL_VERIFICATION_REQUIRED=1
flyctl secrets set -a condoos-api PRIVATE_CREATE_BUILDING_REQUIRED=1
flyctl secrets set -a condoos-api TURNSTILE_SITE_KEY=...
flyctl secrets set -a condoos-api TURNSTILE_SECRET_KEY=...
flyctl secrets set -a condoos-api CREATE_BUILDING_CAPTCHA_REQUIRED=1
flyctl secrets set -a condoos-api TWILIO_ACCOUNT_SID=...
flyctl secrets set -a condoos-api TWILIO_AUTH_TOKEN=...
flyctl secrets set -a condoos-api TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
```

For a temporary bootstrap code during a private pilot, set
`PRIVATE_SETUP_CODES=CODE1,CODE2`. For real sales tracking, agency admins can
issue and disable tracked codes from `/board/portfolio` after their first
agency-linked building exists. The full plaintext code is shown only once; the
database stores only a SHA-256 hash with the same normalization used by the
app.

Operators can also insert hashed rows into `private_setup_codes` with a label,
optional `agency_name`, `max_uses`, and `expires_at`. Never store the plaintext
sales code in production.

Every DB-backed setup code activation is recorded in
`private_setup_code_activations` with the code id, activated building, agency,
activating user, and timestamp. `/board/portfolio` shows the latest activated
building on each setup-code card so sales/ops can distinguish unused codes from
codes that already launched a building.

Local/SSH helper for issuing one tracked code:

```bash
DB_PATH=/data/condoos.sqlite npm --prefix server run private:setup-code -- \
  --code=ANDES-2026 \
  --agency="Andes Management" \
  --label="Pilot activation" \
  --max-uses=1 \
  --expires-at=2026-06-30T23:59:59Z
```

Agency portfolio exports are available to agency members from
`/api/agencies/:agencyId/export/portfolio.csv` and from the Export CSV button on
`/board/portfolio`.

Agency operational exports are available from `/board/portfolio` and through:

- `GET /api/agencies/:agencyId/export/residents.csv`
- `GET /api/agencies/:agencyId/export/finance.csv`
- `GET /api/agencies/:agencyId/export/tickets.csv`
- `GET /api/agencies/:agencyId/export/work-orders.csv`
- `GET /api/agencies/:agencyId/export/audit.csv`
- `GET /api/agencies/:agencyId/report.md?month=YYYY-MM`

Exports respect the caller's agency membership. Agency admins export all linked
buildings. Non-admin agency staff only export their assigned buildings. The
audit export also includes agency-level audit rows whose metadata references the
agency, so setup-code/staff/export actions are visible even when not tied to one
building.

The monthly agency report is Markdown so it can be copied into a board update,
sales recap, or management-company operating review. It includes portfolio
attention, risk totals, monthly tickets, completed work orders, billed dues,
payments received, expenses, receipt coverage, and next actions per scoped
building.

The portfolio page also shows a recent audit preview from
`GET /api/agencies/:agencyId/audit-events?limit=25`. It uses the same scope as
the CSV exports, so staff see only their allowed buildings plus agency-level
events.

The portfolio response includes an attention queue derived from the same scoped
building metrics. `/board/portfolio` prioritizes urgent tickets, vendor SLA
problems, overdue dues, pending payment proofs, pending residents, and
proposals without budgets. Each queue item carries the target building and board
route so agency staff can switch into the exact workflow without hunting through
menus.

Agency admins can manage staff accounts from `/board/portfolio`: enter the
staff email, pick an agency role, and assign the buildings they are allowed to
see. If the user account already exists, the staff membership is attached
immediately. If it does not exist, CONDOS creates a hashed staff invite, sends a
private acceptance email when Resend is configured, and shows a one-time manual
link fallback for controlled demos. Non-admin agency staff only see assigned
buildings in `/api/agencies/portfolio` and portfolio CSV exports. Agency admins
always see the whole linked portfolio. The API endpoints are:

- `GET /api/agencies/:agencyId/staff`
- `POST /api/agencies/:agencyId/staff`
- `POST /api/agencies/:agencyId/staff/:membershipId`
- `DELETE /api/agencies/:agencyId/staff/:membershipId`
- `POST /api/agencies/staff-invites/accept`
- `POST /api/agencies/:agencyId/active-building`

Invite acceptance requires the signed-in account email to match the invite
email. The safeguards prevent removing the current actor and prevent
deleting/demoting the last agency admin.

The same portfolio page includes a permission review for agency admins. It
flags single-admin agencies, failed staff invite emails, expired/pending invite
counts, and buildings with no directly assigned staff owner. Non-admin agency
staff keep their scoped building access but do not receive the agency-wide
permission review.

Agency staff with multiple assigned buildings can switch their active building
from `/board/portfolio`. The switch endpoint updates `users.condominium_id` only
when the target building belongs to the caller's agency scope; unassigned
buildings return `agency_building_forbidden`.

Turnstile setup can be automated once you have a Cloudflare account ID and an
API token with Turnstile widget write permission:

```bash
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... npm run ops:turnstile:setup
```

The script creates a managed Turnstile widget for `condoos-ten.vercel.app`,
sets `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, and
`CREATE_BUILDING_CAPTCHA_REQUIRED=1` on Fly, deploys the API, then runs
`npm run audit:prod:hardening`. Use `npm run ops:turnstile:dry-run` to preview
without creating a widget, or run `node scripts/setup-turnstile.mjs
--domains=condoos-ten.vercel.app,example.com` to override domains.

WAHA outbound alternative:

```bash
flyctl secrets set -a condoos-api WHATSAPP_PROVIDER=waha
flyctl secrets set -a condoos-api WAHA_URL=https://your-waha-app.fly.dev/api
flyctl secrets set -a condoos-api WAHA_SESSION=default
flyctl secrets set -a condoos-api WAHA_API_KEY=...
```

WAHA uses a WhatsApp Web session, so treat it as a channel adapter rather than
the official WhatsApp Business API. Keep it on a dedicated account/session,
protect the API key, and avoid repointing a WAHA webhook that belongs to another
product.

Notification delivery is written to `notification_outbox` before send. The API
tries immediate delivery and also retries due WhatsApp rows every 60 seconds
while the Fly machine is running. Keep at least one Fly machine warm
(`min_machines_running = 1`) so vote auto-close and notification retries are not
blocked by zero-traffic sleep.

Production demo-login safety:

```bash
# Omit this in real production. Set only on disposable demo deployments.
flyctl secrets set -a condoos-api DEMO_AUTH_ENABLED=1
```

When `NODE_ENV=production` and `DEMO_AUTH_ENABLED` is not set, known seeded demo
credentials such as `admin@condoos.dev / admin123` are rejected and the login
page hides one-click demo buttons.

Production auth rate limits:

```bash
flyctl secrets set -a condoos-api AUTH_RATE_LIMIT_MAX=5
flyctl secrets set -a condoos-api AUTH_IP_RATE_LIMIT_MAX=60
```

`AUTH_RATE_LIMIT_MAX` applies per normalized email plus client IP. The broader
`AUTH_IP_RATE_LIMIT_MAX` applies per client IP. This prevents a shared network
or CI runner from locking out every user after a few legitimate logins while
still limiting credential attacks against each account.

Production E2E runs make many legitimate demo logins in a short window. Do not
raise or disable public limits for that. Instead configure a long random
`RATE_LIMIT_BYPASS_SECRET` on the Fly API and expose the same value to Playwright
as `E2E_RATE_LIMIT_BYPASS_SECRET`. When present, Playwright sends
`x-condoos-rate-limit-bypass`; the API ignores it unless the server-side secret
matches.

```bash
flyctl secrets set -a condoos-api RATE_LIMIT_BYPASS_SECRET='<long-random-secret>'
gh secret set E2E_RATE_LIMIT_BYPASS_SECRET --repo stefanogebara/condoos
```

## File Upload Storage

CONDOS supports uploaded documents, receipts, and ticket evidence through a
provider-neutral `files` registry. Local development stores files on disk under
`./data/uploads` when R2 secrets are absent. Production should use Cloudflare R2
so files survive deploys and Fly machine restarts.

Required production R2 secrets:

```bash
flyctl secrets set -a condoos-api FILE_STORAGE_DRIVER=r2
flyctl secrets set -a condoos-api FILE_UPLOAD_MAX_MB=25
flyctl secrets set -a condoos-api R2_BUCKET=condoos-uploads
flyctl secrets set -a condoos-api R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
flyctl secrets set -a condoos-api R2_ACCESS_KEY_ID=...
flyctl secrets set -a condoos-api R2_SECRET_ACCESS_KEY=...
flyctl secrets set -a condoos-api R2_REGION=auto
```

The frontend uploads directly to the presigned R2 URL, so the R2 bucket also
needs CORS allowing `PUT` from the Vercel app origin and any pilot/staging
origins. Cloudflare documents this as required for browser-based access with
presigned URLs. Use this bucket CORS policy as the production baseline:

```json
[
  {
    "AllowedOrigins": [
      "https://condoos-ten.vercel.app",
      "https://condoos-stefanogebaras-projects.vercel.app",
      "https://condoos-git-main-stefanogebaras-projects.vercel.app"
    ],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Keep uploaded files private; residents and admins open files through the API,
which redirects to a short-lived signed R2 download URL after checking role,
condo, and visibility.

After secrets and bucket CORS are configured, run the strict production upload
probe:

```bash
npm run audit:prod:uploads
```

The probe logs in as a board admin, presigns a tiny file, uploads it, completes
the registry row, downloads the file back through the API, verifies the bytes,
checks that the live client CSP allows the R2 upload origin, and soft-deletes
the test file. Use `npm run audit:prod:uploads:allow-local` only to verify the
non-production local-storage fallback.

## Production E2E Against Vercel

Vercel Deployment Protection can show the Security Checkpoint to automated
browsers. Playwright must send Vercel's automation bypass secret before loading
protected pages, otherwise UI tests fail at the edge and can waste production
login attempts.

Configure a project bypass secret in Vercel's "Protection Bypass for Automation"
settings or API, then expose it only through your local shell or CI secrets:

```powershell
$env:VERCEL_AUTOMATION_BYPASS_SECRET='<secret-from-vercel>'
$env:E2E_RATE_LIMIT_BYPASS_SECRET='<same-secret-configured-on-fly>'
npm run test:e2e:prod:ui
npm run test:e2e:prod:smoke
```

The Playwright config reads `VERCEL_AUTOMATION_BYPASS_SECRET` and also accepts
the legacy aliases `VERCEL_PROTECTION_BYPASS` and `VERCEL_BYPASS_SECRET`. When a
value is present it sends both `x-vercel-protection-bypass` and
`x-vercel-set-bypass-cookie: true`, matching Vercel's documented Playwright
setup:

https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation

Keep `VERCEL_AUTOMATION_BYPASS_SECRET` as a GitHub Actions/Vercel secret. Do not
commit it to `.env`, `.env.local`, screenshots, Playwright reports, or issue
comments. Treat `E2E_RATE_LIMIT_BYPASS_SECRET` the same way.

Useful production test targets:

```bash
npm run test:e2e:prod:api     # API-backed reservation regression, no browser checkpoint
npm run test:e2e:prod:smoke   # Landing/i18n/intent smoke coverage
npm run test:e2e:prod:ui      # Authenticated browser walkthroughs
npm run test:e2e:prod:safe    # Desktop + mobile production-safe UI/i18n/a11y sweep
npm run audit:perf:prod       # Lighthouse budgets for public production pages
```

`test:e2e:prod:safe` is deliberately limited to read-only or form-open browser
flows. Do not point the full mutating local E2E suite at production unless the
database is disposable or a cleanup plan is in place.

## Full Audit Workflow

GitHub Actions has a scheduled `Full Audit` workflow plus manual dispatch. It
does the expensive checks that should not block every push:

- local seeded backend tests, build, and backup/restore dry run
- full local Playwright desktop and mobile matrix
- production-safe desktop and mobile Playwright sweeps against Vercel/Fly
- axe accessibility checks for public, resident, board, and concierge pages
- Lighthouse budgets for `/`, `/login`, and `/onboarding`
- optional live provider checks for PostHog, Google config, Resend, and WhatsApp

Required GitHub secrets for production browser checks:

```text
VERCEL_AUTOMATION_BYPASS_SECRET
E2E_RATE_LIMIT_BYPASS_SECRET
```

Optional GitHub variables:

```text
E2E_EXPECT_GOOGLE=1
E2E_EXPECT_WHATSAPP=1
```

Optional write-enabled live-provider secrets:

```text
E2E_ALLOW_PROD_WRITES=1
E2E_LIVE_EMAIL_TO=stefanogebara@gmail.com
E2E_LIVE_WHATSAPP_TO=+5511999002121
```

Only set `E2E_ALLOW_PROD_WRITES=1` for a manual run when you actually want the
workflow to create a production invite email and a production package
notification. The default scheduled workflow avoids those writes.
