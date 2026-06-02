import { expect, type APIRequestContext } from '@playwright/test';

export async function completeProposalReadiness(
  request: APIRequestContext,
  apiURL: string,
  headers: Record<string, string>,
  proposalId: number,
  options: { opensAt?: string; closesAt?: string; quorumPercent?: number } = {},
) {
  const readiness = await request.patch(`${apiURL}/proposals/${proposalId}/readiness`, {
    headers,
    data: {
      estimated_cost: 12000,
      cost_breakdown: 'Materials: 8000\nLabor: 4000',
      risk_summary: 'Residents need advance notice and vendor access must be coordinated. Compare warranty and alternatives before approving.',
    },
  });
  expect(readiness.ok(), `readiness update failed: ${readiness.status()} ${await readiness.text()}`).toBeTruthy();

  const closesAt = options.closesAt || new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const compliance = await request.patch(`${apiURL}/proposals/${proposalId}/compliance`, {
    headers,
    data: { quorum_percent: options.quorumPercent ?? 0, voting_opens_at: options.opensAt || null, voting_closes_at: closesAt },
  });
  expect(compliance.ok(), `compliance update failed: ${compliance.status()} ${await compliance.text()}`).toBeTruthy();
}
