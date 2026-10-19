import type { ActiveElections, ElectionConfig, ElectionResults } from "./types";
import { resultMetricForElection } from "./format";

export const electionDataBaseUrl = import.meta.env.VITE_ELECTION_DATA_BASE_URL || "/election-assets/";
export const pollIntervalMs = Number(import.meta.env.VITE_POLL_INTERVAL_MS || 3000);
export const staleAfterMs = Number(import.meta.env.VITE_STALE_AFTER_MS || 45000);

export type ElectionSetup = { active: ActiveElections; election: ElectionConfig; current: ElectionResults; previous: ElectionResults; feedUrl: string };

const validElectionId = (value: unknown): value is string => typeof value === "string" && /^[A-Z][A-Z0-9]*$/.test(value);
const validResults = (value: unknown, expectedId: string): value is ElectionResults => {
  if (!value || typeof value !== "object") return false;
  const results = value as Partial<ElectionResults>;
  return results.id === expectedId && typeof results.name === "string" && typeof results.label === "string"
    && ["municipal", "provincial", "national", "other"].includes(results.type || "")
    && Boolean(results.votes) && typeof results.votes === "object"
    && Boolean(results.seats) && typeof results.seats === "object";
};

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, cache: "no-cache" });
  if (!response.ok) throw new Error(`Election data request failed with status ${response.status}`);
  return response.json() as Promise<unknown>;
}

export async function fetchElectionSetup(signal: AbortSignal): Promise<ElectionSetup> {
  const baseUrl = electionDataBaseUrl.endsWith("/") ? electionDataBaseUrl : `${electionDataBaseUrl}/`;
  const activeValue = await fetchJson(new URL("active-elections.json", new URL(baseUrl, window.location.href)).toString(), signal);
  if (!activeValue || typeof activeValue !== "object") throw new Error("Active election settings are invalid");
  const active = activeValue as Partial<ActiveElections>;
  if (!validElectionId(active.current) || !validElectionId(active.previous) || active.current === active.previous) throw new Error("Active election IDs are invalid");
  const [currentValue, previousValue] = await Promise.all([
    fetchJson(new URL(`results-${active.current}.json`, new URL(baseUrl, window.location.href)).toString(), signal),
    fetchJson(new URL(`results-${active.previous}.json`, new URL(baseUrl, window.location.href)).toString(), signal),
  ]);
  if (!validResults(currentValue, active.current) || !validResults(previousValue, active.previous)) throw new Error("Election results do not match the active election IDs");
  const current = currentValue;
  const previous = previousValue;
  const election: ElectionConfig = {
    electionName: current.name,
    electionType: current.type,
    resultMetric: resultMetricForElection(current.type),
    currentLabel: current.label,
    previousLabel: previous.label,
    partyNames: {
    GLPVDA: "GL-PvdA",
    PVDA: "PvdA",
    GROENLINKS: "GroenLinks",
    VVD: "VVD",
    D66: "D66",
    CDA: "CDA",
    PVV: "PVV",
    SP: "SP",
    CU: "CU",
    SGP: "SGP",
    FVD: "FvD",
    JA21: "JA21",
    BBB: "BBB",
    DENK: "DENK",
    VOLT: "Volt",
    PVDD: "PvdD",
    },
  };
  return { active: { current: current.id, previous: previous.id }, current, previous, election,
    feedUrl: new URL(`data-${current.id}.jsonl.gz`, new URL(baseUrl, window.location.href)).toString() };
}
