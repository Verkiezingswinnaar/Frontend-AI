import type { ElectionConfig, ElectionResults, ElectionType, Party, PartySnapshot, ResultMetric, Snapshot } from "./types";

export const numberFormat = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });
export const percentFormat = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const wholePercentFormat = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });

export const formatVotes = (value: number | undefined): string =>
  value === undefined || !Number.isFinite(value) ? "—" : numberFormat.format(Math.round(value));

export const formatPercent = (value: number | undefined): string =>
  value === undefined || !Number.isFinite(value) ? "—" : `${percentFormat.format(value)}%`;

export const formatWholePercent = (value: number | undefined): string =>
  value === undefined || !Number.isFinite(value) ? "—" : `${wholePercentFormat.format(value)}%`;

export const resultMetricForElection = (type: ElectionType): ResultMetric =>
  type === "national" || type === "tweede-kamer" ? "seats" : "vote-share";

export const chartFits = (availableWidth: number, partyCount: number, groupWidth: number, gap: number): boolean =>
  availableWidth >= partyCount * groupWidth + Math.max(0, partyCount - 1) * gap;

export function chartValueForParty(
  snapshot: Snapshot,
  party: Party,
  metric: ResultMetric,
  series: "current" | "previous",
): number | undefined {
  if (metric === "seats") return series === "current" ? party.data.seats_prediction : party.previousSeats ?? party.data.seats_last_election;
  return series === "current" ? party.data.votes_percentage : previousShare(snapshot, party);
}

export function chartPartiesForMetric(parties: Party[], metric: ResultMetric): Party[] {
  if (metric !== "seats") return parties;
  return parties.filter((party) =>
    (party.previousSeats ?? party.data.seats_last_election ?? 0) > 0
    || (party.data.seats_prediction ?? 0) > 0,
  );
}

export function hasSameMunicipalityDetails(data: PartySnapshot): boolean {
  return data.votes_this_election_with_partials !== undefined
    || data.votes_last_election_corrected !== undefined;
}

export const formatPp = (value: number | undefined): string => {
  if (value === undefined || !Number.isFinite(value)) return "";
  const prefix = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${prefix}${percentFormat.format(Math.abs(value))}%.`;
};

export const formatSignedPercent = (value: number | undefined): string => {
  if (value === undefined || !Number.isFinite(value)) return "";
  const prefix = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${prefix}${percentFormat.format(Math.abs(value))}%`;
};

export const formatTime = (timestamp: number): string =>
  new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));

export function partiesFor(snapshot: Snapshot, config: ElectionConfig, previousResults?: ElectionResults): Party[] {
  const codes = new Set([...Object.keys(snapshot.party_snapshots), ...Object.keys(previousResults?.votes ?? {}), ...Object.keys(previousResults?.seats ?? {})]);
  return [...codes]
    .map((code) => ({
      code,
      name: config.partyNames[code] ?? code,
      data: snapshot.party_snapshots[code] ?? {},
      previousVotes: previousResults?.votes[code] ?? snapshot.party_snapshots[code]?.votes_last_election,
      previousSeats: previousResults?.seats[code] ?? snapshot.party_snapshots[code]?.seats_last_election,
      previousTotalVotes: previousResults ? Object.values(previousResults.votes).reduce((sum, count) => sum + count, 0) : undefined,
    }))
    .sort((a, b) => (b.data.votes_percentage ?? -1) - (a.data.votes_percentage ?? -1));
}

export function previousShare(snapshot: Snapshot, party: Party): number | undefined {
  const total = snapshot.snapshot_total_votes_last_election;
  if (party.previousVotes !== undefined) {
    const archiveTotal = party.previousTotalVotes ?? total;
    if (!archiveTotal || archiveTotal <= 0) return undefined;
    return (party.previousVotes / archiveTotal) * 100;
  }
  if (party.data.votes_last_election === undefined || !total || total <= 0) return undefined;
  return (party.data.votes_last_election / total) * 100;
}

export function totalWithPartials(snapshot: Snapshot, field: "votes_this_election_with_partials" | "votes_last_election_corrected"): number | undefined {
  const values = Object.values(snapshot.party_snapshots).map((party) => party[field]);
  if (!values.length || values.some((value) => value === undefined)) return undefined;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

export function currentShareWithPartials(snapshot: Snapshot, value: number | undefined): number | undefined {
  const total = totalWithPartials(snapshot, "votes_this_election_with_partials");
  if (value === undefined || total === undefined || total <= 0) return undefined;
  return (value / total) * 100;
}

export function forecastDelta(snapshot: Snapshot, party: Party): number | undefined {
  const share = party.data.votes_percentage;
  const previous = previousShare(snapshot, party);
  return share === undefined || previous === undefined ? undefined : share - previous;
}
