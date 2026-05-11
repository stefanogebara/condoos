// One-shot cleanup of E2E test pollution. Run on Fly via:
//   flyctl ssh console -a condoos-api -C "node /app/scripts/cleanup-test-pollution.js"
// Idempotent: deletes records whose titles/emails/body match well-known
// E2E patterns. Safe to re-run.
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || '/data/condoos.sqlite';
const db = new Database(DB_PATH);

// 2026-05 audit (round 2): extended further with patterns the fresh-eyes
// audit found still rendering in prod after the first cleanup. Patterns
// stay tightly scoped so a real resident-authored row can never match
// (no real condo would title a proposal "audit dup test" or a package
// description "WAHA live test").
const propWhere = "(title LIKE 'Isolation probe%' OR title LIKE 'E2E %' OR title LIKE 'walkthrough %' OR title LIKE 'UI compliance%' OR title LIKE 'Vote-closer%' OR title LIKE 'PROD_E2E%' OR title LIKE '%Cost gate test%' OR title LIKE '%Prod maintenance%' OR title = 'desc' OR title LIKE 'audit dup test%' OR description LIKE 'audit dup test%')";
const asmWhere  = "(title LIKE 'Canary AGO%' OR title LIKE 'walkthrough %' OR title LIKE 'E2E %' OR title LIKE 'AGO 2026 Smoke%')";
const meetingWhere = "(title LIKE 'E2E %' OR title LIKE 'walkthrough %')";
const inviteWhere = "(email LIKE 'e2e-%@example.com' OR email LIKE 'e2e+%@condoos.test')";
const suggestionWhere = "(body LIKE 'E2E %' OR body LIKE 'A iluminação do hall do 3º andar fica piscando%')";
const visitorWhere = "(visitor_name LIKE 'E2E %' OR visitor_name LIKE 'PROD_E2E%' OR visitor_name LIKE 'walkthrough %' OR visitor_name LIKE 'Prod Pre-approved%' OR visitor_name LIKE 'Prod maintenance test%')";
// Tickets (Incident Loop) — Playwright walks accidentally seeded ~10
// "Lights in lobby" duplicates plus a mojibake-titled "Fast-track test"
// row. Scrub them by title pattern. Patterns chosen so a real resident-
// reported issue ("Elevador A travando…") would never match.
const ticketWhere = "(title LIKE 'Lights in lobby are not working%' OR title LIKE 'Fast-track test%' OR title LIKE 'Playwright walk%' OR title LIKE 'Playwright test%' OR title LIKE 'UX fast-track%' OR title LIKE 'UX walk%' OR title LIKE 'Round2 picker test%' OR title LIKE 'walkthrough %' OR title LIKE 'E2E %' OR description LIKE 'Playwright%' OR description LIKE 'UX walk%')";
const announcementWhere = "(title LIKE 'E2E %' OR title LIKE 'PROD_E2E%' OR title LIKE 'walkthrough %')";
const packageWhere = "(description LIKE 'WAHA live test%' OR description LIKE 'CondoOS production notification test%' OR description LIKE 'E2E %' OR description LIKE 'PROD_E2E%' OR carrier LIKE 'E2E %')";
const expenseWhere = "(description LIKE 'audit dup test%' OR description LIKE 'E2E %' OR description LIKE 'PROD_E2E%' OR vendor LIKE 'E2E %')";

const propBefore = db.prepare('SELECT COUNT(*) AS c FROM proposals').get().c;
const asmBefore  = db.prepare('SELECT COUNT(*) AS c FROM assemblies').get().c;
const meetingBefore = db.prepare('SELECT COUNT(*) AS c FROM meetings').get().c;
const inviteBefore = db.prepare('SELECT COUNT(*) AS c FROM invites').get().c;
const suggestionBefore = db.prepare('SELECT COUNT(*) AS c FROM suggestions').get().c;
const visitorBefore = db.prepare('SELECT COUNT(*) AS c FROM visitors').get().c;
const ticketBefore = db.prepare('SELECT COUNT(*) AS c FROM tickets').get().c;
const announcementBefore = db.prepare('SELECT COUNT(*) AS c FROM announcements').get().c;
const packageBefore = db.prepare('SELECT COUNT(*) AS c FROM packages').get().c;
const expenseTableExists = !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='expenses'`).get();
const expenseBefore = expenseTableExists ? db.prepare('SELECT COUNT(*) AS c FROM expenses').get().c : 0;

db.prepare('DELETE FROM proposal_votes    WHERE proposal_id IN (SELECT id FROM proposals WHERE ' + propWhere + ')').run();
db.prepare('DELETE FROM proposal_comments WHERE proposal_id IN (SELECT id FROM proposals WHERE ' + propWhere + ')').run();
// Cousin tables that hold FKs to proposals — null out or delete to keep FK constraints satisfied.
db.prepare('DELETE FROM announcements WHERE related_proposal_id IN (SELECT id FROM proposals WHERE ' + propWhere + ')').run();
db.prepare('UPDATE suggestions SET promoted_proposal_id = NULL WHERE promoted_proposal_id IN (SELECT id FROM proposals WHERE ' + propWhere + ')').run();
db.prepare('DELETE FROM action_items WHERE proposal_id IN (SELECT id FROM proposals WHERE ' + propWhere + ')').run();
db.prepare('UPDATE assembly_agenda_items SET source_proposal_id = NULL WHERE source_proposal_id IN (SELECT id FROM proposals WHERE ' + propWhere + ')').run();
const propRes = db.prepare('DELETE FROM proposals WHERE ' + propWhere).run();

db.prepare('DELETE FROM assembly_votes        WHERE assembly_id IN (SELECT id FROM assemblies WHERE ' + asmWhere + ')').run();
db.prepare('DELETE FROM assembly_proxies      WHERE assembly_id IN (SELECT id FROM assemblies WHERE ' + asmWhere + ')').run();
db.prepare('DELETE FROM assembly_attendance   WHERE assembly_id IN (SELECT id FROM assemblies WHERE ' + asmWhere + ')').run();
db.prepare('DELETE FROM assembly_agenda_items WHERE assembly_id IN (SELECT id FROM assemblies WHERE ' + asmWhere + ')').run();
const asmRes  = db.prepare('DELETE FROM assemblies WHERE ' + asmWhere).run();

db.prepare('DELETE FROM action_items WHERE meeting_id IN (SELECT id FROM meetings WHERE ' + meetingWhere + ')').run();
const meetingRes = db.prepare('DELETE FROM meetings WHERE ' + meetingWhere).run();

const inviteRes = db.prepare('DELETE FROM invites WHERE ' + inviteWhere).run();

db.prepare('UPDATE proposals SET source_suggestion_id = NULL WHERE source_suggestion_id IN (SELECT id FROM suggestions WHERE ' + suggestionWhere + ')').run();
const suggestionRes = db.prepare('DELETE FROM suggestions WHERE ' + suggestionWhere).run();

const visitorRes = db.prepare('DELETE FROM visitors WHERE ' + visitorWhere).run();
// Tickets — cascade order: verifications + dispatches + comments + attachments first,
// then the tickets themselves. notification_outbox rows referenced by dispatches keep
// existing (audit trail). Idempotent via the same title-pattern guard.
const ticketIdsRow = db.prepare('SELECT id FROM tickets WHERE ' + ticketWhere).all();
const ticketIdsToWipe = ticketIdsRow.map((r) => r.id);
let ticketRes = { changes: 0 };
if (ticketIdsToWipe.length > 0) {
  const placeholders = ticketIdsToWipe.map(() => '?').join(',');
  // Only attempt if the cascaded tables exist (defensive — these were all
  // added by Incident Loop Phase 1/2 and may be missing on older DBs).
  function tableExistsLocal(name) {
    return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  }
  if (tableExistsLocal('ticket_verifications')) {
    db.prepare(`DELETE FROM ticket_verifications WHERE ticket_id IN (${placeholders})`).run(...ticketIdsToWipe);
  }
  if (tableExistsLocal('ticket_dispatches')) {
    db.prepare(`DELETE FROM ticket_dispatches WHERE ticket_id IN (${placeholders})`).run(...ticketIdsToWipe);
  }
  if (tableExistsLocal('ticket_comments')) {
    db.prepare(`DELETE FROM ticket_comments WHERE ticket_id IN (${placeholders})`).run(...ticketIdsToWipe);
  }
  if (tableExistsLocal('ticket_attachments')) {
    db.prepare(`DELETE FROM ticket_attachments WHERE ticket_id IN (${placeholders})`).run(...ticketIdsToWipe);
  }
  ticketRes = db.prepare(`DELETE FROM tickets WHERE id IN (${placeholders})`).run(...ticketIdsToWipe);
}
const announcementRes = db.prepare('DELETE FROM announcements WHERE ' + announcementWhere).run();
const packageRes = db.prepare('DELETE FROM packages WHERE ' + packageWhere).run();
const expenseRes = expenseTableExists
  ? db.prepare('DELETE FROM expenses WHERE ' + expenseWhere).run()
  : { changes: 0 };

const propAfter = db.prepare('SELECT COUNT(*) AS c FROM proposals').get().c;
const asmAfter  = db.prepare('SELECT COUNT(*) AS c FROM assemblies').get().c;
const meetingAfter = db.prepare('SELECT COUNT(*) AS c FROM meetings').get().c;
const inviteAfter = db.prepare('SELECT COUNT(*) AS c FROM invites').get().c;
const suggestionAfter = db.prepare('SELECT COUNT(*) AS c FROM suggestions').get().c;
const visitorAfter = db.prepare('SELECT COUNT(*) AS c FROM visitors').get().c;
const announcementAfter = db.prepare('SELECT COUNT(*) AS c FROM announcements').get().c;
const packageAfter = db.prepare('SELECT COUNT(*) AS c FROM packages').get().c;
const expenseAfter = expenseTableExists ? db.prepare('SELECT COUNT(*) AS c FROM expenses').get().c : 0;

console.log('[cleanup] proposals: ' + propBefore + ' → ' + propAfter + ' (deleted ' + propRes.changes + ')');
console.log('[cleanup] assemblies: ' + asmBefore + ' → ' + asmAfter + ' (deleted ' + asmRes.changes + ')');
console.log('[cleanup] meetings: ' + meetingBefore + ' → ' + meetingAfter + ' (deleted ' + meetingRes.changes + ')');
console.log('[cleanup] invites: ' + inviteBefore + ' → ' + inviteAfter + ' (deleted ' + inviteRes.changes + ')');
console.log('[cleanup] suggestions: ' + suggestionBefore + ' → ' + suggestionAfter + ' (deleted ' + suggestionRes.changes + ')');
console.log('[cleanup] visitors: ' + visitorBefore + ' → ' + visitorAfter + ' (deleted ' + visitorRes.changes + ')');
const ticketAfter = db.prepare('SELECT COUNT(*) AS c FROM tickets').get().c;
console.log('[cleanup] tickets: ' + ticketBefore + ' → ' + ticketAfter + ' (deleted ' + ticketRes.changes + ')');
console.log('[cleanup] announcements: ' + announcementBefore + ' → ' + announcementAfter + ' (deleted ' + announcementRes.changes + ')');
console.log('[cleanup] packages: ' + packageBefore + ' → ' + packageAfter + ' (deleted ' + packageRes.changes + ')');
if (expenseTableExists) {
  console.log('[cleanup] expenses: ' + expenseBefore + ' → ' + expenseAfter + ' (deleted ' + expenseRes.changes + ')');
}

// E2E onboarding artifacts — condos created by the create-building wizard test
// and users created by /auth/dev-register. Safe to delete: real users never
// have an "e2e+" prefix and real condos never start with "E2E ".
const condoBefore = db.prepare('SELECT COUNT(*) AS c FROM condominiums').get().c;
const userBefore  = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;

const e2eCondoIds = db.prepare("SELECT id FROM condominiums WHERE name LIKE 'E2E %'").all().map((r) => r.id);
const e2eUserIds  = db.prepare("SELECT id FROM users WHERE email LIKE 'e2e+%@condoos.test'").all().map((r) => r.id);

// audit_log was added by the cofounder backend track and references both
// users(id) and condominiums(id). Strip rows for our E2E artifacts before
// the parent deletions, otherwise FK constraints reject the wipe.
function tableExists(name) {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
}

if (e2eCondoIds.length > 0) {
  const placeholders = e2eCondoIds.map(() => '?').join(',');
  if (tableExists('audit_log')) {
    db.prepare(`DELETE FROM audit_log WHERE condominium_id IN (${placeholders})`).run(...e2eCondoIds);
  }
  // Cascade: kill anything that references these condos before nuking the condos themselves.
  db.prepare(`DELETE FROM amenity_reservations WHERE amenity_id IN (SELECT id FROM amenities WHERE condominium_id IN (${placeholders}))`).run(...e2eCondoIds);
  db.prepare(`DELETE FROM amenities WHERE condominium_id IN (${placeholders})`).run(...e2eCondoIds);
  db.prepare(`DELETE FROM user_unit WHERE unit_id IN (SELECT u.id FROM units u JOIN buildings b ON b.id = u.building_id WHERE b.condominium_id IN (${placeholders}))`).run(...e2eCondoIds);
  db.prepare(`DELETE FROM units WHERE building_id IN (SELECT id FROM buildings WHERE condominium_id IN (${placeholders}))`).run(...e2eCondoIds);
  db.prepare(`DELETE FROM buildings WHERE condominium_id IN (${placeholders})`).run(...e2eCondoIds);
  db.prepare(`DELETE FROM condominiums WHERE id IN (${placeholders})`).run(...e2eCondoIds);
}

if (e2eUserIds.length > 0) {
  const placeholders = e2eUserIds.map(() => '?').join(',');
  if (tableExists('audit_log')) {
    db.prepare(`DELETE FROM audit_log WHERE actor_user_id IN (${placeholders})`).run(...e2eUserIds);
  }
  db.prepare(`DELETE FROM user_unit WHERE user_id IN (${placeholders})`).run(...e2eUserIds);
  db.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).run(...e2eUserIds);
}

const condoAfter = db.prepare('SELECT COUNT(*) AS c FROM condominiums').get().c;
const userAfter  = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
console.log('[cleanup] condominiums: ' + condoBefore + ' → ' + condoAfter + ' (deleted ' + e2eCondoIds.length + ')');
console.log('[cleanup] users: ' + userBefore + ' → ' + userAfter + ' (deleted ' + e2eUserIds.length + ')');
