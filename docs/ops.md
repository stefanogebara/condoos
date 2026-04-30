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
flyctl secrets set -a condoos-api TWILIO_ACCOUNT_SID=...
flyctl secrets set -a condoos-api TWILIO_AUTH_TOKEN=...
flyctl secrets set -a condoos-api TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
```

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

## Production E2E Against Vercel

Vercel Deployment Protection can show the Security Checkpoint to automated
browsers. Playwright must send Vercel's automation bypass secret before loading
protected pages, otherwise UI tests fail at the edge and can waste production
login attempts.

Configure a project bypass secret in Vercel's "Protection Bypass for Automation"
settings or API, then expose it only through your local shell or CI secrets:

```powershell
$env:VERCEL_AUTOMATION_BYPASS_SECRET='<secret-from-vercel>'
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
comments.

Useful production test targets:

```bash
npm run test:e2e:prod:api     # API-backed reservation regression, no browser checkpoint
npm run test:e2e:prod:smoke   # Landing/i18n/intent smoke coverage
npm run test:e2e:prod:ui      # Authenticated browser walkthroughs
```

Production scripts intentionally run the `desktop` Playwright project only. The
Fly API login endpoint is production-rate-limited, and running the same
authenticated suite across desktop plus mobile can exhaust the limit before the
second project starts. Use the full local `npm run test:e2e` matrix for
cross-device coverage.
