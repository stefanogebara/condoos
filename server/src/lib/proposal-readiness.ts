export type ProposalReadinessKey =
  | 'scope'
  | 'budget'
  | 'analysis'
  | 'risks'
  | 'voting_window';

export interface ProposalReadinessCheck {
  key: ProposalReadinessKey;
  label: string;
  ready: boolean;
  hint: string;
}

export interface ProposalReadiness {
  ready: boolean;
  score: number;
  missing: ProposalReadinessKey[];
  checks: ProposalReadinessCheck[];
}

export interface ProposalReadinessInput {
  title?: string | null;
  description?: string | null;
  estimated_cost?: number | string | null;
  cost_breakdown?: string | null;
  risk_summary?: string | null;
  voting_opens_at?: string | null;
  voting_closes_at?: string | null;
}

function text(value: unknown): string {
  return String(value || '').trim();
}

function proposalCost(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function validDate(value: unknown): Date | null {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hasCostAnalysis(cost: number | null, costBreakdown: string): boolean {
  if (!costBreakdown) return false;
  if (cost === 0) return true;
  if (/^[—–-]+$/.test(costBreakdown)) return false;
  return costBreakdown.length >= 8;
}

export function buildProposalReadiness(
  proposal: ProposalReadinessInput,
  now: Date = new Date(),
): ProposalReadiness {
  const title = text(proposal.title);
  const description = text(proposal.description);
  const cost = proposalCost(proposal.estimated_cost);
  const costBreakdown = text(proposal.cost_breakdown);
  const risks = text(proposal.risk_summary);
  const opens = validDate(proposal.voting_opens_at);
  const closes = validDate(proposal.voting_closes_at);
  const closeAfterOpen = !opens || !closes || opens.getTime() < closes.getTime();

  const checks: ProposalReadinessCheck[] = [
    {
      key: 'scope',
      label: 'Clear scope',
      ready: title.length >= 6 && description.length >= 40,
      hint: 'Add a clear title and enough description for residents to understand what will change.',
    },
    {
      key: 'budget',
      label: 'Budget',
      ready: cost !== null,
      hint: 'Add an estimated cost, or 0 when the proposal has no direct expense.',
    },
    {
      key: 'analysis',
      label: 'Cost analysis',
      ready: hasCostAnalysis(cost, costBreakdown),
      hint: 'Explain the budget, quote basis, or why there is no direct cost.',
    },
    {
      key: 'risks',
      label: 'Risks and impact',
      ready: risks.length >= 20,
      hint: 'Summarize resident impact, operational risks, dependencies, or cheaper alternatives.',
    },
    {
      key: 'voting_window',
      label: 'Voting window',
      ready: !!closes && closes.getTime() > now.getTime() && closeAfterOpen,
      hint: 'Set a future voting closing date so the decision has a clear deadline.',
    },
  ];

  const missing = checks.filter((check) => !check.ready).map((check) => check.key);
  return {
    ready: missing.length === 0,
    score: Math.round(((checks.length - missing.length) / checks.length) * 100),
    missing,
    checks,
  };
}
