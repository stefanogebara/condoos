// ARC-R2 — Agent dispatch queue.
//
// Replaces the fire-and-forget IIFE in dispatchAgentInBackground with a
// durable row + worker. The behaviour change worth understanding:
//
//   BEFORE
//     verify ticket → IIFE → runAdminAgent → dispatch → DB writes
//   - Crash mid-IIFE = work permanently lost. No retry, no audit row,
//     ticket stuck in 'verified'.
//   - inFlightByCondo Map was module-local — second machine = no guard.
//
//   AFTER
//     verify ticket → INSERT agent_dispatch_queue → return immediately
//     ↓ (worker polls every 5s)
//     SELECT one 'queued' row → UPDATE to 'claimed' (atomic via tx)
//     ↓
//     runAdminAgent → dispatch → UPDATE to 'done' (or 'failed')
//   - Crash mid-work: row stays 'claimed'. Reaper transitions stale
//     'claimed' rows older than 5min back to 'failed' for visibility
//     (or future retry).
//   - Multi-machine ready WHEN ON A SHARED VOLUME: two Fly machines
//     hitting the same SQLite file serialize via WAL's single-writer
//     lock + the `WHERE status='queued'` UPDATE guard + the post-
//     update changes() check (SEC-M5 fix). Two machines with
//     INDEPENDENT volumes have independent queues — that's not
//     multi-machine, that's two single-machines. Before scaling
//     beyond N=1 with separate volumes, plan the Postgres migration
//     and add `SELECT ... FOR UPDATE SKIP LOCKED` to claimNextDispatch.
//   - Idempotent: unique partial index on ticket_id WHERE status IN
//     ('queued','claimed') stops double-enqueue on concurrent verifies.
//
// Trade-off: there's now a ≤5s polling delay between verify and the
// agent starting work. The agent itself takes 30-55s on the ReAct path,
// so an extra 5s is noise. The reliability win is worth it.

import db from '../db';
import os from 'os';
import { captureMessage } from './sentry';

export type DispatchQueueStatus = 'queued' | 'claimed' | 'done' | 'failed';

export interface DispatchQueueRow {
  id: number;
  ticket_id: number;
  condominium_id: number;
  triggered_by_user_id: number | null;
  locale: string | null;
  status: DispatchQueueStatus;
  claimed_at: string | null;
  claimed_by: string | null;
  attempt_count: number;
  last_error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface EnqueueInput {
  ticketId: number;
  condoId: number;
  triggeredByUserId?: number;
  locale?: string;
}

// Stable per-process id so a multi-machine deploy can attribute work to
// the machine that did it. Format: hostname:pid — survives container
// restarts the same way Fly's machine ids do.
const WORKER_ID = `${os.hostname()}:${process.pid}`;
export function workerId(): string {
  return WORKER_ID;
}

// Enqueue a ticket for agent dispatch. Returns the new queue id on
// insert, or null when an active row already exists (ticket was just
// verified by someone else within the same heartbeat).
//
// The UNIQUE partial index `idx_agent_dispatch_queue_active_ticket`
// enforces "at most one queued OR claimed row per ticket"; the second
// INSERT throws SQLITE_CONSTRAINT, which we swallow and return null.
// Callers shouldn't treat "null" as an error — it just means someone
// else is already on it.
export function enqueueDispatch(input: EnqueueInput): number | null {
  try {
    const result = db.prepare(
      `INSERT INTO agent_dispatch_queue (ticket_id, condominium_id, triggered_by_user_id, locale)
       VALUES (?, ?, ?, ?)`
    ).run(input.ticketId, input.condoId, input.triggeredByUserId ?? null, input.locale ?? null);
    return Number(result.lastInsertRowid);
  } catch (err: any) {
    // SEC-H3 (re-audit fix) — Narrow the swallow to UNIQUE constraint
    // violations specifically. The old `/SQLITE_CONSTRAINT/i` pattern
    // would also catch FK violations (bad condo_id), NOT NULL
    // violations (a null ticket_id from a bad caller), and CHECK
    // violations (invalid status) and silently return null — the
    // caller would believe "already enqueued" when actually the row
    // was rejected for a programming-error reason and the agent
    // never runs.
    const code = String(err?.code || '');
    const message = String(err?.message || '');
    const isUniqueViolation =
      code === 'SQLITE_CONSTRAINT_UNIQUE'
      || /UNIQUE constraint/i.test(message);
    if (isUniqueViolation) return null;
    // Log + rethrow on FK/NOT NULL/CHECK violations so the bug surfaces
    // instead of silently dropping the work.
    console.warn(`[agent-dispatch-queue] non-unique constraint on enqueue: ${code} ${message}`);
    throw err;
  }
}

// Atomically claim the oldest queued row. Returns null when the queue
// is empty. The SELECT-then-UPDATE pattern is wrapped in a SQLite
// transaction so two workers can't claim the same row — better-sqlite3
// is synchronous within a process, and the transaction provides write-
// level serialization with other processes on the same DB.
export function claimNextDispatch(): DispatchQueueRow | null {
  return db.transaction(() => {
    const row = db.prepare(
      `SELECT id, ticket_id, condominium_id, triggered_by_user_id, locale,
              status, claimed_at, claimed_by, attempt_count, last_error,
              created_at, finished_at
       FROM agent_dispatch_queue
       WHERE status = 'queued'
       ORDER BY created_at ASC
       LIMIT 1`
    ).get() as DispatchQueueRow | undefined;
    if (!row) return null;
    const result = db.prepare(
      `UPDATE agent_dispatch_queue
          SET status = 'claimed',
              claimed_at = CURRENT_TIMESTAMP,
              claimed_by = ?,
              attempt_count = attempt_count + 1
        WHERE id = ? AND status = 'queued'`
    ).run(WORKER_ID, row.id);
    // SEC-M5 (re-audit fix) — Verify the UPDATE actually flipped this
    // row. Under non-WAL SQLite OR a future Postgres migration, two
    // workers could see the same row in their SELECT before either
    // issues the UPDATE; the `WHERE status='queued'` guard ensures
    // only one wins at write time, but the prior code returned the
    // row as 'claimed' regardless of whether the UPDATE actually ran.
    // Now we check changes and return null when we lost the race —
    // the caller (processOneDispatch) just skips this tick.
    if (Number(result.changes) === 0) return null;
    return { ...row, status: 'claimed' as const, claimed_by: WORKER_ID };
  })();
}

// Mark a claimed row done after the agent + dispatch flow completes
// successfully.
//
// REG-4 (re-audit fix) — Guarded on `status = 'claimed'` so a slow
// worker finishing AFTER the reaper transitioned the row to 'failed'
// can't silently flip it back to 'done'. Without the guard, a 6-min
// ReAct run racing the 5-min reaper would produce a row that
// oscillates failed→done, breaking forensics + (worse) leaving the
// failed-state index believing the slot is open for a re-enqueue
// that could double-dispatch. Returns the actual number of rows
// touched so callers can distinguish "marked done" from "too late,
// reaper got it" — useful for logging but not branch-critical for
// the worker's happy path.
export function markDispatchDone(id: number): number {
  const result = db.prepare(
    `UPDATE agent_dispatch_queue
        SET status = 'done',
            finished_at = CURRENT_TIMESTAMP,
            last_error = NULL
      WHERE id = ? AND status = 'claimed'`
  ).run(id);
  return Number(result.changes);
}

// Mark a claimed row failed. last_error is recorded for forensics.
// Stays 'failed' (no auto-retry today) — the audit log captures it and
// the admin sees the ticket stuck. Future enhancement: retry up to
// attempt_count < 3, then bury.
//
// Same `status='claimed'` guard as markDispatchDone so a slow worker
// failing after the reaper already failed the row doesn't overwrite
// 'reaper_timeout' with a less-informative late error.
export function markDispatchFailed(id: number, error: unknown): number {
  const msg = error instanceof Error ? error.message : String(error);
  const result = db.prepare(
    `UPDATE agent_dispatch_queue
        SET status = 'failed',
            finished_at = CURRENT_TIMESTAMP,
            last_error = ?
      WHERE id = ? AND status = 'claimed'`
  ).run(msg.slice(0, 500), id);
  // Fire an ops event only when the UPDATE actually flipped a row.
  // Returning 0 means the row was already transitioned (e.g. by the
  // reaper) — no need to double-report. Includes the queue row id +
  // ticket id so the dashboard can drill into a specific failure.
  if (Number(result.changes) > 0) {
    const row = db.prepare(
      `SELECT ticket_id, condominium_id, attempt_count FROM agent_dispatch_queue WHERE id = ?`
    ).get(id) as { ticket_id: number; condominium_id: number; attempt_count: number } | undefined;
    captureMessage('agent.dispatch.failed', 'warning', {
      queue_id: id,
      ticket_id: row?.ticket_id,
      condo_id: row?.condominium_id,
      attempt: row?.attempt_count,
      error: msg.slice(0, 500),
    });
  }
  return Number(result.changes);
}

// Observability snapshot for the ops dashboard. Counts rows by status,
// surfaces oldest-queued and oldest-claimed lag, returns last few
// failure messages, and lists distinct worker stamps that have
// claimed work recently. Scoped to one condo so admins see only
// their own building's queue.
//
// Lag thresholds (callers can interpret):
//   - oldest_queued_age_seconds > 30s   → worker may be stalled
//   - oldest_claimed_age_seconds > 300s → run is genuinely slow or
//                                         the reaper is about to fire
//   - failed_24h > 0                    → something needs attention
export interface QueueStatusSnapshot {
  counts: { queued: number; claimed: number; done: number; failed: number };
  oldest_queued_age_seconds: number | null;
  oldest_claimed_age_seconds: number | null;
  failed_24h: number;
  recent_failures: Array<{
    id: number;
    ticket_id: number;
    finished_at: string;
    last_error: string | null;
    attempt_count: number;
  }>;
  active_workers: string[];
  generated_at: string;
}

export function getQueueStatusSnapshot(condoId: number): QueueStatusSnapshot {
  const counts = { queued: 0, claimed: 0, done: 0, failed: 0 };
  const countRows = db.prepare(
    `SELECT status, COUNT(*) AS n
     FROM agent_dispatch_queue
     WHERE condominium_id = ?
     GROUP BY status`
  ).all(condoId) as Array<{ status: DispatchQueueStatus; n: number }>;
  for (const r of countRows) {
    if (r.status in counts) (counts as Record<string, number>)[r.status] = Number(r.n);
  }

  // Null when the bucket is empty so the UI can show "—" instead of
  // "0s" (which would imply a fresh row just arrived).
  const oldestQueued = db.prepare(
    `SELECT (strftime('%s', 'now') - strftime('%s', created_at)) AS age_s
     FROM agent_dispatch_queue
     WHERE condominium_id = ? AND status = 'queued'
     ORDER BY created_at ASC LIMIT 1`
  ).get(condoId) as { age_s: number | null } | undefined;
  const oldestClaimed = db.prepare(
    `SELECT (strftime('%s', 'now') - strftime('%s', claimed_at)) AS age_s
     FROM agent_dispatch_queue
     WHERE condominium_id = ? AND status = 'claimed' AND claimed_at IS NOT NULL
     ORDER BY claimed_at ASC LIMIT 1`
  ).get(condoId) as { age_s: number | null } | undefined;

  // Failure rate over the last 24h — the actionable signal. Steady-
  // state should be near zero; a spike means OpenRouter outage,
  // vendor mis-dispatch, or a code regression.
  const failed24h = (db.prepare(
    `SELECT COUNT(*) AS n
     FROM agent_dispatch_queue
     WHERE condominium_id = ?
       AND status = 'failed'
       AND finished_at >= datetime('now', '-24 hours')`
  ).get(condoId) as { n: number }).n;

  const recentFailures = db.prepare(
    `SELECT id, ticket_id, finished_at, last_error, attempt_count
     FROM agent_dispatch_queue
     WHERE condominium_id = ?
       AND status = 'failed'
       AND finished_at IS NOT NULL
     ORDER BY finished_at DESC
     LIMIT 5`
  ).all(condoId) as Array<{
    id: number;
    ticket_id: number;
    finished_at: string;
    last_error: string | null;
    attempt_count: number;
  }>;

  // Distinct workers that have claimed work in the last hour. With
  // N=1 machine this is just one stamp; with N>1 it surfaces which
  // machines are actually pulling work.
  const activeWorkers = (db.prepare(
    `SELECT DISTINCT claimed_by
     FROM agent_dispatch_queue
     WHERE condominium_id = ?
       AND claimed_at IS NOT NULL
       AND claimed_at >= datetime('now', '-1 hour')`
  ).all(condoId) as Array<{ claimed_by: string | null }>)
    .map((r) => r.claimed_by)
    .filter((s): s is string => !!s);

  return {
    counts,
    oldest_queued_age_seconds: oldestQueued?.age_s ?? null,
    oldest_claimed_age_seconds: oldestClaimed?.age_s ?? null,
    failed_24h: failed24h,
    recent_failures: recentFailures,
    active_workers: activeWorkers,
    generated_at: new Date().toISOString(),
  };
}

// Reaper for stale 'claimed' rows. A crash between claim and done/fail
// leaves the row stuck. Transitions any 'claimed' row older than
// maxAgeSec to 'failed' with last_error='reaper_timeout'. Caller is
// expected to be the same scheduler as the agent_runs reaper (every
// 5min in server.ts).
//
// REG-4 (re-audit) — Default raised to 10min from 5min. A ReAct run
// with 6 LLM calls at OpenRouter's p99 latency (~50s each) can
// legitimately take 5-6 minutes. The old 5min threshold raced those
// runs and produced false-positive 'failed' rows. The cost of waiting
// 10min before reaping is "admin sees spinner for 5 extra minutes on
// a genuinely crashed run" — acceptable when balanced against losing
// legitimate output. markDispatchDone now also has a claimed-guard
// (above), so the worst case of a false reap is a misleading audit
// row, not a double-dispatch.
export function reapStaleDispatches(maxAgeSec = 600): number {
  const result = db.prepare(
    `UPDATE agent_dispatch_queue
        SET status = 'failed',
            finished_at = CURRENT_TIMESTAMP,
            last_error = COALESCE(last_error, 'reaper_timeout')
      WHERE status = 'claimed'
        AND claimed_at < datetime('now', ?)`
  ).run(`-${Math.max(60, Math.round(maxAgeSec))} seconds`);
  const changes = Number(result.changes);
  if (changes > 0) {
    // A reaper hit means at least one worker crashed or hung mid-run.
    // Surface as an ops event so a spike (e.g. OpenRouter outage
    // killing many runs at once) shows up as a trend, not just a
    // single Fly log line.
    captureMessage('agent.dispatch.reaped', 'warning', {
      count: changes,
      max_age_sec: maxAgeSec,
    });
  }
  return changes;
}

// Drain worker: process one row per tick. Caller is expected to be a
// setInterval — keeping the worker stateless makes it trivial to
// restart and easy to test. Returns null when the queue is empty
// (caller can skip the next tick if it wants).
export type DispatchProcessor = (row: DispatchQueueRow) => Promise<void>;

export async function processOneDispatch(
  processor: DispatchProcessor,
): Promise<{ id: number; outcome: 'done' | 'failed' } | null> {
  const claimed = claimNextDispatch();
  if (!claimed) return null;
  try {
    await processor(claimed);
    markDispatchDone(claimed.id);
    return { id: claimed.id, outcome: 'done' };
  } catch (err) {
    markDispatchFailed(claimed.id, err);
    console.warn(`[agent-dispatch-queue] dispatch ${claimed.id} failed:`, (err as Error)?.message || err);
    return { id: claimed.id, outcome: 'failed' };
  }
}

// Start the periodic drain. Returns the interval handle so tests can
// stop it. tickMs defaults to 5s — fast enough that admins don't feel
// a delay (the agent itself takes 30s+), slow enough that empty-queue
// polling doesn't burn CPU.
export function startDispatchQueueWorker(
  processor: DispatchProcessor,
  tickMs = 5_000,
): NodeJS.Timeout {
  let inFlight = false;
  const tick = async () => {
    if (inFlight) return; // skip overlapping ticks if a dispatch takes >5s
    inFlight = true;
    try {
      // Drain up to 3 rows per tick — keeps a backlog from sitting
      // around but doesn't monopolize the writer.
      for (let i = 0; i < 3; i++) {
        const r = await processOneDispatch(processor);
        if (!r) break;
      }
    } finally {
      inFlight = false;
    }
  };
  return setInterval(() => { void tick(); }, tickMs);
}
