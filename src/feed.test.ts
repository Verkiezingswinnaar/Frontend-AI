import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decompressGzip, fetchLatestSnapshot, hasForecast, isSnapshot, latestSnapshot, parseJsonLines } from "./feed";
import { currentShareWithPartials, formatPercent, formatPp, formatSignedPercent, formatVotes, partiesFor, totalWithPartials } from "./format";
import type { ElectionConfig, Snapshot } from "./types";

const fixturesPath = process.env.ELECTION_FIXTURES_PATH || fileURLToPath(new URL("../../Backend/testdata", import.meta.url));
const config: ElectionConfig = { electionName: "GR2026", electionType: "municipal", currentLabel: "GR2026", previousLabel: "GR2022", partyNames: { GLPVDA: "GL-PvdA" } };
afterEach(() => vi.unstubAllGlobals());

describe("historical election fixtures", () => {
  const fixtureNames = readdirSync(fixturesPath).filter((name) => name.endsWith(".jsonl"));
  it("parses snapshots from every previous election-night fixture", () => {
    expect(fixtureNames.length).toBeGreaterThan(0);
    for (const name of fixtureNames) {
      const parsed = parseJsonLines(readFileSync(`${fixturesPath}/${name}`, "utf8"));
      expect(parsed.length, name).toBeGreaterThan(1);
      expect(latestSnapshot(parsed)?.timestamp, name).toBe(Math.max(...parsed.map((item) => item.timestamp)));
    }
  });

  it("selects and renders a feed made from exactly one fixture line", () => {
    const name = fixtureNames[0];
    const lines = readFileSync(`${fixturesPath}/${name}`, "utf8").split(/\r?\n/).filter((item) => item.trim());
    const line = lines.find((item) => isSnapshot(JSON.parse(item)))!;
    const selected = latestSnapshot(parseJsonLines(`${line}\n`));
    expect(selected?.timestamp).toBeGreaterThan(0);
    expect(partiesFor(selected!, config).length).toBeGreaterThan(0);
    expect(hasForecast(selected!)).toBe(false);
  });

  it("keeps optional partial comparisons hidden when historical records do not include them", () => {
    const lines = readFileSync(`${fixturesPath}/${fixtureNames[0]}`, "utf8").split(/\r?\n/).filter((item) => item.trim());
    const line = lines.find((item) => isSnapshot(JSON.parse(item)))!;
    const selected = latestSnapshot(parseJsonLines(line))!;
    expect(totalWithPartials(selected, "votes_this_election_with_partials")).toBeUndefined();
    expect(totalWithPartials(selected, "votes_last_election_corrected")).toBeUndefined();
  });

  it("uses current partials and corrected previous totals for expanded comparison values", () => {
    const snapshot: Snapshot = { timestamp: 1, party_snapshots: {
      A: { votes_this_election_with_partials: 120, votes_last_election_corrected: 100 },
      B: { votes_this_election_with_partials: 80, votes_last_election_corrected: 60 },
    } };
    expect(totalWithPartials(snapshot, "votes_this_election_with_partials")).toBe(200);
    expect(totalWithPartials(snapshot, "votes_last_election_corrected")).toBe(160);
    expect(currentShareWithPartials(snapshot, 120)).toBe(60);
  });
});

describe("snapshot parsing and selection", () => {
  const sample = (timestamp: number): Snapshot => ({ timestamp, estimated_total_votes: 1200, party_snapshots: { A: { votes_percentage: 12.5 } } });
  it("returns no snapshot for empty input", () => expect(latestSnapshot(parseJsonLines("\n  \n"))).toBeNull());
  it("chooses the greatest timestamp even when snapshots are out of order", () => {
    expect(latestSnapshot([sample(10), sample(30), sample(20)])?.timestamp).toBe(30);
  });
  it("validates required timestamp and party data while ignoring future fields", () => {
    expect(isSnapshot({ ...sample(1), future_field: { any: "shape" } })).toBe(true);
    expect(isSnapshot({ ...sample(1), timestamp: Number.NaN })).toBe(false);
    expect(isSnapshot({ ...sample(1), party_snapshots: { A: { votes_percentage: "12" } } })).toBe(false);
    expect(isSnapshot({ timestamp: 1, estimated_total_votes: 0, party_snapshots: { A: { votes_this_election: 0, votes_prediction: 0 } } })).toBe(false);
    expect(hasForecast({ timestamp: 1, estimated_total_votes: 0, party_snapshots: { A: { votes_this_election: 100, votes_prediction: 0 } } })).toBe(false);
  });
});

describe("compressed feed refresh", () => {
  const validLine = JSON.stringify({ timestamp: 100, estimated_total_votes: 200, party_snapshots: { A: { votes_prediction: 200, votes_percentage: 100 } } });
  const okResponse = () => new Response(gzipSync(`${validLine}\n`), { status: 200 });
  it("loads the latest valid snapshot from a gzip response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse()));
    const snapshot = await fetchLatestSnapshot("https://feed.example/data.jsonl.gz", new AbortController().signal);
    expect(snapshot?.timestamp).toBe(100);
  });
  it("reports HTTP and network failures, then recovers on a later refresh", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    await expect(fetchLatestSnapshot("https://feed.example/data.jsonl.gz", signal)).rejects.toThrow("status 503");
    await expect(fetchLatestSnapshot("https://feed.example/data.jsonl.gz", signal)).rejects.toThrow("network unavailable");
    await expect(fetchLatestSnapshot("https://feed.example/data.jsonl.gz", signal)).resolves.toMatchObject({ timestamp: 100 });
  });
  it("propagates request timeouts and gzip decompression errors", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockRejectedValueOnce(new DOMException("Aborted", "AbortError"))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 })));
    const signal = new AbortController().signal;
    await expect(fetchLatestSnapshot("https://feed.example/data.jsonl.gz", signal)).rejects.toMatchObject({ name: "AbortError" });
    await expect(fetchLatestSnapshot("https://feed.example/data.jsonl.gz", signal)).rejects.toThrow();
  });
  it("stops decompression when the uncompressed payload exceeds its limit", async () => {
    const bytes = gzipSync("payload larger than the configured limit");
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await expect(decompressGzip(data, 4)).rejects.toThrow("groter dan toegestaan");
  });
  it("returns empty for a successful empty feed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(gzipSync("  \n"), { status: 200 })));
    await expect(fetchLatestSnapshot("https://feed.example/data.jsonl.gz", new AbortController().signal)).resolves.toBeNull();
  });
});

describe("Dutch formatting and party order", () => {
  it("formats counts, shares, percentage-point deltas, and relative percentages", () => {
    expect(formatVotes(1234567)).toContain("1.234.567");
    expect(formatPercent(11.25)).toBe("11,3%");
    expect(formatPp(1.5)).toBe("+1,5%.");
    expect(formatSignedPercent(12.5)).toBe("+12,5%");
  });
  it("sorts parties by forecast share", () => {
    const snapshot: Snapshot = { timestamp: 1, party_snapshots: { A: { votes_percentage: 2 }, B: { votes_percentage: 20 } } };
    expect(partiesFor(snapshot, config).map((party) => party.code)).toEqual(["B", "A"]);
  });
});
