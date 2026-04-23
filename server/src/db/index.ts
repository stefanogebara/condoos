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

export function initSchema() {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(sql);
  migrateUsersCondoNullable();

  // Additive column migrations that SQLite can't express in schema.sql.
  addColumnIfMissing('condominiums', 'invite_code',        `TEXT`);
  addColumnIfMissing('condominiums', 'logo_url',           `TEXT`);
  addColumnIfMissing('condominiums', 'voting_model',       `TEXT NOT NULL DEFAULT 'one_per_unit'`);
  addColumnIfMissing('condominiums', 'require_approval',   `INTEGER NOT NULL DEFAULT 1`);
  addColumnIfMissing('condominiums', 'created_by_user_id', `INTEGER REFERENCES users(id)`);
  // Voter eligibility on proposals: 'all' (residents + owners), 'owners_only', 'primary_contact_only'
  addColumnIfMissing('proposals',    'voter_eligibility',  `TEXT NOT NULL DEFAULT 'all'`);
  addColumnIfMissing('invites',      'relationship',       `TEXT NOT NULL DEFAULT 'tenant'`);
  addColumnIfMissing('invites',      'primary_contact',    `INTEGER NOT NULL DEFAULT 0`);
  addColumnIfMissing('invites',      'voting_weight',      `REAL NOT NULL DEFAULT 1.0`);

  migrateLegacyUnits();

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
