import type { ElectionConfig } from "./types";

export const feedUrl = import.meta.env.VITE_DATA_URL || "/test-feed/replay-output/data-test.jsonl.gz";
export const pollIntervalMs = Number(import.meta.env.VITE_POLL_INTERVAL_MS || 3000);
export const staleAfterMs = Number(import.meta.env.VITE_STALE_AFTER_MS || 45000);

export const election: ElectionConfig = {
  electionName: import.meta.env.VITE_ELECTION_NAME || "Gemeenteraadsverkiezingen 2026",
  electionType: (import.meta.env.VITE_ELECTION_TYPE as ElectionConfig["electionType"]) || "municipal",
  currentLabel: import.meta.env.VITE_CURRENT_LABEL || "GR2026",
  previousLabel: import.meta.env.VITE_PREVIOUS_LABEL || "GR2022",
  partyNames: {
    GLPVDA: "GL-PvdA",
    PVDA: "PvdA",
    GROENLINKS: "GroenLinks",
    VVD: "VVD",
    D66: "D66",
    CDA: "CDA",
    PVV: "PVV",
    SP: "SP",
    CU: "ChristenUnie",
    SGP: "SGP",
    FVD: "Forum voor Democratie",
    JA21: "JA21",
    BBB: "BBB",
    DENK: "DENK",
    VOLT: "Volt",
    PVDD: "Partij voor de Dieren",
  },
};
