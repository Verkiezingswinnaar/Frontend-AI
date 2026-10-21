import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decompressGzip, fetchLatestSnapshot, hasForecast, isSnapshot, latestSnapshot, parseJsonLines } from "./feed";
import { chartFits, chartPartiesForMetric, chartValueForParty, currentShareWithPartials, formatPercent, formatPp, formatSignedPercent, formatVotes, formatWholePercent, hasSameMunicipalityDetails, partiesFor, previousShare, resultMetricForElection, totalWithPartials } from "./format";
import type { ElectionConfig, ElectionResults, Snapshot } from "./types";
import { fetchElectionSetup } from "./config";

const fixturesPath = process.env.ELECTION_FIXTURES_PATH || fileURLToPath(new URL("../../Backend/testdata", import.meta.url));
const config: ElectionConfig = { electionName: "GR2026", electionType: "municipal", resultMetric: "vote-share", currentLabel: "GR2026", previousLabel: "GR2022", partyNames: { GLPVDA: "GL-PvdA" } };
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
    expect(currentShareWithPartials({ timestamp: 1, party_snapshots: { A: { votes_this_election_with_partials: 120 }, B: {} } }, 120)).toBeUndefined();
    expect(hasSameMunicipalityDetails({ votes_this_election_with_partials: 120 })).toBe(true);
    expect(hasSameMunicipalityDetails({ votes_last_election_corrected: 100 })).toBe(true);
    expect(hasSameMunicipalityDetails({})).toBe(false);
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

  it("accepts finite seat counts and rejects nonnumeric seat fields", () => {
    expect(isSnapshot({ ...sample(1), party_snapshots: { A: { votes_prediction: 100, seats_prediction: 7, seats_last_election: 6 } } })).toBe(true);
    expect(isSnapshot({ ...sample(1), party_snapshots: { A: { votes_prediction: 100, seats_prediction: "7" } } })).toBe(false);
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
  it("builds the full previous-election baseline, including parties missing from the current feed", () => {
    const snapshot: Snapshot = { timestamp: 1, snapshot_total_votes_last_election: 900, party_snapshots: {
      A: { votes_percentage: 25, votes_prediction: 100, votes_last_election: 30 },
    } };
    const previous: ElectionResults = { id: "TK2023", name: "Tweede Kamerverkiezing 2023", label: "TK2023", type: "national", votes: { A: 400, B: 500, OVERIG: 29 }, seats: { A: 10, B: 4 } };
    const parties = partiesFor(snapshot, config, previous);
    const partyB = parties.find((party) => party.code === "B")!;
    expect(parties.map((party) => party.code).sort()).toEqual(["A", "B", "OVERIG"]);
    expect(partyB.previousVotes).toBe(500);
    expect(partyB.data.votes_prediction).toBeUndefined();
    expect(previousShare(snapshot, partyB)).toBeCloseTo(500 / 929 * 100);
    expect(chartValueForParty(snapshot, partyB, "seats", "previous")).toBe(4);
    expect(chartValueForParty(snapshot, partyB, "seats", "current")).toBeUndefined();
  });

  it("loads election IDs, per-election metadata, and a derived feed URL from the shared base", async () => {
    vi.stubGlobal("window", { location: { href: "http://localhost:5173/" } });
    const archive = (id: string): ElectionResults => ({ id, name: id, label: id, type: "national", votes: { OVERIG: 1 }, seats: {} });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith("active-elections.json") ? { current: "TK2025", previous: "TK2023" }
        : url.endsWith("results-TK2025.json") ? archive("TK2025") : archive("TK2023");
      return new Response(JSON.stringify(body), { status: 200 });
    }));
    const setup = await fetchElectionSetup(new AbortController().signal);
    expect(setup.active).toEqual({ current: "TK2025", previous: "TK2023" });
    expect(setup.election.resultMetric).toBe("seats");
    expect(setup.feedUrl).toBe("http://localhost:5173/election-assets/data-TK2025.jsonl.gz");
  });

  it("formats counts, shares, percentage-point deltas, and relative percentages", () => {
    expect(formatVotes(1234567)).toContain("1.234.567");
    expect(formatPercent(11.25)).toBe("11,3%");
    expect(formatWholePercent(11.6)).toBe("12%");
    expect(formatWholePercent(11.4)).toBe("11%");
    expect(formatVotes(7)).toBe("7");
    expect(formatPp(1.5)).toBe("+1,5%.");
    expect(formatSignedPercent(12.5)).toBe("+12,5%");
  });
  it("uses vote shares for municipal and provincial elections and seats for national elections", () => {
    expect(resultMetricForElection("municipal")).toBe("vote-share");
    expect(resultMetricForElection("provincial")).toBe("vote-share");
    expect(resultMetricForElection("national")).toBe("seats");
    expect(resultMetricForElection("tweede-kamer")).toBe("seats");
  });
  it("switches to the compact chart exactly when the available width cannot fit all party groups", () => {
    expect(chartFits(142, 2, 68, 6)).toBe(true);
    expect(chartFits(141, 2, 68, 6)).toBe(false);
    expect(chartFits(216, 3, 68, 6)).toBe(true);
    expect(chartFits(215, 3, 68, 6)).toBe(false);
  });
  it("selects supplied seats independently for current and previous national results", () => {
    const snapshot: Snapshot = { timestamp: 1, snapshot_total_votes_last_election: 200, party_snapshots: {} };
    const party = { code: "A", name: "A", data: { votes_percentage: 12.5, votes_last_election: 20, seats_prediction: 8, seats_last_election: 7 } };
    expect(chartValueForParty(snapshot, party, "seats", "current")).toBe(8);
    expect(chartValueForParty(snapshot, party, "seats", "previous")).toBe(7);
    expect(chartValueForParty(snapshot, { ...party, data: { votes_percentage: 12.5 } }, "seats", "current")).toBeUndefined();
  });
  it("filters only national chart parties by previous or forecast seats", () => {
    const parties = [
      { code: "previous", name: "Previous", data: { seats_prediction: 0 }, previousSeats: 1 },
      { code: "forecast", name: "Forecast", data: { seats_prediction: 1 }, previousSeats: 0 },
      { code: "none", name: "None", data: { seats_prediction: 0 }, previousSeats: 0 },
      { code: "unknown", name: "Unknown", data: {}, previousSeats: 0 },
    ];
    expect(chartPartiesForMetric(parties, "seats").map((party) => party.code)).toEqual(["previous", "forecast"]);
    expect(chartPartiesForMetric(parties, "vote-share")).toBe(parties);
    expect(parties).toHaveLength(4);
  });
  it("sorts parties by forecast share", () => {
    const snapshot: Snapshot = { timestamp: 1, party_snapshots: { A: { votes_percentage: 2 }, B: { votes_percentage: 20 } } };
    expect(partiesFor(snapshot, config).map((party) => party.code)).toEqual(["B", "A"]);
  });
});
