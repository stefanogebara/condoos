// Multi-user end-to-end loop — proves the cross-feature seam.
//
// Each piece of this chain already has its own narrower spec:
//   - pilot-ticket-lifecycle.spec.ts → ticket → agent
//   - proposals-advanced.spec.ts     → voting eligibility / quorum / locks
//   - assemblies-lifecycle.spec.ts   → in-session voting
//
// But nothing previously asserted the chain holds end-to-end:
// a resident's ticket can become an admin's proposal, two distinct
// users can vote on it, the tally matches, and the proposal closes
// cleanly. That's the seam this test covers.
//
// Sequence:
//   1. Resident files a ticket (verification_threshold=1)
//   2. Admin verifies → triggers agent enqueue
//   3. Wait for the agent_run row to land (≤60s — pilot already
//      proves this works, here we just sync on it before moving on
//      so the proposal isn't created while the building is busy)
//   4. Admin creates a proposal referencing the ticket title
//   5. Admin sets quorum=0% + 1h voting window (so any vote passes)
//   6. Admin transitions proposal: discussion → voting
//   7. Admin votes 'yes'
//   8. Each available resident votes 'yes' (1, 2, or 3 residents
//      depending on which E2E_RESIDENT*/E2E_RESIDENT2_*/E2E_RESIDENT3_*
//      env pairs are set — see voter-count detection below)
//   9. Assert tally: N yes (1 admin + R residents), 0 no, 0 abstain
//  10. Admin closes proposal: voting → approved
//  11. Cleanup: best-effort soft-delete the ticket
//
// Production-safe: each run creates one ticket + one proposal in
// the e2e-* account's building. Ticket gets soft-deleted in cleanup;
// proposal stays as 'approved' (harmless — they pile up but the
// dashboard truncates).
//
// Skips when E2E_ADMIN_*/E2E_RESIDENT_* are not present. Optional
// E2E_RESIDENT2_*/E2E_RESIDENT3_* upgrade the assertion from 2-voter
// to 3-voter / 4-voter without changing the test shape.

import { expect, test, type APIRequestContext } from '@playwright/test';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4316/api');

const adminEmail = process.env.E2E_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const residentEmail = process.env.E2E_RESIDENT_EMAIL;
const residentPassword = process.env.E2E_RESIDENT_PASSWORD;

// Optional extra residents. Provisioned via
// scripts/provision-e2e-residents.mjs and wired as GitHub secrets.
// When all 3 pairs are set, the test asserts a 3-voter tally; when
// only the primary resident is present, it asserts a 2-voter tally.
type ResidentCreds = { email: string; password: string };
const extraResidentCreds: ResidentCreds[] = [
  { email: process.env.E2E_RESIDENT2_EMAIL || '', password: process.env.E2E_RESIDENT2_PASSWORD || '' },
  { email: process.env.E2E_RESIDENT3_EMAIL || '', password: process.env.E2E_RESIDENT3_PASSWORD || '' },
].filter((c): c is ResidentCreds => !!c.email && !!c.password);

type Session = { token: string; user: { id: number; role: string } };

async function login(request: APIRequestContext, email: string, password: string): Promise<Session> {
  const res = await request.post(`${apiURL}/auth/login`, { data: { email, password } });
  expect(res.ok(), `login failed for ${email}: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()).data as Session;
}

function authHeaders(session: Session): Record<string, string> {
  return { Authorization: `Bearer ${session.token}` };
}

test('multi-user loop: ticket → agent → proposal → N-voter tally → close', async ({ request }) => {
  test.skip(!adminEmail || !adminPassword || !residentEmail || !residentPassword,
    'requires E2E_ADMIN_* and E2E_RESIDENT_* credentials');

  const admin = await login(request, adminEmail!, adminPassword!);
  const resident = await login(request, residentEmail!, residentPassword!);
  const adminH = authHeaders(admin);
  const residentH = authHeaders(resident);

  // Each entry is one ballot's auth headers. Admin + primary resident
  // are always present; the extras are skipped when their secrets
  // aren't configured. Expected yes count = residentHs.length + 1
  // (the +1 is the admin's own vote, cast separately below).
  const residentHs: Array<Record<string, string>> = [residentH];
  for (const creds of extraResidentCreds) {
    const extra = await login(request, creds.email, creds.password);
    residentHs.push(authHeaders(extra));
  }
  const expectedYes = residentHs.length + 1;

  // Make sure auto-dispatch is ON so step 3 has a queue row to wait on.
  // Same setup as pilot-ticket-lifecycle.
  await request.patch(`${apiURL}/admin/agent/kill-switch`, {
    headers: adminH,
    data: { auto_dispatch_enabled: true },
  });

  const stamp = Date.now();
  const ticketTitle = `Multi-user loop ${stamp}`;
  const proposalTitle = `Decisão sobre ${ticketTitle}`;
  let ticketId: number | undefined;
  let proposalId: number | undefined;

  try {
    // ───── 1. Resident files a ticket ───────────────────────────────
    const createdTicket = await request.post(`${apiURL}/tickets`, {
      headers: residentH,
      data: {
        title: ticketTitle,
        description: 'Bomba de água com ruído anormal — multi-user E2E test.',
        category: 'plumbing',
        priority: 'normal',
        verification_threshold: 1,
      },
    });
    expect(createdTicket.ok(), `ticket create failed: ${createdTicket.status()} ${await createdTicket.text()}`).toBeTruthy();
    ticketId = (await createdTicket.json()).data.id;
    expect(ticketId).toBeGreaterThan(0);

    // ───── 2. Admin verifies (crosses threshold=1 → enqueues agent) ─
    const verified = await request.post(`${apiURL}/tickets/${ticketId}/verify`, {
      headers: adminH,
      data: { vote: 'confirm' },
    });
    expect(verified.ok(), `verify failed: ${verified.status()} ${await verified.text()}`).toBeTruthy();

    // ───── 3. Wait for agent_run to land in a terminal state ────────
    // Synchronizing here so we don't pile a proposal on top of the
    // building while the queue worker is mid-LLM call. If the queue
    // is broken, this test fails here with the same signal as
    // pilot-ticket-lifecycle — and we save the wasted proposal cleanup.
    const deadline = Date.now() + 60_000;
    let agentTerminal = false;
    while (Date.now() < deadline) {
      const runs = await request.get(`${apiURL}/ai/admin-agent/runs?limit=10`, { headers: adminH });
      if (runs.ok()) {
        const arr = (await runs.json()).data as Array<{ ticket_id: number | null; status: string }>;
        if (arr.find((r) => r.ticket_id === ticketId && r.status !== 'running')) {
          agentTerminal = true;
          break;
        }
      }
      await new Promise((res) => setTimeout(res, 3_000));
    }
    expect(agentTerminal, `agent_run for ticket ${ticketId} did not reach terminal in 60s`).toBeTruthy();

    // ───── 4. Admin creates a proposal ──────────────────────────────
    // estimated_cost > 0 is required by the discussion → voting gate
    // (proposal-cost spec covers the inverse — empty cost rejected).
    const createdProposal = await request.post(`${apiURL}/proposals`, {
      headers: adminH,
      data: {
        title: proposalTitle,
        description: `Aprovar contratação de fornecedor para resolver chamado #${ticketId}.`,
        category: 'maintenance',
        estimated_cost: 1500,
        voter_eligibility: 'all',
      },
    });
    expect(createdProposal.ok(), `proposal create failed: ${createdProposal.status()} ${await createdProposal.text()}`).toBeTruthy();
    proposalId = (await createdProposal.json()).data.id;
    expect(proposalId).toBeGreaterThan(0);

    // ───── 5. Set compliance: quorum=0, 1h voting window ────────────
    // quorum=0 means any single vote counts toward the threshold —
    // this isolates the test from the building's roster size.
    const opensAt  = new Date().toISOString();
    const closesAt = new Date(Date.now() + 3_600_000).toISOString();
    const compliance = await request.patch(`${apiURL}/proposals/${proposalId}/compliance`, {
      headers: adminH,
      data: { quorum_percent: 0, voting_opens_at: opensAt, voting_closes_at: closesAt },
    });
    expect(compliance.ok(), `compliance update failed: ${compliance.status()} ${await compliance.text()}`).toBeTruthy();

    // ───── 6. discussion → voting ───────────────────────────────────
    const opened = await request.post(`${apiURL}/proposals/${proposalId}/status`, {
      headers: adminH,
      data: { status: 'voting' },
    });
    expect(opened.ok(), `open voting failed: ${opened.status()} ${await opened.text()}`).toBeTruthy();

    // ───── 7. Admin votes yes ───────────────────────────────────────
    const adminVote = await request.post(`${apiURL}/proposals/${proposalId}/vote`, {
      headers: adminH,
      data: { choice: 'yes' },
    });
    expect(adminVote.ok(), `admin vote failed: ${adminVote.status()} ${await adminVote.text()}`).toBeTruthy();

    // ───── 8. Each available resident votes yes ─────────────────────
    // Loop over residentHs so the test scales 1 → 2 → 3 residents
    // automatically based on which E2E_RESIDENT* secrets are set.
    for (let i = 0; i < residentHs.length; i++) {
      const r = residentHs[i];
      const vote = await request.post(`${apiURL}/proposals/${proposalId}/vote`, {
        headers: r,
        data: { choice: 'yes' },
      });
      expect(vote.ok(), `resident #${i + 1} vote failed: ${vote.status()} ${await vote.text()}`).toBeTruthy();
    }

    // ───── 9. Tally matches (expectedYes yes, 0 no, 0 abstain) ──────
    // GET /proposals/:id returns the tally under `votes` (yes / no /
    // abstain / total — see proposal-tally.ts) and a quorum block
    // alongside. Both should reflect every ballot and a met quorum.
    const fetched = await request.get(`${apiURL}/proposals/${proposalId}`, { headers: adminH });
    expect(fetched.ok()).toBeTruthy();
    const body = (await fetched.json()).data;
    const votes = body.votes;
    expect(votes, `proposal ${proposalId} response missing votes: ${JSON.stringify(body)}`).toBeTruthy();
    expect(votes.yes, `expected ${expectedYes} yes votes (admin + ${residentHs.length} resident${residentHs.length === 1 ? '' : 's'})`).toBe(expectedYes);
    expect(votes.no || 0).toBe(0);
    expect(votes.abstain || 0).toBe(0);
    expect(votes.total).toBe(expectedYes);
    expect(body.quorum?.quorum_met, `quorum should be met at 0% with ${expectedYes} ballots cast`).toBe(true);

    // ───── 10. Close proposal: voting → approved ────────────────────
    const approved = await request.post(`${apiURL}/proposals/${proposalId}/status`, {
      headers: adminH,
      data: { status: 'approved' },
    });
    expect(approved.ok(), `approve failed: ${approved.status()} ${await approved.text()}`).toBeTruthy();

    // Confirm the row settled into 'approved'.
    const closed = await request.get(`${apiURL}/proposals/${proposalId}`, { headers: adminH });
    const closedBody = (await closed.json()).data;
    expect(closedBody.status).toBe('approved');
  } finally {
    // Best-effort: kill the ticket so it doesn't show up in admin lists.
    // The proposal stays — by design — as a record of the loop. The
    // CI suite truncates the visible list, so accumulation is fine.
    if (ticketId) {
      await request.delete(`${apiURL}/tickets/${ticketId}`, { headers: adminH }).catch(() => { /* best-effort */ });
    }
  }
});
