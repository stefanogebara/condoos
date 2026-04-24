# CondoOS — team workflow

Two owners, two tracks, one product.

- **[Stefano's track →](#stefanos-track)** — UI, AI, product, governance features, Stitch, marketing
- **[Cofounder's track →](#cofounders-track)** — backend endpoints, data model, email, audit, ops, tests

Everything else (shared files, ground rules, cadence) is at the bottom.

---

## Getting set up (cofounder — first 30 min)

```bash
git clone https://github.com/stefanogebara/condoos.git
cd condoos
bash scripts/setup.sh         # installs + seeds the SQLite demo DB
npm run dev                   # starts server :4000 + client :3000
```

Open `http://localhost:3000`, click the **Resident** or **Board admin** one-click tile. Read the README and poke around.

**Credentials**: `admin@condoos.dev` / `admin123` · `resident@condoos.dev` / `resident123`. Pine Ridge invite code: `DEMO123`.

---

## Stefano's track

You own anything a user *sees* or anything *smart*. UI, design, AI, governance features, marketing surfaces.

### Priority 1 — finish the governance story

#### 1. Voting compliance mode

Brazilian condomínios have legal requirements for how votes are conducted. Make it real.

- Add to proposals: `quorum_percent` (int 0–100), `voting_opens_at` (timestamp)
- Server: reject votes after `voting_closes_at`; add a poller that auto-closes proposals when the window expires and triggers `decision-summary` automatically
- UI: board detail — quorum picker + voting window picker while in `discussion`
- UI: resident detail — "Voting closes in 2 days 4h" countdown; "Needs 30% quorum, currently 18%" progress bar

**Files**: `server/src/routes/proposals.ts`, `server/src/db/index.ts`, new `server/src/lib/vote-closer.ts`, `client-app/src/pages/{board,resident}/ProposalDetail.tsx`

**Acceptance**
- [ ] Vote after `voting_closes_at` → 409 `voting_closed`
- [ ] Auto-transitions to `approved`/`rejected`/`inconclusive` when window expires
- [ ] Resident sees countdown + quorum progress
- [ ] Board can edit quorum + window until voting opens

#### 2. AI quality pass

Meeting-summarize falls back too often. Prompts can tighten.

- Fix meeting-summarize: log raw OpenRouter response when JSON parse fails, diagnose why
- Add "agenda items" structured output to meeting summary
- Tune `PROPOSAL_DRAFT_SYS` to produce tighter descriptions
- Add a `proposal_category_classifier` endpoint
- Optional: swap keyword clustering fallback for sentence-embedding clustering

**Files**: `server/src/ai/prompts.ts`, `server/src/ai/fallbacks.ts`, `server/src/routes/ai.ts`, optional `server/src/ai/embeddings.ts`

#### 3. Annual assembly mode (Brazilian legal compliance)

Brazilian condomínios must hold yearly assembleias with specific protocols. Must-have for BR market.

- New route `/board/assemblies`, new `assemblies` table (condo_id, title, scheduled_for, quorum_required, status, minutes_url)
- Each assembly can bundle multiple proposals voted in one session
- Resident: "Attend" button + in-session voting panel
- Post-assembly: AI generates the `ata` (meeting minutes) in PT-BR legal style + PDF export

**Files**: new `server/src/routes/assemblies.ts`, `server/src/db/schema.sql`, new `client-app/src/pages/{board,resident}/Assemblies.tsx`

### Priority 2 — integrations + polish

#### 4. WhatsApp notifications

You have Twilio credentials in other projects. Wire up WhatsApp.

- New proposal → DMs every resident
- Vote closing in 24h → reminder to anyone who hasn't voted
- Assembly scheduled → attendance invite
- Meeting recap published → "Announcement from the board"

**Files**: new `server/src/lib/whatsapp.ts` (copy pattern from `restaurant-ai-mcp`), hook into proposal/announcement/assembly route transitions, `.env.example` adds Twilio vars, new `client-app/src/pages/resident/Settings.tsx` for phone capture + notification toggles

#### 5. Mobile-first polish

CondoOS gets used on phones 80% of the time. Go touch every resident page at 390×844.

- Bottom tab bar on mobile (Overview / Suggest / Visitors / More)
- Sidebar → off-canvas drawer on mobile, keep sidebar on desktop
- Touch targets min 44px

**Files**: `client-app/src/components/Sidebar.tsx` → split into `DesktopSidebar` + `MobileTabBar`, `client-app/src/pages/{resident,board}/*App.tsx`, new `BottomNav.tsx`

#### 6. Landing iteration + demo video

- Try: different hero copy, "Built in Brazil for Brazilian condomínios" band, testimonial slot, pricing preview card
- 90-second Loom walkthrough: sign up → create building → invite cofounder → vote on a proposal → embed on landing

**Files**: `client-app/src/pages/Landing.tsx`, maybe a new `Pricing.tsx`

### Priority 3 — wire the UI as cofounder ships backend

As he lands each endpoint, you build the screen.

| When he ships… | You build… |
|---|---|
| Email sending (`lib/email.ts`) | Email template designs, "Resend invites" button on Residents page, confirmation toasts |
| Move-in/move-out backend | Board UI: "Move out" button on resident card → date picker modal → confirmation, historical-access preserved indicator |
| Audit log backend | New `/board/audit` page with filter by user/action/date, using the design system |
| Financial module backend | Both `/app/finance` (resident dues + statements) and `/board/finance` (admin invoicing + collections). Big design job. |
| Multi-building backend | Tower picker in onboarding wizard step 2 + building switcher in board nav |
| Session refresh endpoint | Remove all `window.location.href` hacks, call `/auth/refresh` instead |

---

## Cofounder's track

You build the plumbing Stefano wires to. Backend endpoints, data integrity, email, audit, monitoring, tests.

**Working agreement**: when you finish an endpoint, ping Stefano with the spec. He builds the UI. Don't touch `client-app/` unless he asks.

### Priority 1 — Email invites (1 day, no UI)

CSV imports create `invites` rows but we never actually email anyone. Hook up Resend.

1. Sign up at https://resend.com (free tier: 100/day). Give Stefano the API key to add to Fly secrets.
2. `RESEND_API_KEY` in `.env.example`
3. Create `server/src/lib/email.ts` with `sendInvite({ to, condoName, inviteCode, unitNumber, adminName })` that POSTs to Resend's REST API
4. Plain-text MVP template (Stefano styles later):

   ```
   Subject: You're invited to {condoName} on CondoOS

   {adminName} invited you to join {condoName} on CondoOS.

   Your unit: {unitNumber}
   Invite code: {inviteCode}

   Sign in at https://condoos-ten.vercel.app/login with this email —
   we'll connect you to your unit automatically.
   ```
5. In `server/src/routes/memberships.ts` at the end of the CSV-import tx, fire-and-forget an email per imported row (don't block response)
6. Silent degrade: missing key → `console.log` instead of fail

**Acceptance**
- [ ] CSV upload → invited emails land within 1 minute
- [ ] Missing key locally → no error, console log only
- [ ] Unit test: fake key, assert fetch URL + body shape

### Priority 2 — Move-in / move-out workflow (1–2 days)

Property managers can't ship without this. Schema supports it; no endpoints yet.

1. `POST /api/memberships/:id/move-out` — `board_admin` only, body `{ move_out_date }`, verifies scope, sets `status='moved_out'`, clears `primary_contact`; if user has no other active memberships, sets `users.condominium_id = NULL`
2. `POST /api/memberships/:id/reactivate` — mistakes happen
3. `POST /api/memberships/transfer-unit` — atomic tx: old → moved_out, new → active
4. `GET /api/memberships/history?unit_id=N` — returns `moved_out` + `revoked` rows for a unit

**Acceptance**
- [ ] Move-out → user loses `/app` access immediately (scope check fails), historical votes/comments preserved
- [ ] Unit becomes available for a new resident via invite code
- [ ] Moved-out user can still see their old data via a read-only `/api/me/history` endpoint
- [ ] Unit test: move-out then new-resident-join succeeds

**Files**: `server/src/routes/memberships.ts`, possibly new `server/src/routes/me.ts`

### Priority 3 — Audit log (1 day, backend only)

Every write action logged. Stefano builds the UI later.

1. Add `audit_log` table:
   ```sql
   CREATE TABLE IF NOT EXISTS audit_log (
     id             INTEGER PRIMARY KEY AUTOINCREMENT,
     condominium_id INTEGER,
     actor_user_id  INTEGER REFERENCES users(id),
     actor_email    TEXT,
     action         TEXT NOT NULL,
     target_type    TEXT,
     target_id      INTEGER,
     metadata       TEXT,
     ip             TEXT,
     created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
   );
   ```
2. `server/src/lib/audit.ts` with `audit(req, { action, target_type, target_id, metadata })`
3. Call `audit()` from every mutation path (memberships approve/deny, proposals status/vote, meetings create/notes/summarize, announcements create, onboarding create-building, onboarding join)
4. `GET /api/audit` board_admin only, scoped to their condo, supports `?action=&from=&to=&target_type=&limit=`
5. `GET /api/audit/export` returns CSV

**Acceptance**: every mutation visible today leaves an audit row; filter queries work; CSV handles commas/quotes in metadata.

**Files**: new `server/src/lib/audit.ts`, `server/src/db/schema.sql` + `index.ts`, every route file with write endpoints, new `server/src/routes/audit.ts`

### Priority 4 — Session refresh + small fixes (half day)

#### 4a. `POST /api/auth/refresh`
After creating a building, client currently does `window.location.href = '/board'` because the JWT still says old role. Clean fix: endpoint re-reads user from DB, returns `{ token: newToken, user }`. Tell Stefano; he removes the hack.

#### 4b. Relationship on invites
CSV import accepts `relationship` but we don't store it. Google auto-claim hardcodes `'tenant'`.

- Add `invites.relationship` column (default `'tenant'`)
- Store from CSV import
- Read in the Google auto-claim block in `server/src/routes/auth.ts`

**Acceptance**: CSV row `owner@x.com,301,owner` → claimed user becomes owner not tenant.

### Priority 5 — Production operations (ongoing)

- **Fly monitoring**: https://fly.io/apps/condoos-api/metrics. Alert when error rate > 5 req/min or memory > 80%. Weekly check of `flyctl logs -a condoos-api --no-tail | tail -100`
- **Sentry** (free tier) for server + client. Surface errors in dev channel.
- **Rate limiting**: `express-rate-limit` on `/api/auth/login` (5 / 15min / IP) and `/api/ai/*` (30 / min / user)

### Priority 6 — Tests (ongoing)

Currently zero tests. Bring to 50% on `routes/` and 80% on `lib/`.

- Vitest + supertest as dev deps in `server/`
- Integration tests for the onboarding flow: create condo → join → approve → vote
- GitHub Action running tests on every PR; block merge on failure

**Files**: `server/package.json`, new `server/tests/*.test.ts`, new `.github/workflows/ci.yml`

### Priority 7 — Backend for features Stefano will UI later

When he's ready, you should have endpoints waiting.

| Feature | What you ship |
|---|---|
| **Multi-building** | Extend `onboarding/create-building` to accept multiple buildings; new `POST /api/buildings` (add building after initial setup), `GET /api/buildings` |
| **Financial module** | Tables `dues_schedules`, `invoices`, `payments`; endpoints `POST /api/finance/invoices` (bulk-generate monthly dues), `GET /api/finance/statements/:unit_id`, `POST /api/finance/payments` |
| **Maintenance tickets** (pair with Stefano) | Tables `tickets`, `ticket_comments`, `ticket_attachments`; full CRUD |

---

## Four-week sequence

| Week | Stefano | Cofounder |
|---|---|---|
| 1 | Voting compliance + AI quality pass | Resend email invites + move-in/out backend |
| 2 | Mobile-first polish + landing/demo video | Audit log + session refresh + relationship fix + first tests |
| 3 | Annual assembly + WhatsApp | Financial module backend + rate limiting |
| 4 | **Pair week**: maintenance ticket system — Stefano UI, cofounder backend | |

---

## Ground rules

1. **Branches**: `stefano/feature-name` and `cofounder/feature-name`. Open PRs, review each other.
2. **Shared files (ping before touching)**:
   - `server/src/db/schema.sql`
   - `server/src/db/index.ts`
   - `server/src/server.ts`
   - `server/src/lib/auth.ts`
   - `client-app/src/App.tsx`
3. **Before merging**: typecheck passes (`npx tsc --noEmit` in `server/`), seed still works (`npm run seed`), demo accounts still log in, Playwright demo flow still passes (resident suggest → board cluster → vote → meeting → announcement)
4. **Don't change the data model** without updating `schema.sql`, `db/index.ts` (migration), and the seed
5. **Don't add env vars** without `.env.example` + a README mention
6. **Don't silently swallow errors** — graceful fallback only on AI endpoints (explicit choice)
7. **Don't touch each other's surface** — if you need to, ask first

## Anti-patterns

- Stefano ships a backend change without telling cofounder (he's counting on that file being stable)
- Cofounder touches a component file (that's Stefano's surface)
- Someone merges with failing typecheck
- Someone adds a third-party SaaS without documenting the env var + silent-degrade path

## Cadence

- **Monday 15 min** — what each is shipping this week, where you might collide
- **Wednesday** — cross-review PRs merged so far
- **Friday** — each does a 5-min live demo of the week's work

## Commands cheat-sheet

```bash
# Local dev
npm run dev                                     # both server + client
npm --prefix server run seed                    # rebuild SQLite with demo data
cd server && npx tsc --noEmit                   # typecheck server
cd client-app && CI=false npx tsc --noEmit      # typecheck client

# Deploy (you mostly won't — CI does it)
flyctl deploy -a condoos-api --remote-only      # server to Fly
vercel --prod --yes                             # client to Vercel

# Health checks
curl https://condoos-api.fly.dev/api/health
flyctl logs -a condoos-api --no-tail | tail -30
```

## Live infra

- **App**: https://condoos-ten.vercel.app
- **API**: https://condoos-api.fly.dev
- **Repo**: https://github.com/stefanogebara/condoos
- **Design system**: https://condoos-ten.vercel.app/design
- **Logo gallery**: https://condoos-ten.vercel.app/logos
- **Fly dashboard**: https://fly.io/apps/condoos-api
- **Vercel dashboard**: https://vercel.com/stefanogebaras-projects/condoos
- **Stitch project**: https://stitch.withgoogle.com/projects/1399691735525483036
- **Stitch design-system asset id**: `7671660702723806725`

---

## Demo video script — 90-second pitch

Read this script while screen-recording a Loom / OBS walkthrough. Click-paths on the left, narration on the right. Target: **90s ± 5s**.

### Setup before recording

- Browser at `1440×900`. Fresh Chrome profile (no stray tabs).
- Two tabs pre-loaded:
  1. `https://condoos-ten.vercel.app/` — landing
  2. `https://condoos-ten.vercel.app/login` — login form
- Log into admin demo once so credentials prefill, then log out. Saves ~4s on stage.
- Quiet room, single wired mic. Record once, don't cut.

### Click-path + narration

**[0:00 – 0:08] Hero** — Tab 1, let the hero settle.
> "Brazilian condomínios still run on spreadsheets, paper notices, and WhatsApp groups. CondoOS is the operating system that replaces all three."

**[0:08 – 0:18] Scroll to AGO section.**
> "Annual assemblies — the *AGO* — are mandatory by the civil code. Ours ships with digital proxies, quorum per item, and the *ata* written for you in Portuguese the minute the session closes."

**[0:18 – 0:26] Scroll to the elderly-woman 'Para cada morador' section.**
> "The product had to work for the 72-year-old owner, not just the síndico's son. Big type, WhatsApp-first, plain language — the AI translates the juridiquês."

**[0:26 – 0:34] Click Entrar → login as admin@condoos.dev / admin123.**
> "Let me show you a live condominium. This is the admin board view — six owners, one building, a real proposal from last week."

**[0:34 – 0:48] Sidebar → Assemblies → New assembly → fill title / date → Create & open agenda → click 'Draft with AI'.**
> "I'll schedule our annual assembly. Title. Date. Done. And here's the trick: the AI drafts the whole agenda from our open proposals — accounts approval, budget, the garage gate repair. The síndico skipped forty minutes of admin."

**[0:48 – 1:02] Back to Proposals → open garage-gate proposal → Voting compliance card → 50% quorum, 7-day window → Save voting rules → Open voting.**
> "Any proposal gets a quorum rule and a voting window. Fifty percent quorum, closes next Friday. If the window expires and nobody hit quorum — it auto-closes as inconclusive. No síndico twisting arms."

**[1:02 – 1:16] Private tab logged in as resident@condoos.dev → Proposals → same proposal → hit Yes.**
> "Now the resident. Notification landed on their WhatsApp — they click through, read the AI-generated plain-language explainer instead of the twelve-page proposal, vote yes in three seconds."

**[1:16 – 1:30] Show the quorum progress line OR scroll the landing Day-to-day band.**
> "Bootstrapped in four weekends. Sixty-six end-to-end tests on production. Built in Brazil for the thirty thousand condomínios still running on paper. Code's on GitHub — link in the description. Onboarding the first ten beta buildings now."

### Cut-priority if time blows past 95s

1. First cut: **0:18–0:26 Para cada morador** — emotional but not load-bearing.
2. Second cut: **1:16–1:30 close-on-wins** — compress to 4-sec outro "Code's on GitHub. Onboarding ten buildings now."
3. Never cut **0:34–1:02** — AGO creation + compliance editor are the killer moments.

### 30-second LinkedIn cut

1. Hero (3s): "CondoOS — operating system for Brazilian condomínios."
2. AGO + AI agenda draft (12s).
3. Resident vote in 3 clicks (10s).
4. Outro (5s): "Live at condoos-ten.vercel.app."

### Don'ts

- Don't explain the tech stack on-camera. Technical buyers read the GitHub. Business buyers only care about what they click.
- First 8 seconds must earn the viewer. The hero shot earns it — don't waste it on a slow intro.
- If a build breaks mid-take, don't retry live. Re-record. Slow recovery kills pitch momentum.
