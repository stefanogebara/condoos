// One-shot cleanup of E2E test pollution. Run on Fly via:
//   flyctl ssh console -a condoos-api -C "node /app/scripts/cleanup-test-pollution.js"
// Idempotent: deletes records whose titles/emails/body match well-known
// E2E patterns. Safe to re-run.
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || '/data/condoos.sqlite';
const db = new Database(DB_PATH);

const propWhere = "(title LIKE 'Isolation probe%' OR title LIKE 'E2E %' OR title LIKE 'walkthrough %' OR title LIKE 'UI compliance%' OR title LIKE 'Vote-closer%')";
const asmWhere  = "(title LIKE 'Canary AGO%' OR title LIKE 'walkthrough %' OR title LIKE 'E2E %')";
const meetingWhere = "(title LIKE 'E2E %' OR title LIKE 'walkthrough %')";
const inviteWhere = "(email LIKE 'e2e-%@example.com' OR email LIKE 'e2e+%@condoos.test')";
const suggestionWhere = "(body LIKE 'A iluminação do hall do 3º andar fica piscando%')";

const propBefore = db.prepare('SELECT COUNT(*) AS c FROM proposals').get().c;
const asmBefore  = db.prepare('SELECT COUNT(*) AS c FROM assemblies').get().c;
const meetingBefore = db.prepare('SELECT COUNT(*) AS c FROM meetings').get().c;
const inviteBefore = db.prepare('SELECT COUNT(*) AS c FROM invites').get().c;
const suggestionBefore = db.prepare('SELECT COUNT(*) AS c FROM suggestions').get().c;

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

const propAfter = db.prepare('SELECT COUNT(*) AS c FROM proposals').get().c;
const asmAfter  = db.prepare('SELECT COUNT(*) AS c FROM assemblies').get().c;
const meetingAfter = db.prepare('SELECT COUNT(*) AS c FROM meetings').get().c;
const inviteAfter = db.prepare('SELECT COUNT(*) AS c FROM invites').get().c;
const suggestionAfter = db.prepare('SELECT COUNT(*) AS c FROM suggestions').get().c;

console.log('[cleanup] proposals: ' + propBefore + ' → ' + propAfter + ' (deleted ' + propRes.changes + ')');
console.log('[cleanup] assemblies: ' + asmBefore + ' → ' + asmAfter + ' (deleted ' + asmRes.changes + ')');
console.log('[cleanup] meetings: ' + meetingBefore + ' → ' + meetingAfter + ' (deleted ' + meetingRes.changes + ')');
console.log('[cleanup] invites: ' + inviteBefore + ' → ' + inviteAfter + ' (deleted ' + inviteRes.changes + ')');
console.log('[cleanup] suggestions: ' + suggestionBefore + ' → ' + suggestionAfter + ' (deleted ' + suggestionRes.changes + ')');

// E2E onboarding artifacts — condos created by the create-building wizard test
// and users created by /auth/dev-register. Safe to delete: real users never
// have an "e2e+" prefix and real condos never start with "E2E ".
const condoBefore = db.prepare('SELECT COUNT(*) AS c FROM condominiums').get().c;
const userBefore  = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;

const e2eCondoIds = db.prepare("SELECT id FROM condominiums WHERE name LIKE 'E2E %'").all().map((r) => r.id);
const e2eUserIds  = db.prepare("SELECT id FROM users WHERE email LIKE 'e2e+%@condoos.test'").all().map((r) => r.id);

if (e2eCondoIds.length > 0) {
  const placeholders = e2eCondoIds.map(() => '?').join(',');
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
  db.prepare(`DELETE FROM user_unit WHERE user_id IN (${placeholders})`).run(...e2eUserIds);
  db.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).run(...e2eUserIds);
}

const condoAfter = db.prepare('SELECT COUNT(*) AS c FROM condominiums').get().c;
const userAfter  = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
console.log('[cleanup] condominiums: ' + condoBefore + ' → ' + condoAfter + ' (deleted ' + e2eCondoIds.length + ')');
console.log('[cleanup] users: ' + userBefore + ' → ' + userAfter + ' (deleted ' + e2eUserIds.length + ')');
