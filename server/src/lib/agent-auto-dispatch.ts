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
  const confidentEnough = confidence?.tier === 'high'
    || (typeof confidence?.score === 'number' && confidence.score >= 0.85);
  const categoryCompatible = categoryMatches(input.ticketCategory, input.vendorCategory || '');
  const evidence = {
    similarResolvedTicket: (input.plan?.building_memory?.similar_resolved_tickets?.length || 0) > 0,
    highConfidenceCostHistory: input.topFit?.cost_history?.confidence === 'high'
      && Number(input.topFit.cost_history.expense_count || 0) >= 3,
  };

  if (!categoryCompatible) {
    return { allowed: false, reason: 'category_mismatch', confidentEnough, categoryCompatible, evidence };
  }

  if (isSafetyCriticalUrgent(input.ticketPriority, input.ticketCategory)) {
    return { allowed: true, reason: 'urgent_safety', confidentEnough, categoryCompatible, evidence };
  }

  if (!confidentEnough) {
    return { allowed: false, reason: 'insufficient_confidence', confidentEnough, categoryCompatible, evidence };
  }

  if (!evidence.similarResolvedTicket || !evidence.highConfidenceCostHistory) {
    return { allowed: false, reason: 'insufficient_evidence', confidentEnough, categoryCompatible, evidence };
  }

  return { allowed: true, reason: 'eligible', confidentEnough, categoryCompatible, evidence };
}
