// Tickets module: full CRUD, comments, attachments, status lifecycle,
// role-based access control, and tenant scoping.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

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

async function installSession(page: Page, session: Session) {
  await page.addInitScript((args: { token: string; user: unknown }) => {
    localStorage.setItem('condoos_token', args.token);
    localStorage.setItem('condoos_user', JSON.stringify(args.user));
  }, { token: session.token, user: session.user });
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

test('Tickets: resident community report appears on admin ticket page', async ({ request, page }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const resH = { Authorization: `Bearer ${resident.token}`, 'Content-Type': 'application/json' };
  const admH = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };
  const title = `E2E Community Visibility ${Date.now()}`;

  const createRes = await request.post(`${apiURL}/tickets`, {
    headers: resH,
    data: {
      title,
      description: 'Community-visible issue that should land on the admin board.',
      category: 'maintenance',
      priority: 'normal',
      verification_threshold: 3,
    },
  });
  expect(createRes.status()).toBe(201);
  const ticketId: number = (await createRes.json()).data.id;

  const adminList = (await (await request.get(`${apiURL}/tickets`, { headers: admH })).json()).data as any[];
  expect(adminList.some((ticket: any) => ticket.id === ticketId && ticket.verification_threshold === 3)).toBe(true);

  await installSession(page, admin);
  await page.goto('/board/tickets', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(title)).toBeVisible();
  await expect(page.getByText(/Aguardando verificação|Awaiting verification|Esperando verificación/i)).toBeVisible();
});

test('Tickets: admin records vendor response through the modal', async ({ request, page }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const admH = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };
  const tag = Date.now();
  const title = `E2E Vendor Response ${tag}`;
  const responseSummary = `Confirmou visita E2E ${tag} amanhã às 9h.`;

  const contactRes = await request.post(`${apiURL}/service-contacts`, {
    headers: admH,
    data: {
      category: 'general_maintenance',
      company_name: `E2E Maintenance ${tag}`,
      phone: '+55 11 4000-0000',
      preferred: true,
    },
  });
  expect(contactRes.status()).toBe(201);
  const contactId: number = (await contactRes.json()).data.id;

  const createRes = await request.post(`${apiURL}/tickets`, {
    headers: admH,
    data: {
      title,
      description: 'Ticket prepared for vendor response modal coverage.',
      category: 'general_maintenance',
      priority: 'normal',
    },
  });
  expect(createRes.status()).toBe(201);
  const ticketId: number = (await createRes.json()).data.id;

  const dispatchRes = await request.post(`${apiURL}/tickets/${ticketId}/dispatch`, {
    headers: admH,
    data: {
      service_contact_id: contactId,
      channel: 'manual',
      message: 'Please inspect this issue and confirm availability.',
    },
  });
  expect(dispatchRes.status()).toBe(201);
  const dispatchId: number = (await dispatchRes.json()).data.id;

  await installSession(page, admin);
  await page.goto('/board/tickets', { waitUntil: 'domcontentloaded' });
  await page.getByText(title).click();
  await expect(page.getByText(/Histórico de acionamentos|Dispatch history|Historial de activaciones/i)).toBeVisible();

  await page.getByRole('button', { name: /Registrar resposta|Record response|Registrar respuesta/i }).click();
  await expect(page.getByRole('heading', { name: /Registrar resposta do fornecedor|Record vendor response|Registrar respuesta del proveedor/i })).toBeVisible();
  await page.getByPlaceholder(/Confirmou visita|Confirmed a visit|Confirmó visita/i).fill(responseSummary);
  await page.getByRole('button', { name: /Salvar resposta|Save response|Guardar respuesta/i }).click();

  // The modal only closes after the awaited POST /responded resolves, so a
  // hidden heading is a reliable "write committed" signal. Asserting on the
  // summary text instead raced the still-open textarea against the API write.
  await expect(page.getByRole('heading', { name: /Registrar resposta do fornecedor|Record vendor response|Registrar respuesta del proveedor/i })).toBeHidden();
  await expect(page.getByText(responseSummary)).toBeVisible();
  const detail = (await (await request.get(`${apiURL}/tickets/${ticketId}`, { headers: admH })).json()).data;
  const dispatch = detail.dispatches.find((row: any) => row.id === dispatchId);
  expect(dispatch.status).toBe('responded');
  expect(dispatch.response_summary).toBe(responseSummary);
});

test('Tickets: admin creates and completes a work order', async ({ request, page }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const admH = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };
  const tag = Date.now();
  const title = `E2E Work Order ${tag}`;

  const contactRes = await request.post(`${apiURL}/service-contacts`, {
    headers: admH,
    data: {
      category: 'general_maintenance',
      company_name: `E2E Work Vendor ${tag}`,
      phone: '+55 11 5000-0000',
      preferred: true,
    },
  });
  expect(contactRes.status()).toBe(201);
  const contactId: number = (await contactRes.json()).data.id;

  const createRes = await request.post(`${apiURL}/tickets`, {
    headers: admH,
    data: {
      title,
      description: 'Ticket prepared for work-order lifecycle coverage.',
      category: 'general_maintenance',
      priority: 'normal',
    },
  });
  expect(createRes.status()).toBe(201);
  const ticketId: number = (await createRes.json()).data.id;

  const workOrderRes = await request.post(`${apiURL}/tickets/${ticketId}/work-order`, {
    headers: admH,
    data: {
      service_contact_id: contactId,
      title: `Repair order ${tag}`,
      scope: 'Inspect, quote, repair, and upload invoice evidence.',
      status: 'scheduled',
      scheduled_for: '2026-05-14 09:30',
      estimated_amount_cents: 125000,
      invoice_url: 'https://example.com/invoice.pdf',
      photo_url: 'https://example.com/photo.jpg',
    },
  });
  expect(workOrderRes.status()).toBe(201);
  const workOrder = (await workOrderRes.json()).data;
  expect(workOrder.status).toBe('scheduled');
  expect(workOrder.vendor_name).toContain(`E2E Work Vendor ${tag}`);

  await installSession(page, admin);
  await page.goto('/board/tickets', { waitUntil: 'domcontentloaded' });
  await page.getByText(title).click();
  await expect(page.getByText(/Ordem de serviço|Work order|Orden de trabajo/i)).toBeVisible();
  await expect(page.getByText(`Repair order ${tag}`)).toBeVisible();

  const completeRes = await request.patch(`${apiURL}/tickets/${ticketId}/work-order/${workOrder.id}`, {
    headers: admH,
    data: {
      status: 'completed',
      approved_amount_cents: 119900,
      completion_note: 'Completed and tested with the building staff.',
    },
  });
  expect(completeRes.ok()).toBeTruthy();

  const detail = (await (await request.get(`${apiURL}/tickets/${ticketId}`, { headers: admH })).json()).data;
  expect(detail.remediation_status).toBe('resolved');
  expect(detail.status).toBe('resolved');
  expect(detail.work_order.status).toBe('completed');
  expect(detail.work_order.completed_at).toBeTruthy();
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
