// Pre-vote cost + risk analysis (#13).
//
// - discussion → voting transition is blocked until estimated_cost > 0
//   (returns 409 missing_cost_estimate)
// - POST /api/ai/proposals/:id/analyze-cost generates cost + risk fields
//   (works with the OpenRouter key set, falls back gracefully without)
import { expect, test, type APIRequestContext } from '@playwright/test';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4312/api');

async function adminToken(request: APIRequestContext): Promise<string> {
  const r = await request.post(`${apiURL}/auth/login`, {
    data: { email: 'admin@condoos.dev', password: 'admin123' },
  });
  expect(r.ok()).toBeTruthy();
  return (await r.json()).data.token;
}

async function createDiscussionProposal(request: APIRequestContext, token: string): Promise<number> {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const created = await request.post(`${apiURL}/proposals`, {
    headers,
    data: {
      title: `E2E cost-gate ${Date.now()}`,
      description: 'Proposta de teste para validar o portão de custo antes da votação.',
      category: 'maintenance',
      // No estimated_cost — should block voting transition.
    },
  });
  expect(created.ok(), `create failed: ${created.status()} ${await created.text()}`).toBeTruthy();
  return (await created.json()).data.id as number;
}

test('Proposals API: opening voting without estimated_cost is blocked with 409', async ({ request }) => {
  const token = await adminToken(request);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const id = await createDiscussionProposal(request, token);

  const tryOpen = await request.post(`${apiURL}/proposals/${id}/status`, {
    headers, data: { status: 'voting' },
  });
  expect(tryOpen.status()).toBe(409);
  expect((await tryOpen.json()).error).toBe('missing_cost_estimate');

  // After patching a cost manually, the same transition should succeed.
  // (Direct UPDATE via /proposals/:id endpoint isn't exposed; just call the
  // proposals create endpoint with a cost. We'll re-create with an estimate.)
  const ok = await request.post(`${apiURL}/proposals`, {
    headers,
    data: {
      title: `E2E cost-gate-ok ${Date.now()}`,
      description: 'Proposal with a fixed cost — voting transition expected.',
      category: 'maintenance',
      estimated_cost: 12000,
    },
  });
  expect(ok.ok()).toBeTruthy();
  const okId = (await ok.json()).data.id as number;

  const transition = await request.post(`${apiURL}/proposals/${okId}/status`, {
    headers, data: { status: 'voting' },
  });
  expect(transition.ok(), `voting transition blocked: ${transition.status()}`).toBeTruthy();
});

test('AI: analyze-cost fills estimated_cost + cost_breakdown + risk_summary', async ({ request }) => {
  const token = await adminToken(request);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const id = await createDiscussionProposal(request, token);

  const res = await request.post(`${apiURL}/ai/proposals/${id}/analyze-cost`, { headers });
  expect(res.ok(), `analyze-cost failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()).data as {
    estimated_cost: number;
    cost_breakdown: string;
    risk_summary: string;
  };

  // The fallback returns 0 + "—" + a short message; the live LLM returns
  // realistic numbers. Either is a valid pass — we just check the contract.
  expect(typeof body.estimated_cost).toBe('number');
  expect(body.estimated_cost).toBeGreaterThanOrEqual(0);
  expect(typeof body.cost_breakdown).toBe('string');
  expect(typeof body.risk_summary).toBe('string');
  expect(body.risk_summary.length).toBeGreaterThan(5);

  // Pull the proposal back and confirm the fields are persisted.
  const detail = await request.get(`${apiURL}/proposals/${id}`, { headers });
  const proposal = (await detail.json()).data;
  expect(proposal.estimated_cost).toBe(body.estimated_cost);
  expect(proposal.cost_breakdown).toBe(body.cost_breakdown);
  expect(proposal.risk_summary).toBe(body.risk_summary);
});
