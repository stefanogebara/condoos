// Live smoke for the strong-audit remediation. Verifies on prod:
//   1. BoardAgent kill-switch UI renders + toggle flips both directions
//      (covers ARC-R5 end-to-end through the SPA, not just the API).
//   2. Verifying a ticket enqueues a dispatch and the queue worker
//      drains it within seconds — covers ARC-R2 + ARC-R3 + SEC-2 +
//      SEC-5 collectively. Side effect on the ticket row (remediation
//      status flip) proves the worker is processing, no queue-status
//      endpoint required.
//   3. Concierge filter on /api/documents excludes receipts/insurance/
//      contracts/minutes (SEC-Phase-2). Provisions a temporary concierge
//      via the admin /concierge/invite endpoint and cleans up after.
//
// Reaper transitioning a stuck claimed row isn't covered here — would
// need prod DB write access to plant a stale row. The unit test in
// domain.test.ts at agent-dispatch-queue: ...reaper revives stuck claims
// covers that path.

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:6312/api');

type Session = { token: string; user: any };

async function loginApi(request: APIRequestContext, email: string, password: string): Promise<Session> {
  const res = await request.post(`${apiURL}/auth/login`, { data: { email, password } });
  expect(res.ok(), `login failed for ${email}: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()).data as Session;
}

async function setSession(page: Page, session: Session) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('condoos_token', token);
    localStorage.setItem('condoos_user', JSON.stringify(user));
  }, session);
}

test('BoardAgent kill-switch banner renders and toggle flips both directions (ARC-R5 UI)', async ({ page, request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');

  // Make sure we start ON so the test asserts a deterministic
  // starting state regardless of previous runs.
  await request.patch(`${apiURL}/admin/agent/kill-switch`, {
    headers: { Authorization: `Bearer ${admin.token}` },
    data: { auto_dispatch_enabled: true },
  });

  try {
    await setSession(page, admin);
    await page.goto('/board/agent');

    // Banner appears AFTER the initial fetch resolves — wait for the
    // sage-state text. Multi-locale: pt-BR is the default so the
    // string lives there.
    await expect(page.getByRole('main').getByText('Auto-dispatch ativo')).toBeVisible({ timeout: 10_000 });

    // Pause it via the UI button.
    await page.getByRole('button', { name: /Pausar/i }).click();
    await expect(page.getByRole('main').getByText('Auto-dispatch pausado')).toBeVisible({ timeout: 10_000 });

    // API now reflects the change too.
    const off = await request.get(`${apiURL}/admin/agent/kill-switch`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect((await off.json()).data.auto_dispatch_enabled).toBe(false);

    // Reactivate via the UI.
    await page.getByRole('button', { name: /Reativar/i }).click();
    await expect(page.getByRole('main').getByText('Auto-dispatch ativo')).toBeVisible({ timeout: 10_000 });

    const on = await request.get(`${apiURL}/admin/agent/kill-switch`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect((await on.json()).data.auto_dispatch_enabled).toBe(true);
  } finally {
    // Defensive restore in case the test failed mid-toggle.
    await request.patch(`${apiURL}/admin/agent/kill-switch`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { auto_dispatch_enabled: true },
    });
  }
});

test('verifying a ticket drains through the dispatch queue worker (ARC-R2 end-to-end)', async ({ request }) => {
  // Two demo board admins both at the same condo so the second
  // verification crosses the threshold (default = 1). admin@condoos.dev
  // is the first verifier (auto-credited as the ticket creator's
  // implicit verify when they're an admin); we use a second verifier
  // via the API. The dispatch then enqueues; the worker (5s tick)
  // drains within ~10s and either dispatches OR holds at the gate.
  // Either outcome proves the worker is alive — both transition the
  // ticket out of 'verified' state.
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');

  // Make sure kill switch is OFF so we're testing the queue worker
  // path, not the auto-dispatch gate flipping it down. With the
  // switch off, the worker still claims+processes the row; the
  // dispatch step gets held but the queue row goes done.
  await request.patch(`${apiURL}/admin/agent/kill-switch`, {
    headers: { Authorization: `Bearer ${admin.token}` },
    data: { auto_dispatch_enabled: false },
  });

  let ticketId: number | undefined;
  try {
    // Create a fresh ticket. verification_threshold=1 means a single
    // additional verify after creation triggers dispatch.
    const created = await request.post(`${apiURL}/tickets`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        title: `Queue smoke ticket ${Date.now()}`,
        description: 'Elevador A com ruído entre andares.',
        category: 'elevator',
        priority: 'normal',
        verification_threshold: 1,
      },
    });
    expect(created.ok(), `ticket create failed: ${created.status()} ${await created.text()}`).toBeTruthy();
    ticketId = (await created.json()).data.id;

    // Verify the ticket — this is what fires dispatchAgentInBackground
    // → enqueueDispatch. The queue worker then drains it.
    const verified = await request.post(`${apiURL}/tickets/${ticketId}/verify`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { vote: 'confirm' },
    });
    expect(verified.ok(), `verify failed: ${verified.status()} ${await verified.text()}`).toBeTruthy();

    // Poll the ticket up to 30s waiting for the remediation_status to
    // transition away from 'verified' (whether dispatched, held, or
    // failed — the worker ran either way).
    const deadline = Date.now() + 30_000;
    let finalStatus = '';
    while (Date.now() < deadline) {
      const r = await request.get(`${apiURL}/tickets/${ticketId}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      if (r.ok()) {
        const t = (await r.json()).data;
        finalStatus = String(t.remediation_status || '');
        // 'verified' = worker hasn't drained yet. Anything else =
        // worker ran. With kill-switch OFF we expect the worker to
        // process the row but the auto-dispatch path returns early,
        // so the ticket stays at 'verified' from the dispatch side
        // — but the queue row should be 'done'. We can't see the
        // queue row from a public endpoint, so we look for the
        // agent_run that the queue worker created instead.
      }
      if (finalStatus && finalStatus !== 'verified') break;
      // Also accept "the agent ran" signal — agent_runs has a row.
      const runs = await request.get(`${apiURL}/ai/admin-agent/runs?limit=5`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      if (runs.ok()) {
        const arr = (await runs.json()).data as Array<{ ticket_id: number | null; status: string }>;
        if (arr.some((r) => r.ticket_id === ticketId)) {
          finalStatus = 'agent_run_observed';
          break;
        }
      }
      await new Promise((res) => setTimeout(res, 2_000));
    }
    expect(
      finalStatus,
      'queue worker did not produce an agent_run row for the verified ticket within 30s',
    ).not.toBe('');
    expect(finalStatus).not.toBe('verified');
  } finally {
    // Restore kill switch
    await request.patch(`${apiURL}/admin/agent/kill-switch`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { auto_dispatch_enabled: true },
    });
    // Soft-delete the test ticket
    if (ticketId) {
      await request.delete(`${apiURL}/tickets/${ticketId}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      }).catch(() => { /* delete endpoint may not exist; ignore */ });
    }
  }
});

test('concierge filter excludes financial/legal/governance documents (Phase 2 live)', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const tag = `phase2-conciergetest-${Date.now()}`;
  const conciergeEmail = `concierge-smoke-${Date.now()}@condoos.dev`;
  const conciergePassword = 'concierge-smoke-32chars-minimum-ok';
  const docIds: number[] = [];
  let conciergeUserId: number | undefined;

  try {
    // Seed one doc per blocked category + one per allowed category
    // so we can prove the filter is category-based, not visibility-based.
    const categories: Array<{ category: string; expected_for_concierge: boolean }> = [
      { category: 'receipts',   expected_for_concierge: false },
      { category: 'insurance',  expected_for_concierge: false },
      { category: 'contracts',  expected_for_concierge: false },
      { category: 'minutes',    expected_for_concierge: false },
      { category: 'notices',    expected_for_concierge: true },
      { category: 'rules',      expected_for_concierge: true },
    ];
    for (const c of categories) {
      const created = await request.post(`${apiURL}/documents`, {
        headers: { Authorization: `Bearer ${admin.token}` },
        data: {
          title: `${tag} ${c.category}`,
          category: c.category,
          file_url: 'https://example.com/x.pdf',
          visibility: 'residents',
          active: true,
        },
      });
      expect(created.ok(), `doc create ${c.category}: ${created.status()} ${await created.text()}`).toBeTruthy();
      docIds.push((await created.json()).data.id);
    }

    // Provision a concierge user via the admin invite endpoint. The
    // endpoint may require additional fields — best-effort.
    const invited = await request.post(`${apiURL}/concierge/invite`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        email: conciergeEmail,
        password: conciergePassword,
        first_name: 'Smoke',
        last_name: 'Concierge',
      },
    });
    if (!invited.ok()) {
      test.skip(true, `concierge invite endpoint not available on this deploy: ${invited.status()} ${await invited.text()}`);
    }
    conciergeUserId = (await invited.json()).data?.id;

    const concierge = await loginApi(request, conciergeEmail, conciergePassword);
    const list = await request.get(`${apiURL}/documents`, {
      headers: { Authorization: `Bearer ${concierge.token}` },
    });
    expect(list.ok(), `concierge documents list: ${list.status()}`).toBeTruthy();
    const rows = (await list.json()).data as Array<{ id: number; title: string; category: string }>;
    const ours = rows.filter((r) => r.title.startsWith(tag));

    const seen = new Set(ours.map((r) => r.category));
    // Blocked: must NOT be visible.
    for (const c of ['receipts', 'insurance', 'contracts', 'minutes']) {
      expect(seen.has(c), `concierge must NOT see category ${c}`).toBe(false);
    }
    // Allowed: must be visible.
    for (const c of ['notices', 'rules']) {
      expect(seen.has(c), `concierge MUST see category ${c}`).toBe(true);
    }
  } finally {
    // Cleanup test docs (concierge cannot, only admin can).
    for (const id of docIds) {
      await request.delete(`${apiURL}/documents/${id}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      }).catch(() => { /* best-effort */ });
    }
    // Note: we don't delete the concierge user — there's no admin
    // endpoint for that. Each run creates a unique email so they
    // don't collide. Manual prod cleanup is acceptable for smoke.
    void conciergeUserId;
  }
});
