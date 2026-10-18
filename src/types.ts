export type PartySnapshot = {
  relative_vote_change?: number;
  votes_percentage?: number;
  votes_prediction?: number;
  votes_this_election?: number;
  votes_last_election?: number;
  votes_last_election_corrected?: number;
  votes_this_election_with_partials?: number;
  votes_last_election_with_partials?: number;
};

export type Snapshot = {
  timestamp: number;
  snapshot_total_votes_this_election?: number;
  snapshot_total_votes_last_election?: number;
  estimated_total_votes?: number;
  estimated_total_votes_direct?: number;
  estimated_below_threshold?: number;
  estimated_above_threshold?: number;
  estimated_total_votes_ratio?: number;
  party_snapshots: Record<string, PartySnapshot>;
};

export type Party = {
  code: string;
  name: string;
  data: PartySnapshot;
};

export type ElectionConfig = {
  electionName: string;
  electionType: "municipal" | "tweede-kamer" | "other";
  currentLabel: string;
  previousLabel: string;
  partyNames: Record<string, string>;
};
