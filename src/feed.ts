import type { Snapshot } from "./types";

const MAX_COMPRESSED_BYTES = 8 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_SNAPSHOTS = 20000;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function isPartySnapshot(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  const known = ["relative_vote_change", "votes_percentage", "votes_prediction", "votes_this_election",
    "votes_last_election", "votes_last_election_corrected", "votes_this_election_with_partials",
    "votes_last_election_with_partials"];
  return known.every((key) => fields[key] === undefined || finite(fields[key]));
}

export function isSnapshot(value: unknown): value is Snapshot {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!finite(record.timestamp) || record.timestamp <= 0) return false;
  if (record.party_snapshots === null || typeof record.party_snapshots !== "object" || Array.isArray(record.party_snapshots)) return false;
  if (Object.keys(record.party_snapshots).length === 0) return false;
  if (!Object.values(record.party_snapshots).every(isPartySnapshot)) return false;
  const knownNumberFields = [
    "snapshot_total_votes_this_election", "snapshot_total_votes_last_election",
    "estimated_total_votes", "estimated_total_votes_direct", "estimated_below_threshold",
    "estimated_above_threshold", "estimated_total_votes_ratio",
  ];
  if (!knownNumberFields.every((key) => record[key] === undefined || finite(record[key]))) return false;
  const hasObservedVotes = Object.values(record.party_snapshots).some((party) => {
    const fields = party as Record<string, unknown>;
    return (finite(fields.votes_this_election) && fields.votes_this_election > 0) ||
      (finite(fields.votes_prediction) && fields.votes_prediction > 0);
  });
  return hasObservedVotes || (finite(record.estimated_total_votes) && record.estimated_total_votes > 0);
}

export function parseJsonLines(text: string): Snapshot[] {
  const snapshots: Snapshot[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (snapshots.length >= MAX_SNAPSHOTS) throw new Error("De uitslagenbron bevat te veel snapshots.");
    try {
      const value: unknown = JSON.parse(line);
      if (isSnapshot(value)) snapshots.push(value);
    } catch {
      // Keep processing later snapshots if a historical line is damaged.
    }
  }
  return snapshots;
}

export function latestSnapshot(snapshots: Snapshot[]): Snapshot | null {
  return snapshots.reduce<Snapshot | null>(
    (latest, snapshot) => (!latest || snapshot.timestamp > latest.timestamp ? snapshot : latest),
    null,
  );
}

export function hasForecast(snapshot: Snapshot): boolean {
  return (typeof snapshot.estimated_total_votes === "number" && snapshot.estimated_total_votes > 0) ||
    Object.values(snapshot.party_snapshots).some((party) => typeof party.votes_prediction === "number" && party.votes_prediction > 0);
}

async function readBounded(stream: ReadableStream<Uint8Array>, limit: number, label: string): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error(`De ${label} is groter dan toegestaan.`);
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function decompressGzip(data: ArrayBuffer, maxBytes = MAX_DECOMPRESSED_BYTES): Promise<string> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Deze browser kan de gecomprimeerde uitslagen niet openen.");
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
  const bytes = await readBounded(stream, maxBytes, "uitgepakte uitslagenbron");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function fetchLatestSnapshot(url: string, signal: AbortSignal): Promise<Snapshot | null> {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`De uitslagenbron antwoordde met status ${response.status}.`);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_COMPRESSED_BYTES) throw new Error("De gecomprimeerde uitslagenbron is groter dan toegestaan.");
  const compressed = response.body
    ? await readBounded(response.body, MAX_COMPRESSED_BYTES, "gecomprimeerde uitslagenbron")
    : new Uint8Array(await response.arrayBuffer());
  if (compressed.byteLength > MAX_COMPRESSED_BYTES) throw new Error("De gecomprimeerde uitslagenbron is groter dan toegestaan.");
  const ownedBuffer = new Uint8Array(compressed.byteLength);
  ownedBuffer.set(compressed);
  const text = await decompressGzip(ownedBuffer.buffer);
  return latestSnapshot(parseJsonLines(text));
}
