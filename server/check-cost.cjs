// One-shot diagnostic — runs SQL against prod DB inside the fly machine.
// Removed after the run.
const db = require('./dist/db').default;
const expenses = db.prepare(
  "SELECT id, vendor, amount_cents, spent_at, substr(spent_at,1,10) AS prefix FROM expenses WHERE vendor LIKE '%tis%'"
).all();
console.log('Otis expenses:', JSON.stringify(expenses, null, 2));

const sc = db.prepare("SELECT id, company_name, condominium_id FROM service_contacts WHERE active=1 ORDER BY company_name").all();
console.log('---active service_contacts:', JSON.stringify(sc, null, 2));

const join = db.prepare(
  "SELECT sc.id, sc.company_name, e.vendor, e.amount_cents, e.spent_at, substr(e.spent_at,1,10) AS prefix FROM service_contacts sc LEFT JOIN expenses e ON e.condominium_id=sc.condominium_id AND LOWER(e.vendor) LIKE LOWER(sc.company_name) || '%' WHERE sc.active=1"
).all();
console.log('---raw join (no date filter):', JSON.stringify(join, null, 2));

const cutoff = db.prepare("SELECT date('now', '-24 months') AS cutoff").get();
console.log('---date cutoff:', JSON.stringify(cutoff));

const filtered = db.prepare(
  "SELECT sc.id, sc.company_name, COUNT(e.id) AS cnt, SUM(e.amount_cents) AS total FROM service_contacts sc LEFT JOIN expenses e ON e.condominium_id=sc.condominium_id AND LOWER(e.vendor) LIKE LOWER(sc.company_name) || '%' AND substr(e.spent_at, 1, 10) >= date('now', '-24 months') WHERE sc.active=1 GROUP BY sc.id, sc.company_name HAVING cnt > 0"
).all();
console.log('---filtered with HAVING:', JSON.stringify(filtered, null, 2));
