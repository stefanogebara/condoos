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
