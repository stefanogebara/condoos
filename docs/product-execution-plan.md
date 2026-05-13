# CONDOS Buyer-Readiness Execution Plan

## North Star

CONDOS should reduce calls, WhatsApps, confusion at the front desk, and board drama.

Every roadmap decision should answer one buyer question: will this make the building easier to operate and easier to trust?

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

## Current Execution Slice

The first implementation slice focuses on Phase 1:

- Save this plan in the repo.
- Fix the most visible language leaks in resident, admin, guard, proposals, amenities, and settings.
- Add resident daily action feed.
- Add admin command-center attention feed.
- Add guard search and faster front-desk filtering.
- Run build and targeted language checks.
