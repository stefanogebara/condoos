// Audit log: list with filters, CSV export, and access control.
// Creates write operations first to guarantee audit rows exist.
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

// Generates audit rows by creating an announcement then querying audit.
async function ensureAuditRows(request: APIRequestContext, token: string): Promise<void> {
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  await request.post(`${apiURL}/announcements`, {
    headers: h,
    data: { title: `E2E Audit seed ${Date.now()}`, body: 'Auto-gerado para popular o log de auditoria.' },
  });
}

// ---------------------------------------------------------------------------
// 1. Admin can list audit entries (non-empty after a write)
// ---------------------------------------------------------------------------

test('Audit: admin lists entries; non-empty after a write operation', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  await ensureAuditRows(request, admin.token);

  const h = { Authorization: `Bearer ${admin.token}` };
  const res = await request.get(`${apiURL}/audit`, { headers: h });
  expect(res.ok()).toBeTruthy();
  const rows = (await res.json()).data as any[];
  expect(rows.length).toBeGreaterThan(0);
  // Each row should have at minimum: id, action, created_at
  const row = rows[0];
  expect(row).toHaveProperty('id');
  expect(row).toHaveProperty('action');
  expect(row).toHaveProperty('created_at');
});

// ---------------------------------------------------------------------------
// 2. Resident gets 403 on all audit endpoints
// ---------------------------------------------------------------------------

test('Audit: resident gets 403 on list and export', async ({ request }) => {
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const h = { Authorization: `Bearer ${resident.token}` };

  const listRes = await request.get(`${apiURL}/audit`, { headers: h });
  expect(listRes.status()).toBe(403);

  const exportRes = await request.get(`${apiURL}/audit/export`, { headers: h });
  expect(exportRes.status()).toBe(403);
});

// ---------------------------------------------------------------------------
// 3. Limit filter caps the result count
// ---------------------------------------------------------------------------

test('Audit: limit query param caps result count', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  await ensureAuditRows(request, admin.token);
  const h = { Authorization: `Bearer ${admin.token}` };

  const res = await request.get(`${apiURL}/audit?limit=2`, { headers: h });
  expect(res.ok()).toBeTruthy();
  const rows = (await res.json()).data as any[];
  expect(rows.length).toBeLessThanOrEqual(2);
});

// ---------------------------------------------------------------------------
// 4. From/to date filter only returns rows in the window
// ---------------------------------------------------------------------------

test('Audit: from/to date filter returns only rows in range', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  await ensureAuditRows(request, admin.token);
  const h = { Authorization: `Bearer ${admin.token}` };

  const from = new Date(Date.now() - 60 * 1000).toISOString(); // 1 minute ago
  const to   = new Date(Date.now() + 60 * 1000).toISOString(); // 1 minute future

  const res = await request.get(`${apiURL}/audit?from=${from}&to=${to}`, { headers: h });
  expect(res.ok()).toBeTruthy();
  const rows = (await res.json()).data as any[];
  // All returned rows should be within the window
  for (const row of rows) {
    const ts = new Date(row.performed_at).getTime();
    expect(ts).toBeGreaterThanOrEqual(new Date(from).getTime() - 1000);
    expect(ts).toBeLessThanOrEqual(new Date(to).getTime()   + 1000);
  }
});

// ---------------------------------------------------------------------------
// 5. Filter by target_type
// ---------------------------------------------------------------------------

test('Audit: target_type filter narrows to matching rows', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const h = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  // Create an announcement to ensure an 'announcement' target_type row exists
  await request.post(`${apiURL}/announcements`, {
    headers: h,
    data: { title: `E2E Audit filter ${Date.now()}`, body: 'Filtrando por tipo.' },
  });

  const res = await request.get(`${apiURL}/audit?target_type=announcement`, { headers: { Authorization: `Bearer ${admin.token}` } });
  expect(res.ok()).toBeTruthy();
  const rows = (await res.json()).data as any[];
  for (const row of rows) {
    expect(row.target_type).toBe('announcement');
  }
});

// ---------------------------------------------------------------------------
// 6. CSV export returns text/csv with header row
// ---------------------------------------------------------------------------

test('Audit: export returns CSV with column headers', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  await ensureAuditRows(request, admin.token);
  const h = { Authorization: `Bearer ${admin.token}` };

  const res = await request.get(`${apiURL}/audit/export`, { headers: h });
  expect(res.ok()).toBeTruthy();
  const ct = res.headers()['content-type'] ?? '';
  expect(ct.toLowerCase()).toContain('text/csv');

  const body = await res.text();
  // CSV must have at least one line and include recognizable column headers
  const lines = body.split('\n').filter((l) => l.trim().length > 0);
  expect(lines.length).toBeGreaterThan(0);
  const header = lines[0].toLowerCase();
  expect(header).toMatch(/id|action|performed_at/);
});

// ---------------------------------------------------------------------------
// 7. Export respects limit filter
// ---------------------------------------------------------------------------

test('Audit: export with limit=1 returns at most 2 CSV lines (header + 1 row)', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  await ensureAuditRows(request, admin.token);
  const h = { Authorization: `Bearer ${admin.token}` };

  const res = await request.get(`${apiURL}/audit/export?limit=1`, { headers: h });
  const body = await res.text();
  const lines = body.split('\n').filter((l) => l.trim().length > 0);
  // Header + at most 1 data row = 2 lines max
  expect(lines.length).toBeLessThanOrEqual(2);
});
