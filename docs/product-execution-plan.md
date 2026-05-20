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

## Current Execution Slice: Enterprise Operations Hardening

The next implementation slice should keep building on the private-enterprise plan:

- Harden maintenance into a fuller work-order timeline with quote comparison and SLA alerts.
- Continue deeper agency permission review screens beyond the active-building switch.
- Expand portfolio reporting into a true agency command center.
- Keep production-safe i18n, build, server tests, and pilot smoke checks green before each push.
