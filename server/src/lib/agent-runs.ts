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

export function appendAgentRunProgress(id: number, step: Omit<ProgressStep, 'at'> & { at?: string }): void {
  const row = db.prepare(`SELECT progress_json FROM agent_runs WHERE id = ?`).get(id) as { progress_json: string | null } | undefined;
  if (!row) return;
  let existing: ProgressStep[] = [];
  try { existing = row.progress_json ? JSON.parse(row.progress_json) : []; } catch { existing = []; }
  const next: ProgressStep = {
    at: step.at || new Date().toISOString(),
    label: String(step.label || '').slice(0, 120),
    ...(step.detail ? { detail: String(step.detail).slice(0, 240) } : {}),
  };
  // Cap at 20 entries — beyond that the UI doesn't render anything
  // useful and the JSON blob grows unbounded.
  const trimmed = [...existing, next].slice(-20);
  db.prepare(
    `UPDATE agent_runs SET progress_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(JSON.stringify(trimmed), id);
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

export function getAgentRunSnapshot(id: number, condoId: number): AgentRunSnapshot | null {
  const row = db.prepare(
    `SELECT id, status, progress_json, duration_ms, started_at, finished_at
     FROM agent_runs WHERE id = ? AND condominium_id = ?`
  ).get(id, condoId) as
    | { id: number; status: AgentRunStatus; progress_json: string | null; duration_ms: number | null; started_at: string; finished_at: string | null }
    | undefined;
  if (!row) return null;
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
