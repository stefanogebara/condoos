# CONDOS Pre-Outreach Readiness Checklist

Use this before contacting a serious management agency, condo board, or pilot
building. The goal is simple: do not create buyer trust with words and then lose
it with a broken demo.

## Outreach Rule

CONDOS is a private B2B product. Public visitors can see login and marketing,
but production building creation must stay controlled through CONDOS-issued
setup codes or invited agency/building admins.

Do not pitch open public signup. Pitch controlled activation for selected
buildings and management agencies.

## Required Green Gate

Run these from the repo root before a high-value demo:

```bash
npm test
npm run build
npm run test:e2e:pilot
npm run test:e2e:prod:smoke
npm run test:e2e:prod:safe:desktop
npm run audit:prod:hardening:warn
npm run audit:prod:uploads
npm run audit:ops:backup-restore
npm run audit:perf:prod
```

For real production, use `npm run audit:prod:hardening` instead of the warning
mode once email verification, Turnstile, and CSP are fully configured.

## Manual Demo Check

Before outreach starts, manually confirm these paths in production or the exact
demo environment:

- Login routes correctly for admin, resident, and guard accounts.
- New building creation is gated by private setup code.
- Admin `/board` shows the command center.
- Agency `/board/portfolio` shows health, attention queue, escalations, vendor
  intelligence, setup codes, staff controls, reports, and exports.
- Resident `/app` shows daily actions, visitors, parties, packages,
  reservations, tickets, finance transparency, and documents.
- Guard `/board/concierge` is fast: today visitors, parties, packages,
  deliveries, resident contact fallback, and search.
- Finance shows invoices, payments/proofs, expenses, receipts, budget summary,
  and reports.
- Documents can be linked or uploaded, and uploaded files respect role
  visibility.
- Spanish, Portuguese, English, and French do not leak wrong-language UI chrome.
- Any user-entered or seed content that is intentionally untranslated is marked
  or explained as content, not product chrome.

## Environment And Integrations

Confirm these before promising the capability live:

- Email sending and verification are configured.
- Google login is configured or hidden cleanly.
- Cloudflare R2 uploads are configured.
- Backup checks are current.
- Sentry or equivalent error monitoring is configured.
- PostHog or equivalent product analytics is configured.
- WhatsApp provider is configured before promising WhatsApp automation.
- AI provider is configured before promising live AI answers.
- Demo credentials are disabled in real production unless the deployment is
  intentionally disposable and both demo flags are set.

## Buyer Demo Data

Create or verify one clean private demo agency:

- Agency name looks real and local to the target market.
- At least two buildings are linked, so the portfolio view has meaning.
- Each building has residents, units, admins, guards, amenities, documents,
  tickets/work orders, invoices/payments, expenses/receipts, proposals, and
  announcements.
- One building has a small operational issue, such as overdue dues or a vendor
  follow-up, so the attention queue has something to explain.
- One building is healthy, so the product can show contrast.
- All names, descriptions, and seeded content are localized to the demo
  language.

## Do Not Demo Yet

Avoid promising these as finished unless they are explicitly checked in the
current environment:

- Live payment processor collection.
- Fully automated WhatsApp flows.
- Deep accounting replacement.
- Incident mode.
- White-label deployment.
- Legal compliance guarantees for any specific jurisdiction.
- AI answers without source/citation limits.

## Demo Success Standard

The 15-minute buyer walkthrough should prove:

1. The front desk knows who can enter.
2. Residents know what needs action.
3. Admins know what needs attention.
4. The board can explain money and decisions.
5. A management agency can see which building needs help first.

If the walkthrough needs excuses for core operations, keep improving before
outreach volume increases.
