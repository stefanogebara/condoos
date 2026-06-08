// Comprehensive admin click-through. Walks every page in /board and
// exercises the major action buttons. Each test is non-destructive on prod
// (creates ephemeral entities; doesn't delete shared demo data).
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { credentialsFor } from './support/credentials';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4316/api');

type Session = { token: string; user: any };
const sessionCache = new Map<string, Session>();

test.describe.configure({ timeout: 90_000 });

async function loginApi(request: APIRequestContext, email: string, password: string): Promise<Session> {
  const cached = sessionCache.get(email);
  if (cached) return cached;
  const r = await request.post(`${apiURL}/auth/login`, { data: { email, password } });
  expect(r.ok(), `login failed for ${email}: ${r.status()} ${await r.text()}`).toBeTruthy();
  const session = (await r.json()).data as Session;
  sessionCache.set(email, session);
  return session;
}

async function adminLogin(page: Page, request: APIRequestContext) {
  const creds = credentialsFor('admin');
  const s = await loginApi(request, creds.email, creds.password);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('condoos_token', token);
    localStorage.setItem('condoos_user', JSON.stringify(user));
  }, s);
}

async function nav(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.getByRole('button', { name: /Open menu|Abrir menu/i }).click();
    await expect(page.getByRole('button', { name: /Close menu|Fechar menu/i })).toBeVisible();
  }
  return page.locator('aside');
}

// ---------------------------------------------------------------------------
// /board overview — landing page after login
// ---------------------------------------------------------------------------

test('admin: overview renders with sidebar nav', async ({ page, request, isMobile }) => {
  await adminLogin(page, request);
  await page.goto('/board');
  const menu = await nav(page, isMobile);
  await expect(menu.getByText(/Board admin|Síndico/i).first()).toBeVisible();
  // Every primary nav link should be in the sidebar
  const links = [
    /^(Overview|Visão geral)$/i,
    /^(Suggestions|Sugestões)$/i,
    /AI agent|Agente IA/i,
    /^(Reports|Relatórios|Informes)$/i,
    /Pending|Pendentes/i,
    /^(Proposals|Propostas)$/i,
    /^(Assemblies|Assembleias)$/i,
    /^(Meetings|Reuniões)$/i,
    /^(Announcements|Comunicados)$/i,
    /^(Residents|Moradores)$/i,
    /^(Documents|Documentos)$/i,
    /^(Operations|Operação)$/i,
  ];
  for (const l of links) {
    await expect(menu.getByRole('link', { name: l })).toBeVisible();
  }
});

test('admin: operations service network page renders', async ({ page, request }) => {
  await adminLogin(page, request);
  await page.goto('/board/services');
  await expect(page.getByRole('heading', { name: /Operations|Operação/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /New contact|Novo contato/i })).toBeVisible();
  await expect(page.getByText(/service network|Rede de serviços|No operations contacts|Nenhum contato operacional/i).first()).toBeVisible();
});

test('admin: document vault page renders', async ({ page, request }) => {
  await adminLogin(page, request);
  await page.goto('/board/documents');
  await expect(page.getByRole('heading', { level: 1, name: /Documents|Documentos/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /New document|Nuevo documento|Novo documento/i })).toBeVisible();
  await expect(page.getByText(/document vault|cofre de documentos|bóveda de documentos/i).first()).toBeVisible();
});

test('admin: agency portfolio renders trends and work-order story', async ({ page, request }) => {
  await adminLogin(page, request);
  const metrics = {
    pending_residents: 1,
    unresolved_tickets: 3,
    urgent_tickets: 1,
    recurring_problem_clusters: 1,
    vendor_follow_up_problems: 1,
    overdue_dues: 1,
    pending_payment_proofs: 0,
    vendor_sla_problems: 0,
    proposals_missing_budget: 0,
    upcoming_meetings: 1,
  };
  const portfolio = {
    agencies: [{
      id: 77,
      name: 'Quito Operations',
      slug: 'quito-operations',
      role: 'agency_admin',
      capabilities: ['building_admin', 'finance', 'maintenance', 'concierge', 'documents', 'reports'],
      totals: metrics,
      permission_review: {
        total_staff: 2,
        agency_admins: 1,
        scoped_staff: 1,
        unassigned_staff: 0,
        pending_invites: 0,
        expired_invites: 0,
        failed_invite_emails: 0,
        buildings_without_direct_staff: [],
      },
      attention: [],
      risk_followups: [{
        id: 1,
        agency_id: 77,
        condominium_id: 45,
        condominium_name: 'Test Condo',
        kind: 'urgent_tickets',
        record_id: '10',
        owner_user_id: 501,
        owner_email: 'maintenance@example.com',
        owner_name: 'Maintenance Owner',
        status: 'in_progress',
        due_at: '2026-05-20T12:00:00.000Z',
        note: 'Call vendor before board check-in',
        route: '/board/tickets',
        overdue: true,
        created_at: '2026-05-18T12:00:00.000Z',
        updated_at: '2026-05-18T12:00:00.000Z',
      }, {
        id: 2,
        agency_id: 77,
        condominium_id: 46,
        condominium_name: 'North Tower',
        kind: 'overdue_dues',
        record_id: '22',
        owner_user_id: 502,
        owner_email: 'finance@example.com',
        owner_name: 'Budget Owner',
        status: 'waiting',
        due_at: '2026-06-20T12:00:00.000Z',
        note: 'Confirm payment promise before report export',
        route: '/board/finances',
        overdue: false,
        created_at: '2026-05-19T12:00:00.000Z',
        updated_at: '2026-05-19T12:00:00.000Z',
      }],
      trends: [
        { month: '2025-12', tickets_opened: 1, tickets_resolved: 1, work_orders_opened: 0, work_orders_completed: 0, maintenance_spend_cents: 0, maintenance_spend: 'USD 0.00', overdue_dues: 0 },
        { month: '2026-01', tickets_opened: 2, tickets_resolved: 1, work_orders_opened: 1, work_orders_completed: 0, maintenance_spend_cents: 10000, maintenance_spend: 'USD 100.00', overdue_dues: 0 },
        { month: '2026-02', tickets_opened: 2, tickets_resolved: 2, work_orders_opened: 1, work_orders_completed: 1, maintenance_spend_cents: 18000, maintenance_spend: 'USD 180.00', overdue_dues: 0 },
        { month: '2026-03', tickets_opened: 3, tickets_resolved: 2, work_orders_opened: 2, work_orders_completed: 1, maintenance_spend_cents: 24000, maintenance_spend: 'USD 240.00', overdue_dues: 1 },
        { month: '2026-04', tickets_opened: 4, tickets_resolved: 3, work_orders_opened: 2, work_orders_completed: 2, maintenance_spend_cents: 31000, maintenance_spend: 'USD 310.00', overdue_dues: 1 },
        { month: '2026-05', tickets_opened: 4, tickets_resolved: 1, work_orders_opened: 2, work_orders_completed: 1, maintenance_spend_cents: 42000, maintenance_spend: 'USD 420.00', overdue_dues: 1 },
      ],
      work_order_story: [{
        id: 901,
        condominium_id: 45,
        condominium_name: 'Test Condo',
        ticket_id: 701,
        ticket_title: 'Garage gate vendor follow-up',
        title: 'Garage gate repair',
        scope: 'Repair sensor and verify closing cycle',
        status: 'in_progress',
        vendor_name: 'Lift Vendor',
        estimated_amount_cents: 39000,
        approved_amount_cents: 42000,
        scheduled_for: '2026-05-24T10:00:00.000Z',
        completed_at: null,
        updated_at: '2026-05-20T10:00:00.000Z',
        quote_count: 2,
        selected_quote_count: 1,
        route: '/board/tickets',
      }],
      buildings: [{
        id: 45,
        name: 'Test Condo',
        address: '1 Main',
        invite_code: 'TEST01',
        metrics,
        scorecard: {
          health_score: 49,
          risk_level: 'critical',
          maintenance_score: 30,
          finance_score: 86,
          community_score: 80,
          next_actions: [
            'Resolve urgent tickets before the next board check-in.',
            'Group recurring problems into one work plan with owner and budget.',
            'Chase stale vendor updates and log next steps.',
          ],
          drilldowns: [
            {
              kind: 'urgent_tickets',
              route: '/board/tickets',
              count: 1,
              records: [{
                id: 10,
                title: 'Elevator noise',
                detail: 'maintenance · urgent',
                status: 'open',
                route: '/board/tickets',
                occurred_at: '2026-05-02T10:00:00.000Z',
                follow_up: {
                  id: 1,
                  agency_id: 77,
                  condominium_id: 45,
                  kind: 'urgent_tickets',
                  record_id: '10',
                  owner_user_id: 501,
                  owner_email: 'maintenance@example.com',
                  owner_name: 'Maintenance Owner',
                  status: 'in_progress',
                  due_at: '2026-05-20T12:00:00.000Z',
                  note: 'Call vendor before board check-in',
                  created_at: '2026-05-18T12:00:00.000Z',
                  updated_at: '2026-05-18T12:00:00.000Z',
                },
              }],
            },
            {
              kind: 'vendor_follow_up_problems',
              route: '/board/tickets',
              count: 1,
              records: [{
                id: 11,
                title: 'Garage gate repair',
                detail: 'Lift Vendor',
                status: 'in_progress',
                route: '/board/tickets',
                occurred_at: '2026-05-11T10:00:00.000Z',
              }],
            },
          ],
        },
      }, {
        id: 46,
        name: 'North Tower',
        address: '2 Main',
        invite_code: 'NORTH1',
        metrics: {
          pending_residents: 0,
          unresolved_tickets: 0,
          urgent_tickets: 0,
          recurring_problem_clusters: 0,
          vendor_follow_up_problems: 0,
          overdue_dues: 1,
          pending_payment_proofs: 0,
          vendor_sla_problems: 0,
          proposals_missing_budget: 0,
          upcoming_meetings: 0,
        },
        scorecard: {
          health_score: 78,
          risk_level: 'watch',
          maintenance_score: 88,
          finance_score: 64,
          community_score: 90,
          next_actions: [
            'Review overdue dues and payment follow-up.',
          ],
          drilldowns: [],
        },
      }],
    }],
  };

  await page.route('**/api/agencies/portfolio', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: portfolio }),
  }));
  await page.route('**/api/admin/integrations/status', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      data: {
        private_access: { configured: true, required: true, active_setup_codes: 1, env_setup_codes: 1 },
        email: { configured: true, provider: 'smtp', from_configured: true },
        google_login: { configured: true },
        whatsapp: { configured: true, provider: 'waha', from: '+5511999002121' },
        uploads: { configured: true, driver: 'r2', bucket_configured: true },
        ai: { configured: true, model: 'openrouter' },
        backups: { configured: true, retention_days: 7, last_attempt_at: '2026-05-20T09:00:00.000Z' },
        observability: { sentry_configured: true, posthog_configured: true },
      },
    }),
  }));
  await page.route('**/api/agencies/77/setup-codes', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: { setup_codes: [] } }),
  }));
  await page.route('**/api/agencies/77/staff', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      data: {
        staff: [{
          id: 301,
          user_id: 501,
          email: 'maintenance@example.com',
          first_name: 'Maintenance',
          last_name: 'Owner',
          role: 'maintenance_manager',
          created_at: '2026-05-18T12:00:00.000Z',
          assigned_building_ids: [45],
        }],
        invites: [],
      },
    }),
  }));
  await page.route('**/api/agencies/77/audit-events**', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: { events: [] } }),
  }));

  await page.goto('/board/portfolio');
  await expect(page.getByRole('heading', { name: /Operational pace|Ritmo operacional/i })).toBeVisible();
  await expect(page.getByText(/6-month trend|Tendência de 6 meses/i)).toBeVisible();
  await expect(page.getByText('USD 420.00')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Ticket to completion|Chamado até conclusão/i })).toBeVisible();
  await expect(page.getByText('Garage gate repair').first()).toBeVisible();
  await expect(page.getByText('Garage gate vendor follow-up')).toBeVisible();
  await expect(page.getByText(/Vendor selected|Fornecedor definido/i)).toBeVisible();
  await expect(page.getByText(/Work order scheduled|Ordem agendada/i)).toBeVisible();
  await expect(page.getByText('Lift Vendor').first()).toBeVisible();
  await expect(page.getByText(/2 cotações|2 quotes/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Open tickets|Abrir chamados/i })).toBeVisible();
  await expect(page.getByText(/Operational health|Saúde operacional/i).first()).toBeVisible();
  await expect(page.getByText('49/100')).toBeVisible();
  await expect(page.getByText(/Critical|Crítico/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: /Follow-ups|Acompanhamentos/i })).toBeVisible();
  await expect(page.getByText(/Risks with an owner|Riscos com dono/i)).toBeVisible();
  await expect(page.getByText('Confirm payment promise before report export')).toBeVisible();
  await page.getByRole('button', { name: /Overdue|Atrasados/i }).click();
  await expect(page.getByText('Call vendor before board check-in')).toBeVisible();
  await expect(page.getByText('Confirm payment promise before report export')).toBeHidden();
  await page.getByRole('button', { name: /All|Todos/i }).first().click();
  await page.getByLabel(/Filter follow-ups by building|Filtrar acompanhamentos por prédio/i).selectOption('46');
  await expect(page.getByText('Confirm payment promise before report export')).toBeVisible();
  await expect(page.getByText('Call vendor before board check-in')).toBeHidden();
  await page.getByLabel(/Filter follow-ups by building|Filtrar acompanhamentos por prédio/i).selectOption('all');
  await expect(page.getByText(/Maintenance|Manutenção/i).first()).toBeVisible();
  await expect(page.getByText(/Chase stale vendor updates|Cobrar atualizações|Persigue actualizaciones|Relancez les mises/i).first()).toBeVisible();
  await expect(page.getByText(/Records explaining risk|Registros que explicam o risco/i)).toBeVisible();
  await expect(page.getByText('Elevator noise')).toBeVisible();
  await expect(page.getByText(/In progress|Em andamento|En curso/i).first()).toBeVisible();
  await expect(page.getByText(/Maintenance Owner/i).first()).toBeVisible();
  await expect(page.getByText('Garage gate repair').first()).toBeVisible();
});

test('admin: AI agent generates an operational plan', async ({ page, request }) => {
  await adminLogin(page, request);
  await page.goto('/board/agent');
  await expect(page.getByRole('heading', { name: /AI agent|Agente IA|Agent IA/i })).toBeVisible();
  const taskInput = page.getByRole('textbox', { name: /What do you want to solve|O que você quer resolver|Qué quieres resolver|Que voulez-vous résoudre/i });
  await expect(taskInput).toBeVisible();
  await taskInput.fill('Compare options to repair the gym treadmill and find maintenance vendors.');
  await page.getByRole('button', { name: /Generate plan|Gerar plano|Generar plan|Générer le plan/i }).click();
  const aiTimeout = process.env.E2E_HAS_LLM ? 60_000 : 20_000;
  await expect(page.getByText(/Recommended action|Ação recomendada|Acción recomendada|Action recommandée/i)).toBeVisible({ timeout: aiTimeout });
  await page.getByText(/Plan details|Detalhes do plano|Detalles del plan|Détails du plan/i).click();
  await expect(page.getByRole('heading', { name: /^(Options|Opções|Opciones|Recommendation|Recomendação|Recomendación|Recommandation)$/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^(Research plan|Plano de pesquisa|Plan de investigación|Plan de recherche)$/i })).toBeVisible();
});

test('admin: AI agent renders server-derived evidence cards', async ({ page, request }) => {
  await adminLogin(page, request);
  await page.route('**/api/ai/admin-agent', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          summary: 'Plano baseado em histórico real do prédio e uma fonte externa citada.',
          task_type: 'repair',
          assumptions: ['Valores precisam ser confirmados por orçamento formal.'],
          recommended_next_step: 'Acionar a Otis e comparar a cotação com a fonte externa.',
          existing_network_fit: [],
          options: [{
            title: 'Diagnóstico técnico',
            fit: 'Melhor primeiro passo.',
            pros: ['Usa fornecedor conhecido'],
            cons: ['Exige confirmação de agenda'],
            estimated_cost_range: 'Confirmar por orçamento.',
            timeline: '24-72h',
            questions_for_vendor: ['Qual a causa raiz?'],
            evaluation_criteria: ['Garantia', 'Prazo'],
          }],
          evidence_sources: [
            {
              type: 'past_ticket',
              title: 'Elevador A com ruído',
              detail: 'Resolvido em 2026-04-01 · fornecedor: Otis Elevadores SP',
            },
            {
              type: 'web_citation',
              title: 'Fornecedor externo citado',
              detail: 'Resultado externo usado como comparação.',
              url: 'https://example.com/vendor',
              source: 'test',
            },
          ],
          vendor_search_plan: {
            search_queries: ['manutenção elevador condomínio São Paulo'],
            shortlisting_criteria: ['Atende condomínios', 'Tem garantia'],
            outreach_message: 'Olá, preciso de diagnóstico para elevador em condomínio.',
          },
          action_plan: [],
          resident_update: { title: 'Elevador em análise', body: 'A administração está avaliando o reparo.' },
          proposal_draft: null,
          risks: ['Contratar sem escopo fechado aumenta risco de aditivo.'],
        },
      }),
    });
  });

  await page.goto('/board/agent');
  await page.getByRole('textbox', { name: /What do you want to solve|O que você quer resolver/i }).fill('Consertar o elevador A com ruído recorrente.');
  await page.getByRole('button', { name: /Generate plan|Gerar plano/i }).click();
  await page.locator('summary').filter({ hasText: /Technical diagnostics|Diagnóstico técnico/i }).click();
  await expect(page.getByRole('heading', { name: /Evidence used|Evidências usadas/i })).toBeVisible();
  await expect(page.getByText('Chamado anterior')).toBeVisible();
  await expect(page.getByText('Citação web')).toBeVisible();
  await expect(page.getByText('Elevador A com ruído')).toBeVisible();
  const source = page.getByRole('link', { name: /Open source|Abrir fonte/i });
  await expect(source).toHaveAttribute('href', 'https://example.com/vendor');
  await expect(page.getByRole('link', { name: /Search vendors|Buscar fornecedores/i })).toHaveAttribute('href', /google\.com\/search/);
  await page.getByText(/Plan details|Detalhes do plano/i).click();
  await expect(page.getByRole('button', { name: /Save vendor|Cadastrar fornecedor/i }).first()).toBeVisible();
});

test('admin: AI fallback state stays actionable without false credit copy', async ({ page, request }) => {
  await adminLogin(page, request);
  await page.route('**/api/ai/admin-agent', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          summary: 'Checklist seguro para triagem operacional.',
          task_type: 'repair',
          assumptions: ['Resposta degradada.'],
          recommended_next_step: 'Pedir diagnóstico técnico por escrito.',
          existing_network_fit: [],
          options: [],
          vendor_search_plan: {
            search_queries: ['assistência portão garagem condomínio São Paulo'],
            shortlisting_criteria: ['Atende condomínio', 'Tem plantão'],
            outreach_message: 'Olá, preciso avaliar o portão da garagem. Pode atender hoje?',
          },
          action_plan: [],
          resident_update: { title: 'Portão em avaliação', body: 'A administração está avaliando o reparo.' },
          proposal_draft: null,
          risks: ['Sem diagnóstico ainda.'],
          _fallback: true,
          ai_status: 'degraded',
        },
      }),
    });
  });

  await page.goto('/board/agent');
  await page.getByRole('textbox', { name: /What do you want to solve|O que você quer resolver/i }).fill('Consertar portão da garagem que está travando.');
  await page.getByRole('button', { name: /Generate plan|Gerar plano/i }).click();
  await expect(page.getByText(/AI incomplete|IA incompleta/i)).toBeVisible();
  await expect(page.getByText(/copy messages|copiar mensagens/i)).toBeVisible();
  await expect(page.getByText(/out of credits|sem créditos/i)).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Search vendors|Buscar fornecedores/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Copy message|Copiar mensagem/i }).first()).toBeVisible();
});

test('admin: AI unclear input asks for detail without showing vendor dead ends', async ({ page, request }) => {
  await adminLogin(page, request);
  await page.route('**/api/ai/admin-agent', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          summary: 'Ainda faltam detalhes para eu recomendar fornecedor, custo ou plano de ação sem inventar contexto.',
          task_type: 'general',
          assumptions: [],
          recommended_next_step: 'Informe o problema específico, local exato, urgência e qualquer foto, orçamento ou fornecedor já acionado.',
          existing_network_fit: [],
          options: [],
          vendor_search_plan: { search_queries: [], shortlisting_criteria: [], outreach_message: '' },
          action_plan: [],
          resident_update: { title: '', body: '' },
          proposal_draft: null,
          risks: ['Escopo insuficiente.'],
          confidence: { score: 0.3, tier: 'low', reasoning: ['Faltam detalhes.'] },
          follow_up_suggestions: [
            'Qual é o problema específico e em qual área do prédio acontece?',
            'Existe risco imediato de segurança, água, gás, elevador ou acesso?',
          ],
        },
      }),
    });
  });

  await page.goto('/board/agent');
  await page.getByRole('textbox', { name: /What do you want to solve|O que você quer resolver/i }).fill('O prédio precisa de ajuda urgente com algumas coisas.');
  await page.getByRole('button', { name: /Generate plan|Gerar plano/i }).click();
  await expect(page.getByText(/faltam detalhes|more detail/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /problema específico|specific issue/i })).toBeVisible();
  await expect(page.getByText(/Sua rede cadastrada|Saved network/i)).toHaveCount(0);
  await expect(page.getByText(/Comunicado aos moradores|Resident update/i)).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Search vendors|Buscar fornecedores/i })).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// /board/proposals — list + click into detail + voting compliance editor
// ---------------------------------------------------------------------------

test('admin: proposals list shows real items + status badges', async ({ page, request }) => {
  await adminLogin(page, request);
  await page.goto('/board/proposals');
  await expect(page.getByRole('heading', { name: /Proposals|Propostas/i })).toBeVisible();
  const cards = page.locator('a[href*="/board/proposals/"]');
  if (!(await cards.first().waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false))) {
    await expect(page.getByText(/No proposals|Nenhuma proposta|Ninguna propuesta|Aucune proposition/i).first()).toBeVisible();
    return;
  }
  await expect(cards.first()).toBeVisible();
});

test('admin: proposal detail shows description + comments + voting cards', async ({ page, request }) => {
  await adminLogin(page, request);
  await page.goto('/board/proposals');
  const firstCard = page.locator('a[href*="/board/proposals/"]').first();
  if (!(await firstCard.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false))) {
    await expect(page.getByText(/No proposals|Nenhuma proposta|Ninguna propuesta|Aucune proposition/i).first()).toBeVisible();
    return;
  }
  await firstCard.click();
  // We're on detail. Check for at least: heading, vote count cards (Yes/No/Abstain), action button or status badge
  await expect(page.getByRole('heading').first()).toBeVisible();
  // The 3-up vote tally cards should be present (Yes/No/Abstain)
  await expect(page.getByText(/Yes|Sim/i).first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// /board/suggestions — list + AI cluster button
// ---------------------------------------------------------------------------

test('admin: suggestions page surfaces the cluster CTA when items exist', async ({ page, request }) => {
  await adminLogin(page, request);
  await page.goto('/board/suggestions');
  await expect(page.getByRole('heading', { level: 1, name: /Suggestions|Sugest/i })).toBeVisible();
  // The cluster button is only visible if there are open suggestions; the demo seed has some.
  // Either we see it OR we see an empty state — both are valid renders.
  const clusterBtn = page.getByRole('button', { name: /cluster|agrupar/i }).first();
  const empty = page.getByText(/no open|nenhuma|empty/i).first();
  await expect(clusterBtn.or(empty)).toBeVisible();
});

// ---------------------------------------------------------------------------
// /board/pending — pending memberships
// ---------------------------------------------------------------------------

test('admin: pending memberships page renders', async ({ page, request }) => {
  await adminLogin(page, request);
  await page.goto('/board/pending');
  // Use level: 1 to scope to the page H1 — there's also an h3 "Nothing pending" empty state
  await expect(page.getByRole('heading', { level: 1, name: /Pending|Pendente/i })).toBeVisible();
  await expect(page.locator('aside')).toBeVisible();
});

// ---------------------------------------------------------------------------
// /board/assemblies — full lifecycle UI (create → agenda → convoke)
// ---------------------------------------------------------------------------

test('admin: assemblies list shows existing AGOs', async ({ page, request }) => {
  await adminLogin(page, request);
  await page.goto('/board/assemblies');
  await expect(page.getByRole('heading', { name: /Assemblies|Assembleias/i })).toBeVisible();
  // The "New assembly" button must always be visible to admins
  await expect(page.getByRole('button', { name: /New assembly|Nova assembleia/i })).toBeVisible();
});

test('admin: assembly detail shows agenda + lifecycle buttons in correct state', async ({ page, request }) => {
  // Create an ephemeral assembly via API so the test is deterministic
  const creds = credentialsFor('admin');
  const { token } = await loginApi(request, creds.email, creds.password);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const r = await request.post(`${apiURL}/assemblies`, {
    headers, data: { title: `walkthrough ${Date.now()}`, kind: 'ordinary', first_call_at: future },
  });
  const id = (await r.json()).data.id;

  await adminLogin(page, request);
  await page.goto(`/board/assemblies/${id}`);
  // Empty agenda state + the AI-draft CTA + "Add item" form should all be visible
  await expect(page.getByRole('button', { name: /Convoke|Convocar/i })).toBeVisible();
  await expect(page.getByPlaceholder(/Item title|Título do item/i)).toBeVisible();
  // The "Draft with AI" CTA shows only when agenda is empty
  await expect(page.getByRole('button', { name: /Draft with AI|Redigir com IA/i })).toBeVisible();
});

// ---------------------------------------------------------------------------
// /board/meetings — list + new-meeting form
// ---------------------------------------------------------------------------

test('admin: meetings page exposes "New meeting" button + form opens', async ({ page, request }) => {
  await adminLogin(page, request);
  await page.goto('/board/meetings');
  await expect(page.getByRole('heading', { name: /Meetings|Reuniões/i })).toBeVisible();
  const newBtn = page.getByRole('button', { name: /New meeting|Nova reunião/i });
  await expect(newBtn).toBeVisible();
  await newBtn.click();
  // The form's title input should now be visible (placeholder mentions Q3 / Board Meeting)
  await expect(page.getByPlaceholder(/Q3|Title|Board Meeting|Título|Reunião do síndico/i).first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// /board/announcements — list + create button
// ---------------------------------------------------------------------------

test('admin: announcements page surfaces create CTA', async ({ page, request }) => {
  await adminLogin(page, request);
  await page.goto('/board/announcements');
  await expect(page.getByRole('heading', { name: /Announcements|Comunic/i })).toBeVisible();
  // Either there's a create button or a primary CTA somewhere visible
  const newBtn = page.getByRole('button', { name: /New|Novo|Create|Criar/i }).first();
  await expect(newBtn).toBeVisible();
});

// ---------------------------------------------------------------------------
// /board/residents — table + Import roster button
// ---------------------------------------------------------------------------

test('admin: residents page lists residents + has import roster button', async ({ page, request }) => {
  await adminLogin(page, request);
  await page.goto('/board/residents');
  await expect(page.getByRole('heading', { name: /Residents|Moradores/i })).toBeVisible();
  // Import roster button always visible
  await expect(page.getByRole('button', { name: /Import roster|Importar/i }).first()).toBeVisible();
  const residentCard = page.locator('main').getByText(/@/).first();
  const empty = page.getByText(/No residents|Nenhum morador|Aún no hay residentes|Aucun résident/i).first();
  await expect(residentCard.or(empty)).toBeVisible();
});

// ---------------------------------------------------------------------------
// Cross-cutting — sidebar navigation works between any two pages
// ---------------------------------------------------------------------------

test('admin: sidebar nav links round-trip between pages', async ({ page, request, isMobile }) => {
  await adminLogin(page, request);
  await page.goto('/board');
  await (await nav(page, isMobile)).getByRole('link', { name: /^(Proposals|Propostas)$/i }).click();
  await expect(page).toHaveURL(/\/board\/proposals$/);
  await (await nav(page, isMobile)).getByRole('link', { name: /^(Assemblies|Assembleias)$/i }).click();
  await expect(page).toHaveURL(/\/board\/assemblies$/);
  await (await nav(page, isMobile)).getByRole('link', { name: /^(Residents|Moradores)$/i }).click();
  await expect(page).toHaveURL(/\/board\/residents$/);
  await (await nav(page, isMobile)).getByRole('link', { name: /^(Overview|Visão geral)$/i }).click();
  await expect(page).toHaveURL(/\/board$/);
});
