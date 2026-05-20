import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = process.env.DB_PATH || './data/condoos.sqlite';
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

function ensureDir(file: string) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

ensureDir(DB_PATH);

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function columnExists(table: string, col: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  return rows.some((r) => r.name === col);
}

function addColumnIfMissing(table: string, col: string, ddl: string) {
  if (!columnExists(table, col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
  }
}

// Widens the users.role CHECK to include 'concierge' (#11). Safe to run on
// fresh DBs (the table created by schema.sql still has the old CHECK; this
// fn detects it and rebuilds). Idempotent.
function migrateUsersRoleConcierge() {
  // Find the create-statement to see whether the CHECK already includes concierge.
  const ddl = (db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='users'`)
    .get() as { sql?: string } | undefined)?.sql || '';
  if (ddl.includes("'concierge'")) return;

  const foreignKeys = db.pragma('foreign_keys', { simple: true }) as number;
  db.pragma('foreign_keys = OFF');
  try {
    db.exec(`
      CREATE TABLE users_new (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        condominium_id   INTEGER REFERENCES condominiums(id) ON DELETE SET NULL,
        email            TEXT UNIQUE NOT NULL,
        password_hash    TEXT NOT NULL,
        first_name       TEXT NOT NULL,
        last_name        TEXT NOT NULL,
        role             TEXT NOT NULL CHECK(role IN ('resident','board_admin','concierge')),
        unit_number      TEXT,
        avatar_url       TEXT,
        phone            TEXT,
        mobile_phone     TEXT,
        home_phone       TEXT,
        whatsapp_opt_in  INTEGER NOT NULL DEFAULT 0,
        token_version    INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users_new (
        id, condominium_id, email, password_hash, first_name, last_name,
        role, unit_number, avatar_url, phone, mobile_phone, home_phone, whatsapp_opt_in, token_version, created_at
      )
      SELECT
        id, condominium_id, email, password_hash, first_name, last_name,
        role, unit_number, avatar_url, phone, mobile_phone, home_phone, whatsapp_opt_in, COALESCE(token_version, 0), created_at
      FROM users;

      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
    console.log('[migrate] widened users.role to include concierge');
  } finally {
    db.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  }
}

function migrateUsersCondoNullable() {
  const cols = db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string; notnull: number }>;
  const condoCol = cols.find((c) => c.name === 'condominium_id');
  if (!condoCol || condoCol.notnull === 0) return;

  const foreignKeys = db.pragma('foreign_keys', { simple: true }) as number;
  db.pragma('foreign_keys = OFF');
  try {
    db.exec(`
      CREATE TABLE users_new (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
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

      INSERT INTO users_new (
        id, condominium_id, email, password_hash, first_name, last_name,
        role, unit_number, avatar_url, created_at
      )
      SELECT
        id, condominium_id, email, password_hash, first_name, last_name,
        role, unit_number, avatar_url, created_at
      FROM users;

      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
    console.log('[migrate] made users.condominium_id nullable');
  } finally {
    db.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  }
}

/**
 * Migrate legacy users.unit_number → buildings/units/user_unit.
 * Runs only when there are users but zero buildings for their condo.
 * Idempotent — safe to call on every boot.
 */
function migrateLegacyUnits() {
  const condos = db.prepare(`SELECT id FROM condominiums`).all() as { id: number }[];
  for (const { id: condoId } of condos) {
    const hasBuilding = db
      .prepare(`SELECT 1 FROM buildings WHERE condominium_id = ? LIMIT 1`)
      .get(condoId);
    if (hasBuilding) continue;

    const users = db
      .prepare(
        `SELECT id, unit_number, role FROM users WHERE condominium_id = ? AND unit_number IS NOT NULL AND unit_number <> ''`
      )
      .all(condoId) as { id: number; unit_number: string; role: string }[];
    if (users.length === 0) continue;

    // Create a default building
    const buildingRes = db
      .prepare(
        `INSERT INTO buildings (condominium_id, name, floors) VALUES (?, ?, ?)`
      )
      .run(condoId, 'Main Tower', 10);
    const buildingId = Number(buildingRes.lastInsertRowid);

    const insertUnit = db.prepare(
      `INSERT INTO units (building_id, floor, number) VALUES (?, ?, ?) ON CONFLICT(building_id, number) DO NOTHING`
    );
    const findUnit = db.prepare(
      `SELECT id FROM units WHERE building_id = ? AND number = ?`
    );
    const insertLink = db.prepare(
      `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight, move_in_date)
       VALUES (?, ?, 'owner', 'active', 1, 1.0, CURRENT_TIMESTAMP)`
    );

    for (const u of users) {
      // Parse floor: 3-digit "704" → 7, 4-digit "1201" → 12, letter unit "PH-1" → null.
      const digits = u.unit_number.match(/^(\d+)/)?.[1];
      let floor: number | null = null;
      if (digits) {
        if (digits.length === 3) floor = parseInt(digits.slice(0, 1), 10);
        else if (digits.length === 4) floor = parseInt(digits.slice(0, 2), 10);
        else floor = parseInt(digits, 10);
      }
      insertUnit.run(buildingId, floor, u.unit_number);
      const unitRow = findUnit.get(buildingId, u.unit_number) as { id: number } | undefined;
      if (unitRow) insertLink.run(u.id, unitRow.id);
    }
    console.log(`[migrate] backfilled ${users.length} users into buildings/units for condo ${condoId}`);
  }
}

/**
 * Widen proposals.status CHECK to include 'inconclusive' (quorum-not-met).
 * SQLite cannot alter CHECK constraints in place, so we rebuild the table.
 * Idempotent — skips if 'inconclusive' is already accepted.
 */
// Phase 1 — make building_documents.file_url nullable + add a CHECK
// constraint enforcing "file_url OR file_id must be set". The original
// schema enforced file_url NOT NULL because the vault started as a
// link-only catalog; now that admins can upload real files via R2,
// upload-only rows need file_url=NULL (no synthesised internal path).
//
// Idempotent: PRAGMA table_info reports notnull=1 on the legacy
// schema, notnull=0 once migrated. Exits early after the first run.
function migrateDocumentsFileUrlNullable() {
  const cols = db.prepare(`PRAGMA table_info(building_documents)`).all() as Array<{ name: string; notnull: number }>;
  const fileUrlCol = cols.find((c) => c.name === 'file_url');
  if (!fileUrlCol) return;            // table not created yet — initial CREATE will use the new shape
  if (fileUrlCol.notnull === 0) return;  // already migrated

  const foreignKeys = db.pragma('foreign_keys', { simple: true }) as number;
  db.pragma('foreign_keys = OFF');
  try {
    db.exec(`
      CREATE TABLE building_documents_new (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        condominium_id      INTEGER NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
        uploaded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        title               TEXT NOT NULL,
        category            TEXT NOT NULL
          CHECK(category IN ('rules','minutes','contracts','insurance','warranties','receipts','vendors','notices','other')),
        description         TEXT,
        file_url            TEXT,
        file_id             INTEGER REFERENCES files(id) ON DELETE SET NULL,
        document_date       TEXT,
        visibility          TEXT NOT NULL DEFAULT 'residents'
          CHECK(visibility IN ('residents','board_only')),
        active              INTEGER NOT NULL DEFAULT 1,
        created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (file_url IS NOT NULL OR file_id IS NOT NULL)
      );

      INSERT INTO building_documents_new (
        id, condominium_id, uploaded_by_user_id, title, category, description,
        file_url, file_id, document_date, visibility, active, created_at, updated_at
      )
      SELECT
        id, condominium_id, uploaded_by_user_id, title, category, description,
        file_url, file_id, document_date, visibility, active, created_at, updated_at
      FROM building_documents;

      DROP TABLE building_documents;
      ALTER TABLE building_documents_new RENAME TO building_documents;
    `);
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_building_documents_condo_active_category
      ON building_documents(condominium_id, active, category, document_date)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_building_documents_condo_visibility
      ON building_documents(condominium_id, visibility, active, updated_at)`).run();
    console.log('[migrate] relaxed building_documents.file_url to nullable with file_url OR file_id CHECK');
  } finally {
    db.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  }
}

function migrateProposalsInconclusiveStatus() {
  const table = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'proposals'`
  ).get() as { sql: string } | undefined;
  if (!table || table.sql.includes("'inconclusive'")) return;

  const foreignKeys = db.pragma('foreign_keys', { simple: true }) as number;
  db.pragma('foreign_keys = OFF');
  try {
    const cols = db.prepare(`PRAGMA table_info(proposals)`).all() as Array<{ name: string; type: string }>;
    const colNames = cols.map((c) => c.name);

    db.exec(`CREATE TABLE proposals_new (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      condominium_id   INTEGER NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
      author_id        INTEGER NOT NULL REFERENCES users(id),
      title            TEXT NOT NULL,
      description      TEXT NOT NULL,
      category         TEXT,
      estimated_cost   REAL,
      status           TEXT NOT NULL DEFAULT 'discussion'
        CHECK(status IN ('discussion','voting','approved','rejected','completed','inconclusive')),
      source_suggestion_id INTEGER REFERENCES suggestions(id),
      ai_drafted       INTEGER NOT NULL DEFAULT 0,
      ai_summary       TEXT,
      ai_explainer     TEXT,
      decision_summary TEXT,
      quorum_percent   INTEGER NOT NULL DEFAULT 0,
      voting_opens_at  TEXT,
      voting_closes_at TEXT,
      closed_at        TEXT,
      close_reason     TEXT,
      created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`);

    const baseCols = [
      'id','condominium_id','author_id','title','description','category','estimated_cost',
      'status','source_suggestion_id','ai_drafted','ai_summary','ai_explainer',
      'decision_summary','quorum_percent','voting_opens_at','voting_closes_at',
      'closed_at','close_reason','created_at','updated_at',
    ];
    const existingBase = baseCols.filter((c) => colNames.includes(c));
    db.exec(`INSERT INTO proposals_new (${existingBase.join(', ')})
             SELECT ${existingBase.join(', ')} FROM proposals`);
    db.exec(`DROP TABLE proposals`);
    db.exec(`ALTER TABLE proposals_new RENAME TO proposals`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_proposals_condo ON proposals(condominium_id, status)`);
    console.log('[migrate] widened proposals.status CHECK to include inconclusive');
  } finally {
    db.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  }
}

export function initSchema() {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(sql);
  migrateUsersCondoNullable();
  migrateProposalsInconclusiveStatus();
  // Must run AFTER the additive column migrations below so phone +
  // whatsapp_opt_in already exist in the source table.

  // Additive column migrations that SQLite can't express in schema.sql.
  addColumnIfMissing('condominiums', 'invite_code',        `TEXT`);
  // Defense in depth: a collision used to silently route a new condo's
  // joiners at the OLDER condo's units. The route now retries on the
  // application side, but the index guarantees the DB rejects a duplicate
  // even if a future code path forgets. UNIQUE ignores NULL on SQLite,
  // so legacy rows without a code don't conflict.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_condominiums_invite_code ON condominiums(invite_code) WHERE invite_code IS NOT NULL`);
  addColumnIfMissing('condominiums', 'logo_url',           `TEXT`);
  addColumnIfMissing('condominiums', 'voting_model',       `TEXT NOT NULL DEFAULT 'one_per_unit'`);
  addColumnIfMissing('condominiums', 'require_approval',   `INTEGER NOT NULL DEFAULT 1`);
  addColumnIfMissing('condominiums', 'created_by_user_id', `INTEGER REFERENCES users(id)`);
  addColumnIfMissing('condominiums', 'country',            `TEXT NOT NULL DEFAULT 'BR'`);
  addColumnIfMissing('condominiums', 'currency',           `TEXT NOT NULL DEFAULT 'BRL'`);
  addColumnIfMissing('condominiums', 'locale',             `TEXT NOT NULL DEFAULT 'pt-BR'`);
  addColumnIfMissing('condominiums', 'governance_mode',    `TEXT NOT NULL DEFAULT 'brazil_condominium'`);
  // IANA timezone for the building. Used by the agent's after-hours
  // detection so an admin in Acre (UTC-5) doesn't get a 21h-is-late
  // warning at 19h local. Default to São Paulo because the product is
  // Brazil-first, but it's per-condo so a Miami building can override.
  addColumnIfMissing('condominiums', 'timezone',           `TEXT NOT NULL DEFAULT 'America/Sao_Paulo'`);
  // ARC-R5 — Per-condo agent kill switch. When auto_dispatch_enabled
  // is 0, the auto-dispatch gate refuses regardless of confidence /
  // evidence — admin reviews every dispatch manually. Default ON so
  // existing condos aren't disrupted. The agent ITSELF still runs
  // (helping admins draft outreach is still useful); this only gates
  // the automatic WhatsApp send. Toggling the bit is the fastest
  // ops response to "the agent shipped something bad" — no redeploy
  // needed, no env var change, just an SQL flip.
  addColumnIfMissing('condominiums', 'auto_dispatch_enabled', `INTEGER NOT NULL DEFAULT 1`);
  // Voter eligibility on proposals: 'all' (residents + owners), 'owners_only', 'primary_contact_only'
  addColumnIfMissing('proposals',    'voter_eligibility',  `TEXT NOT NULL DEFAULT 'all'`);
  addColumnIfMissing('invites',      'relationship',       `TEXT NOT NULL DEFAULT 'tenant'`);
  addColumnIfMissing('invites',      'primary_contact',    `INTEGER NOT NULL DEFAULT 0`);
  addColumnIfMissing('invites',      'voting_weight',      `REAL NOT NULL DEFAULT 1.0`);
  addColumnIfMissing('invites',      'email_status',       `TEXT`);
  addColumnIfMissing('invites',      'email_sent_at',      `TEXT`);
  addColumnIfMissing('invites',      'email_error',        `TEXT`);
  // Voting compliance — quorum + window
  addColumnIfMissing('proposals',    'quorum_percent',     `INTEGER NOT NULL DEFAULT 0`);
  addColumnIfMissing('proposals',    'voting_opens_at',    `TEXT`);
  addColumnIfMissing('proposals',    'closed_at',          `TEXT`);
  addColumnIfMissing('proposals',    'close_reason',       `TEXT`);
  // Pre-vote cost + risk analysis (#13). cost_breakdown is a list of line
  // items as plaintext (e.g. "Mão de obra: R$ 12.000\nMaterial: R$ 8.000").
  // risk_summary is plaintext too — AI-generated then admin-editable.
  addColumnIfMissing('proposals',    'cost_breakdown',     `TEXT`);
  addColumnIfMissing('proposals',    'risk_summary',       `TEXT`);

  // Budget transparency (#12) — expenses table for outgoing spend. Sebastian's
  // invoices table tracks dues collection (incoming); a separate table avoids
  // mixing the two semantics. Residents read this view-only via /app/transparencia.
  db.exec(`
    CREATE TABLE IF NOT EXISTS expenses (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      condominium_id      INTEGER NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
      amount_cents        INTEGER NOT NULL,
      currency            TEXT NOT NULL DEFAULT 'BRL',
      category            TEXT NOT NULL,
      vendor              TEXT,
      description         TEXT NOT NULL,
      admin_explanation   TEXT,
      spent_at            TEXT NOT NULL,
      receipt_url         TEXT,
      related_proposal_id INTEGER REFERENCES proposals(id) ON DELETE SET NULL,
      created_by_user_id  INTEGER REFERENCES users(id),
      created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_expenses_condo_spent
      ON expenses(condominium_id, spent_at);
    CREATE INDEX IF NOT EXISTS idx_expenses_condo_category
      ON expenses(condominium_id, category, spent_at);
    CREATE INDEX IF NOT EXISTS idx_expenses_condo_vendor_spent
      ON expenses(condominium_id, vendor, spent_at);
  `);
  // AI spend tracking (Phase 1.3) — one row per successful OpenRouter call.
  // Lets the team see token spend forming instead of discovering it via a
  // 402 outage. condominium_id is best-effort (some calls have no condo
  // context) so it's intentionally not a FK.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_usage (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      caller            TEXT NOT NULL,
      model             TEXT NOT NULL,
      prompt_tokens     INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens      INTEGER NOT NULL DEFAULT 0,
      est_cost_usd      REAL NOT NULL DEFAULT 0,
      outcome           TEXT NOT NULL DEFAULT 'ok',
      condominium_id    INTEGER,
      iterations        INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at);
    CREATE INDEX IF NOT EXISTS idx_ai_usage_caller  ON ai_usage(created_at, caller);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS budget_targets (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      condominium_id   INTEGER NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
      month            TEXT NOT NULL CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
      category         TEXT NOT NULL CHECK(category IN (
        'maintenance','utilities','cleaning','security','staff','admin',
        'infrastructure','amenity','insurance','tax','reserve','other'
      )),
      amount_cents     INTEGER NOT NULL CHECK(amount_cents >= 0),
      currency         TEXT NOT NULL DEFAULT 'BRL',
      notes            TEXT,
      created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(condominium_id, month, category)
    );
    CREATE INDEX IF NOT EXISTS idx_budget_targets_condo_month
      ON budget_targets(condominium_id, month);
  `);
  // Operational service network — admin-maintained directory of known vendors,
  // installers, maintenance providers, emergency contacts, and contracts.
  db.exec(`
    CREATE TABLE IF NOT EXISTS service_contacts (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      condominium_id      INTEGER NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
      category            TEXT NOT NULL,
      company_name        TEXT NOT NULL,
      contact_name        TEXT,
      phone               TEXT,
      whatsapp            TEXT,
      email               TEXT,
      website             TEXT,
      address             TEXT,
      service_scope       TEXT,
      notes               TEXT,
      contract_url        TEXT,
      emergency_available INTEGER NOT NULL DEFAULT 0,
      preferred           INTEGER NOT NULL DEFAULT 0,
      active              INTEGER NOT NULL DEFAULT 1,
      last_used_at        TEXT,
      created_by_user_id  INTEGER REFERENCES users(id),
      created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_service_contacts_condo_active_category
      ON service_contacts(condominium_id, active, category, company_name);
    CREATE INDEX IF NOT EXISTS idx_service_contacts_condo_company
      ON service_contacts(condominium_id, company_name);
  `);
  // WhatsApp notifications — phone + opt-in on users
  addColumnIfMissing('users',        'phone',              `TEXT`);
  addColumnIfMissing('users',        'mobile_phone',       `TEXT`);
  addColumnIfMissing('users',        'home_phone',         `TEXT`);
  addColumnIfMissing('users',        'whatsapp_opt_in',    `INTEGER NOT NULL DEFAULT 0`);
  // Explicit JWT revocation. Incremented on logout / forced session reset;
  // requireAuth rejects tokens whose embedded version no longer matches.
  addColumnIfMissing('users',        'token_version',      `INTEGER NOT NULL DEFAULT 0`);
  // Email verification timestamp. NULL = unverified. Set when the user
  // clicks the link in their verify-email message. Used as an audit
  // signal (e.g. AGO vote eligibility); login still works while NULL.
  addColumnIfMissing('users',        'email_verified_at',  `TEXT`);
  // Concierge role (#11) — widen the role CHECK constraint. Done AFTER
  // the columns above so the rebuilt table preserves them.
  migrateUsersRoleConcierge();
  // Account verification for sensitive first-run actions. Added after the
  // concierge table rebuild so legacy role migrations do not drop the columns.
  addColumnIfMissing('users',        'email_verified_at', `TEXT`);
  addColumnIfMissing('users',        'email_verification_sent_at', `TEXT`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash  TEXT NOT NULL UNIQUE,
      expires_at  TEXT NOT NULL,
      used_at     TEXT,
      created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user
      ON email_verification_tokens(user_id, used_at, expires_at);
  `);
  // Party/event reservations: guest count + names list so the porteiro
  // can admit by name when 30 people show up for a Saturday party.
  addColumnIfMissing('amenity_reservations', 'expected_guests', `INTEGER NOT NULL DEFAULT 0`);
  addColumnIfMissing('amenity_reservations', 'guest_list',      `TEXT`);
  addColumnIfMissing('amenity_reservations', 'notes',           `TEXT`);
  addColumnIfMissing('amenity_reservations', 'cancelled_at',    `TEXT`);
  addColumnIfMissing('amenity_reservations', 'cancelled_by_user_id', `INTEGER REFERENCES users(id) ON DELETE SET NULL`);
  addColumnIfMissing('amenity_reservations', 'cancel_reason',   `TEXT`);
  // Visitor parties + recurring access. These are additive so old visitor rows
  // remain valid; party requests are regular guest visits with a names list.
  addColumnIfMissing('visitors', 'expected_guests', `INTEGER NOT NULL DEFAULT 0`);
  addColumnIfMissing('visitors', 'guest_list',      `TEXT`);
  addColumnIfMissing('visitors', 'recurring_days',  `TEXT`);
  addColumnIfMissing('visitors', 'recurring_until', `TEXT`);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_visitors_condo_expected
      ON visitors(condominium_id, expected_at, status);
  `);
  // Admin-configurable amenity reservation slots. Capacity is treated as the
  // max number of people in a slot; legacy rows without guests count as 1.
  addColumnIfMissing('amenities', 'slot_minutes',        `INTEGER NOT NULL DEFAULT 60`);
  addColumnIfMissing('amenities', 'booking_window_days', `INTEGER NOT NULL DEFAULT 14`);
  addColumnIfMissing('amenities', 'active',              `INTEGER NOT NULL DEFAULT 1`);
  addColumnIfMissing('amenities', 'admin_notes',         `TEXT`);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_log_condo_created
      ON audit_log(condominium_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_log_action
      ON audit_log(condominium_id, action, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_log_target
      ON audit_log(condominium_id, target_type, target_id);
  `);

  // In-app notifications power the role-specific command centers. Keep them
  // separate from notification_outbox, which is only external delivery.
  db.exec(`
    CREATE TABLE IF NOT EXISTS in_app_notifications (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      condominium_id   INTEGER NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
      user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source           TEXT NOT NULL DEFAULT 'system'
        CHECK(source IN ('system','visitor','package','finance','ticket','proposal','reservation','concierge')),
      title            TEXT NOT NULL,
      body             TEXT,
      href             TEXT,
      priority         TEXT NOT NULL DEFAULT 'normal'
        CHECK(priority IN ('low','normal','high','urgent')),
      target_type      TEXT,
      target_id        INTEGER,
      status           TEXT NOT NULL DEFAULT 'unread'
        CHECK(status IN ('unread','read','archived')),
      created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      read_at          TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_in_app_notifications_user_status
      ON in_app_notifications(user_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_in_app_notifications_condo_created
      ON in_app_notifications(condominium_id, created_at);
  `);

  // File storage registry. This is intentionally provider-agnostic: local
  // development can store bytes on disk, while production uses Cloudflare R2's
  // S3-compatible API behind the same file IDs.
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      condominium_id      INTEGER NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
      uploaded_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      original_filename   TEXT NOT NULL,
      content_type        TEXT NOT NULL,
      size_bytes          INTEGER NOT NULL,
      storage_driver      TEXT NOT NULL,
      storage_key         TEXT NOT NULL,
      public_url          TEXT,
      purpose             TEXT NOT NULL
        CHECK(purpose IN ('document','receipt','ticket_attachment','work_order','payment_proof','other')),
      visibility          TEXT NOT NULL DEFAULT 'board_only'
        CHECK(visibility IN ('residents','board_only','operations','guard_only')),
      target_type         TEXT,
      target_id           INTEGER,
      status              TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','uploaded','ready','deleted','failed')),
      created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      uploaded_at         TEXT,
      deleted_at          TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_files_storage_key
      ON files(storage_driver, storage_key);
    CREATE INDEX IF NOT EXISTS idx_files_condo_status
      ON files(condominium_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_files_target
      ON files(target_type, target_id, status);
    CREATE INDEX IF NOT EXISTS idx_files_uploader
      ON files(uploaded_by_user_id, status, created_at);
  `);

  addColumnIfMissing('expenses', 'receipt_file_id', `INTEGER REFERENCES files(id) ON DELETE SET NULL`);
  addColumnIfMissing('expenses', 'admin_explanation', `TEXT`);

  // Resident payment proofs — residents upload transfer receipts/screenshots;
  // admins review them before they become real payment records.
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_proofs (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      condominium_id      INTEGER NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
      invoice_id          INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      resident_user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      file_id             INTEGER NOT NULL REFERENCES files(id) ON DELETE RESTRICT,
      amount_cents        INTEGER NOT NULL,
      method              TEXT NOT NULL DEFAULT 'transfer',
      reference           TEXT,
      note                TEXT,
      status              TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','approved','rejected')),
      reviewed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at         TEXT,
      rejection_reason    TEXT,
      payment_id          INTEGER REFERENCES payments(id) ON DELETE SET NULL,
      created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_payment_proofs_condo_status
      ON payment_proofs(condominium_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_payment_proofs_invoice
      ON payment_proofs(invoice_id, status);
    CREATE INDEX IF NOT EXISTS idx_payment_proofs_resident
      ON payment_proofs(resident_user_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_proofs_file
      ON payment_proofs(file_id);
  `);

  migrateLegacyUnits();

  // Incident Loop (Phase 1) — community-verified tickets that auto-route to
  // the admin AI agent. Additive columns + a verifications table; the base
  // `tickets` schema is unchanged so existing private tickets keep working.
  // A ticket is "community-visible" when verification_threshold > 0.
  addColumnIfMissing('tickets', 'verification_threshold', `INTEGER NOT NULL DEFAULT 0`);
  addColumnIfMissing('tickets', 'verification_count',     `INTEGER NOT NULL DEFAULT 0`);
  addColumnIfMissing('tickets', 'denial_count',           `INTEGER NOT NULL DEFAULT 0`);
  addColumnIfMissing('tickets', 'verified_at',            `TEXT`);
  addColumnIfMissing('tickets', 'verified_by_user_id',    `INTEGER REFERENCES users(id)`);
  // remediation_status walks: open → verified → agent_dispatched →
  // awaiting_vendor → vendor_engaged → blocked_needs_admin → resolved.
  // The existing `status` column tracks the lifecycle handle that admins
  // close manually; remediation_status tracks the auto-pipeline state.
  addColumnIfMissing('tickets', 'remediation_status',     `TEXT NOT NULL DEFAULT 'open'`);
  addColumnIfMissing('tickets', 'blocked_reason',         `TEXT`);
  // agent_plan is the most recent JSON response from /api/ai/admin-agent —
  // stored as text so the admin can review it without re-running the model.
  addColumnIfMissing('tickets', 'agent_plan',             `TEXT`);
  addColumnIfMissing('tickets', 'agent_run_at',           `TEXT`);
  db.prepare(`
    CREATE TABLE IF NOT EXISTS ticket_verifications (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      vote        TEXT NOT NULL CHECK(vote IN ('confirm','deny')),
      comment     TEXT,
      created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(ticket_id, user_id)
    )
  `).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_ticket_verifications_ticket ON ticket_verifications(ticket_id)`).run();
  // Phase 4 operations — canonical ticket timeline. Older UI synthesized
  // progress from tickets/dispatches/work_orders; this table becomes the
  // durable audit trail residents and admins can read without leaking
  // admin-only vendor notes.
  db.prepare(`
    CREATE TABLE IF NOT EXISTS ticket_events (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id        INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      condominium_id   INTEGER NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
      actor_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      event_type       TEXT NOT NULL,
      title            TEXT NOT NULL,
      body             TEXT,
      metadata_json    TEXT,
      visibility       TEXT NOT NULL DEFAULT 'resident'
        CHECK(visibility IN ('resident','admin')),
      created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket
    ON ticket_events(ticket_id, created_at, id)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_ticket_events_condo
    ON ticket_events(condominium_id, created_at, id)`).run();
  // Phase 2 — audit trail of every vendor contact attempt the AI agent or
  // an admin makes on behalf of a verified ticket. outbox_id ties back to
  // the actual queued notification (whatsapp/email) so we can follow up on
  // delivery status; channel='manual' covers offline contacts (phone call,
  // in-person) that the admin records by hand.
  db.prepare(`
    CREATE TABLE IF NOT EXISTS ticket_dispatches (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id             INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      service_contact_id    INTEGER REFERENCES service_contacts(id) ON DELETE SET NULL,
      channel               TEXT NOT NULL CHECK(channel IN ('whatsapp','email','manual')),
      outbox_id             INTEGER REFERENCES notification_outbox(id) ON DELETE SET NULL,
      message_body          TEXT NOT NULL,
      status                TEXT NOT NULL DEFAULT 'queued'
        CHECK(status IN ('queued','sent','failed','responded','cancelled')),
      dispatched_by_user_id INTEGER REFERENCES users(id),
      created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      responded_at          TEXT,
      response_summary      TEXT
    )
  `).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_ticket_dispatches_ticket ON ticket_dispatches(ticket_id, created_at)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_ticket_dispatches_service_contact
    ON ticket_dispatches(service_contact_id, channel, status, created_at)`).run();
  // Roadmap item 3 — veto window on auto-dispatch. When the agent
  // auto-fires a vendor outreach on a verified ticket, we don't send
  // immediately: notification_outbox.next_attempt_at gets set to +5min,
  // and ticket_dispatches.scheduled_send_after tracks the same time so
  // the UI can show a countdown + cancel button. Admin presses cancel:
  // ticket_dispatch.status='cancelled', outbox row flipped to status
  // ='skipped' with reason='admin_cancelled' before the worker fires.
  // Urgent + safety-critical tickets skip the window entirely (send_after
  // set to NULL so the worker picks it up on the next tick).
  addColumnIfMissing('ticket_dispatches', 'scheduled_send_after', `TEXT`);
  addColumnIfMissing('ticket_dispatches', 'cancellation_reason',  `TEXT`);
  addColumnIfMissing('ticket_dispatches', 'cancelled_by_user_id', `INTEGER REFERENCES users(id)`);
  addColumnIfMissing('ticket_dispatches', 'cancelled_at',         `TEXT`);
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_ticket_dispatches_scheduled
    ON ticket_dispatches(scheduled_send_after) WHERE scheduled_send_after IS NOT NULL`).run();
  // COR-M7 — Prevent double-dispatch races on concurrent verification.
  // Two board admins verifying the same ticket within ~200ms could
  // each pass the `SELECT existingDispatch` guard (which runs outside
  // a transaction earlier in the path) and both INSERT a queued
  // dispatch, sending the vendor two WhatsApp messages. The unique
  // index is restricted to status='queued' specifically — once a
  // dispatch transitions to sent/responded, a follow-up dispatch on
  // a different channel (e.g. email after WhatsApp) is legitimate
  // and must not be blocked. The dispatch transaction (ARC-R3)
  // wraps everything that follows so a unique-violation rolls back
  // the whole sequence cleanly.
  // Drop the previous attempt at this index (too strict — blocked
  // legitimate multi-channel follow-up dispatches). Safe to leave the
  // DROP in place forever since it's idempotent.
  db.prepare(`DROP INDEX IF EXISTS idx_ticket_dispatches_active_unique`).run();
  db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_dispatches_queued_unique
    ON ticket_dispatches(ticket_id, service_contact_id)
    WHERE status = 'queued'`).run();

  // ARC-R2 — Agent dispatch queue. Replaces the fire-and-forget IIFE
  // in dispatchAgentInBackground with a durable row + worker. Surviving
  // a process crash mid-dispatch is the main win: the IIFE used to drop
  // the work entirely on Fly redeploy, OOM, or panic. Multi-machine
  // support comes free — the SELECT+UPDATE-to-claim pattern works for
  // one writer today and N writers when we move to Postgres.
  //
  // Status walks: queued → claimed → done (or failed). The reaper
  // (lib/agent-dispatch-queue.ts) transitions 'claimed' rows older than
  // 5 minutes to 'failed' for retry. Idempotency for "the same ticket
  // got verified twice in a second" comes from the partial unique
  // index below — only one queued/claimed row per ticket at a time.
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_dispatch_queue (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id            INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      condominium_id       INTEGER NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
      triggered_by_user_id INTEGER REFERENCES users(id),
      locale               TEXT,
      status               TEXT NOT NULL DEFAULT 'queued'
                             CHECK (status IN ('queued','claimed','done','failed')),
      claimed_at           TEXT,
      claimed_by           TEXT,
      attempt_count        INTEGER NOT NULL DEFAULT 0,
      last_error           TEXT,
      created_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at          TEXT
    )
  `);
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_agent_dispatch_queue_drain
    ON agent_dispatch_queue(status, created_at) WHERE status = 'queued'`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_agent_dispatch_queue_reaper
    ON agent_dispatch_queue(status, claimed_at) WHERE status = 'claimed'`).run();
  // Idempotency — a ticket can't have two active queue entries. If the
  // verify-and-enqueue path fires twice within a heartbeat, the second
  // INSERT fails the unique constraint and the caller no-ops cleanly.
  db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_dispatch_queue_active_ticket
    ON agent_dispatch_queue(ticket_id) WHERE status IN ('queued','claimed')`).run();
  // Roadmap item 6 — image / document understanding. When residents
  // upload a photo of a leak, the model can SEE it instead of asking
  // for a written description. Same for vendor PDF quotes and contract
  // scans. Analysis is cached per-attachment so repeat agent runs on
  // the same ticket don't re-pay for vision tokens.
  //   ai_description       — short factual caption ("Vazamento sob a pia
  //                           da cozinha, gota visível no sifão")
  //   ai_signals           — structured tags the prompt can branch on
  //                           ("water_damage, urgency_low, no_visible_mold")
  //   ai_analyzed_at       — timestamp; null means "never analyzed"
  //   ai_analysis_error    — last error code if analysis failed
  addColumnIfMissing('ticket_attachments', 'ai_description',    `TEXT`);
  addColumnIfMissing('ticket_attachments', 'ai_signals',        `TEXT`);
  addColumnIfMissing('ticket_attachments', 'ai_analyzed_at',    `TEXT`);
  addColumnIfMissing('ticket_attachments', 'ai_analysis_error', `TEXT`);
  addColumnIfMissing('ticket_attachments', 'file_id',           `INTEGER REFERENCES files(id) ON DELETE SET NULL`);

  // Phase 2 operations — once a vendor responds, the admin needs a real
  // work order: scheduled visit, estimate, invoice/photo evidence, and
  // completion note. Keep this one-to-one with a ticket for now so the UI
  // stays simple; dispatches still preserve every vendor contact attempt.
  db.prepare(`
    CREATE TABLE IF NOT EXISTS ticket_work_orders (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id               INTEGER NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE CASCADE,
      service_contact_id      INTEGER REFERENCES service_contacts(id) ON DELETE SET NULL,
      title                   TEXT NOT NULL,
      scope                   TEXT,
      status                  TEXT NOT NULL DEFAULT 'scheduled'
        CHECK(status IN ('draft','scheduled','in_progress','completed','cancelled')),
      estimated_amount_cents  INTEGER,
      approved_amount_cents   INTEGER,
      scheduled_for           TEXT,
      started_at              TEXT,
      completed_at            TEXT,
      invoice_url             TEXT,
      invoice_file_id         INTEGER REFERENCES files(id) ON DELETE SET NULL,
      photo_url               TEXT,
      photo_file_id           INTEGER REFERENCES files(id) ON DELETE SET NULL,
      completion_note         TEXT,
      created_by_user_id      INTEGER REFERENCES users(id),
      updated_by_user_id      INTEGER REFERENCES users(id),
      created_at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_ticket_work_orders_ticket ON ticket_work_orders(ticket_id, status)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_ticket_work_orders_vendor ON ticket_work_orders(service_contact_id, status)`).run();
  addColumnIfMissing('ticket_work_orders', 'invoice_file_id', `INTEGER REFERENCES files(id) ON DELETE SET NULL`);
  addColumnIfMissing('ticket_work_orders', 'photo_file_id',   `INTEGER REFERENCES files(id) ON DELETE SET NULL`);

  // Phase 4 operations — comparable vendor quotes before a work order is
  // approved. Quotes stay admin-only until the board turns the selected
  // option into a public work order/proposal, avoiding resident leakage of
  // private negotiations while still preserving an audit trail.
  db.prepare(`
    CREATE TABLE IF NOT EXISTS ticket_vendor_quotes (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id               INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      condominium_id          INTEGER NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
      service_contact_id      INTEGER REFERENCES service_contacts(id) ON DELETE SET NULL,
      vendor_name             TEXT NOT NULL,
      quote_amount_cents      INTEGER,
      currency                TEXT NOT NULL DEFAULT 'BRL',
      availability            TEXT,
      warranty                TEXT,
      notes                   TEXT,
      attachment_url          TEXT,
      attachment_file_id      INTEGER REFERENCES files(id) ON DELETE SET NULL,
      status                  TEXT NOT NULL DEFAULT 'received'
        CHECK(status IN ('received','shortlisted','selected','rejected')),
      created_by_user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_ticket_vendor_quotes_ticket ON ticket_vendor_quotes(ticket_id, status, quote_amount_cents)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_ticket_vendor_quotes_condo ON ticket_vendor_quotes(condominium_id, created_at)`).run();

  // Document Vault — a lightweight, storage-provider-agnostic registry for
  // bylaws, meeting minutes, contracts, insurance, warranties, receipts, and
  // vendor docs. Stores secure document links for now; file storage can attach
  // behind the same table later without changing resident/admin flows.
  db.prepare(`
    CREATE TABLE IF NOT EXISTS building_documents (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      condominium_id      INTEGER NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
      uploaded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      title               TEXT NOT NULL,
      category            TEXT NOT NULL
        CHECK(category IN ('rules','minutes','contracts','insurance','warranties','receipts','vendors','notices','other')),
      description         TEXT,
      file_url            TEXT,
      file_id             INTEGER REFERENCES files(id) ON DELETE SET NULL,
      document_date       TEXT,
      visibility          TEXT NOT NULL DEFAULT 'residents'
        CHECK(visibility IN ('residents','board_only')),
      active              INTEGER NOT NULL DEFAULT 1,
      created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (file_url IS NOT NULL OR file_id IS NOT NULL)
    )
  `).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_building_documents_condo_active_category
    ON building_documents(condominium_id, active, category, document_date)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_building_documents_condo_visibility
    ON building_documents(condominium_id, visibility, active, updated_at)`).run();
  addColumnIfMissing('building_documents', 'file_id', `INTEGER REFERENCES files(id) ON DELETE SET NULL`);
  // Phase 1 — Relax existing DBs to match the new shape (nullable
  // file_url + CHECK). Idempotent: short-circuits when notnull=0.
  migrateDocumentsFileUrlNullable();

  // Roadmap item 2 — conversational thread. The agent workbench was
  // single-shot: every query was a fresh agent call with no memory of
  // what the admin asked five minutes ago. These tables let the runner
  // carry prior turns into the prompt context so the admin can refine
  // ("first vendor said booked, try next"), ask follow-ups ("what about
  // cost?"), or push back ("I think it's a building-wide issue") without
  // re-explaining context every time.
  db.prepare(`
    CREATE TABLE IF NOT EXISTS agent_threads (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      condominium_id  INTEGER NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
      admin_user_id   INTEGER NOT NULL REFERENCES users(id),
      title           TEXT,
      mode            TEXT,
      status          TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active','archived')),
      created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_agent_threads_admin ON agent_threads(admin_user_id, status, updated_at)`).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS agent_turns (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id     INTEGER NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
      turn_index    INTEGER NOT NULL,
      user_task     TEXT NOT NULL,
      agent_summary TEXT,
      agent_plan    TEXT,
      fallback      INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_agent_turns_thread ON agent_turns(thread_id, turn_index)`).run();

  // Agent V2 observability. Every admin-agent invocation gets a durable
  // run row so background ticket calls, workbench chats, fallbacks and
  // failures are auditable without scraping logs.
  db.prepare(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      condominium_id  INTEGER NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
      admin_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      thread_id       INTEGER REFERENCES agent_threads(id) ON DELETE SET NULL,
      ticket_id       INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
      mode            TEXT,
      task            TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'running'
        CHECK(status IN ('running','succeeded','failed')),
      attempt_count   INTEGER NOT NULL DEFAULT 1,
      fallback        INTEGER NOT NULL DEFAULT 0,
      model           TEXT,
      react_enabled   INTEGER NOT NULL DEFAULT 0,
      duration_ms     INTEGER,
      plan_json       TEXT,
      trace_json      TEXT,
      last_error      TEXT,
      started_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at     TEXT,
      created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_agent_runs_condo_status ON agent_runs(condominium_id, status, created_at)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_agent_runs_ticket ON agent_runs(ticket_id, created_at)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_agent_runs_thread ON agent_runs(thread_id, created_at)`).run();
  // Live thinking-trace support — the runner writes incremental
  // progress to progress_json as each ReAct tool fires, so the UI can
  // poll and show "checking past tickets... pulled Otis history..."
  // instead of a 30-55s spinner. Schema: JSON array of {at, label,
  // detail?} entries, monotonically growing until status≠running.
  addColumnIfMissing('agent_runs', 'progress_json', `TEXT`);

  // Ensure Pine Ridge has an invite code so the demo condo is joinable via code too.
  const pine = db.prepare(`SELECT id, invite_code FROM condominiums LIMIT 1`).get() as
    | { id: number; invite_code: string | null }
    | undefined;
  if (pine && !pine.invite_code) {
    const code = 'DEMO' + Math.floor(100 + Math.random() * 900);
    db.prepare(`UPDATE condominiums SET invite_code = ? WHERE id = ?`).run(code, pine.id);
    console.log(`[migrate] assigned invite_code ${code} to condo ${pine.id}`);
  }
}

initSchema();

export default db;
