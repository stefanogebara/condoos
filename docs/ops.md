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
# This is explicit documentation; the server also fails closed by default
# outside NODE_ENV=development/test.
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
- `GET /api/agencies/:agencyId/report.pdf?month=YYYY-MM`

Exports respect the caller's agency membership. Agency admins export all linked
buildings. Non-admin agency staff only export their assigned buildings. The
audit export also includes agency-level audit rows whose metadata references the
agency, so setup-code/staff/export actions are visible even when not tied to one
building.

The monthly agency report is available as Markdown and PDF so it can be copied
into a board update, downloaded for a board packet, or shared in a
management-company operating review. It includes the executive snapshot,
portfolio health score, attention queue, maintenance scoreboard, finance
transparency scoreboard, and next actions per scoped building.

The portfolio page also shows a recent audit preview from
`GET /api/agencies/:agencyId/audit-events?limit=25`. It uses the same scope as
the CSV exports, so staff see only their allowed buildings plus agency-level
events.

Building-level board packets are available to board/report-capable admins from
`/board/reports` and through:

- `GET /api/reports/board-packet?month=YYYY-MM`
- `GET /api/reports/board-packet.pdf?month=YYYY-MM`

The PDF export is generated server-side from the same scoped packet data as the
on-screen report and writes an audit row when downloaded.

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
# Omit both in real production. Set only on disposable demo deployments.
flyctl secrets set -a condoos-api DEMO_AUTH_ENABLED=1
flyctl secrets set -a condoos-api ALLOW_DEMO_AUTH_IN_PRODUCTION=1
```

In production, `DEMO_AUTH_ENABLED=1` alone is ignored. Known seeded demo
credentials such as `admin@condoos.dev / admin123` are rejected unless both demo
flags are set, and the login page hides one-click demo buttons when demo auth is
off.

Production auth rate limits:

```bash
flyctl secrets set -a condoos-api AUTH_RATE_LIMIT_MAX=5
flyctl secrets set -a condoos-api AUTH_IP_RATE_LIMIT_MAX=60
```

`AUTH_RATE_LIMIT_MAX` applies per normalized email plus client IP. The broader
`AUTH_IP_RATE_LIMIT_MAX` applies per client IP. This prevents a shared network
or CI runner from locking out every user after a few legitimate logins while
still limiting credential attacks against each account.

Production E2E should use private automation/pilot credentials, not seeded demo
credentials, unless the deployment is intentionally disposable. Configure these
as local shell variables or GitHub Actions secrets before running production-safe
authenticated suites:

```text
E2E_ADMIN_EMAIL
E2E_ADMIN_PASSWORD
E2E_RESIDENT_EMAIL
E2E_RESIDENT_PASSWORD
E2E_CONCIERGE_EMAIL
E2E_CONCIERGE_PASSWORD
```

These runs make many legitimate logins in a short window. Do not raise or
disable public limits for that. Instead configure a long random
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

Production backup and load probes:

```bash
npm run audit:prod:backup      # verify latest off-site backup downloads + integrity-checks
npm run audit:prod:backup:run  # trigger one production snapshot, upload it, then verify it
npm run audit:prod:restore-drill # restore latest off-site backup into a temp DB and prove it opens read-write
npm run audit:prod:restore-boot  # boot an isolated API process against the restored temp DB and health-check it
npm run audit:prod:load        # bounded production API/client concurrency probe
```

`audit:prod:backup` logs in as the production E2E board admin, finds the latest
off-site snapshot, downloads it, gunzips it into a temporary file, opens it as
read-only SQLite, runs `PRAGMA integrity_check`, and counts core tables. It does
not replace or mutate the production database. `audit:prod:backup:run` first
creates a fresh snapshot and then verifies that exact uploaded object and runs
the restore drill against it. `audit:prod:restore-drill` is also non-destructive:
it downloads the backup server-side into a temporary SQLite file, runs
`PRAGMA integrity_check`, `PRAGMA foreign_key_check`, counts core tables, and
creates/drops a temporary probe table to prove the restored file is writable.
`audit:prod:restore-boot` goes one step further: the Fly API downloads the
backup into a temporary SQLite file, starts a separate local-only API process
with `DB_PATH` pointed at that restored copy and `NODE_ENV=test`, waits for
`/api/health` to report `db: ok`, then terminates the child process and deletes
the temporary DB plus SQLite sidecars. It never replaces the live production
database and does not start schedulers, WhatsApp retries, backup jobs, or agent
workers.
Production prefers dedicated `BACKUP_S3_*` credentials, but falls back to the
configured private R2 upload bucket for pilot readiness. `audit:prod:load` is
intentionally small; it exercises the live client, auth, dashboard, tickets,
finance, integrations, and agent queue status under bounded concurrency so it
can run in CI without becoming a load test against customers.

## Backup Freshness (Stale-Scheduler Alert)

`GET /api/admin/backup/status` includes a `freshness` block computed by listing
the bucket and reading the newest object's `LastModified`:

```json
{
  "freshness": {
    "ok": true,
    "latest_object_key": "condoos-sqlite/condoos-2026-05-25T03-00-15.sqlite.gz",
    "latest_object_at": "2026-05-25T03:00:15.000Z",
    "age_hours": 4.31,
    "stale_threshold_hours": 36,
    "stale": false
  }
}
```

The bucket is the source of truth — the scheduler's in-memory `last_attempt_at`
resets on every Fly machine restart, so it can show `null` even when prod is
healthy. The bucket's `LastModified` survives restarts.

`stale` is `true` when `age_hours > stale_threshold_hours` (default 36h —
24h daily cadence plus a 12h buffer for clock drift or one missed run). Tune
via `BACKUP_STALE_HOURS` on Fly when needed.

`audit:prod:backup` now enforces freshness with `--require-fresh`. The scheduled
`Full Audit` GitHub Action runs daily at 07:23 UTC, so a silently-stalled
scheduler turns into a failed CI run within 24h of the missed window.

If `audit:prod:backup` fails with `backup freshness check failed (stale)`:

1. Check Fly logs for the most recent `[backup]` line:
   ```bash
   flyctl logs -a condoos-api | grep "\[backup\]" | tail -20
   ```
2. Trigger one manual snapshot to bridge the gap and confirm credentials still
   work:
   ```bash
   npm run audit:prod:backup:run
   ```
3. If `[backup] failed:` lines reference `AccessDenied`, `InvalidAccessKeyId`,
   or `NoSuchBucket`, the R2/S3 credentials have drifted. Rotate and re-set
   `BACKUP_S3_*` (or `R2_*`) secrets on Fly, then `flyctl deploy -a condoos-api`.

## Restoring From a Production Backup (Runbook)

**When to use:** the Fly `/data` volume is lost, corrupted, or you need to roll
back to a known-good snapshot. This is destructive against the live DB. Read
the whole runbook before running step 4.

**Prerequisites:**

- `flyctl` authenticated against the `condoos-api` app.
- `BACKUP_S3_*` (or `R2_*`) credentials available locally for the storage
  bucket where snapshots live.
- The S3-compatible CLI of your choice (`aws s3` works against R2 with
  `--endpoint-url`).

### Step 1 — Confirm the bucket has a usable backup

Hit the status endpoint via the audit script. This is non-destructive and just
proves you can talk to S3, that the bucket has at least one object, and that
the latest one isn't stale:

```bash
npm run audit:prod:backup
```

Expected: `"ok": true`, `freshness_stale: false`.

### Step 2 — Dry-run restore against a temp DB

Prove the backup is actually restorable end-to-end. This runs server-side on
the Fly machine, downloads the snapshot to `/tmp`, opens it as SQLite, runs
`PRAGMA integrity_check` + `PRAGMA foreign_key_check`, and does a writable
probe — without touching the live DB:

```bash
npm run audit:prod:restore-drill
```

Then the stronger drill — boot a real API process against the restored snapshot
on a separate port and hit `/api/health`:

```bash
npm run audit:prod:restore-boot
```

If either drill fails, stop. Pick an older snapshot via `--key` and retry
(see Step 5 below). Do not proceed to a destructive restore against a backup
that fails the drills.

### Step 3 — Capture the current DB before overwriting

Even if the live DB is suspected-bad, take one final on-disk snapshot via Fly
SSH so the failed state is recoverable for forensics:

```bash
flyctl ssh console -a condoos-api -C "sh -lc 'cp /data/condoos.sqlite /data/condoos.sqlite.before-restore-$(date -u +%Y%m%dT%H%M%SZ)'"
```

### Step 4 — Restore (destructive)

Pull the chosen snapshot onto the Fly machine and replace `/data/condoos.sqlite`
with it. Stop the API first so no in-flight write races the swap:

```bash
# 4a. Find the key you want from the bucket. Latest is usually right; for a
#     point-in-time rollback, list explicit keys:
flyctl ssh console -a condoos-api

# Inside the machine:
KEY='condoos-sqlite/condoos-YYYY-MM-DDTHH-MM-SS.sqlite.gz'
TMP=/tmp/restore-$(date -u +%Y%m%dT%H%M%SZ).sqlite

# 4b. Download + gunzip. The same R2 secrets the backup writer uses are
#     already in the machine env, so we just need the AWS CLI (or call the
#     same S3 SDK via a small node one-liner if AWS CLI isn't installed):
node -e "
  const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
  const fs = require('fs');
  const zlib = require('zlib');
  const { pipeline } = require('stream/promises');
  const client = new S3Client({
    region: process.env.BACKUP_S3_REGION || process.env.R2_REGION || 'auto',
    endpoint: process.env.BACKUP_S3_ENDPOINT || process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.BACKUP_S3_ACCESS_KEY || process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.BACKUP_S3_SECRET_KEY || process.env.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });
  (async () => {
    const obj = await client.send(new GetObjectCommand({
      Bucket: process.env.BACKUP_S3_BUCKET || process.env.R2_BUCKET,
      Key: process.env.RESTORE_KEY,
    }));
    await pipeline(obj.Body, zlib.createGunzip(), fs.createWriteStream(process.env.RESTORE_OUT));
  })();
" 2>&1

# Then run it with env:
RESTORE_KEY=$KEY RESTORE_OUT=$TMP node /tmp/restore-fetch.mjs

# 4c. Integrity-check the downloaded file before swap:
sqlite3 $TMP 'PRAGMA integrity_check;'   # must print: ok

# 4d. Atomic swap. The Fly machine doesn't auto-restart on file replace, but
#     better-sqlite3 holds an open fd against the old inode; do a clean
#     process restart afterwards:
mv $TMP /data/condoos.sqlite
exit

# 4e. Restart the API so the new file is the one opened on next connect:
flyctl machine restart -a condoos-api
```

### Step 5 — Restore from a non-latest snapshot

If the most recent snapshot is bad (e.g., it caught corruption mid-window),
pass `--key` to the audit script to drill against an older one before
restoring:

```bash
# Pass through the script as --key=condoos-sqlite/...sqlite.gz; the
# /admin/backup/restore-drill endpoint accepts an explicit key in the
# JSON body. Forward it on the CLI:
node scripts/prod-backup-check.mjs --require-configured --restore-drill --key=condoos-sqlite/condoos-YYYY-MM-DDTHH-MM-SS.sqlite.gz
```

(The script's `--key` passthrough is currently implicit — the API accepts
`{"key":"..."}` on `/admin/backup/restore-drill`. If you need a specific older
key, edit `prod-backup-check.mjs` to set `body: JSON.stringify({ key: ... })`
or hit the endpoint directly with `curl`.)

### Step 6 — Verify after restore

After the API restarts:

```bash
# Health
curl -fsS https://condoos-api.fly.dev/api/health | jq

# Smoke the board admin login + one read
npm run audit:prod:credentials

# Re-trigger one fresh backup so the post-restore state is itself backed up
npm run audit:prod:backup:run
```

### Step 7 — Rollback the restore

If the restored DB is itself bad, the pre-restore snapshot from Step 3 is on
the machine as `/data/condoos.sqlite.before-restore-*`. Swap it back the same
way (Step 4d) and restart.

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
$env:E2E_ADMIN_EMAIL='automation-admin@example.com'
$env:E2E_ADMIN_PASSWORD='...'
$env:E2E_RESIDENT_EMAIL='automation-resident@example.com'
$env:E2E_RESIDENT_PASSWORD='...'
$env:E2E_CONCIERGE_EMAIL='automation-guard@example.com'
$env:E2E_CONCIERGE_PASSWORD='...'
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

When these commands run locally without `E2E_ADMIN_*` / `E2E_RESIDENT_*`,
public production smoke still runs, but authenticated UI checks skip instead of
falling back to seeded demo credentials. CI still runs
`scripts/verify-prod-credentials.mjs` first, so missing or drifted secrets fail
fast before browser tests start.

`test:e2e:prod:safe` is deliberately limited to read-only, form-open, or
self-cleaning browser flows. The finance modal spec creates a one-off invoice
with notes prefixed `E2E finance modal dismissal`, targets that exact invoice in
the UI, and voids it through the audited `/api/finance/invoices/:id/void`
endpoint in cleanup. The proposal walkthrough creates a temporary `E2E
pre-vote analysis ...` discussion proposal and deletes it through the audited
`DELETE /api/proposals/:id` endpoint, which only accepts clean discussion
proposals with no votes, comments, announcements, or action items. The upload
integrity check is storage-driver-aware: local API uploads reject short bodies at
PUT time, while R2/direct uploads fail closed at `/api/uploads/complete` if the
object is absent. Do not point the full mutating local E2E suite at production
unless the database is disposable or a cleanup plan is in place.

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
E2E_ADMIN_EMAIL
E2E_ADMIN_PASSWORD
E2E_RESIDENT_EMAIL
E2E_RESIDENT_PASSWORD
E2E_CONCIERGE_EMAIL
E2E_CONCIERGE_PASSWORD
```

Optional GitHub variables:

```text
E2E_EXPECT_GOOGLE=1
E2E_EXPECT_WHATSAPP=1
```

Optional extra residents for richer `multi-user-loop.spec.ts` coverage:

```text
E2E_RESIDENT2_EMAIL
E2E_RESIDENT2_PASSWORD
E2E_RESIDENT3_EMAIL
E2E_RESIDENT3_PASSWORD
```

When all three resident pairs are set, the multi-user-loop spec asserts a
4-voter tally (admin + 3 residents). With only the primary set, it falls
back to a 2-voter tally automatically. To provision the extra prod accounts:

```bash
node scripts/provision-e2e-residents.mjs --password '<at-least-16-chars>'
# Then set the GitHub secrets the script prints at the end.
```

The script is idempotent and re-aligns `password_hash` on subsequent runs, so
it doubles as the rotation tool for these accounts. It attaches the new
residents to the same unit as `e2e-resident@condoos.test` — `voter_eligibility
= 'all'` only requires an active `user_unit` row, no new unit needed.

Optional write-enabled live-provider secrets:

```text
E2E_ALLOW_PROD_WRITES=1
E2E_LIVE_EMAIL_TO=stefanogebara@gmail.com
E2E_LIVE_WHATSAPP_TO=+5511999002121
```

Only set `E2E_ALLOW_PROD_WRITES=1` for a manual run when you actually want the
workflow to create a production invite email and a production package
notification. The default scheduled workflow avoids those writes.

## E2E credential drift

If the Production E2E or Full Audit workflows start failing at `/auth/login`
with `invalid_credentials` for one of the `e2e-*@condoos.test` accounts, the
prod DB `password_hash` column has drifted away from the GitHub Actions
secret. Causes seen so far: manual ops session via Fly SSH that ran an
ad-hoc UPDATE; a restored DB backup that pre-dated the last secret rotation.

Symptom — `npm run audit:prod:credentials` returns:

```
[FAIL] admin — 401 invalid_credentials
```

Fix — pick a new password and align both ends:

```bash
NEW_PW='something-long-and-random-32-chars-min'

# 1. Re-hash the prod DB for all 3 accounts.
npm run ops:reset-e2e-passwords -- --password "$NEW_PW"

# 2. Update the 3 GitHub Actions secrets to match.
gh secret set E2E_ADMIN_PASSWORD     --body "$NEW_PW"
gh secret set E2E_RESIDENT_PASSWORD  --body "$NEW_PW"
gh secret set E2E_CONCIERGE_PASSWORD --body "$NEW_PW"

# 3. Verify both ends agree (no rate-limit risk — only 3 logins).
gh workflow run "Production E2E" -f suite=api
```

The `Verify prod credentials are aligned with GitHub secrets` step in both
workflows runs `scripts/verify-prod-credentials.mjs` before any browser
suite, so a future drift fails fast at the top of the run instead of
cascading 401s through 20+ downstream tests.
