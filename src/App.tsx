import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { fetchElectionSetup, pollIntervalMs, staleAfterMs } from "./config";
import type { ElectionSetup } from "./config";
import { fetchLatestSnapshot, hasForecast } from "./feed";
import { chartFits, chartPartiesForMetric, chartValueForParty, formatPercent, formatPp, formatTime, formatVotes, formatWholePercent, forecastDelta, partiesFor, previousShare, totalWithPartials } from "./format";
import type { ElectionConfig, Party, Snapshot } from "./types";

const chartPartyMinWidth = 56;
const chartPartyGap = 3;

function useFeed() {
  const [setup, setSetup] = useState<ElectionSetup | null>(null);
  const setupRef = useRef<ElectionSetup | null>(null);
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
      const activeSetup = setupRef.current ?? await fetchElectionSetup(controller.signal);
      setupRef.current = activeSetup;
      setSetup(activeSetup);
      const newest = await fetchLatestSnapshot(activeSetup.feedUrl, controller.signal);
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

  return { setup, snapshot, lastSnapshotAt, error, refreshing };
}

function SummaryChart({ snapshot, parties, election }: { snapshot: Snapshot; parties: Party[]; election: ElectionConfig }) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateLayout = () => {
      const styles = window.getComputedStyle(viewport);
      const groupWidth = Number.parseFloat(styles.getPropertyValue("--chart-party-min-width")) || chartPartyMinWidth;
      const gap = Number.parseFloat(styles.getPropertyValue("--chart-party-gap")) || chartPartyGap;
      setCompact(!chartFits(viewport.clientWidth, parties.length, groupWidth, gap));
    };
    const observer = new ResizeObserver(updateLayout);
    observer.observe(viewport);
    updateLayout();
    return () => observer.disconnect();
  }, [parties.length]);

  const metric = election.resultMetric;
  const chartStyle = {
    "--chart-party-count": parties.length,
    "--chart-required-width": `${parties.length * chartPartyMinWidth + Math.max(0, parties.length - 1) * chartPartyGap}px`,
  } as CSSProperties;
  const valueFor = (party: Party, series: "current" | "previous") => chartValueForParty(snapshot, party, metric, series);
  const displayValue = (value: number | undefined, isMobile: boolean) => {
    if (value === undefined) return "—";
    if (metric === "seats") return formatVotes(value);
    return isMobile ? formatPercent(value) : formatWholePercent(value);
  };
  const styleForBar = (height: number, width: number): CSSProperties => compact
    ? { height: "100%", width: `${width}%` }
    : { height: `${height}%`, "--bar-height": `${height}%` } as CSSProperties;
  const max = Math.max(1, ...parties.flatMap((party) => [valueFor(party, "current") ?? 0, valueFor(party, "previous") ?? 0]));
  return (
    <section className="panel chart-panel" aria-labelledby="chart-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Vergelijking</p>
          <h2 id="chart-title">{metric === "seats" ? "Zetelprognose per partij" : "Prognose per partij"}</h2>
        </div>
        <div className="legend" aria-label="Legenda">
          <span><i className="legend-swatch previous" />{election.previousLabel}</span>
          <span><i className="legend-swatch forecast" />{election.currentLabel} prognose</span>
        </div>
      </div>
      <div className="chart-viewport" ref={viewportRef}>
      <div className={`chart${compact ? " chart--compact" : ""}`} style={chartStyle} role="img" aria-label={`Staafdiagram met prognose en vorige einduitslag: ${parties.map((party) => `${party.name}, ${election.previousLabel} ${displayValue(valueFor(party, "previous"), compact)}${metric === "seats" ? " zetels" : ""}, ${election.currentLabel} ${displayValue(valueFor(party, "current"), compact)}${metric === "seats" ? " zetels" : ""}`).join("; ")}.`}>
        {parties.map((party) => {
          const oldValue = valueFor(party, "previous");
          const nowValue = valueFor(party, "current");
          const old = oldValue ?? 0;
          const now = nowValue ?? 0;
          const oldHeight = Math.max(old / max * 100, old ? 3 : 0);
          const nowHeight = Math.max(now / max * 100, now ? 3 : 0);
          const oldWidth = Math.max(old / max * 100, old ? 2 : 0);
          const nowWidth = Math.max(now / max * 100, now ? 2 : 0);
          return <div className="chart-party" key={party.code}>
            <span className="chart-party-name">{party.name}</span>
            <div className="chart-bars">
              <div className="chart-bar-row"><span className="bar-mobile-label">{election.previousLabel}</span><div className="bar-track"><div className="bar previous" style={styleForBar(oldHeight, oldWidth)}>{!compact && oldValue !== undefined && <span className="bar-label">{displayValue(oldValue, false)}</span>}</div></div><span className="bar-value">{displayValue(oldValue, true)}</span></div>
              <div className="chart-bar-row"><span className="bar-mobile-label">{election.currentLabel}</span><div className="bar-track"><div className="bar forecast" style={styleForBar(nowHeight, nowWidth)}>{!compact && nowValue !== undefined && <span className="bar-label">{displayValue(nowValue, false)}</span>}</div></div><span className="bar-value">{displayValue(nowValue, true)}</span></div>
            </div>
          </div>;
        })}
      </div>
      </div>
      {metric !== "seats" && <p className="chart-caption">Percentages zijn prognoses op basis van de beschikbare uitslagen.</p>}
    </section>
  );
}

function TotalsPanel({ snapshot, setup, election }: { snapshot: Snapshot; setup: ElectionSetup; election: ElectionConfig }) {
  const [expanded, setExpanded] = useState(false);
  const current = snapshot.estimated_total_votes;
  const previous = Object.values(setup.previous.votes).reduce<number>((sum, count) => sum + count, 0);
  const currentPartial = totalWithPartials(snapshot, "votes_this_election_with_partials");
  const previousCorrected = totalWithPartials(snapshot, "votes_last_election_corrected");
  const municipalityCounts = Object.values(snapshot.party_snapshots).map((party) => party.municipalities);
  const municipalityCountValue = municipalityCounts.length > 0
    && municipalityCounts.every((count) => count !== undefined && count === municipalityCounts[0])
    ? municipalityCounts[0]
    : undefined;
  const municipalityCount = municipalityCountValue === undefined ? undefined : formatVotes(municipalityCountValue);
  const forecastChange = current !== undefined && previous > 0
    ? ((current - previous) / previous) * 100
    : undefined;
  const hasTotalDetails = current !== undefined || currentPartial !== undefined || previousCorrected !== undefined;
  return <section className="panel totals-panel" aria-labelledby="totals-title">
    <div className="total-heading"><div><p className="eyebrow">Verkiezingstotaal</p><h2 id="totals-title">Totaal stemmen</h2></div></div>
    <div className="total-values">
      <div><span>{election.currentLabel} prognose</span><strong>{formatVotes(current)} stemmen</strong></div>
      <div><span>{election.previousLabel}</span><strong>{formatVotes(previous)} stemmen</strong></div>
    </div>
    {hasTotalDetails && <>
      <div className="total-disclosure-row"><button className="disclosure party-disclosure total-disclosure" type="button" aria-expanded={expanded} aria-label={`${expanded ? "Verberg" : "Toon"} vergelijking van het totaal aantal stemmen${municipalityCount ? ` in ${municipalityCount} gemeenten` : ""}`} aria-controls="expanded-total" onClick={() => setExpanded(!expanded)}>
        <span className="chevron" aria-hidden="true">{expanded ? "⌃" : "⌄"}</span>
      </button></div>
      {expanded && <div className="expanded-total expanded-total-copy" id="expanded-total">
        {municipalityCount !== undefined && currentPartial !== undefined && <p>Er zijn tot nu toe <strong>{formatVotes(currentPartial)} stemmen</strong> geteld in {municipalityCount} gemeenten.</p>}
        {municipalityCount !== undefined && previousCorrected !== undefined && <p>Bij de vorige verkiezingen waren er <strong>{formatVotes(previousCorrected)} stemmen</strong> geteld in dezelfde {municipalityCount} gemeenten.</p>}
        {current !== undefined && <p>{forecastChange === undefined
          ? <>We verwachten dat het totaal aantal stemmen uitkomt op <strong>{formatVotes(current)} stemmen</strong>.</>
          : forecastChange === 0
            ? <>We verwachten dat het totaal aantal stemmen gelijk blijft op <strong>{formatVotes(current)} stemmen</strong>.</>
            : <>We verwachten dat het totaal aantal stemmen met <strong>{formatPercent(Math.abs(forecastChange))}</strong> {forecastChange > 0 ? "stijgt" : "daalt"} naar <strong>{formatVotes(current)} stemmen</strong>.</>}</p>}
      </div>}
    </>}
  </section>;
}

function PartyRow({ snapshot, party, election }: { snapshot: Snapshot; party: Party; election: ElectionConfig }) {
  const [expanded, setExpanded] = useState(false);
  const current = party.data.votes_this_election_with_partials;
  const oldCorrected = party.data.votes_last_election_corrected;
  const change = current !== undefined && oldCorrected !== undefined && oldCorrected > 0
    ? ((current - oldCorrected) / oldCorrected) * 100
    : undefined;
  const canExpand = change !== undefined;
  const changePercent = change === undefined ? undefined : formatPercent(Math.abs(change));
  const municipalityCount = party.data.municipalities === undefined
    ? "[N]"
    : formatVotes(party.data.municipalities);
  const previous = previousShare(snapshot, party);
  const delta = forecastDelta(snapshot, party);
  return <article className="party-row">
    <div className="party-line">
      <h3>{party.name}</h3>
      {delta !== undefined && <span className={`delta ${delta < 0 ? "negative" : ""}`}>Prognose {formatPp(delta)}</span>}
    </div>
    <div className="party-comparison">
      <div className="party-result"><span className="result-label">{election.currentLabel} prognose</span><span className="result-values"><strong className="vote-count">{formatVotes(party.data.votes_prediction)}</strong><span className="vote-unit">stemmen</span><span className="vote-share">{formatPercent(party.data.votes_percentage)}</span></span></div>
      <div className="party-result previous-result"><span className="result-label">{election.previousLabel}</span><span className="result-values"><strong className="vote-count">{formatVotes(party.previousVotes ?? party.data.votes_last_election)}</strong><span className="vote-unit">stemmen</span><span className="vote-share">{formatPercent(previous)}</span></span></div>
      {canExpand && <button className="disclosure party-disclosure" type="button" aria-expanded={expanded} aria-label={`${expanded ? "Verberg" : "Toon"} uitslagen in dezelfde ${municipalityCount} gemeenten voor ${party.name}`} onClick={() => setExpanded(!expanded)}><span className="chevron" aria-hidden="true">{expanded ? "⌃" : "⌄"}</span></button>}
    </div>
    {expanded && current !== undefined && oldCorrected !== undefined && change !== undefined && changePercent !== undefined && <div className="expanded-party expanded-party-copy">
      <p>Voor <strong>{party.name}</strong> zijn tot nu toe <strong>{formatVotes(current)} stemmen</strong> geteld in {municipalityCount} gemeenten.</p>
      <p>Bij de vorige verkiezingen haalde deze partij <strong>{formatVotes(oldCorrected)} stemmen</strong> in dezelfde {municipalityCount} gemeenten.</p>
      <p>Voor onze prognose nemen we aan dat deze trend zich voortzet. {change === 0 ? <>We verwachten dus dat deze partij evenveel stemmen zal halen als bij de vorige verkiezingen.</> : <>We verwachten dus dat deze partij <strong>{changePercent} {change > 0 ? "meer" : "minder"} stemmen</strong> zal halen dan bij de vorige verkiezingen.</>}</p>
    </div>}
  </article>;
}

export default function App() {
  const { setup, snapshot, lastSnapshotAt, error, refreshing } = useFeed();
  const election = setup?.election;
  const parties = useMemo(() => snapshot && election && setup ? partiesFor(snapshot, election, setup.previous) : [], [snapshot, election, setup]);
  const chartParties = useMemo(() => election ? chartPartiesForMetric(parties, election.resultMetric) : parties, [parties, election]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);
  const stale = Boolean(snapshot && lastSnapshotAt && now - lastSnapshotAt > staleAfterMs);
  const status = snapshot ? (stale || error ? "Livegegevens tijdelijk niet bijgewerkt" : refreshing ? "Livegegevens worden bijgewerkt" : "Livegegevens beschikbaar") : (refreshing ? "Uitslagen worden geladen" : "Uitslagen niet beschikbaar");

  return <main className="page-shell">
    {!setup ? <section className="empty-state panel" aria-live="polite">{refreshing ? <span className="loader" aria-hidden="true" /> : <span className="empty-icon" aria-hidden="true">…</span>}<h1>{refreshing ? "Verkiezing laden" : "Verkiezingsgegevens niet beschikbaar"}</h1><p>{refreshing ? "We halen de actieve verkiezingsgegevens op." : "De actieve verkiezing kan niet worden geladen. Probeer het opnieuw."}</p>{error && <p className="error-detail">{error}</p>}{!refreshing && <button className="retry-button" onClick={() => window.location.reload()}>Opnieuw proberen</button>}</section> : <>
    <header className="site-header">
      <a className="brand" href="#top" aria-label="VerkiezingsWinnaar.nl startpagina"><span className="brand-mark" aria-hidden="true">VW</span><span>VerkiezingsWinnaar<span className="brand-domain">.nl</span></span></a>
      <div className="election-meta"><strong>{election!.electionName}</strong><span className="live-status">{/* Intentional: this persistent badge identifies the live dashboard, independent of feed freshness. */}<span className="live-indicator"><i aria-hidden="true" />Live</span>{snapshot && lastSnapshotAt ? `Bijgewerkt ${formatTime(snapshot.timestamp)}` : ""}</span></div>
    </header>

    <div className="announcement" aria-live="polite" aria-atomic="true">{status}</div>

    {snapshot && hasForecast(snapshot) ? <>
      <div className="intro"><div><p className="eyebrow">Live verkiezingsprognose</p><h1>{election!.electionName}</h1><p className="intro-copy">Volg de voorlopige prognose en vergelijk die met de vorige einduitslag.</p></div><span className="provisional">Voorlopige uitslagen</span></div>
      <SummaryChart snapshot={snapshot} parties={chartParties} election={election!} />
      <TotalsPanel snapshot={snapshot} setup={setup!} election={election!} />
      <section className="results-section" aria-labelledby="results-title"><div className="section-heading results-heading"><div><h2 id="results-title">Partijresultaten</h2></div></div>
        <div className="party-list">{parties.map((party) => <PartyRow key={party.code} party={party} snapshot={snapshot} election={election!} />)}</div>
      </section>
      <details className="methodology panel"><summary>Hoe komt deze prognose tot stand?</summary><p>De prognose schat de einduitslag op basis van beschikbare, vergelijkbare uitslagen. Voorspelde stemmen zijn schattingen; ze zijn geen getelde of gecertificeerde uitslagen. De gegevens worden automatisch bijgewerkt.</p><p>Partijpercentages zijn prognoses. De regel “zelfde gemeentes” gebruikt alleen waarden die de gegevensbron daarvoor aanlevert.</p></details>
      <footer>VerkiezingsWinnaar.nl · Uitslagen zijn voorlopig en kunnen wijzigen.</footer>
    </> : <section className="empty-state panel" aria-live="polite">
      {refreshing && !snapshot ? <><span className="loader" aria-hidden="true" /><h1>Uitslagen laden</h1><p>We halen de meest recente verkiezingsgegevens op.</p><div className="skeleton-chart" aria-hidden="true"><i /><i /><i /><i /><i /></div><div className="skeleton-row" aria-hidden="true" /><div className="skeleton-row short" aria-hidden="true" /></> : <><span className="empty-icon" aria-hidden="true">…</span><h1>Er zijn nog geen resultaten beschikbaar</h1><p>Zodra uitslagen binnenkomen, verschijnt hier een prognose.</p><button className="retry-button" onClick={() => window.location.reload()}>Opnieuw proberen</button></>}
      {error && refreshing && <p className="error-detail">{error}</p>}
    </section>}
    </>}
  </main>;
}
