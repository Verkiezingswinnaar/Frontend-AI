export type PartySnapshot = {
  relative_vote_change?: number;
  votes_percentage?: number;
  votes_prediction?: number;
  votes_this_election?: number;
  votes_last_election?: number;
  municipalities?: number;
  seats_prediction?: number;
  seats_last_election?: number;
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

export type ElectionType = "municipal" | "provincial" | "national" | "tweede-kamer" | "other";
export type ResultMetric = "vote-share" | "seats";

export type Party = {
  code: string;
  name: string;
  data: PartySnapshot;
  previousVotes?: number;
  previousSeats?: number;
  previousTotalVotes?: number;
};

export type ActiveElections = { current: string; previous: string };
export type ElectionResults = {
  id: string;
  name: string;
  label: string;
  type: ElectionType;
  votes: Record<string, number>;
  seats: Record<string, number>;
};

export type ElectionConfig = {
  electionName: string;
  electionType: ElectionType;
  resultMetric: ResultMetric;
  currentLabel: string;
  previousLabel: string;
  partyNames: Record<string, string>;
};
