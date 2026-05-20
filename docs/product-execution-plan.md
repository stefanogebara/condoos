# CONDOS Buyer-Readiness Execution Plan

## North Star

CONDOS should reduce calls, WhatsApps, confusion at the front desk, and board drama.

Every roadmap decision should answer one buyer question: will this make the building easier to operate and easier to trust?

## Private Enterprise Direction

CONDOS is not public self-serve software right now. Public visitors can see
marketing/login and residents can join invited buildings, but new production
buildings should be activated privately through direct sales to management
agencies or selected condo boards. The production default is:

- no uncontrolled public building creation
- setup-code or invite activation for new buildings/agencies
- agency portfolio visibility above building workflows
- production-safe audit green before a buyer demo
- demo credentials only on disposable demo deployments

## Product Truth From The Buyer Review

The current product has a strong condo-specific foundation: visitors, guard flow, amenities, proposals, tickets, transparency, and AI-assisted operations. The gap is not ambition. The gap is trust polish and daily operational sharpness. A buyer should feel that this can run a real building, not only demo one.

## Phase 1: Trust And Daily Use

Priority: make the app feel finished, localized, and useful every day.

- Remove language leaks and raw demo-language strings across Spanish, English, Portuguese, and French surfaces.
- Turn the resident home into an action feed for fast tasks:
  - approve visitor
  - package waiting
  - vote now
  - reservation today
  - payment due
  - ticket updated
- Turn the admin landing page into a command center:
  - pending residents
  - urgent tickets
  - proposals needing attention
  - upcoming meetings
  - unpaid dues
  - reservations conflicts
- Make guard mode ultra-fast:
  - one search box for unit, resident, visitor, package, party, or delivery
  - today’s visitors
  - pending packages
  - parties and guest lists
  - notify resident in one tap
- Improve empty states so blank pages explain what is ready, what is missing, and what action comes next.

Success criteria:

- A Spanish client can navigate the full app without seeing Portuguese operational text unless they selected Portuguese.
- A resident can complete the most likely daily action from the home page in one click.
- An admin can see what needs attention without opening five menus.
- A guard can answer “who is this for?” in under five seconds.

## Phase 2: Money And Operations

Priority: make CONDOS mission-critical.

- Add dues/payment flows in the resident and admin UI:
  - due amounts
  - payment status
  - receipts
  - exports
  - future payment-provider integration
- Upgrade tickets into work orders:
  - resident report
  - neighbor verification
  - admin approval
  - vendor assignment
  - estimate
  - work order
  - photos
  - invoice
  - visible timeline
- Expand vendor operations:
  - service contacts
  - assignments
  - response status
  - vendor scorecards
  - repeat problem history
- Strengthen accounting transparency without building full accounting too early:
  - expenses
  - receipts
  - budget categories
  - dues status
  - export-ready data
- Improve real-building onboarding:
  - CSV import
  - apartment layout import
  - bulk resident invites
  - guard setup
  - service contacts
  - amenities
  - bank/payment setup
  - documents upload
  - push/WhatsApp setup

Success criteria:

- Admins can explain exactly where money went.
- Residents can see what they owe and why.
- Every maintenance issue has a lifecycle, owner, next step, and evidence.

## Phase 3: Management Company Product

Priority: make CONDOS useful for a company that manages many buildings.

- Portfolio dashboard:
  - all buildings
  - open emergencies
  - unpaid balances
  - expiring contracts
  - staff workload
  - board satisfaction
  - pending votes
  - service SLAs
- Staff permissions by role and building.
- White-labeling for management companies.
- Imports, exports, and audit logs.
- Monthly management-company client reports per building.

Success criteria:

- A management company can know which building needs help first.
- A supervisor can audit staff actions and service levels.
- A building board receives a clear monthly report without manual spreadsheet work.

## Phase 4: Moat

Priority: create differentiated CONDOS intelligence once workflows are reliable.

- Building Memory:
  - every past issue, vendor, cost, decision, vote, receipt, and resolution searchable by AI
- Explain This Expense:
  - residents ask why money was spent and receive receipt, category, proposal link, and admin explanation
- Proposal Readiness Score:
  - no vote opens until budget, vendor quote, impact, timeline, and alternatives are clear
- Incident Mode:
  - leak, fire, elevator outage, or emergency creates a live response board for admin, guard, residents, and vendors
- WhatsApp-first resident experience:
  - approve visitors
  - receive packages
  - voting reminders
  - submit issues
- Vendor intelligence:
  - response time
  - cost quality
  - repeat problems
  - resident satisfaction
- Board packet generator:
  - monthly PDF with budget, issues, votes, vendors, risks, and next steps
- Predictive maintenance:
  - recurring issues and equipment history suggest future fixes before failure

Success criteria:

- CONDOS becomes the operational memory of the building.
- Boards get clearer decisions with less conflict.
- Managers can show measurable reductions in calls, confusion, and unresolved issues.

## What Not To Build Yet

- Do not add more random pages before tightening reliability and polish.
- Do not overbuild AI chat until the underlying workflows are complete.
- Do not build deep accounting from scratch before payments, export, and a basic ledger are proven.
- Do not make the resident app feel like admin software. Residents need five-second actions.

## Completed Slice: Phase 1 Trust And Daily Use

The first implementation slice focuses on Phase 1:

- Save this plan in the repo.
- Fix the most visible language leaks in resident, admin, guard, proposals, amenities, and settings.
- Add resident daily action feed.
- Add admin command-center attention feed.
- Add guard search and faster front-desk filtering.
- Run build and targeted language checks.

## Completed Slice: Payment Proofs And Budget Trust

This slice used the upload foundation to make money workflows more real:

- Let residents upload payment receipts/proofs against open invoices.
- Add an admin review queue for approving or rejecting payment proofs.
- Convert approved proofs into payment records without allowing overpayment.
- Add monthly budget vs actual and receipt coverage so the board can explain money clearly.

## Completed Slice: Phase 2 Money, Work Orders, And Documents

The second implementation wave made the operating core more buyer-ready:

- Added admin dues schedules, invoice generation, receivables, CSV export, and manual payment recording.
- Added resident statements inside Transparency so residents can see what they owe.
- Turned verified tickets into work orders with vendor assignment, schedule, estimates, approved cost, invoice/photo links, completion notes, and resident-visible status.
- Added a document vault for rules, minutes, contracts, insurance, warranties, receipts, vendor docs, and resident-visible notices.

## Completed Slice: Real Upload Foundation

The document vault is no longer link-only:

- Added a `files` registry with purpose, visibility, original filename, content type, size, storage key, uploader, status, and soft-delete metadata.
- Added upload endpoints for local/dev storage and Cloudflare R2 presigned uploads.
- Kept external HTTPS links working while allowing uploaded documents, expense receipts, and ticket evidence.
- Added authenticated download checks so residents, guards, and admins only open files appropriate to their role and condo.
- Documented R2 secrets and release checks before production pilots depend on uploaded files.

## Completed Slice: Building Memory

The moat work started without adding fragile automation:

- Added a role-aware search index over tickets, work orders, expenses, proposals, announcements, documents, meetings, and vendor contacts.
- Gave admins one Building Memory page to answer “when did this happen, who handled it, what did it cost, and where is the proof?”
- Kept resident privacy boundaries intact: board-only documents and service-contact details stay admin-only.
- Used the existing data model first; deeper AI answers can sit on top once the search surface is trusted.

## Completed Slice: Agency Attention Queue

The management-company layer now behaves more like a command center:

- Added a prioritized portfolio attention queue from scoped building metrics.
- Surfaces urgent tickets, vendor SLA problems, overdue dues, pending payment proofs, pending residents, and proposals missing budgets.
- Lets agency users jump from each alert into the correct building workflow.
- Keeps non-admin agency staff scoped to assigned buildings while agency admins see the full linked portfolio.

## Completed Slice: Agency Monthly Report

This slice makes portfolio data easier to sell and operate:

- Added a scoped monthly Markdown report for agency members.
- Summarizes portfolio attention, current risk totals, monthly tickets, completed work orders, dues billed, payments received, expenses, receipt coverage, and next actions per building.
- Exposes the report from `/api/agencies/:agencyId/report.md?month=YYYY-MM`.
- Adds a one-click download from `/board/portfolio` alongside CSV exports.

## Completed Slice: Agency Pilot Readiness Checklist

This slice gives agencies a plain pre-demo quality gate in the app:

- Added a `/board/portfolio` checklist for private access, transactional email, R2 uploads, backups, observability, critical operations, admin redundancy, and building coverage.
- Shows ready/review state with buyer-facing guidance so private pilots do not rely on memory or hidden docs.
- Reuses the existing integration status and permission review data instead of inventing a second source of truth.
- Keeps the checklist localized across PT/EN/ES/FR for agency demos.

## Completed Slice: Agency Role Capability Guardrails

This slice makes scoped agency roles enforceable on the server:

- Added explicit building capabilities for agency roles: building admin, finance, maintenance, concierge, documents, and reports.
- Added middleware that lets organic building admins keep full access while limiting agency staff to their assigned building and role lane.
- Applied the guardrail to board-admin routes across finance, work orders/tickets, concierge/packages, residents/invites, building layout/settings, documents, governance, amenities, AI/admin ops, audit, reports, and service contacts.
- Added tests proving finance staff can use finance but not maintenance, maintenance staff can use maintenance but not finance, concierge supervisors cannot act as building admins, and scoped staff cannot act in unassigned buildings.

## Completed Slice: Agency Frontend Permission Filtering

This slice makes the board UI match the server-side agency lanes:

- Exposed each agency role's building capabilities through `/api/agencies/portfolio`.
- Added a shared client capability helper so the board shell can filter links and redirect scoped staff away from blocked routes.
- Hid unrelated board pages for finance, maintenance, document/report, and concierge-scoped agency staff instead of letting them discover server 403s by clicking around.
- Kept `/board/portfolio` available to scoped agency staff for assigned-building switching, audit preview, portfolio metrics, reports, and exports.
- Made the portfolio page load even when enterprise integration status is admin-only, so scoped staff can still use their allowed portfolio view.
- Tightened remaining read endpoints for memory, documents, finance transparency, and ticket views so manually typing a URL does not bypass agency capability checks.

## Completed Slice: Role-Aware Agency Exports

This slice prevents scoped agency staff from downloading export families outside their lane:

- Mapped operational CSV exports to explicit capabilities: resident/audit exports require building-admin access, finance exports require finance access, and ticket/work-order exports require maintenance access.
- Required report capability for the agency monthly Markdown report and portfolio CSV summary.
- Made the frontend show only the export buttons each agency role can actually use.
- Added tests proving scoped finance and maintenance staff are blocked from unrelated export families while assigned building admins still get sensitive building-scoped exports.

## Completed Slice: Vendor Quote Decision Flow

This slice makes maintenance quote comparison operational instead of read-only:

- Added an admin-only quote status update flow for received, shortlisted, selected, and rejected quotes.
- Enforced one selected quote per ticket by automatically moving any previous selected quote back to shortlisted when a new quote is selected.
- Added an admin-only ticket timeline event when a quote decision changes so the board can audit why a vendor was chosen.
- Added quote decision buttons in the admin ticket view: select, shortlist, and reject.
- Kept quote details and decision history hidden from residents while preserving condo-scoped tests.

## Completed Slice: Recurring Maintenance Risk

This slice makes repeated maintenance pain visible at the agency level:

- Detects recurring problem clusters when a building has three or more non-closed tickets in the same category within the last 180 days.
- Surfaces recurring maintenance clusters in `/api/agencies/portfolio`, `/board/portfolio`, the prioritized agency attention queue, portfolio CSV exports, and monthly agency Markdown reports.
- Adds next-action guidance so agency managers know which buildings need pattern investigation, not only one-off ticket response.
- Keeps the signal scoped by condominium and covered by the existing agency portfolio domain test.

## Completed Slice: Vendor Intelligence

This slice makes the saved service network feel operational instead of static:

- Add vendor scorecards to the Operations page using real dispatch, work-order, and expense history.
- Show response rate, average response time, completed/open work orders, tracked spend, and latest operational activity.
- Keep aggregation scoped by condominium so management-company data does not leak across buildings.
- Add indexes and tests around the vendor scorecard query so it can later feed AI recommendations and portfolio reporting.

## Completed Slice: Monthly Board Packet

This slice turns the operating data already in CONDOS into a board-ready report:

- Add an admin Reports page with a monthly board packet.
- Aggregate expenses, dues, overdue units, tickets, work orders, proposals, meetings, announcements, and vendor network health.
- Surface risks and next steps so admins know what needs attention before a board meeting.
- Let admins copy, download, or print the packet without leaving the app.
- Keep all queries scoped to the active condominium and cover the report with domain and E2E tests.

## Completed Slice: Role Command Centers

This slice started the new multi-week roadmap in `docs/condos-operating-roadmap.md`:

- Add a shared role-scoped `/api/dashboard/actions` contract for resident, admin, and guard command centers.
- Add in-app notification records plus read tracking so arrivals/packages can become durable app alerts.
- Wire the resident, admin, and guard home screens to the shared action feed instead of page-local guesses.
- Add release and pilot-readiness docs so every future push has the same quality gate.

## Completed Slice: Brazil And Ecuador Market Settings

This slice gives every building a market identity instead of assuming one country forever:

- Add building-level country, currency, timezone, locale, and governance mode.
- Add onboarding controls so new buildings start as Brazil/BRL/PT-BR or Ecuador/USD/Spanish.
- Add an admin Edificio settings panel to adjust country, currency, language, timezone, and governance mode later.
- Make invoices, dues schedules, expenses, and budget summaries default to the building currency.
- Cover Ecuador currency defaults with server tests and keep the full local i18n sweep green.

## Completed Slice: Agency Staff Invites

This slice turns agency staff setup from a manual pre-created-user step into a private invite flow:

- Add hashed agency staff invite records with expiry, accepted/revoked state, scoped building assignments, and email delivery status.
- Send agency staff invites through the existing email pipeline, with a one-time private signup link fallback when email is not configured.
- Let invited staff create an account or continue after signup, then accept the invite only if the account email matches.
- Show pending agency staff invites and the one-time copy link from `/board/portfolio`.
- Cover invite email generation, email mismatch rejection, scoped acceptance, accepted status, and portfolio visibility with server tests.
- Keep server tests, production build, and the full desktop i18n leak sweep green.

## Completed Slice: Scoped Agency Building Switching

This slice closes the gap between portfolio access and single-building board workflows:

- Add a scoped agency active-building switch endpoint so staff can enter an assigned building from `/board/portfolio`.
- Reject building switches outside the caller's agency assignment, while agency admins can switch across the linked portfolio.
- Activate existing agency staff users as `board_admin` with an allowed active building, matching the invite acceptance path.
- Add portfolio card actions for opening a building and marking the active building.
- Cover allowed and forbidden switching with server tests.

## Completed Slice: Private Public Entry Polish

This slice makes the public entry points match the private B2B sales model:

- Login and signup now show private activation language when setup codes are required.
- Signup create intent tells approved admins to use the CONDOS private activation code instead of implying anyone can create a production building.
- Onboarding landing copy is locale-aware and explains that new buildings are activated by the agency or CONDOS team with a private code.
- The i18n leak sweep now includes signup join/create/agency public routes, closing a previous blind spot.

## Completed Slice: Setup Code Activation Tracking

This slice makes private activation auditable for agency sales and onboarding:

- Record which setup code activated which building, who activated it, and when.
- Show activation history on `/board/portfolio` setup-code cards so agencies can see unused vs. used codes.
- Keep setup-code values hashed while tracking activation metadata through IDs and audit-safe references.
- Cover code activation tracking with server tests.

## Completed Slice: Agency Permission Review

This slice makes portfolio access safer before private pilots:

- Compute a permission review summary for agency admins: total staff, agency admins, scoped staff, pending/expired/failed invites, and buildings with no directly assigned staff owner.
- Show the review on `/board/portfolio` so an agency can fix single-admin risk, failed invites, and uncovered buildings before a buyer walkthrough.
- Keep non-admin agency staff scoped: they can use their assigned building view, but do not receive the agency-wide permission review.
- Cover the permission review with server tests.

## Current Execution Slice: Enterprise Operations Hardening

The next implementation slice should keep building on the private-enterprise plan:

- Package the now-real maintenance lifecycle into stronger agency reporting: vendor follow-up health and richer multi-building maintenance summaries.
- Expand portfolio reporting into a true agency command center.
- Add polished report packaging and stronger multi-building agency priorities.
- Keep production-safe i18n, build, server tests, and pilot smoke checks green before each push.
