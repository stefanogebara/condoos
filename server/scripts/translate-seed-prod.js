// One-shot translator for prod seed data that pre-dates the PT-BR rewrite.
// Idempotent: only updates rows whose title still matches the OLD English text.
const Database = require('better-sqlite3');
const db = new Database(process.env.DB_PATH || '/data/condoos.sqlite');

const updates = [
  ['proposals',
    'Install 4 EV charging stations in garage',
    'Instalar 4 carregadores de carro elétrico na garagem',
    'Level-2 EV chargers in the 4 visitor spots near the elevator. Estimated install + hardware $18,000. Ongoing electricity will be metered per-user via RFID card.',
    'Carregadores nível 2 nas 4 vagas de visitante perto do elevador. Estimativa de instalação + equipamento R$ 90.000. Energia consumida cobrada por usuário via cartão RFID.',
    18000, 90000],
  ['proposals',
    'Replace lobby AC unit',
    'Trocar o ar-condicionado do saguão',
    'The lobby AC has failed twice this summer. Quote from Cool Breeze HVAC for a 5-ton replacement: $9,400 including installation and a 5-year warranty.',
    'O ar do saguão falhou duas vezes neste verão. Orçamento da Cool Breeze HVAC para um novo equipamento de 5 TR: R$ 47.000 incluindo instalação e 5 anos de garantia.',
    9400, 47000],
];

for (const u of updates) {
  const r = db.prepare('UPDATE proposals SET title = ?, description = ?, estimated_cost = ? WHERE title = ?')
              .run(u[2], u[4], u[6], u[1]);
  console.log('proposals', u[1].slice(0, 30), 'updated', r.changes);
}

// Suggestions
const sugUpd = [
  ['The lobby AC is barely working. It was 30C inside yesterday afternoon.',
   'O ar do saguão mal está funcionando. Ontem à tarde marcou 30°C aqui dentro.'],
  ['Lobby feels really hot lately. Is the AC broken?',
   'O saguão está muito quente ultimamente. O ar quebrou?'],
  ['Gym treadmill #3 makes a loud clanking sound when used.',
   'A esteira #3 da academia faz um barulho alto quando alguém usa.'],
  ['Can we add EV charging stations? At least 2 of us drive EVs.',
   'Podemos colocar carregadores de carro elétrico? Pelo menos 2 moradores têm EV.'],
];
for (const [en, pt] of sugUpd) {
  const r = db.prepare('UPDATE suggestions SET body = ? WHERE body = ?').run(pt, en);
  console.log('suggestions', en.slice(0, 30), 'updated', r.changes);
}

// Announcements
const annUpd = [
  ['Pool re-opens Friday',     'Piscina reabre na sexta',
   'The rooftop pool will re-open this Friday after quarterly maintenance. Thanks for your patience.',
   'A piscina volta a funcionar nesta sexta após a manutenção trimestral. Obrigado pela paciência.'],
  ['Fire drill Thursday 10am', 'Simulado de incêndio quinta 10h',
   'Building-wide fire drill this Thursday at 10am. Expect alarms for ~10 minutes.',
   'Simulado de incêndio em todo o prédio nesta quinta às 10h. Alarmes vão tocar por uns 10 minutos.'],
  ['New recycling guidelines', 'Nova orientação de reciclagem',
   'Please break down cardboard before placing it in the bins. Pickup is Mondays and Thursdays.',
   'Desmonte as caixas de papelão antes de colocar no contêiner. Coleta segundas e quintas.'],
];
for (const [enT, ptT, enB, ptB] of annUpd) {
  const r = db.prepare('UPDATE announcements SET title = ?, body = ? WHERE title = ?').run(ptT, ptB, enT);
  console.log('announcements', enT.slice(0, 30), 'updated', r.changes);
}

// Meeting
const mtgUpd = db.prepare('UPDATE meetings SET title = ?, agenda = ? WHERE title = ?')
                 .run('Reunião do síndico — 2º trimestre',
                      'Revisar propostas em pauta (carregadores EV, ar do saguão), orçamento trimestral, reclamações recentes.',
                      'Q2 Board Meeting');
console.log('meetings updated', mtgUpd.changes);

// Comments on the EV proposal — translate inline
const commentMap = [
  ['Love this. I just bought an EV and charging at work is a hassle.',
   'Adorei. Acabei de comprar um EV e carregar no trabalho é um saco.'],
  ['Who pays for electricity? I dont want my HOA fee subsidizing someone elses fuel.',
   'Quem paga a eletricidade? Não quero ver minha taxa subsidiando o combustível de outros moradores.'],
  ['Per-user metering should cover it. Ask for the utility breakdown from the installer.',
   'A medição por usuário resolve. Pede a planilha de consumo da empresa que vai instalar.'],
  ['$18K feels high. Can we get a second quote?',
   'R$ 90 mil parece alto. Dá pra pegar um segundo orçamento?'],
  ['Two spots is fine for now, scale up later if demand grows.',
   'Duas vagas já basta por agora. Dá pra expandir depois se aparecer demanda.'],
];
for (const [en, pt] of commentMap) {
  const r = db.prepare('UPDATE proposal_comments SET body = ? WHERE body = ?').run(pt, en);
  console.log('proposal_comments', en.slice(0, 30), 'updated', r.changes);
}

console.log('done.');
