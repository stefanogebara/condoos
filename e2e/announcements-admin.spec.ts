// Announcements: admin create (pinned, linked, plain), resident access control,
// list ordering (pinned first).
import { expect, test, type APIRequestContext } from '@playwright/test';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4316/api');

type Session = { token: string; user: any };
const sessionCache = new Map<string, Session>();

async function loginApi(request: APIRequestContext, email: string, password: string): Promise<Session> {
  const cached = sessionCache.get(email);
  if (cached) return cached;
  const r = await request.post(`${apiURL}/auth/login`, { data: { email, password } });
  expect(r.ok(), `login failed for ${email}: ${r.status()} ${await r.text()}`).toBeTruthy();
  const session = (await r.json()).data as Session;
  sessionCache.set(email, session);
  return session;
}

// ---------------------------------------------------------------------------
// 1. Admin creates a plain announcement → resident sees it in the list
// ---------------------------------------------------------------------------

test('Announcements: admin creates → resident can read it in the list', async ({ request }) => {
  const admin    = await loginApi(request, 'admin@condoos.dev',    'admin123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const admH  = { Authorization: `Bearer ${admin.token}`,    'Content-Type': 'application/json' };
  const resH  = { Authorization: `Bearer ${resident.token}` };

  const tag = Date.now();
  const createRes = await request.post(`${apiURL}/announcements`, {
    headers: admH,
    data: {
      title: `E2E Announcement ${tag}`,
      body:  'Manutenção programada do elevador nesta sexta-feira das 8h às 18h.',
      pinned: false,
    },
  });
  expect(createRes.ok(), `create failed: ${createRes.status()} ${await createRes.text()}`).toBeTruthy();
  const annId: number = (await createRes.json()).data.id;
  expect(annId).toBeGreaterThan(0);

  // Resident lists announcements and finds the new one
  const listRes  = await request.get(`${apiURL}/announcements`, { headers: resH });
  expect(listRes.ok()).toBeTruthy();
  const list = (await listRes.json()).data as any[];
  const found = list.find((a: any) => a.id === annId);
  expect(found, `announcement ${annId} not found in resident list`).toBeTruthy();
  expect(found.title).toContain(`E2E Announcement ${tag}`);
});

// ---------------------------------------------------------------------------
// 2. Admin creates a pinned announcement → it appears first in the list
// ---------------------------------------------------------------------------

test('Announcements: pinned announcement appears before unpinned ones', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const admH  = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  const tag = Date.now();

  // Create unpinned first
  await request.post(`${apiURL}/announcements`, {
    headers: admH,
    data: { title: `E2E Unpinned ${tag}`, body: 'Aviso normal.', pinned: false },
  });

  // Create pinned after (same timestamp, but pinned should sort first)
  const pinnedRes = await request.post(`${apiURL}/announcements`, {
    headers: admH,
    data: { title: `E2E Pinned ${tag}`, body: 'Aviso importante!', pinned: true },
  });
  const pinnedId: number = (await pinnedRes.json()).data.id;

  const listRes = await request.get(`${apiURL}/announcements`, { headers: admH });
  const list    = (await listRes.json()).data as any[];

  // The pinned one must appear before any unpinned ones
  const pinnedIndex   = list.findIndex((a: any) => a.id === pinnedId);
  const unpinnedIndex = list.findIndex((a: any) => !a.pinned);

  expect(pinnedIndex).toBeGreaterThanOrEqual(0);
  if (unpinnedIndex >= 0) {
    expect(pinnedIndex).toBeLessThan(unpinnedIndex);
  }
});

// ---------------------------------------------------------------------------
// 3. Admin creates announcement linked to a proposal
// ---------------------------------------------------------------------------

test('Announcements: admin links announcement to a proposal', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const admH  = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  // Create a proposal to link to
  const propRes = await request.post(`${apiURL}/proposals`, {
    headers: admH,
    data: { title: `E2E Linked Proposal ${Date.now()}`, description: 'Proposta para vincular ao aviso.' },
  });
  const propId: number = (await propRes.json()).data.id;

  const createRes = await request.post(`${apiURL}/announcements`, {
    headers: admH,
    data: {
      title: `E2E Linked Ann ${Date.now()}`,
      body:  'A proposta de reforma foi aprovada em assembleia.',
      related_proposal_id: propId,
    },
  });
  expect(createRes.ok()).toBeTruthy();
  const annId: number = (await createRes.json()).data.id;

  const listRes = await request.get(`${apiURL}/announcements`, { headers: admH });
  const list    = (await listRes.json()).data as any[];
  const found   = list.find((a: any) => a.id === annId);
  expect(found?.related_proposal_id).toBe(propId);
});

// ---------------------------------------------------------------------------
// 4. Resident cannot create announcements (403)
// ---------------------------------------------------------------------------

test('Announcements: resident gets 403 trying to create', async ({ request }) => {
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const resH     = { Authorization: `Bearer ${resident.token}`, 'Content-Type': 'application/json' };

  const createRes = await request.post(`${apiURL}/announcements`, {
    headers: resH,
    data: { title: 'Tentativa não autorizada', body: 'Isso não deveria funcionar.' },
  });
  expect(createRes.status()).toBe(403);
});

// ---------------------------------------------------------------------------
// 5. Validation: missing title or body is rejected
// ---------------------------------------------------------------------------

test('Announcements: missing required fields are rejected', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const admH  = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  // Missing body
  const noBody = await request.post(`${apiURL}/announcements`, {
    headers: admH,
    data: { title: 'Sem corpo' },
  });
  expect(noBody.status()).toBeGreaterThanOrEqual(400);

  // Missing title
  const noTitle = await request.post(`${apiURL}/announcements`, {
    headers: admH,
    data: { body: 'Sem título' },
  });
  expect(noTitle.status()).toBeGreaterThanOrEqual(400);
});
