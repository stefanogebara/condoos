import type { AdminAgentNetworkFit, AdminAgentOutput } from '../ai/admin-agent';
import { categoryMatches } from './category-aliases';

const SAFETY_CRITICAL_SET = new Set([
  'elevator',
  'fire_safety',
  'gas',
  'gas_leak',
  'water',
  'water_damage',
  'security',
]);

export function isSafetyCriticalUrgent(priority: string, category: string): boolean {
  return priority === 'urgent' && SAFETY_CRITICAL_SET.has(category);
}

type AutoDispatchPlan = Pick<AdminAgentOutput, 'confidence' | 'building_memory'> | null | undefined;

export type AutoDispatchGateInput = {
  ticketPriority: string;
  ticketCategory: string;
  vendorCategory: string | null | undefined;
  plan: AutoDispatchPlan;
  topFit: Pick<AdminAgentNetworkFit, 'cost_history'> | null | undefined;
};

export type AutoDispatchGateDecision = {
  allowed: boolean;
  reason:
    | 'urgent_safety'
    | 'eligible'
    | 'category_mismatch'
    | 'insufficient_confidence'
    | 'insufficient_evidence';
  confidentEnough: boolean;
  categoryCompatible: boolean;
  evidence: {
    similarResolvedTicket: boolean;
    highConfidenceCostHistory: boolean;
  };
};

export function evaluateAgentAutoDispatch(input: AutoDispatchGateInput): AutoDispatchGateDecision {
  const confidence = input.plan?.confidence;
  // SEC-M4 — Defense-in-depth: clamp score to [0,1] at the gate. The
  // sanitizer already clamps before the gate sees the plan, but a
  // future caller passing an un-sanitized plan must not be able to
  // bypass the threshold with score=999 paired with tier='medium'.
  const rawScore = typeof confidence?.score === 'number' && Number.isFinite(confidence.score)
    ? Math.max(0, Math.min(1, confidence.score))
    : 0;
  const confidentEnough = confidence?.tier === 'high' || rawScore >= 0.85;
  const categoryCompatible = categoryMatches(input.ticketCategory, input.vendorCategory || '');
  const evidence = {
    similarResolvedTicket: (input.plan?.building_memory?.similar_resolved_tickets?.length || 0) > 0,
    highConfidenceCostHistory: input.topFit?.cost_history?.confidence === 'high'
      && Number(input.topFit.cost_history.expense_count || 0) >= 3,
  };

  if (!categoryCompatible) {
    return { allowed: false, reason: 'category_mismatch', confidentEnough, categoryCompatible, evidence };
  }

  // SEC-5 — Urgent-safety used to bypass ALL evidence checks (no
  // confidence requirement, no similar-resolved-ticket, no cost-history,
  // and no 5-minute veto window). That left the auto-dispatch decision
  // controlled entirely by the ticket's priority+category fields plus
  // the model's existing_network_fit[0] — which an attacker can
  // influence via prompt injection in the ticket text (see SEC-1, SEC-2).
  //
  // Bar to clear now: even on the safety path, the system must have at
  // least one server-visible signal that this vendor is a reasonable
  // pick — either confidence is high OR there's a similar resolved
  // ticket OR we have reliable cost history with this vendor. This
  // doesn't ask for a full evidence package (we still want fast
  // dispatch for real gas leaks); it just rules out "zero corroborating
  // evidence and the model's word for it."
  if (isSafetyCriticalUrgent(input.ticketPriority, input.ticketCategory)) {
    const hasAnyEvidence = confidentEnough
      || evidence.similarResolvedTicket
      || evidence.highConfidenceCostHistory;
    if (hasAnyEvidence) {
      return { allowed: true, reason: 'urgent_safety', confidentEnough, categoryCompatible, evidence };
    }
    // Fall through to insufficient_evidence — the safety path doesn't
    // get to skip the bar entirely. The veto-window skip in tickets.ts
    // is separately gated by isSafetyCriticalUrgent so this still
    // dispatches without the 5min hold IF we make it past the gate.
    return { allowed: false, reason: 'insufficient_evidence', confidentEnough, categoryCompatible, evidence };
  }

  if (!confidentEnough) {
    return { allowed: false, reason: 'insufficient_confidence', confidentEnough, categoryCompatible, evidence };
  }

  if (!evidence.similarResolvedTicket || !evidence.highConfidenceCostHistory) {
    return { allowed: false, reason: 'insufficient_evidence', confidentEnough, categoryCompatible, evidence };
  }

  return { allowed: true, reason: 'eligible', confidentEnough, categoryCompatible, evidence };
}
