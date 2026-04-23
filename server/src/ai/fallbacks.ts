// Deterministic fallbacks used when OpenRouter is unavailable.
// Must never throw and must return same shape as AI output.

export function fallbackProposalDraft(text: string) {
  const t = text.trim();
  const title = t.length > 60 ? t.slice(0, 57).replace(/\s\S*$/, '') + '...' : t;
  return {
    title: `Address resident concern: ${title.slice(0, 50)}`,
    description: `A resident raised the following concern: "${t}". The board should review whether this constitutes a maintenance issue, a policy change, or a budgetable project, then decide on concrete next steps and a timeline.`,
    category: 'maintenance',
    estimated_cost: null,
    rationale: 'Raised directly by a resident - deserves a structured review.',
    _fallback: true,
  };
}

export function fallbackCluster(suggestions: { id: number; body: string }[]) {
  // Naive keyword-based clustering: AC, EV, gym, noise, package...
  const groups: Record<string, number[]> = {};
  const keywords: Array<[string, RegExp]> = [
    ['HVAC / cooling',   /\b(ac|air conditioning|cool|hot|temperature|heat)\b/i],
    ['EV charging',      /\b(ev|electric vehicle|charger|charging)\b/i],
    ['Gym equipment',    /\b(gym|treadmill|weight|equipment|fitness)\b/i],
    ['Noise',            /\b(noise|loud|quiet)\b/i],
    ['Packages',         /\b(package|delivery|amazon|ups|fedex)\b/i],
    ['Parking',          /\b(parking|garage|spot)\b/i],
    ['Cleanliness',      /\b(clean|dirt|trash|garbage)\b/i],
  ];
  const assigned = new Set<number>();
  for (const s of suggestions) {
    for (const [label, rx] of keywords) {
      if (rx.test(s.body)) {
        groups[label] = groups[label] || [];
        groups[label].push(s.id);
        assigned.add(s.id);
        break;
      }
    }
  }
  const clusters = Object.entries(groups)
    .filter(([, ids]) => ids.length >= 2)
    .map(([label, ids]) => ({ label, summary: `${ids.length} residents mentioned this.`, suggestion_ids: ids }));
  const clusteredIds = new Set(clusters.flatMap((c) => c.suggestion_ids));
  const unclustered_ids = suggestions.filter((s) => !clusteredIds.has(s.id)).map((s) => s.id);
  return { clusters, unclustered_ids, _fallback: true };
}

export function fallbackThreadSummary(commentsCount: number) {
  return {
    summary: `Discussion has ${commentsCount} comments. Residents raised concerns about cost and implementation details.`,
    points_of_agreement: ['There is interest in addressing the issue'],
    points_of_disagreement: ['Cost and scope remain debated'],
    open_questions: ['What is the implementation timeline?', 'Who bears ongoing costs?'],
    _fallback: true,
  };
}

export function fallbackMeetingSummary(rawNotes: string) {
  return {
    summary: 'The board convened to review pending proposals and operational items. See raw notes for full detail.',
    decisions: ['Proposals reviewed; decisions pending formal vote.'],
    action_items: [
      { description: 'Circulate meeting notes to residents', owner_label: 'Board Secretary', due_date: null },
    ],
    resident_announcement: {
      title: 'Board meeting recap',
      body: `Hi neighbors,\n\nThe board met to review current proposals and operational matters. ${rawNotes ? 'Notes were recorded and will be posted shortly.' : 'Formal minutes to follow.'}\n\nReach out with any questions.`,
    },
    _fallback: true,
  };
}

export function fallbackExplain(title: string, description: string) {
  return `Hi neighbors, the board is considering "${title}". In plain terms: ${description.slice(0, 200)}${description.length > 200 ? '...' : ''}\n\nWe wanted to flag this early so everyone has a chance to weigh in before anything is finalized. If you have thoughts, please leave a comment on the proposal page - your input shapes the outcome.`;
}

export function fallbackDecisionSummary(
  title: string,
  outcome: 'approved' | 'rejected' | 'inconclusive',
  votes: { yes: number; no: number; abstain: number }
) {
  return {
    headline: `${title} - ${outcome}`,
    outcome,
    vote_breakdown_text: `${votes.yes} yes, ${votes.no} no, ${votes.abstain} abstain`,
    rationale: `The board reviewed resident feedback and voted. Final tally: ${votes.yes} yes / ${votes.no} no / ${votes.abstain} abstain.`,
    next_steps: outcome === 'approved'
      ? ['Schedule implementation', 'Communicate timeline to residents']
      : ['Archive proposal', 'Revisit if new information arises'],
    _fallback: true,
  };
}
