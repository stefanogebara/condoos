# CONDOS Release Checklist

Use this before pushing to `main`, because `main` deploys through Vercel.

## Required Local Gate

Run from the repo root:

```bash
npm --prefix server test
npm run build
npm run test:e2e:desktop -- e2e/dashboard-actions.spec.ts
```

Run when a slice touches language, navigation, dashboards, onboarding, or public pages:

```bash
npm run test:e2e:desktop -- e2e/i18n-leaks.spec.ts
npm run test:e2e:pilot
```

Run before a serious demo or production review:

```bash
npm run test:e2e:prod:smoke
npm run test:e2e:prod:safe:desktop
npm run audit:ops:backup-restore
npm run audit:perf:prod
```

## Product Gate

Every change should clearly support one buyer promise:

- Front desk knows who can enter.
- Residents know what needs action.
- Admin knows what needs attention.
- Board can explain money and decisions.

Do not add a new page or workflow unless it strengthens one of those promises.

## Safety Gate

- Git status is clean except intended changes.
- Remote `origin` is `stefanogebara/condoos`.
- No unrelated repo/account files are touched.
- No secrets are committed.
- Demo credentials remain disabled in real production unless the deployment is intentionally disposable.
- New env vars are documented in `.env.example` and `docs/ops.md`.
- New data writes are scoped by `condominium_id`.
- Residents, guards, and admins see only role-appropriate data.

## Pilot Gate

Before showing a buyer:

- Admin can see what needs attention from `/board`.
- Resident can see what needs action from `/app`.
- Guard can search unit/resident/visitor/package/party from `/board/concierge`.
- Finance transparency shows dues, payments, expenses, receipts, and reports.
- Document vault limitations are stated honestly if real uploads are not configured.
- WhatsApp/email/Google/AI status is either configured or gracefully hidden/degraded.
