import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { election, feedUrl, pollIntervalMs, staleAfterMs } from "./config";
import { fetchLatestSnapshot, hasForecast } from "./feed";
import { currentShareWithPartials, formatPercent, formatPp, formatTime, formatVotes, forecastDelta, partiesFor, previousShare, totalWithPartials } from "./format";
import type { Party, Snapshot } from "./types";

function useFeed() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const snapshotRef = useRef<Snapshot | null>(null);
  const [lastSnapshotAt, setLastSnapshotAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const requestInFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    setRefreshing(true);
    try {
      const newest = await fetchLatestSnapshot(feedUrl, controller.signal);
      if (newest) {
        const current = snapshotRef.current;
        if (!current || newest.timestamp >= current.timestamp) {
          if (!current || newest.timestamp > current.timestamp) setLastSnapshotAt(Date.now());
          snapshotRef.current = newest;
          setSnapshot(newest);
        }
        setError(null);
      } else if (!snapshotRef.current) {
        setError("Er zijn nog geen resultaten beschikbaar.");
      } else {
        setError(null);
      }
    } catch (cause) {
      setError(cause instanceof Error && cause.name === "AbortError" ? "De verbinding duurde te lang." : "De live uitslagen konden niet worden opgehaald.");
    } finally {
      window.clearTimeout(timeout);
      requestInFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return { snapshot, lastSnapshotAt, error, refreshing };
}

function SummaryChart({ snapshot, parties }: { snapshot: Snapshot; parties: Party[] }) {
  const max = Math.max(1, ...parties.flatMap((party) => [party.data.votes_percentage ?? 0, previousShare(snapshot, party) ?? 0]));
  return (
    <section className="panel chart-panel" aria-labelledby="chart-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Vergelijking</p>
          <h2 id="chart-title">Prognose per partij</h2>
        </div>
        <div className="legend" aria-label="Legenda">
          <span><i className="legend-swatch previous" />{election.previousLabel} afgeronde gemeentes</span>
          <span><i className="legend-swatch forecast" />{election.currentLabel} prognose</span>
        </div>
      </div>
      <div className="chart" role="img" aria-label={`Staafdiagram met prognose en vorige einduitslag: ${parties.map((party) => `${party.name}, ${election.previousLabel} ${formatPercent(previousShare(snapshot, party))}, ${election.currentLabel} ${formatPercent(party.data.votes_percentage)}`).join("; ")}.`}>
        {parties.map((party) => {
          const oldValue = previousShare(snapshot, party);
          const nowValue = party.data.votes_percentage;
          const old = oldValue ?? 0;
          const now = nowValue ?? 0;
          return <div className="chart-party" key={party.code}>
            <span className="chart-party-name">{party.name}</span>
            <div className="chart-bars">
              <div className="chart-bar-row"><span className="bar-mobile-label">{election.previousLabel}</span><div className="bar-track"><div className="bar previous" style={{ height: `${Math.max(old / max * 100, old ? 3 : 0)}%`, width: `${Math.max(old / max * 100, old ? 2 : 0)}%` }} /></div><span className="bar-value">{formatPercent(oldValue)}</span></div>
              <div className="chart-bar-row"><span className="bar-mobile-label">{election.currentLabel}</span><div className="bar-track"><div className="bar forecast" style={{ height: `${Math.max(now / max * 100, now ? 3 : 0)}%`, width: `${Math.max(now / max * 100, now ? 2 : 0)}%` }} /></div><span className="bar-value">{formatPercent(nowValue)}</span></div>
            </div>
          </div>;
        })}
      </div>
      <p className="chart-caption">Percentages zijn prognoses op basis van de beschikbare uitslagen.</p>
    </section>
  );
}

function TotalsPanel({ snapshot }: { snapshot: Snapshot }) {
  const [expanded, setExpanded] = useState(false);
  const current = snapshot.estimated_total_votes;
  const previous = snapshot.snapshot_total_votes_last_election;
  const currentPartial = totalWithPartials(snapshot, "votes_this_election_with_partials");
  const previousCorrected = totalWithPartials(snapshot, "votes_last_election_corrected");
  const hasPartial = currentPartial !== undefined || previousCorrected !== undefined;
  return <section className="panel totals-panel" aria-labelledby="totals-title">
    <div className="total-heading"><div><p className="eyebrow">Verkiezingstotaal</p><h2 id="totals-title">Totaal stemmen</h2></div></div>
    <div className="total-values">
      <div><span>{election.currentLabel} prognose</span><strong>{formatVotes(current)} stemmen</strong></div>
      <div><span>{election.previousLabel} in afgeronde gemeentes</span><strong>{formatVotes(previous)} stemmen</strong></div>
    </div>
    {hasPartial && <>
      <button className="disclosure total-disclosure" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        <span>{expanded ? "Verberg actuele vergelijking" : "Toon actuele vergelijking"}</span><span className="chevron" aria-hidden="true">{expanded ? "⌃" : "⌄"}</span>
      </button>
      {expanded && <div className="expanded-total">
        {currentPartial !== undefined && <p><span>{election.currentLabel} nu</span><strong>{formatVotes(currentPartial)} stemmen</strong></p>}
        {previousCorrected !== undefined && <p><span>{election.previousLabel} zelfde gemeentes</span><strong>{formatVotes(previousCorrected)} stemmen</strong></p>}
      </div>}
    </>}
  </section>;
}

function PartyRow({ snapshot, party }: { snapshot: Snapshot; party: Party }) {
  const [expanded, setExpanded] = useState(false);
  const current = party.data.votes_this_election_with_partials;
  const oldCorrected = party.data.votes_last_election_corrected;
  const canExpand = current !== undefined || oldCorrected !== undefined;
  const previous = previousShare(snapshot, party);
  const delta = forecastDelta(snapshot, party);
  return <article className="party-row">
    <div className="party-line">
      <h3>{party.name}</h3>
      {delta !== undefined && <span className={`delta ${delta < 0 ? "negative" : ""}`}>prognose {formatPp(delta)}</span>}
    </div>
    <div className="party-comparison">
      <div className="party-result"><span className="result-label">{election.currentLabel} prognose</span><span className="result-values"><strong>{formatVotes(party.data.votes_prediction)} stemmen</strong><span>{formatPercent(party.data.votes_percentage)}</span></span></div>
      <div className="party-result previous-result"><span className="result-label">{election.previousLabel} afgerond</span><span className="result-values"><strong>{formatVotes(party.data.votes_last_election)} stemmen</strong><span>{formatPercent(previous)}</span></span></div>
      {canExpand && <button className="disclosure party-disclosure" type="button" aria-expanded={expanded} aria-label={`${expanded ? "Verberg" : "Toon"} uitslagen in dezelfde gemeentes voor ${party.name}`} onClick={() => setExpanded(!expanded)}><span className="chevron" aria-hidden="true">{expanded ? "⌃" : "⌄"}</span></button>}
    </div>
    {expanded && <div className="expanded-party">
      {current !== undefined && <p><span>{election.currentLabel} nu</span><strong>{formatVotes(current)} stemmen</strong><span>{formatPercent(currentShareWithPartials(snapshot, current))}</span></p>}
      {oldCorrected !== undefined && <p><span>{election.previousLabel} zelfde gemeentes</span><strong>{formatVotes(oldCorrected)} stemmen</strong></p>}
    </div>}
  </article>;
}

export default function App() {
  const { snapshot, lastSnapshotAt, error, refreshing } = useFeed();
  const parties = useMemo(() => snapshot ? partiesFor(snapshot, election) : [], [snapshot]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);
  const stale = Boolean(snapshot && lastSnapshotAt && now - lastSnapshotAt > staleAfterMs);
  const status = snapshot ? (stale || error ? "Livegegevens tijdelijk niet bijgewerkt" : refreshing ? "Livegegevens worden bijgewerkt" : "Livegegevens beschikbaar") : (refreshing ? "Uitslagen worden geladen" : "Uitslagen niet beschikbaar");

  return <main className="page-shell">
    <header className="site-header">
      <a className="brand" href="#top" aria-label="VerkiezingsWinnaar.nl startpagina"><span className="brand-mark" aria-hidden="true">VW</span><span>VerkiezingsWinnaar<span className="brand-domain">.nl</span></span></a>
      <div className="election-meta"><strong>{election.electionName}</strong><span className={`live-status ${stale || error ? "is-stale" : ""}`}><i aria-hidden="true" />{snapshot ? (stale || error ? "Vertraagd" : "Live") : "Wachten op uitslagen"}{snapshot && lastSnapshotAt ? ` · bijgewerkt ${formatTime(snapshot.timestamp)}` : ""}</span></div>
    </header>

    <div className="announcement" aria-live="polite" aria-atomic="true">{status}</div>

    {snapshot && hasForecast(snapshot) ? <>
      {(stale || error) && <div className="notice" role="status"><strong>Livegegevens tijdelijk niet bijgewerkt.</strong> De laatste beschikbare prognose staat hieronder; laatst bijgewerkt om {formatTime(snapshot.timestamp)}.{error && <span className="error-detail"> {error}</span>}</div>}
      <div className="intro"><div><p className="eyebrow">Live verkiezingsprognose</p><h1>{election.electionName}</h1><p className="intro-copy">Volg de voorlopige prognose en vergelijk die met de vorige einduitslag.</p></div><span className="provisional">Voorlopige uitslagen</span></div>
      <SummaryChart snapshot={snapshot} parties={parties} />
      <TotalsPanel snapshot={snapshot} />
      <section className="results-section" aria-labelledby="results-title"><div className="section-heading results-heading"><div><p className="eyebrow">Op volgorde van prognose</p><h2 id="results-title">Partijresultaten</h2></div><span className="party-count">{parties.length} partijen</span></div>
        <div className="party-list">{parties.map((party) => <PartyRow key={party.code} party={party} snapshot={snapshot} />)}</div>
      </section>
      <details className="methodology panel"><summary>Hoe komt deze prognose tot stand?</summary><p>De prognose schat de einduitslag op basis van beschikbare, vergelijkbare uitslagen. Voorspelde stemmen zijn schattingen; ze zijn geen getelde of gecertificeerde uitslagen. De gegevens worden automatisch bijgewerkt.</p><p>Partijpercentages zijn prognoses. De regel “zelfde gemeentes” gebruikt alleen waarden die de gegevensbron daarvoor aanlevert.</p></details>
      <footer>VerkiezingsWinnaar.nl · Uitslagen zijn voorlopig en kunnen wijzigen.</footer>
    </> : <section className="empty-state panel" aria-live="polite">
      {refreshing && !snapshot ? <><span className="loader" aria-hidden="true" /><h1>Uitslagen laden</h1><p>We halen de meest recente verkiezingsgegevens op.</p><div className="skeleton-chart" aria-hidden="true"><i /><i /><i /><i /><i /></div><div className="skeleton-row" aria-hidden="true" /><div className="skeleton-row short" aria-hidden="true" /></> : <><span className="empty-icon" aria-hidden="true">…</span><h1>Er zijn nog geen resultaten beschikbaar</h1><p>Zodra uitslagen binnenkomen, verschijnt hier een prognose.</p><button className="retry-button" onClick={() => window.location.reload()}>Opnieuw proberen</button></>}
      {error && refreshing && <p className="error-detail">{error}</p>}
    </section>}
  </main>;
}
