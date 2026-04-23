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
  condominium_id   INTEGER NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
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
  status           TEXT NOT NULL DEFAULT 'discussion' CHECK(status IN ('discussion','voting','approved','rejected','completed')),
  source_suggestion_id INTEGER REFERENCES suggestions(id),
  ai_drafted       INTEGER NOT NULL DEFAULT 0,
  ai_summary       TEXT,              -- last cached thread summary
  ai_explainer     TEXT,              -- plain-language explanation
  decision_summary TEXT,              -- board decision summary after vote
  voting_closes_at TEXT,
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_packages_recipient ON packages(recipient_id, status);
CREATE INDEX IF NOT EXISTS idx_visitors_host ON visitors(host_id, status);
CREATE INDEX IF NOT EXISTS idx_reservations_amenity ON amenity_reservations(amenity_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_suggestions_condo ON suggestions(condominium_id, status);
CREATE INDEX IF NOT EXISTS idx_proposals_condo ON proposals(condominium_id, status);
CREATE INDEX IF NOT EXISTS idx_votes_proposal ON proposal_votes(proposal_id);
CREATE INDEX IF NOT EXISTS idx_comments_proposal ON proposal_comments(proposal_id);
