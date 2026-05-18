import db from '../db';

export type AgentRunStatus = 'running' | 'succeeded' | 'failed';

export interface CreateAgentRunInput {
  condominiumId: number;
  adminUserId?: number | null;
  threadId?: number | null;
  ticketId?: number | null;
  mode?: string | null;
  task: string;
  reactEnabled: boolean;
  model: string;
}

export interface FinishAgentRunSuccessInput {
  fallback: boolean;
  plan: unknown;
  trace?: unknown;
  durationMs: number;
}

export interface FinishAgentRunFailureInput {
  error: unknown;
  trace?: unknown;
  durationMs: number;
}

function json(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: 'unserializable_payload' });
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1_000);
  return String(error || 'agent_run_failed').slice(0, 1_000);
}

export function createAgentRun(input: CreateAgentRunInput): number {
  const row = db.prepare(
    `INSERT INTO agent_runs (
       condominium_id, admin_user_id, thread_id, ticket_id, mode, task,
       status, attempt_count, model, react_enabled, started_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'running', 1, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).run(
    input.condominiumId,
    input.adminUserId ?? null,
    input.threadId ?? null,
    input.ticketId ?? null,
    String(input.mode || 'general').slice(0, 80),
    String(input.task || '').slice(0, 6_000),
    String(input.model || '').slice(0, 160),
    input.reactEnabled ? 1 : 0,
  );
  return Number(row.lastInsertRowid);
}

export function finishAgentRunSuccess(id: number, input: FinishAgentRunSuccessInput): void {
  db.prepare(
    `UPDATE agent_runs
        SET status = 'succeeded',
            fallback = ?,
            duration_ms = ?,
            plan_json = ?,
            trace_json = ?,
            finished_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP,
            last_error = NULL
      WHERE id = ?`
  ).run(
    input.fallback ? 1 : 0,
    Math.max(0, Math.round(input.durationMs)),
    json(input.plan),
    json(input.trace ?? null),
    id,
  );
}

// Append an incremental progress step. Used during ReAct loops so the
// UI can poll and show what the agent is currently doing instead of a
// blind spinner. Stored as a JSON array of {at, label} entries.
// Idempotent on append — even if the same label fires twice (e.g. on
// retry), we just grow the list; the UI dedups visually.
export interface ProgressStep {
  at: string;
  label: string;
  detail?: string;
}

// COR-H4 — Wrap the read-modify-write in a SQLite transaction so two
// near-simultaneous progress appends on the same run can't both read
// the same stale `progress_json` and overwrite each other.
//
// In practice better-sqlite3 is synchronous and single-threaded, so
// the actual JS-level race the audit imagined is hard to hit (there's
// no `await` between the SELECT and the UPDATE in the original code).
// The transaction is defense-in-depth for two cases:
//   (1) future refactor that introduces an await between the two,
//   (2) concurrent processes on the same SQLite file — which we don't
//       have today, but a wal-mode SQLite + two processes could.
// The append is also a candidate for SQLite-native `json_insert(...,
// '$[#]', ...)` for a single-statement atomic append, but we still
// need the JS side for the 20-entry trim + metadata shaping, so the
// transaction is the cleaner fix.
export function appendAgentRunProgress(id: number, step: Omit<ProgressStep, 'at'> & { at?: string }): void {
  const next: ProgressStep = {
    at: step.at || new Date().toISOString(),
    label: String(step.label || '').slice(0, 120),
    ...(step.detail ? { detail: String(step.detail).slice(0, 240) } : {}),
  };
  db.transaction(() => {
    const row = db.prepare(`SELECT progress_json FROM agent_runs WHERE id = ?`).get(id) as { progress_json: string | null } | undefined;
    if (!row) return;
    let existing: ProgressStep[] = [];
    try { existing = row.progress_json ? JSON.parse(row.progress_json) : []; } catch { existing = []; }
    // Cap at 20 entries — beyond that the UI doesn't render anything
    // useful and the JSON blob grows unbounded.
    const trimmed = [...existing, next].slice(-20);
    db.prepare(
      `UPDATE agent_runs SET progress_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(JSON.stringify(trimmed), id);
  })();
}

// Read a run's current progress for the UI polling path. Returns the
// status alongside so the client knows when to stop polling.
export interface AgentRunSnapshot {
  id: number;
  status: AgentRunStatus;
  progress: ProgressStep[];
  duration_ms: number | null;
  started_at: string;
  finished_at: string | null;
}

// ARC-R1 / COR-M6 — Reaper for orphaned `agent_runs` rows.
//
// `runAdminAgent` runs as a fire-and-forget IIFE from
// `dispatchAgentInBackground`. The inner try/catch/finally normally
// transitions the row to 'succeeded' or 'failed' before returning,
// but a process restart (Fly redeploy, OOM, panic) mid-run leaves
// the row stuck at 'running' with no `finished_at`. Without this
// reaper, those rows stay 'running' forever — the admin polls the
// progress endpoint and gets a permanent "Iniciando análise" spinner.
//
// The reaper is intentionally crude: any 'running' row older than
// `maxAgeSec` (default 5 minutes) is marked 'failed' with
// `last_error='reaper_timeout'`. A real run that legitimately took
// 5 minutes would already be a problem (OpenRouter wall-time is
// typically 3-15s per call, 6 ReAct rounds max — sub-90s total).
// Setting the bar at 5 minutes leaves plenty of slack for slow
// networks while still catching crashes within one polling interval.
//
// Call once on boot (catches crashes from the previous process) AND
// on a setInterval (catches mid-process orphans where finally never
// runs).
export function reapStaleAgentRuns(maxAgeSec = 300): number {
  const result = db.prepare(
    `UPDATE agent_runs
        SET status = 'failed',
            last_error = COALESCE(last_error, 'reaper_timeout'),
            finished_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
      WHERE status = 'running'
        AND started_at < datetime('now', ?)`
  ).run(`-${Math.max(60, Math.round(maxAgeSec))} seconds`);
  return Number(result.changes);
}

// SEC-H1 — Scope agent run visibility by thread ownership when the run
// is workbench-bound, condo-wide when the run is ticket-bound.
//
// Workbench threads are personal (admin A's "draft a vendor outreach"
// chat is not admin B's business). Ticket-bound runs (from
// dispatchAgentInBackground) are shared building ops — any admin can
// see who/why/result. We differentiate by thread_id NULL (ticket-bound)
// vs NOT NULL (workbench). When a workbench run is requested by an
// admin who didn't create the thread, we 404 (same response as
// "doesn't exist") — never confirm the run's existence to a non-owner.
export function getAgentRunSnapshot(id: number, condoId: number, callerAdminUserId?: number): AgentRunSnapshot | null {
  const row = db.prepare(
    `SELECT id, status, progress_json, duration_ms, started_at, finished_at,
            thread_id, admin_user_id
     FROM agent_runs WHERE id = ? AND condominium_id = ?`
  ).get(id, condoId) as
    | { id: number; status: AgentRunStatus; progress_json: string | null; duration_ms: number | null; started_at: string; finished_at: string | null; thread_id: number | null; admin_user_id: number | null }
    | undefined;
  if (!row) return null;
  // Workbench run (has a thread) — only visible to the admin who
  // started the thread. Ticket-bound runs (thread_id null) remain
  // condo-wide shared visibility.
  if (row.thread_id != null && callerAdminUserId != null && row.admin_user_id !== callerAdminUserId) {
    return null;
  }
  let progress: ProgressStep[] = [];
  try { progress = row.progress_json ? JSON.parse(row.progress_json) : []; } catch { progress = []; }
  return {
    id: row.id,
    status: row.status,
    progress,
    duration_ms: row.duration_ms,
    started_at: row.started_at,
    finished_at: row.finished_at,
  };
}

export function finishAgentRunFailure(id: number, input: FinishAgentRunFailureInput): void {
  db.prepare(
    `UPDATE agent_runs
        SET status = 'failed',
            duration_ms = ?,
            trace_json = ?,
            last_error = ?,
            finished_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`
  ).run(
    Math.max(0, Math.round(input.durationMs)),
    json(input.trace ?? null),
    errorMessage(input.error),
    id,
  );
}
