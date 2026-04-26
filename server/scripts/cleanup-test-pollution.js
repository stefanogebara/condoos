// One-shot cleanup of E2E test pollution. Run on Fly via:
//   flyctl ssh console -a condoos-api -C "node /app/scripts/cleanup-test-pollution.js"
// Idempotent: deletes proposals + assemblies whose titles match well-known
// E2E patterns. Safe to re-run.
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || '/data/condoos.sqlite';
const db = new Database(DB_PATH);

const propWhere = "(title LIKE 'Isolation probe%' OR title LIKE 'E2E %' OR title LIKE 'walkthrough %' OR title LIKE 'UI compliance%' OR title LIKE 'Vote-closer%')";
const asmWhere  = "(title LIKE 'Canary AGO%' OR title LIKE 'walkthrough %' OR title LIKE 'E2E %')";

const propBefore = db.prepare('SELECT COUNT(*) AS c FROM proposals').get().c;
const asmBefore  = db.prepare('SELECT COUNT(*) AS c FROM assemblies').get().c;

db.prepare('DELETE FROM proposal_votes    WHERE proposal_id IN (SELECT id FROM proposals WHERE ' + propWhere + ')').run();
db.prepare('DELETE FROM proposal_comments WHERE proposal_id IN (SELECT id FROM proposals WHERE ' + propWhere + ')').run();
const propRes = db.prepare('DELETE FROM proposals WHERE ' + propWhere).run();

db.prepare('DELETE FROM assembly_votes        WHERE assembly_id IN (SELECT id FROM assemblies WHERE ' + asmWhere + ')').run();
db.prepare('DELETE FROM assembly_proxies      WHERE assembly_id IN (SELECT id FROM assemblies WHERE ' + asmWhere + ')').run();
db.prepare('DELETE FROM assembly_attendance   WHERE assembly_id IN (SELECT id FROM assemblies WHERE ' + asmWhere + ')').run();
db.prepare('DELETE FROM assembly_agenda_items WHERE assembly_id IN (SELECT id FROM assemblies WHERE ' + asmWhere + ')').run();
const asmRes  = db.prepare('DELETE FROM assemblies WHERE ' + asmWhere).run();

const propAfter = db.prepare('SELECT COUNT(*) AS c FROM proposals').get().c;
const asmAfter  = db.prepare('SELECT COUNT(*) AS c FROM assemblies').get().c;

console.log('[cleanup] proposals: ' + propBefore + ' → ' + propAfter + ' (deleted ' + propRes.changes + ')');
console.log('[cleanup] assemblies: ' + asmBefore + ' → ' + asmAfter + ' (deleted ' + asmRes.changes + ')');
