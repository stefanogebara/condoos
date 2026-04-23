import db from '../db';

export type VoterEligibility = 'all' | 'owners_only' | 'primary_contact_only';

export interface ProposalForTally {
  id: number;
  condominium_id: number;
  voter_eligibility?: VoterEligibility | string | null;
}

export interface VoterRights {
  eligible_as_all: boolean;
  eligible_as_owner: boolean;
  eligible_as_primary_contact: boolean;
  voting_weight: number;
}

export interface ProposalVoteTally {
  yes: number;
  no: number;
  abstain: number;
  total: number;
  yes_weight: number;
  no_weight: number;
  abstain_weight: number;
  total_weight: number;
}

export function resolveVoterRights(userId: number, condoId: number): VoterRights {
  const rows = db.prepare(
    `SELECT uu.relationship, uu.primary_contact, uu.voting_weight
     FROM user_unit uu
     JOIN units un ON un.id = uu.unit_id
     JOIN buildings b ON b.id = un.building_id
     WHERE uu.user_id = ? AND b.condominium_id = ? AND uu.status = 'active'`
  ).all(userId, condoId) as Array<{ relationship: string; primary_contact: number; voting_weight: number }>;

  if (rows.length === 0) {
    return { eligible_as_all: false, eligible_as_owner: false, eligible_as_primary_contact: false, voting_weight: 0 };
  }

  return {
    eligible_as_all: true,
    eligible_as_owner: rows.some((r) => r.relationship === 'owner'),
    eligible_as_primary_contact: rows.some((r) => r.primary_contact === 1),
    voting_weight: rows.reduce((acc, r) => acc + Number(r.voting_weight || 0), 0),
  };
}

export function canVote(userId: number, condoId: number, eligibility: string | null): boolean {
  const rights = resolveVoterRights(userId, condoId);
  if (!rights.eligible_as_all) return false;
  if (eligibility === 'owners_only') return rights.eligible_as_owner;
  if (eligibility === 'primary_contact_only') return rights.eligible_as_primary_contact;
  return true;
}

export function getProposalVoteTally(proposal: ProposalForTally): ProposalVoteTally {
  const votes = db.prepare(
    `SELECT pv.user_id, pv.choice,
            COALESCE((
              SELECT SUM(uu.voting_weight) FROM user_unit uu
              JOIN units un ON un.id = uu.unit_id
              JOIN buildings b ON b.id = un.building_id
              WHERE uu.user_id = pv.user_id AND b.condominium_id = ? AND uu.status = 'active'
            ), 1.0) AS weight,
            EXISTS(
              SELECT 1 FROM user_unit uu
              JOIN units un ON un.id = uu.unit_id
              JOIN buildings b ON b.id = un.building_id
              WHERE uu.user_id = pv.user_id AND b.condominium_id = ?
                AND uu.status = 'active' AND uu.relationship = 'owner'
            ) AS is_owner,
            EXISTS(
              SELECT 1 FROM user_unit uu
              JOIN units un ON un.id = uu.unit_id
              JOIN buildings b ON b.id = un.building_id
              WHERE uu.user_id = pv.user_id AND b.condominium_id = ?
                AND uu.status = 'active' AND uu.primary_contact = 1
            ) AS is_primary
     FROM proposal_votes pv
     WHERE pv.proposal_id = ?`
  ).all(proposal.condominium_id, proposal.condominium_id, proposal.condominium_id, proposal.id) as Array<{
    choice: 'yes' | 'no' | 'abstain';
    weight: number;
    is_owner: number;
    is_primary: number;
  }>;

  const eligible = (vote: { is_owner: number; is_primary: number }): boolean => {
    if (proposal.voter_eligibility === 'owners_only') return !!vote.is_owner;
    if (proposal.voter_eligibility === 'primary_contact_only') return !!vote.is_primary;
    return true;
  };

  const tally: ProposalVoteTally = {
    yes: 0,
    no: 0,
    abstain: 0,
    total: 0,
    yes_weight: 0,
    no_weight: 0,
    abstain_weight: 0,
    total_weight: 0,
  };

  for (const vote of votes) {
    if (!eligible(vote)) continue;
    const weight = Number(vote.weight || 0);
    tally.total += 1;
    tally.total_weight += weight;
    if (vote.choice === 'yes') {
      tally.yes += 1;
      tally.yes_weight += weight;
    }
    if (vote.choice === 'no') {
      tally.no += 1;
      tally.no_weight += weight;
    }
    if (vote.choice === 'abstain') {
      tally.abstain += 1;
      tally.abstain_weight += weight;
    }
  }

  return tally;
}

export function attachVoteTally<T extends ProposalForTally>(proposal: T): T & { votes: ProposalVoteTally } {
  return { ...proposal, votes: getProposalVoteTally(proposal) };
}

export function resolveVoteOutcome(tally: ProposalVoteTally): 'approved' | 'rejected' | 'inconclusive' {
  if (tally.yes_weight > tally.no_weight) return 'approved';
  if (tally.no_weight > tally.yes_weight) return 'rejected';
  return 'inconclusive';
}
