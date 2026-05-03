// Meetings module: create, notes, action items, toggle, complete, access control.
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
// 1. Admin full workflow: create → notes → action items → toggle → complete
// ---------------------------------------------------------------------------

test('Meetings: admin creates → updates notes → adds action items → toggles → completes', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const admH  = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const tag = Date.now();

  // Create
  const createRes = await request.post(`${apiURL}/meetings`, {
    headers: admH,
    data: { title: `E2E Meeting ${tag}`, scheduled_for: future, agenda: 'Pauta: manutenção da piscina.' },
  });
  expect(createRes.status(), `create failed: ${createRes.status()}`).toBeLessThan(300);
  const meetingId: number = (await createRes.json()).data.id;
  expect(meetingId).toBeGreaterThan(0);

  // Update notes
  const notesRes = await request.patch(`${apiURL}/meetings/${meetingId}/notes`, {
    headers: admH,
    data: { raw_notes: 'Reunião iniciada às 19h. Aprovada a troca da bomba da piscina por 3x1.' },
  });
  expect(notesRes.ok(), `notes patch failed: ${notesRes.status()}`).toBeTruthy();

  // Add two action items
  const ai1Res = await request.post(`${apiURL}/meetings/${meetingId}/action-items`, {
    headers: admH,
    data: { description: 'Contratar Hidro Service para avaliação', owner_label: 'Síndico' },
  });
  expect(ai1Res.ok()).toBeTruthy();
  const ai1Id: number = (await ai1Res.json()).data.id;

  const ai2Res = await request.post(`${apiURL}/meetings/${meetingId}/action-items`, {
    headers: admH,
    data: {
      description: 'Enviar 3 orçamentos para assembleia',
      due_date: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    },
  });
  expect(ai2Res.ok()).toBeTruthy();

  // Toggle action item 1 to done
  const toggleRes = await request.post(`${apiURL}/meetings/action-items/${ai1Id}/toggle`, { headers: admH });
  expect(toggleRes.ok()).toBeTruthy();
  expect((await toggleRes.json()).data.status).toBe('done');

  // Toggle again → back to open
  const toggle2Res = await request.post(`${apiURL}/meetings/action-items/${ai1Id}/toggle`, { headers: admH });
  expect((await toggle2Res.json()).data.status).toBe('open');

  // Complete meeting
  const completeRes = await request.post(`${apiURL}/meetings/${meetingId}/complete`, { headers: admH });
  expect(completeRes.ok()).toBeTruthy();
  expect((await completeRes.json()).data.status).toBe('completed');

  // Verify via GET
  const detail = (await (await request.get(`${apiURL}/meetings/${meetingId}`, { headers: admH })).json()).data;
  expect(detail.status).toBe('completed');
  expect(detail.raw_notes).toContain('bomba da piscina');
  expect(detail.action_items.length).toBe(2);
});

// ---------------------------------------------------------------------------
// 2. Resident can read meetings but cannot create, patch notes, or complete
// ---------------------------------------------------------------------------

test('Meetings: resident can list and read; cannot create or complete', async ({ request }) => {
  const admin    = await loginApi(request, 'admin@condoos.dev',    'admin123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const admH  = { Authorization: `Bearer ${admin.token}`,    'Content-Type': 'application/json' };
  const resH  = { Authorization: `Bearer ${resident.token}`, 'Content-Type': 'application/json' };

  // Admin creates a meeting for the resident to read
  const future = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
  const createRes = await request.post(`${apiURL}/meetings`, {
    headers: admH,
    data: { title: `E2E Read ${Date.now()}`, scheduled_for: future },
  });
  const meetingId: number = (await createRes.json()).data.id;

  // Resident can list
  const listRes = await request.get(`${apiURL}/meetings`, { headers: resH });
  expect(listRes.ok()).toBeTruthy();
  const list = (await listRes.json()).data as any[];
  expect(list.some((m: any) => m.id === meetingId)).toBe(true);

  // Resident can get detail
  const detailRes = await request.get(`${apiURL}/meetings/${meetingId}`, { headers: resH });
  expect(detailRes.ok()).toBeTruthy();

  // Resident cannot create
  const createByRes = await request.post(`${apiURL}/meetings`, {
    headers: resH,
    data: { title: 'Tentativa', scheduled_for: future },
  });
  expect(createByRes.status()).toBe(403);

  // Resident cannot update notes
  const notesRes = await request.patch(`${apiURL}/meetings/${meetingId}/notes`, {
    headers: resH,
    data: { raw_notes: 'hacking notes' },
  });
  expect(notesRes.status()).toBe(403);

  // Resident cannot complete
  const completeRes = await request.post(`${apiURL}/meetings/${meetingId}/complete`, { headers: resH });
  expect(completeRes.status()).toBe(403);
});

// ---------------------------------------------------------------------------
// 3. List ordering: meetings returned with most recent first
// ---------------------------------------------------------------------------

test('Meetings: list returns ordered by scheduled_for DESC', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const admH  = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  const base = Date.now();
  const older = new Date(base + 1 * 24 * 3600 * 1000).toISOString();
  const newer = new Date(base + 5 * 24 * 3600 * 1000).toISOString();

  await request.post(`${apiURL}/meetings`, {
    headers: admH,
    data: { title: `E2E Older ${base}`, scheduled_for: older },
  });
  await request.post(`${apiURL}/meetings`, {
    headers: admH,
    data: { title: `E2E Newer ${base}`, scheduled_for: newer },
  });

  const listRes = await request.get(`${apiURL}/meetings`, { headers: admH });
  const list = (await listRes.json()).data as any[];
  // First item should be scheduled later than second (DESC)
  if (list.length >= 2) {
    expect(new Date(list[0].scheduled_for) >= new Date(list[1].scheduled_for)).toBe(true);
  }
});

// ---------------------------------------------------------------------------
// 4. Action item requires description (validation)
// ---------------------------------------------------------------------------

test('Meetings: action item with empty description is rejected', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const admH  = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const createRes = await request.post(`${apiURL}/meetings`, {
    headers: admH,
    data: { title: `E2E Validation ${Date.now()}`, scheduled_for: future },
  });
  const meetingId: number = (await createRes.json()).data.id;

  const badRes = await request.post(`${apiURL}/meetings/${meetingId}/action-items`, {
    headers: admH,
    data: { description: '' },
  });
  expect(badRes.status()).toBeGreaterThanOrEqual(400);
});
