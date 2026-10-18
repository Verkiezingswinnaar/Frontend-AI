import type { ElectionConfig, Party, Snapshot } from "./types";

export const numberFormat = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });
export const percentFormat = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const formatVotes = (value: number | undefined): string =>
  value === undefined || !Number.isFinite(value) ? "—" : numberFormat.format(Math.round(value));

export const formatPercent = (value: number | undefined): string =>
  value === undefined || !Number.isFinite(value) ? "—" : `${percentFormat.format(value)}%`;

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

export function partiesFor(snapshot: Snapshot, config: ElectionConfig): Party[] {
  return Object.entries(snapshot.party_snapshots)
    .map(([code, data]) => ({ code, name: config.partyNames[code] ?? code, data }))
    .sort((a, b) => (b.data.votes_percentage ?? -1) - (a.data.votes_percentage ?? -1));
}

export function previousShare(snapshot: Snapshot, party: Party): number | undefined {
  const total = snapshot.snapshot_total_votes_last_election;
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
