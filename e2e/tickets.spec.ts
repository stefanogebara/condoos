// Tickets module: full CRUD, comments, attachments, status lifecycle,
// role-based access control, and tenant scoping.
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
// 1. Resident creates a ticket → admin updates status → both comment
// ---------------------------------------------------------------------------

test('Tickets: resident creates → admin updates status → both comment', async ({ request }) => {
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const admin    = await loginApi(request, 'admin@condoos.dev',    'admin123');
  const resH  = { Authorization: `Bearer ${resident.token}`, 'Content-Type': 'application/json' };
  const admH  = { Authorization: `Bearer ${admin.token}`,    'Content-Type': 'application/json' };

  // Resident creates a ticket
  const tag = Date.now();
  const createRes = await request.post(`${apiURL}/tickets`, {
    headers: resH,
    data: {
      title: `E2E Ticket ${tag}`,
      description: 'Luz do corredor do 2o andar piscando há 3 dias.',
      category: 'maintenance',
      priority: 'high',
    },
  });
  expect(createRes.status()).toBe(201);
  const ticketId: number = (await createRes.json()).data.id;
  expect(ticketId).toBeGreaterThan(0);

  // Resident retrieves the ticket
  const detailRes = await request.get(`${apiURL}/tickets/${ticketId}`, { headers: resH });
  expect(detailRes.ok()).toBeTruthy();
  const ticket = (await detailRes.json()).data;
  expect(ticket.title).toContain(`E2E Ticket ${tag}`);
  expect(ticket.status).toBe('open');
  expect(ticket.priority).toBe('high');

  // Resident adds a public comment
  const commentRes = await request.post(`${apiURL}/tickets/${ticketId}/comments`, {
    headers: resH,
    data: { body: 'Confirmado — piscando toda noite.', internal: false },
  });
  expect(commentRes.status()).toBe(201);

  // Admin updates status to in_progress
  const patchRes = await request.patch(`${apiURL}/tickets/${ticketId}`, {
    headers: admH,
    data: { status: 'in_progress' },
  });
  expect(patchRes.ok()).toBeTruthy();

  // Admin adds an internal comment (resident should not see it in filtered views)
  const internalRes = await request.post(`${apiURL}/tickets/${ticketId}/comments`, {
    headers: admH,
    data: { body: 'Chamado aberto com Elétrica Veloso.', internal: true },
  });
  expect(internalRes.status()).toBe(201);

  // Verify updated status via detail endpoint
  const updatedRes = await request.get(`${apiURL}/tickets/${ticketId}`, { headers: admH });
  const updated = (await updatedRes.json()).data;
  expect(updated.status).toBe('in_progress');
  expect(updated.comments.length).toBeGreaterThanOrEqual(2);
});

// ---------------------------------------------------------------------------
// 2. Full status lifecycle: open → in_progress → waiting → resolved → closed
// ---------------------------------------------------------------------------

test('Tickets: full status lifecycle open→in_progress→waiting→resolved→closed', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const admH  = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  const createRes = await request.post(`${apiURL}/tickets`, {
    headers: admH,
    data: {
      title: `E2E Lifecycle ${Date.now()}`,
      description: 'Fechadura da sala de reunião com defeito.',
      category: 'maintenance',
      priority: 'normal',
    },
  });
  const ticketId: number = (await createRes.json()).data.id;

  for (const status of ['in_progress', 'waiting', 'resolved', 'closed'] as const) {
    const r = await request.patch(`${apiURL}/tickets/${ticketId}`, {
      headers: admH,
      data: { status },
    });
    expect(r.ok(), `failed to set status=${status}: ${r.status()}`).toBeTruthy();
  }

  const final = (await (await request.get(`${apiURL}/tickets/${ticketId}`, { headers: admH })).json()).data;
  expect(final.status).toBe('closed');
});

// ---------------------------------------------------------------------------
// 3. Attachments: admin adds + deletes; resident cannot delete
// ---------------------------------------------------------------------------

test('Tickets: admin adds attachment; resident cannot delete it', async ({ request }) => {
  const admin    = await loginApi(request, 'admin@condoos.dev',    'admin123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const admH  = { Authorization: `Bearer ${admin.token}`,    'Content-Type': 'application/json' };
  const resH  = { Authorization: `Bearer ${resident.token}`, 'Content-Type': 'application/json' };

  const createRes = await request.post(`${apiURL}/tickets`, {
    headers: admH,
    data: { title: `E2E Attach ${Date.now()}`, description: 'Teste de anexo.' },
  });
  const ticketId: number = (await createRes.json()).data.id;

  // Admin attaches a file
  const attachRes = await request.post(`${apiURL}/tickets/${ticketId}/attachments`, {
    headers: admH,
    data: {
      url: 'https://example.com/foto-fechadura.jpg',
      filename: 'foto-fechadura.jpg',
      content_type: 'image/jpeg',
    },
  });
  expect(attachRes.status()).toBe(201);
  const attachId: number = (await attachRes.json()).data.id;

  // Resident cannot delete it
  const delByResident = await request.delete(`${apiURL}/tickets/${ticketId}/attachments/${attachId}`, { headers: resH });
  expect(delByResident.status()).toBe(403);

  // Admin can delete it
  const delByAdmin = await request.delete(`${apiURL}/tickets/${ticketId}/attachments/${attachId}`, { headers: admH });
  expect(delByAdmin.ok()).toBeTruthy();
  expect((await delByAdmin.json()).data.deleted).toBe(true);
});

// ---------------------------------------------------------------------------
// 4. Scoping: resident only sees their own tickets; admin sees all
// ---------------------------------------------------------------------------

test('Tickets: resident only sees own tickets; admin sees all', async ({ request }) => {
  const admin    = await loginApi(request, 'admin@condoos.dev',    'admin123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const admH  = { Authorization: `Bearer ${admin.token}`,    'Content-Type': 'application/json' };
  const resH  = { Authorization: `Bearer ${resident.token}`, 'Content-Type': 'application/json' };

  // Admin creates a ticket (not on behalf of resident)
  const adminTicketRes = await request.post(`${apiURL}/tickets`, {
    headers: admH,
    data: { title: `E2E Admin Ticket ${Date.now()}`, description: 'Ticket criado pelo síndico.' },
  });
  const adminTicketId: number = (await adminTicketRes.json()).data.id;

  // Resident creates their own ticket
  const resTicketRes = await request.post(`${apiURL}/tickets`, {
    headers: resH,
    data: { title: `E2E Resident Ticket ${Date.now()}`, description: 'Ticket do morador.' },
  });
  const resTicketId: number = (await resTicketRes.json()).data.id;

  // Admin list includes both
  const adminList = (await (await request.get(`${apiURL}/tickets`, { headers: admH })).json()).data as any[];
  const adminIds = adminList.map((t: any) => t.id);
  expect(adminIds).toContain(adminTicketId);
  expect(adminIds).toContain(resTicketId);

  // Resident list only contains their own (resTicketId present, adminTicketId absent)
  const resList = (await (await request.get(`${apiURL}/tickets`, { headers: resH })).json()).data as any[];
  const resIds = resList.map((t: any) => t.id);
  expect(resIds).toContain(resTicketId);
  expect(resIds).not.toContain(adminTicketId);
});

// ---------------------------------------------------------------------------
// 5. Authorization: resident cannot patch status
// ---------------------------------------------------------------------------

test('Tickets: resident gets 403 trying to patch status', async ({ request }) => {
  const admin    = await loginApi(request, 'admin@condoos.dev',    'admin123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const admH  = { Authorization: `Bearer ${admin.token}`,    'Content-Type': 'application/json' };
  const resH  = { Authorization: `Bearer ${resident.token}`, 'Content-Type': 'application/json' };

  // Create ticket as resident
  const createRes = await request.post(`${apiURL}/tickets`, {
    headers: resH,
    data: { title: `E2E Auth ${Date.now()}`, description: 'Teste de autorização.' },
  });
  const ticketId: number = (await createRes.json()).data.id;

  // Resident tries to patch — should get 403
  const patchRes = await request.patch(`${apiURL}/tickets/${ticketId}`, {
    headers: resH,
    data: { status: 'resolved' },
  });
  expect(patchRes.status()).toBe(403);

  // Admin can
  const patchAdm = await request.patch(`${apiURL}/tickets/${ticketId}`, {
    headers: admH,
    data: { status: 'resolved' },
  });
  expect(patchAdm.ok()).toBeTruthy();
});

// ---------------------------------------------------------------------------
// 6. Filter by status
// ---------------------------------------------------------------------------

test('Tickets: GET /tickets?status= filter works', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const admH  = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  // Create an open and a resolved ticket
  const t1 = await request.post(`${apiURL}/tickets`, {
    headers: admH,
    data: { title: `E2E Filter Open ${Date.now()}`, description: 'Open ticket.' },
  });
  const t1Id: number = (await t1.json()).data.id;

  const t2 = await request.post(`${apiURL}/tickets`, {
    headers: admH,
    data: { title: `E2E Filter Resolved ${Date.now()}`, description: 'Resolved ticket.' },
  });
  const t2Id: number = (await t2.json()).data.id;
  await request.patch(`${apiURL}/tickets/${t2Id}`, { headers: admH, data: { status: 'resolved' } });

  const openList = (await (await request.get(`${apiURL}/tickets?status=open`, { headers: admH })).json()).data as any[];
  expect(openList.some((t: any) => t.id === t1Id)).toBe(true);
  expect(openList.some((t: any) => t.id === t2Id)).toBe(false);

  const resolvedList = (await (await request.get(`${apiURL}/tickets?status=resolved`, { headers: admH })).json()).data as any[];
  expect(resolvedList.some((t: any) => t.id === t2Id)).toBe(true);
  expect(resolvedList.some((t: any) => t.id === t1Id)).toBe(false);
});
