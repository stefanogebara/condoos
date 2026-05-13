import assert from 'node:assert/strict';

async function main() {
  const dbPath = process.env.DB_PATH || '';
  if (!/agent-evals\.sqlite$/i.test(dbPath.replace(/\\/g, '/'))) {
    throw new Error('Refusing to run agent evals without DB_PATH ending in agent-evals.sqlite');
  }

  // Keep the harness deterministic. Live model/provider evals should be a
  // separate explicit script so CI and local smoke checks do not spend money.
  process.env.OPENROUTER_API_KEY = '';
  process.env.AGENT_USE_REACT = '0';
  delete process.env.WEB_SEARCH_ENDPOINT;
  delete process.env.WEB_SEARCH_API_KEY;

  const { default: db } = await import('../src/db');
  const { runAdminAgent } = await import('../src/ai/admin-agent-runner');
  const { sanitizeAdminAgentOutput } = await import('../src/ai/admin-agent');
  const { researchExternalVendors } = await import('../src/ai/web-research');

  resetDb(db);
  const condoId = Number(db.prepare(
    `INSERT INTO condominiums (name, address, invite_code) VALUES ('Eval Condo', 'São Paulo, SP', 'EVAL01')`
  ).run().lastInsertRowid);
  const adminId = Number(db.prepare(
    `INSERT INTO users (condominium_id, email, password_hash, first_name, last_name, role)
     VALUES (?, 'eval-admin@condoos.dev', 'x', 'Eval', 'Admin', 'board_admin')`
  ).run(condoId).lastInsertRowid);
  db.prepare(
    `INSERT INTO service_contacts (condominium_id, category, company_name, contact_name, whatsapp, service_scope, preferred, emergency_available)
     VALUES (?, 'elevator', 'Otis Elevadores SP', 'Plantão Otis', '+5511999000001', 'Elevadores residenciais e emergência 24h', 1, 1)`
  ).run(condoId);

  const cases: Array<{ name: string; passed: boolean; detail?: string }> = [];

  const run = await runAdminAgent({
    condoId,
    adminUserId: adminId,
    task: 'Elevador A está fazendo ruído entre andares; comparar fornecedor atual e opções.',
    mode: 'repair',
    locale: 'pt-BR',
    location: 'São Paulo',
  });
  cases.push({
    name: 'fallback run produces a persisted agent_runs row',
    passed: !!run.agent_run_id && run.fallback === true,
    detail: `agent_run_id=${run.agent_run_id}`,
  });
  const runRow = db.prepare(`SELECT status, fallback, task FROM agent_runs WHERE id = ?`).get(run.agent_run_id) as any;
  assert.equal(runRow.status, 'succeeded');
  assert.equal(runRow.fallback, 1);

  const refusal = sanitizeAdminAgentOutput({ summary: 'marketing plan', options: [{ title: 'SEO' }] }, {
    task: 'Qual estratégia de marketing digital devo usar?',
    service_contacts: [],
  });
  cases.push({
    name: 'sanitizer hard-refuses out-of-scope agent task',
    passed: refusal.options.length === 0 && refusal.proposal_draft === null && refusal.confidence?.tier === 'high',
  });

  const research = await researchExternalVendors({
    query: 'empresa manutenção elevador condomínio',
    location: 'São Paulo',
    maxResults: 3,
  });
  cases.push({
    name: 'web research fallback returns cited manual search URLs',
    passed: research.configured === false && research.citations.length === 3 && research.citations.every((c) => c.url.startsWith('https://')),
  });

  for (const c of cases) assert.equal(c.passed, true, c.name);
  console.log(JSON.stringify({
    ok: true,
    evaluated_at: new Date().toISOString(),
    cases,
  }, null, 2));
}

function resetDb(db: any) {
  const tables = [
    'agent_runs',
    'agent_turns',
    'agent_threads',
    'ticket_attachments',
    'ticket_comments',
    'ticket_work_orders',
    'ticket_dispatches',
    'ticket_verifications',
    'tickets',
    'service_contacts',
    'audit_log',
    'users',
    'condominiums',
  ];
  db.pragma('foreign_keys = OFF');
  for (const table of tables) db.prepare(`DELETE FROM ${table}`).run();
  for (const table of tables) db.prepare(`DELETE FROM sqlite_sequence WHERE name=?`).run(table);
  db.pragma('foreign_keys = ON');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
