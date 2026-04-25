-- CondoOS SQLite schema
-- Single-tenant for demo. condominium_id plumbed through for future multi-tenant.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS condominiums (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  address       TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Cached active condo for legacy screens. Access control uses user_unit.
  condominium_id   INTEGER REFERENCES condominiums(id) ON DELETE SET NULL,
  email            TEXT UNIQUE NOT NULL,
  password_hash    TEXT NOT NULL,
  first_name       TEXT NOT NULL,
  last_name        TEXT NOT NULL,
  role             TEXT NOT NULL CHECK(role IN ('resident','board_admin')),
  unit_number      TEXT,
  avatar_url       TEXT,
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Packages waiting at front desk
CREATE TABLE IF NOT EXISTS packages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  condominium_id   INTEGER NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
  recipient_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  carrier          TEXT NOT NULL,
  description      TEXT,
  arrived_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  picked_up_at     TEXT,
  status           TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','picked_up'))
);

-- Visitor requests / access approvals
CREATE TABLE IF NOT EXISTS visitors (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  condominium_id   INTEGER NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
  host_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visitor_name     TEXT NOT NULL,
  visitor_type     TEXT NOT NULL DEFAULT 'guest' CHECK(visitor_type IN ('guest','delivery','service','rideshare')),
  expected_at      TEXT,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied','arrived','completed')),
  notes            TEXT,
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at       TEXT
);

-- Amenities (pool, gym, grill, party room...)
CREATE TABLE IF NOT EXISTS amenities (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  condominium_id   INTEGER NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  icon             TEXT,           -- lucide icon name
  capacity         INTEGER NOT NULL DEFAULT 1,
  open_hour        INTEGER NOT NULL DEFAULT 8,
  close_hour       INTEGER NOT NULL DEFAULT 22,
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS amenity_reservations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  amenity_id       INTEGER NOT NULL REFERENCES amenities(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at        TEXT NOT NULL,
  ends_at          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','cancelled')),
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Announcements (board → residents)
CREATE TABLE IF NOT EXISTS announcements (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  condominium_id   INTEGER NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
  author_id        INTEGER NOT NULL REFERENCES users(id),
  title            TEXT NOT NULL,
  body             TEXT NOT NULL,
  pinned           INTEGER NOT NULL DEFAULT 0,
  source           TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','ai_meeting','ai_decision')),
  related_proposal_id INTEGER REFERENCES proposals(id),
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Durable notification outbox. WhatsApp sends are written here before
-- delivery so failures can be audited and retried.
CREATE TABLE IF NOT EXISTS notification_outbox (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  channel             TEXT NOT NULL CHECK(channel IN ('whatsapp','email')),
  provider            TEXT,
  user_id             INTEGER REFERENCES users(id) ON DELETE SET NULL,
  phone               TEXT,
  email               TEXT,
  body                TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','sending','sent','failed','skipped')),
  attempts            INTEGER NOT NULL DEFAULT 0,
  max_attempts        INTEGER NOT NULL DEFAULT 3,
  next_attempt_at     TEXT,
  provider_message_id TEXT,
  last_error          TEXT,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at             TEXT
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_due
  ON notification_outbox(channel, status, next_attempt_at, attempts);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_user
  ON notification_outbox(user_id, created_at);

-- Suggestions / complaints
CREATE TABLE IF NOT EXISTS suggestions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  condominium_id   INTEGER NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
  author_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body             TEXT NOT NULL,
  category         TEXT,                  -- AI-assigned
  cluster_id       INTEGER REFERENCES suggestion_clusters(id),
  status           TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','promoted','dismissed')),
  promoted_proposal_id INTEGER REFERENCES proposals(id),
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS suggestion_clusters (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  condominium_id   INTEGER NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
  label            TEXT NOT NULL,
  summary          TEXT,
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Proposals (the central unit of decision-making)
CREATE TABLE IF NOT EXISTS proposals (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  condominium_id   INTEGER NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
  author_id        INTEGER NOT NULL REFERENCES users(id),
  title            TEXT NOT NULL,
  description      TEXT NOT NULL,
  category         TEXT,
  estimated_cost   REAL,
  status           TEXT NOT NULL DEFAULT 'discussion' CHECK(status IN ('discussion','voting','approved','rejected','completed','inconclusive')),
  source_suggestion_id INTEGER REFERENCES suggestions(id),
  ai_drafted       INTEGER NOT NULL DEFAULT 0,
  ai_summary       TEXT,              -- last cached thread summary
  ai_explainer     TEXT,              -- plain-language explanation
  decision_summary TEXT,              -- board decision summary after vote
  quorum_percent   INTEGER NOT NULL DEFAULT 0,
  voting_opens_at  TEXT,
  voting_closes_at TEXT,
  closed_at        TEXT,
  close_reason     TEXT,
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS proposal_comments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id      INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  author_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body             TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS proposal_votes (
  proposal_id      INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  choice           TEXT NOT NULL CHECK(choice IN ('yes','no','abstain')),
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (proposal_id, user_id)
);

-- Meetings
CREATE TABLE IF NOT EXISTS meetings (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  condominium_id   INTEGER NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  scheduled_for    TEXT NOT NULL,
  agenda           TEXT,
  raw_notes        TEXT,
  ai_summary       TEXT,
  status           TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','in_progress','completed','cancelled')),
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS action_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id       INTEGER REFERENCES meetings(id) ON DELETE CASCADE,
  proposal_id      INTEGER REFERENCES proposals(id) ON DELETE CASCADE,
  owner_id         INTEGER REFERENCES users(id),
  owner_label      TEXT,                  -- free-text when no user mapped
  description      TEXT NOT NULL,
  due_date         TEXT,
  status           TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done')),
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
-- Multi-tenant onboarding layer (v2). Purely additive.
-- =====================================================================

-- Extend condominiums with onboarding fields (additive ALTERs, safe to re-run)
-- Handled in TS migration helper because SQLite ALTER doesn't support IF NOT EXISTS.

-- Buildings — a condo can have multiple towers / blocks.
CREATE TABLE IF NOT EXISTS buildings (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  condominium_id   INTEGER NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,                     -- "Main Tower", "Block A", "North Wing"
  floors           INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Units — structured representation of each apartment.
CREATE TABLE IF NOT EXISTS units (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id      INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  floor            INTEGER,
  number           TEXT NOT NULL,                     -- "704", "PH-1", "203-B"
  sqft             INTEGER,                           -- optional square footage / m²
  bedrooms         INTEGER,
  parking_spots    INTEGER NOT NULL DEFAULT 0,
  storage_units    INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(building_id, number)
);

-- user_unit — many-to-many over time. Captures who lives/owns what and when.
-- A single unit can have multiple active user_units (couple, roommates).
-- A single user can have multiple units (investor-owner of 3 apartments).
-- Historical: status='moved_out' rows preserve audit trail.
CREATE TABLE IF NOT EXISTS user_unit (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  unit_id          INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  relationship     TEXT NOT NULL CHECK(relationship IN ('owner','tenant','occupant')),
  status           TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','active','revoked','moved_out')),
  primary_contact  INTEGER NOT NULL DEFAULT 0,         -- 1 for the HOA-notifications recipient of this unit
  voting_weight    REAL NOT NULL DEFAULT 1.0,          -- 0 for occupants, 1.0 default, configurable
  move_in_date     TEXT,
  move_out_date    TEXT,
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_unit_user   ON user_unit(user_id, status);
CREATE INDEX IF NOT EXISTS idx_user_unit_unit   ON user_unit(unit_id, status);

-- Invites — code-based signup for residents (whole-condo code) and
-- pre-assigned email invites (optional, not used in MVP UI).
CREATE TABLE IF NOT EXISTS invites (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  condominium_id      INTEGER NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
  email               TEXT,                          -- optional: pre-assigned invite
  unit_id             INTEGER REFERENCES units(id),  -- optional: pre-assigned unit
  role                TEXT NOT NULL DEFAULT 'resident'
    CHECK(role IN ('resident','board_admin')),
  relationship        TEXT NOT NULL DEFAULT 'tenant'
    CHECK(relationship IN ('owner','tenant','occupant')),
  primary_contact     INTEGER NOT NULL DEFAULT 0,
  voting_weight       REAL NOT NULL DEFAULT 1.0,
  code                TEXT,                          -- null for email-only invites; the condo-wide code lives on condominiums.invite_code
  expires_at          TEXT,
  claimed_by_user_id  INTEGER REFERENCES users(id),
  email_status        TEXT,
  email_sent_at       TEXT,
  email_error         TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','claimed','revoked','expired')),
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code) WHERE code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_pending_email_unit
  ON invites(condominium_id, email, unit_id) WHERE status = 'pending' AND email IS NOT NULL AND unit_id IS NOT NULL;

-- =====================================================================
-- Annual Assembly (AGO) — Brazilian condo legal compliance layer
-- =====================================================================

CREATE TABLE IF NOT EXISTS assemblies (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  condominium_id      INTEGER NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
  created_by_user_id  INTEGER NOT NULL REFERENCES users(id),
  title               TEXT NOT NULL,
  kind                TEXT NOT NULL CHECK(kind IN ('ordinary','extraordinary')),
  status              TEXT NOT NULL DEFAULT 'draft'
    CHECK(status IN ('draft','convoked','in_session','closed')),
  first_call_at       TEXT NOT NULL,      -- timestamp of first scheduled convocation
  second_call_at      TEXT,               -- usually first_call + 30min
  convoked_at         TEXT,
  started_at          TEXT,
  closed_at           TEXT,
  ata_markdown        TEXT,               -- AI-drafted minutes
  president_user_id   INTEGER REFERENCES users(id),
  secretary_user_id   INTEGER REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assembly_agenda_items (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  assembly_id         INTEGER NOT NULL REFERENCES assemblies(id) ON DELETE CASCADE,
  order_index         INTEGER NOT NULL,
  title               TEXT NOT NULL,
  description         TEXT,
  item_type           TEXT NOT NULL
    CHECK(item_type IN ('budget','accounts','bylaw','election','ordinary','other')),
  source_proposal_id  INTEGER REFERENCES proposals(id),
  required_majority   TEXT NOT NULL DEFAULT 'simple'
    CHECK(required_majority IN ('simple','two_thirds','unanimous')),
  status              TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','active','approved','rejected','inconclusive','deferred')),
  outcome_summary     TEXT,
  closed_at           TEXT,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Attendance roll: one row per (assembly, user) when they check in.
-- Proxies create a second row with attended_as='proxy' and proxy_for_user_id set.
CREATE TABLE IF NOT EXISTS assembly_attendance (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  assembly_id         INTEGER NOT NULL REFERENCES assemblies(id) ON DELETE CASCADE,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  unit_id             INTEGER REFERENCES units(id),
  attended_as         TEXT NOT NULL CHECK(attended_as IN ('self','proxy')),
  proxy_for_user_id   INTEGER REFERENCES users(id),
  is_delinquent       INTEGER NOT NULL DEFAULT 0,
  checked_in_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_attendance_assembly ON assembly_attendance(assembly_id);

-- Proxy grants. One active grant per (assembly, grantor).
CREATE TABLE IF NOT EXISTS assembly_proxies (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  assembly_id       INTEGER NOT NULL REFERENCES assemblies(id) ON DELETE CASCADE,
  grantor_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grantee_user_id   INTEGER NOT NULL REFERENCES users(id),
  status            TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active','revoked')),
  note              TEXT,
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_proxies_active
  ON assembly_proxies(assembly_id, grantor_user_id) WHERE status = 'active';

-- Votes. effective_owner_id = the ownership stake being voted on:
--   - if voting for self:   effective_owner_id = voter_user_id
--   - if voting as proxy:   effective_owner_id = grantor_user_id
-- UNIQUE(agenda_item_id, effective_owner_id) enforces one vote per ownership stake.
CREATE TABLE IF NOT EXISTS assembly_votes (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  assembly_id          INTEGER NOT NULL REFERENCES assemblies(id) ON DELETE CASCADE,
  agenda_item_id       INTEGER NOT NULL REFERENCES assembly_agenda_items(id) ON DELETE CASCADE,
  voter_user_id        INTEGER NOT NULL REFERENCES users(id),
  effective_owner_id   INTEGER NOT NULL REFERENCES users(id),
  choice               TEXT NOT NULL CHECK(choice IN ('yes','no','abstain')),
  weight               REAL NOT NULL DEFAULT 1.0,
  cast_at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(agenda_item_id, effective_owner_id)
);

CREATE INDEX IF NOT EXISTS idx_assembly_votes_item ON assembly_votes(agenda_item_id);

-- Original indexes
CREATE INDEX IF NOT EXISTS idx_packages_recipient ON packages(recipient_id, status);
CREATE INDEX IF NOT EXISTS idx_visitors_host ON visitors(host_id, status);
CREATE INDEX IF NOT EXISTS idx_reservations_amenity ON amenity_reservations(amenity_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_suggestions_condo ON suggestions(condominium_id, status);
CREATE INDEX IF NOT EXISTS idx_proposals_condo ON proposals(condominium_id, status);
CREATE INDEX IF NOT EXISTS idx_votes_proposal ON proposal_votes(proposal_id);
CREATE INDEX IF NOT EXISTS idx_comments_proposal ON proposal_comments(proposal_id);
