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
