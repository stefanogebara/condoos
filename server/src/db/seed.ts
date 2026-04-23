// CondoOS demo seed - idempotent.
import * as dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();
import bcrypt from 'bcryptjs';
import db from './index';

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function isoHoursAhead(hours: number): string {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}

function isoDaysAhead(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function wipe() {
  const wipeOrder = [
    'action_items',
    'proposal_votes',
    'proposal_comments',
    'announcements',
    'suggestions',
    'suggestion_clusters',
    'proposals',
    'meetings',
    'amenity_reservations',
    'amenities',
    'visitors',
    'packages',
    'users',
    'condominiums',
  ];
  db.pragma('foreign_keys = OFF');
  for (const t of wipeOrder) db.prepare(`DELETE FROM ${t}`).run();
  for (const t of wipeOrder) db.prepare(`DELETE FROM sqlite_sequence WHERE name=?`).run(t);
  db.pragma('foreign_keys = ON');
}

function run() {
  console.log('Seeding CondoOS demo data...');
  wipe();

  const condo = db.prepare(
    `INSERT INTO condominiums (name, address) VALUES (?, ?)`
  ).run('Pine Ridge Towers', '1200 Ocean Ave, Miami FL 33139');
  const condoId = Number(condo.lastInsertRowid);

  const hash = (p: string) => bcrypt.hashSync(p, 10);
  const insertUser = db.prepare(
    `INSERT INTO users (condominium_id, email, password_hash, first_name, last_name, role, unit_number)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const users = [
    { email: 'admin@condoos.dev',    pw: 'admin123',    first: 'Alex',   last: 'Silva',   role: 'board_admin', unit: 'PH-1' },
    { email: 'resident@condoos.dev', pw: 'resident123', first: 'Maya',   last: 'Chen',    role: 'resident',    unit: '704' },
    { email: 'jordan@condoos.dev',   pw: 'resident123', first: 'Jordan', last: 'Martins', role: 'resident',    unit: '612' },
    { email: 'taylor@condoos.dev',   pw: 'resident123', first: 'Taylor', last: 'Khan',    role: 'resident',    unit: '305' },
    { email: 'riley@condoos.dev',    pw: 'resident123', first: 'Riley',  last: 'Okafor',  role: 'resident',    unit: '208' },
    { email: 'sam@condoos.dev',      pw: 'resident123', first: 'Sam',    last: 'Nguyen',  role: 'resident',    unit: '401' },
  ];
  const userIds: Record<string, number> = {};
  for (const u of users) {
    const res = insertUser.run(condoId, u.email, hash(u.pw), u.first, u.last, u.role, u.unit);
    userIds[u.email] = Number(res.lastInsertRowid);
  }

  const admin  = userIds['admin@condoos.dev'];
  const maya   = userIds['resident@condoos.dev'];
  const jordan = userIds['jordan@condoos.dev'];
  const taylor = userIds['taylor@condoos.dev'];
  const riley  = userIds['riley@condoos.dev'];
  const sam    = userIds['sam@condoos.dev'];

  const insertPkg = db.prepare(
    `INSERT INTO packages (condominium_id, recipient_id, carrier, description, arrived_at, status)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  insertPkg.run(condoId, maya,   'Amazon', 'Small box',       isoDaysAgo(0), 'waiting');
  insertPkg.run(condoId, maya,   'UPS',    'Envelope',        isoDaysAgo(1), 'waiting');
  insertPkg.run(condoId, jordan, 'FedEx',  'Medium box',      isoDaysAgo(0), 'waiting');
  insertPkg.run(condoId, taylor, 'USPS',   'Document mailer', isoDaysAgo(2), 'waiting');
  insertPkg.run(condoId, riley,  'DHL',    'Fragile package', isoDaysAgo(3), 'picked_up');

  const insertVisitor = db.prepare(
    `INSERT INTO visitors (condominium_id, host_id, visitor_name, visitor_type, expected_at, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  insertVisitor.run(condoId, maya,   'Aunt Priya',    'guest',    isoHoursAhead(3),  'pending',  'Arriving from airport');
  insertVisitor.run(condoId, jordan, 'Uber Eats',     'delivery', isoHoursAhead(1),  'pending',  'Dinner');
  insertVisitor.run(condoId, taylor, 'AC technician', 'service',  isoHoursAhead(26), 'approved', 'Scheduled maintenance');
  insertVisitor.run(condoId, sam,    'Friends (x3)',  'guest',    isoHoursAhead(48), 'approved', 'Game night');

  const insertAmenity = db.prepare(
    `INSERT INTO amenities (condominium_id, name, description, icon, capacity, open_hour, close_hour)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const amenPool = insertAmenity.run(condoId, 'Rooftop Pool',   'Heated, with sun deck',     'Waves',       20, 7,  22).lastInsertRowid;
  const amenGym  = insertAmenity.run(condoId, 'Fitness Center', 'Full cardio + weights',     'Dumbbell',    15, 5,  23).lastInsertRowid;
  insertAmenity.run(condoId, 'BBQ Grill', 'Rooftop grill station', 'Flame', 8, 11, 22);
  const amenRoom = insertAmenity.run(condoId, 'Party Room',     'Lounge, kitchen, seats 40', 'PartyPopper', 40, 9,  23).lastInsertRowid;

  const insertRes = db.prepare(
    `INSERT INTO amenity_reservations (amenity_id, user_id, starts_at, ends_at)
     VALUES (?, ?, ?, ?)`
  );
  insertRes.run(Number(amenPool), maya,   isoDaysAhead(1), isoDaysAhead(1));
  insertRes.run(Number(amenGym),  jordan, isoHoursAhead(18), isoHoursAhead(20));
  insertRes.run(Number(amenRoom), taylor, isoDaysAhead(5), isoDaysAhead(5));

  const insertAnn = db.prepare(
    `INSERT INTO announcements (condominium_id, author_id, title, body, pinned, source)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  insertAnn.run(condoId, admin, 'Pool re-opens Friday',     'The rooftop pool will re-open this Friday after quarterly maintenance. Thanks for your patience.', 1, 'manual');
  insertAnn.run(condoId, admin, 'Fire drill Thursday 10am', 'Building-wide fire drill this Thursday at 10am. Expect alarms for ~10 minutes.', 1, 'manual');
  insertAnn.run(condoId, admin, 'New recycling guidelines', 'Please break down cardboard before placing it in the bins. Pickup is Mondays and Thursdays.', 0, 'manual');

  const insertSug = db.prepare(
    `INSERT INTO suggestions (condominium_id, author_id, body, status, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  insertSug.run(condoId, jordan, 'The lobby AC is barely working. It was 30C inside yesterday afternoon.', 'open', isoDaysAgo(1));
  insertSug.run(condoId, taylor, 'Lobby feels really hot lately. Is the AC broken?',                       'open', isoDaysAgo(1));
  insertSug.run(condoId, riley,  'Gym treadmill #3 makes a loud clanking sound when used.',                'open', isoDaysAgo(3));
  insertSug.run(condoId, sam,    'Can we add EV charging stations? At least 2 of us drive EVs.',           'open', isoDaysAgo(2));

  const insertProp = db.prepare(
    `INSERT INTO proposals (condominium_id, author_id, title, description, category, estimated_cost, status, ai_drafted, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const propDiscussion = Number(insertProp.run(
    condoId, admin,
    'Install 4 EV charging stations in garage',
    'Level-2 EV chargers in the 4 visitor spots near the elevator. Estimated install + hardware $18,000. Ongoing electricity will be metered per-user via RFID card.',
    'infrastructure', 18000, 'discussion', 0, isoDaysAgo(2)
  ).lastInsertRowid);
  const propVoting = Number(insertProp.run(
    condoId, admin,
    'Replace lobby AC unit',
    'The lobby AC has failed twice this summer. Quote from Cool Breeze HVAC for a 5-ton replacement: $9,400 including installation and a 5-year warranty.',
    'maintenance', 9400, 'voting', 0, isoDaysAgo(5)
  ).lastInsertRowid);
  db.prepare(`UPDATE proposals SET voting_closes_at=? WHERE id=?`).run(isoDaysAhead(3), propVoting);

  const insertComment = db.prepare(
    `INSERT INTO proposal_comments (proposal_id, author_id, body, created_at) VALUES (?, ?, ?, ?)`
  );
  insertComment.run(propDiscussion, maya,   'Love this. I just bought an EV and charging at work is a hassle.', isoDaysAgo(2));
  insertComment.run(propDiscussion, jordan, 'Who pays for electricity? I dont want my HOA fee subsidizing someone elses fuel.', isoDaysAgo(2));
  insertComment.run(propDiscussion, taylor, 'Per-user metering should cover it. Ask for the utility breakdown from the installer.', isoDaysAgo(1));
  insertComment.run(propDiscussion, riley,  '$18K feels high. Can we get a second quote?', isoDaysAgo(1));
  insertComment.run(propDiscussion, sam,    'Two spots is fine for now, scale up later if demand grows.', isoDaysAgo(0));

  const insertVote = db.prepare(
    `INSERT INTO proposal_votes (proposal_id, user_id, choice) VALUES (?, ?, ?)`
  );
  insertVote.run(propVoting, maya,   'yes');
  insertVote.run(propVoting, jordan, 'yes');
  insertVote.run(propVoting, taylor, 'abstain');

  const insertMeeting = db.prepare(
    `INSERT INTO meetings (condominium_id, title, scheduled_for, agenda, status)
     VALUES (?, ?, ?, ?, ?)`
  );
  insertMeeting.run(condoId, 'Q2 Board Meeting', isoDaysAhead(2),
    'Review pending proposals (EV chargers, lobby AC), quarterly budget, recent complaints.',
    'scheduled'
  );

  console.log('Seed complete.');
  console.log('  admin@condoos.dev    / admin123    (board admin)');
  console.log('  resident@condoos.dev / resident123 (resident)');
}

run();
