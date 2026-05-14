// AI spend tracking. OpenRouter returns a `usage` block on every successful
// response; we capture it into the `ai_usage` table so the team can see the
// bill forming instead of discovering it via a 402 outage.
//
// Only SUCCESSFUL calls are recorded: a 402/429/timeout bills ~zero tokens,
// so the table is a faithful picture of actual spend. Failure visibility
// comes from the circuit breaker state (see openrouter.ts / Phase 1.6).
import db from '../db';

// Approximate OpenRouter list prices, USD per 1M tokens (input / output).
// These are estimates for a "see the trend" cost column — not billing-grade.
// Update when the model pinning or OpenRouter pricing changes.
const MODEL_RATES: Record<string, { in: number; out: number }> = {
  'anthropic/claude-3.5-haiku': { in: 0.80, out: 4.00 },
  'anthropic/claude-3-haiku':   { in: 0.25, out: 1.25 },
  'deepseek/deepseek-chat':     { in: 0.14, out: 0.28 },
};
// Fallback rate for an unrecognised model — use Haiku 3.5 so an estimate is
// never wildly low (better to over- than under-estimate the bill).
const DEFAULT_RATE = MODEL_RATES['anthropic/claude-3.5-haiku'];

export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const rate = MODEL_RATES[model] || DEFAULT_RATE;
  const cost = (promptTokens / 1_000_000) * rate.in + (completionTokens / 1_000_000) * rate.out;
  return Math.round(cost * 1_000_000) / 1_000_000; // round to 6dp ($0.000001)
}

export interface AiUsageRecord {
  caller: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  outcome: string;          // 'ok' for now — failures aren't token-billed
  condoId?: number | null;
  iterations?: number;      // >1 for the ReAct tool-use loop
}

export function recordAiUsage(rec: AiUsageRecord): void {
  // Usage logging must never break the actual AI call — swallow everything.
  try {
    const prompt = Math.max(0, Math.round(rec.promptTokens || 0));
    const completion = Math.max(0, Math.round(rec.completionTokens || 0));
    db.prepare(
      `INSERT INTO ai_usage
         (caller, model, prompt_tokens, completion_tokens, total_tokens,
          est_cost_usd, outcome, condominium_id, iterations)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      String(rec.caller || 'unknown').slice(0, 80),
      String(rec.model || 'unknown').slice(0, 120),
      prompt,
      completion,
      prompt + completion,
      estimateCostUsd(rec.model, prompt, completion),
      String(rec.outcome || 'ok').slice(0, 40),
      rec.condoId ?? null,
      Math.max(1, Math.round(rec.iterations || 1)),
    );
  } catch (err) {
    console.warn('[ai-usage] failed to record usage:', (err as Error)?.message || err);
  }
}

export interface AiUsageSummary {
  since: string;
  total_calls: number;
  total_tokens: number;
  est_cost_usd: number;
  by_caller: Array<{ caller: string; calls: number; total_tokens: number; est_cost_usd: number }>;
}

// 7-day (or custom-window) rollup for the spend-visibility endpoint (1.6).
export function getAiUsageSummary(days = 7, condoId?: number | null): AiUsageSummary {
  const safeDays = Math.min(365, Math.max(1, Math.round(days || 7)));
  const since = new Date(Date.now() - safeDays * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
  const scoped = typeof condoId === 'number' && Number.isFinite(condoId);
  const where = scoped ? 'created_at >= ? AND condominium_id = ?' : 'created_at >= ?';
  const params = scoped ? [since, condoId] : [since];
  const totals = db.prepare(
    `SELECT COUNT(*) AS calls, COALESCE(SUM(total_tokens), 0) AS tokens,
            COALESCE(SUM(est_cost_usd), 0) AS cost
     FROM ai_usage WHERE ${where}`
  ).get(...params) as { calls: number; tokens: number; cost: number };
  const byCaller = db.prepare(
    `SELECT caller, COUNT(*) AS calls, COALESCE(SUM(total_tokens), 0) AS total_tokens,
            COALESCE(SUM(est_cost_usd), 0) AS est_cost_usd
     FROM ai_usage WHERE ${where}
     GROUP BY caller ORDER BY est_cost_usd DESC`
  ).all(...params) as AiUsageSummary['by_caller'];
  return {
    since,
    total_calls: totals.calls,
    total_tokens: totals.tokens,
    est_cost_usd: Math.round(totals.cost * 1_000_000) / 1_000_000,
    by_caller: byCaller,
  };
}
