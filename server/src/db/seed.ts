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
    'invites',
    'user_unit',
    'units',
    'buildings',
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
    `INSERT INTO condominiums (name, address, invite_code, voting_model, require_approval)
     VALUES (?, ?, ?, 'one_per_unit', 1)`
  ).run('Pine Ridge Towers', '1200 Ocean Ave, Miami FL 33139', 'DEMO123');
  const condoId = Number(condo.lastInsertRowid);

  // Main Tower — 10 floors — placeholder scaffolding.
  const buildingId = Number(
    db.prepare(
      `INSERT INTO buildings (condominium_id, name, floors) VALUES (?, ?, ?)`
    ).run(condoId, 'Main Tower', 10).lastInsertRowid
  );

  const hash = (p: string) => bcrypt.hashSync(p, 10);
  const insertUser = db.prepare(
    `INSERT INTO users (condominium_id, email, password_hash, first_name, last_name, role, unit_number)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertUnit = db.prepare(
    `INSERT INTO units (building_id, floor, number) VALUES (?, ?, ?)`
  );
  const insertUserUnit = db.prepare(
    `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight, move_in_date)
     VALUES (?, ?, ?, 'active', 1, 1.0, CURRENT_TIMESTAMP)`
  );
  function floorOf(unitNumber: string): number | null {
    // 3-digit numbers like 704 → floor 7. 4-digit like 1201 → floor 12. Letter units (PH-1) → null.
    const digits = unitNumber.match(/^(\d+)/)?.[1];
    if (!digits) return null;
    if (digits.length === 3) return parseInt(digits.slice(0, 1), 10);
    if (digits.length === 4) return parseInt(digits.slice(0, 2), 10);
    return parseInt(digits, 10);
  }

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
    const uid = Number(res.lastInsertRowid);
    userIds[u.email] = uid;

    // Create the unit + active owner link (seeded users are all owners in the demo).
    const unitId = Number(insertUnit.run(buildingId, floorOf(u.unit), u.unit).lastInsertRowid);
    insertUserUnit.run(uid, unitId, 'owner');
  }

  // Empty units used by the default roster-import sample in the board UI.
  for (const unit of ['502', '101']) {
    insertUnit.run(buildingId, floorOf(unit), unit);
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
  insertAnn.run(condoId, admin, 'Piscina reabre na sexta',       'A piscina volta a funcionar nesta sexta após a manutenção trimestral. Obrigado pela paciência.', 1, 'manual');
  insertAnn.run(condoId, admin, 'Simulado de incêndio quinta 10h', 'Simulado de incêndio em todo o prédio nesta quinta às 10h. Alarmes vão tocar por uns 10 minutos.', 1, 'manual');
  insertAnn.run(condoId, admin, 'Nova orientação de reciclagem',   'Desmonte as caixas de papelão antes de colocar no contêiner. Coleta segundas e quintas.', 0, 'manual');

  const insertSug = db.prepare(
    `INSERT INTO suggestions (condominium_id, author_id, body, status, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  insertSug.run(condoId, jordan, 'O ar do saguão mal está funcionando. Ontem à tarde marcou 30°C aqui dentro.', 'open', isoDaysAgo(1));
  insertSug.run(condoId, taylor, 'O saguão está muito quente ultimamente. O ar quebrou?',                          'open', isoDaysAgo(1));
  insertSug.run(condoId, riley,  'A esteira #3 da academia faz um barulho alto quando alguém usa.',               'open', isoDaysAgo(3));
  insertSug.run(condoId, sam,    'Podemos colocar carregadores de carro elétrico? Pelo menos 2 moradores têm EV.', 'open', isoDaysAgo(2));

  const insertProp = db.prepare(
    `INSERT INTO proposals (condominium_id, author_id, title, description, category, estimated_cost, status, ai_drafted, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const propDiscussion = Number(insertProp.run(
    condoId, admin,
    'Instalar 4 carregadores de carro elétrico na garagem',
    'Carregadores nível 2 nas 4 vagas de visitante perto do elevador. Estimativa de instalação + equipamento R$ 90.000. Energia consumida cobrada por usuário via cartão RFID.',
    'infrastructure', 90000, 'discussion', 0, isoDaysAgo(2)
  ).lastInsertRowid);
  const propVoting = Number(insertProp.run(
    condoId, admin,
    'Trocar o ar-condicionado do saguão',
    'O ar do saguão falhou duas vezes neste verão. Orçamento da Cool Breeze HVAC para um novo equipamento de 5 TR: R$ 47.000 incluindo instalação e 5 anos de garantia.',
    'maintenance', 47000, 'voting', 0, isoDaysAgo(5)
  ).lastInsertRowid);
  db.prepare(`UPDATE proposals SET voting_closes_at=? WHERE id=?`).run(isoDaysAhead(3), propVoting);

  const insertComment = db.prepare(
    `INSERT INTO proposal_comments (proposal_id, author_id, body, created_at) VALUES (?, ?, ?, ?)`
  );
  insertComment.run(propDiscussion, maya,   'Adorei. Acabei de comprar um EV e carregar no trabalho é um saco.', isoDaysAgo(2));
  insertComment.run(propDiscussion, jordan, 'Quem paga a eletricidade? Não quero ver minha taxa subsidiando o combustível de outros moradores.', isoDaysAgo(2));
  insertComment.run(propDiscussion, taylor, 'A medição por usuário resolve. Pede a planilha de consumo da empresa que vai instalar.', isoDaysAgo(1));
  insertComment.run(propDiscussion, riley,  'R$ 90 mil parece alto. Dá pra pegar um segundo orçamento?', isoDaysAgo(1));
  insertComment.run(propDiscussion, sam,    'Duas vagas já basta por agora. Dá pra expandir depois se aparecer demanda.', isoDaysAgo(0));

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
  insertMeeting.run(condoId, 'Reunião do síndico — 2º trimestre', isoDaysAhead(2),
    'Revisar propostas em pauta (carregadores EV, ar do saguão), orçamento trimestral, reclamações recentes.',
    'scheduled'
  );

  // Demo expenses for the Transparência view (#12). 12 months of realistic
  // condo spend so a fresh demo doesn't show an empty page.
  const insertExpense = db.prepare(
    `INSERT INTO expenses (
      condominium_id, amount_cents, currency, category, vendor,
      description, spent_at, receipt_url, created_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const expenses: Array<{ amount_cents: number; category: string; vendor: string | null; description: string; days_ago: number }> = [
    { amount_cents: 4_700_000, category: 'maintenance',    vendor: 'Cool Breeze HVAC',   description: 'Substituição do ar-condicionado do saguão',           days_ago: 14 },
    { amount_cents:   850_000, category: 'utilities',      vendor: 'Light',              description: 'Conta de luz das áreas comuns — abril',               days_ago: 22 },
    { amount_cents:   620_000, category: 'utilities',      vendor: 'Sabesp',             description: 'Conta de água do prédio — abril',                     days_ago: 22 },
    { amount_cents: 1_200_000, category: 'cleaning',       vendor: 'Lim+ Serviços',      description: 'Equipe de limpeza terceirizada — abril',              days_ago: 30 },
    { amount_cents: 3_400_000, category: 'security',       vendor: 'GuardaSeg',          description: 'Portaria 24h — abril',                                days_ago: 30 },
    { amount_cents:   480_000, category: 'admin',          vendor: null,                  description: 'Honorários do contador',                              days_ago: 30 },
    { amount_cents: 1_350_000, category: 'staff',          vendor: null,                  description: 'Folha do zelador + encargos',                         days_ago: 30 },
    { amount_cents:   180_000, category: 'maintenance',    vendor: 'Fitness Pro',        description: 'Manutenção da esteira #3 da academia',                days_ago: 45 },
    { amount_cents:   320_000, category: 'amenity',        vendor: 'Pool Care',          description: 'Tratamento trimestral da piscina',                    days_ago: 70 },
    { amount_cents: 2_100_000, category: 'insurance',      vendor: 'Porto Seguro',       description: 'Renovação anual do seguro do prédio',                 days_ago: 95 },
    { amount_cents:   930_000, category: 'utilities',      vendor: 'Light',              description: 'Conta de luz das áreas comuns — março',               days_ago: 53 },
    { amount_cents: 1_200_000, category: 'cleaning',       vendor: 'Lim+ Serviços',      description: 'Equipe de limpeza terceirizada — março',              days_ago: 60 },
    { amount_cents:   720_000, category: 'reserve',        vendor: null,                  description: 'Aporte ao fundo de reserva — março',                  days_ago: 60 },
  ];
  for (const e of expenses) {
    insertExpense.run(
      condoId, e.amount_cents, 'BRL', e.category, e.vendor,
      e.description, isoDaysAgo(e.days_ago), null, admin,
    );
  }

  console.log('Seed complete.');
  console.log('  admin@condoos.dev    / admin123    (board admin)');
  console.log('  resident@condoos.dev / resident123 (resident)');
}

run();
