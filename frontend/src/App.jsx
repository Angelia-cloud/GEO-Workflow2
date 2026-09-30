import React, { useEffect, useRef, useState } from "react";
import { api, queryString } from "./api.js";
import { savedValue, saveValue, shortName } from "./format.js";
import { Loading, Notice, PageError } from "./components.jsx";
import { CompetitivePage, EnginesPage, IntelligencePage, IntentsPage, OverviewPage, ReportsPage, SettingsPage } from "./pages/ReportPages.jsx";
import { DetailDrawer, EvidencePage, PromptGenerationPage, RecommendationsPage, UploadsPage } from "./pages/WorkflowPages.jsx";

const NAV = [
  ["overview", "Overview", "overview"], ["intelligence", "Monthly Intelligence", "intelligence"], ["engines", "AI Engines", "engines"],
  ["competitive", "Competitors", "competitive"], ["intents", "Intents", "intents"],
  ["evidence", "Alerts & Diagnosis", "evidence"], ["recommendations", "Recommendations", "recommendations"], ["reports", "Client Report", "reports"],
  ["uploads", "Data & Uploads", "uploads"], ["generate", "Prompt Generation", "generate"], ["settings", "Settings", "settings"],
];

const PAGE_COPY = {
  overview: ["GEO Performance Overview", (name) => `AI visibility, competitive position and intelligence for ${name}.`],
  intelligence: ["Monthly intelligence", () => "What changed this period, why it matters, and what we’ll monitor next."],
  engines: ["AI engine performance", (name) => `How ChatGPT, Gemini, Claude, Perplexity, Copilot and AI Overview see ${name}.`],
  competitive: ["Competitive benchmark", (name) => `${name} against the tracked competitor set on neutral prompts.`],
  intents: ["Intent analysis", (name) => `Where ${name} wins by guest intent, and where competitors are stronger.`],
  evidence: ["Alerts & diagnosis", () => "Review auto alerts and insights, open any AI answer and diagnose the misses."],
  recommendations: ["Recommendations", () => "Review, approve or reject what the diagnosis agent proposes."],
  reports: ["Client report", () => "The monthly client report for the selected period. Export PDF prints just the report."],
  uploads: ["Data & uploads", () => "Validate a Rankscale export, review the import and load it into Supabase."],
  generate: ["Prompt generation", () => "Generate candidate prompts, review them and export approved prompts for Rankscale."],
  settings: ["Settings", () => "Review tracked names, neutral prompts, benchmarks and agent model configuration."],
};

const REPORT_TABS = new Set(["overview", "intelligence", "engines", "competitive", "intents", "evidence", "reports"]);

function NavIcon({ icon }) {
  const common = { viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round", strokeLinejoin: "round" };
  if (icon === "overview") return <svg {...common}><path d="m3.5 9 6.5-5.5L16.5 9v7.5h-4v-4h-5v4h-4z" /></svg>;
  if (icon === "property") return <svg {...common}><path d="m10 2.5 7.5 7.5-7.5 7.5L2.5 10 10 2.5Z" /><path d="m8.5 10 2-2" /></svg>;
  if (icon === "intelligence") return <svg {...common}><rect x="3.5" y="3.5" width="13" height="13" rx="2" /><path d="M7 13V9m3 4V7m3 6v-2" /></svg>;
  if (icon === "engines") return <svg {...common}><path d="M4 16V9m4 7V5m4 11v-4m4 4V7" /><path d="M3 16.5h14" /></svg>;
  if (icon === "competitive") return <svg {...common}><circle cx="10" cy="10" r="6.5" /><circle cx="10" cy="10" r="2" /><path d="M10 3.5v2M16.5 10h-2" /></svg>;
  if (icon === "intents") return <svg {...common}><circle cx="10" cy="10" r="6.5" /><circle cx="10" cy="10" r="3" /><circle cx="10" cy="10" r="1" /></svg>;
  if (icon === "evidence") return <svg {...common}><circle cx="8.5" cy="8.5" r="4.5" /><path d="m12 12 4.5 4.5M7 8.5h3" /></svg>;
  if (icon === "recommendations") return <svg {...common}><path d="M5 5h10M5 10h10M5 15h10" /><circle cx="3" cy="5" r=".7" fill="currentColor" stroke="none" /><circle cx="3" cy="10" r=".7" fill="currentColor" stroke="none" /><circle cx="3" cy="15" r=".7" fill="currentColor" stroke="none" /></svg>;
  if (icon === "reports") return <svg {...common}><path d="M6 2.5h6l3 3V17.5H6z" /><path d="M12 2.5v3h3M8.5 9h4M8.5 12h4M8.5 15h2.5" /></svg>;
  if (icon === "uploads") return <svg {...common}><path d="M10 13V3.5m0 0L6.5 7M10 3.5 13.5 7" /><path d="M4 11.5v4h12v-4" /></svg>;
  if (icon === "generate") return <svg {...common}><path d="m10 2.5 1.5 5 5 1.5-5 1.5-1.5 5-1.5-5-5-1.5 5-1.5z" /><path d="m15.5 3.5.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z" /></svg>;
  if (icon === "settings") return <svg {...common}><circle cx="10" cy="10" r="2.5" /><path d="M10 3.5v2M10 14.5v2M3.5 10h2M14.5 10h2M5.4 5.4l1.4 1.4M13.2 13.2l1.4 1.4M14.6 5.4l-1.4 1.4M6.8 13.2l-1.4 1.4" /></svg>;
  return icon;
}

export default function App() {
  const [properties, setProperties] = useState([]);
  const [propertyId, setPropertyId] = useState("");
  const [propertyError, setPropertyError] = useState(null);
  const [tab, setTab] = useState(() => {
    const saved = savedValue("geo.tab", "overview");
    return PAGE_COPY[saved] ? saved : "overview";
  });
  const [report, setReport] = useState(null);
  const [reportError, setReportError] = useState(null);
  const reportCache = useRef(new Map());
  const [period, setPeriod] = useState({ preset: "last30", from: "", to: "" });
  const [names, setNames] = useState(() => savedValue("geo.names", "rankscale"));
  const [periodOpen, setPeriodOpen] = useState(false);
  const periodPickerRef = useRef(null);
  const [detail, setDetail] = useState(null);
  const [reviewer, setReviewer] = useState(() => savedValue("geo.reviewer"));
  const [counts, setCounts] = useState({});

  function invalidateReportCache() {
    reportCache.current.clear();
    setReport(null);
    setReportError(null);
  }

  function refreshCounts() {
    if (!propertyId) return;
    Promise.all([api(`/api/alerts/${propertyId}`).catch(() => []), api(`/api/recommendations?${queryString({ property_id: propertyId, status: "proposed", limit: 500 })}`).catch(() => [])])
      .then(([alerts, recs]) => setCounts({ evidence: alerts.filter((a) => a.status === "draft").length, recommendations: recs.length }));
  }
  useEffect(() => { refreshCounts(); }, [propertyId, tab]);

  useEffect(() => {
    let active = true;
    api("/api/properties").then((rows) => {
      if (!active) return;
      setProperties(rows);
      setPropertyId(rows[0]?.id || "");
    }).catch((error) => { if (active) setPropertyError(error); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!propertyId || !REPORT_TABS.has(tab)) return undefined;
    const query = queryString({ names, date_from: period.from, date_to: period.to });
    const cacheKey = `${propertyId}?${query}`;
    const cached = reportCache.current.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() && Object.hasOwn(cached, "value")) {
      setReport(cached.value);
      setReportError(null);
      return undefined;
    }
    let active = true;
    setReport(null);
    setReportError(null);
    const request = cached?.promise || api(`/api/report/${propertyId}?${query}`).then((data) => data?.empty ? null : data);
    reportCache.current.set(cacheKey, { promise: request });
    request.then((data) => {
      reportCache.current.set(cacheKey, { value: data, expiresAt: Date.now() + 60_000 });
      while (reportCache.current.size > 6) reportCache.current.delete(reportCache.current.keys().next().value);
      if (active) { setReport(data); setReportError(null); }
    }).catch((error) => {
      if (reportCache.current.get(cacheKey)?.promise === request) reportCache.current.delete(cacheKey);
      if (active) setReportError(error);
    });
    return () => { active = false; };
  }, [propertyId, tab, period, names]);

  useEffect(() => {
    if (!periodOpen) return undefined;
    function dismissPeriodMenu(event) {
      if (event.type === "keydown" && event.key === "Escape") {
        setPeriodOpen(false);
      } else if (event.type === "pointerdown" && !periodPickerRef.current?.contains(event.target)) {
        setPeriodOpen(false);
      }
    }
    document.addEventListener("pointerdown", dismissPeriodMenu);
    document.addEventListener("keydown", dismissPeriodMenu);
    return () => {
      document.removeEventListener("pointerdown", dismissPeriodMenu);
      document.removeEventListener("keydown", dismissPeriodMenu);
    };
  }, [periodOpen]);

  function navigate(nextTab) {
    setTab(nextTab);
    setPeriodOpen(false);
    saveValue("geo.tab", nextTab);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function applyPreset(preset) {
    if (preset === "last30") setPeriod({ preset, from: "", to: "" });
    else if (preset === "all" && report) setPeriod({ preset, from: report.period.data_from, to: report.period.data_to });
    else if (preset.startsWith("m:")) {
      const [year, month] = preset.slice(2).split("-").map(Number);
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      setPeriod({ preset, from: `${preset.slice(2)}-01`, to: `${preset.slice(2)}-${String(lastDay).padStart(2, "0")}` });
    }
    setPeriodOpen(false);
  }

  const activeProperty = properties.find((item) => item.id === propertyId);
  const [title, subtitle] = PAGE_COPY[tab] || PAGE_COPY.overview;
  const periodLabel = report ? `${new Date(report.period.from).toLocaleDateString("en-AU", { day: "numeric", month: "short" })} – ${new Date(report.period.to).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}` : "Select period";
  const months = [];
  if (report?.period?.data_from && report?.period?.data_to) {
    const cursor = new Date(report.period.data_from); cursor.setDate(1);
    const end = new Date(report.period.data_to);
    while (cursor <= end) { months.push(new Date(cursor)); cursor.setMonth(cursor.getMonth() + 1); }
  }

  let content;
  switch (tab) {
    case "overview": content = <OverviewPage report={report} onOpenAlerts={() => navigate("evidence")} />; break;
    case "intelligence": content = <IntelligencePage report={report} propertyId={propertyId} />; break;
    case "engines": content = <EnginesPage report={report} />; break;
    case "competitive": content = <CompetitivePage report={report} />; break;
    case "intents": content = <IntentsPage report={report} />; break;
    case "evidence": content = propertyId ? <EvidencePage propertyId={propertyId} report={report} openDetail={setDetail} /> : <Loading />; break;
    case "recommendations": content = propertyId ? <RecommendationsPage propertyId={propertyId} onChanged={refreshCounts} openMeasurement={(id) => setDetail({ type: "measurement", value: id })} /> : <Loading />; break;
    case "reports": content = <ReportsPage report={report} propertyId={propertyId} openMeasurement={(id) => setDetail({ type: "measurement", value: id })} />; break;
    case "uploads": content = <UploadsPage properties={properties} propertyId={propertyId} onPropertyChange={setPropertyId} onSaved={invalidateReportCache} />; break;
    case "generate": content = propertyId ? <PromptGenerationPage propertyId={propertyId} reviewer={savedValue("geo.reviewer")} /> : <Loading />; break;
    case "settings": content = propertyId ? <SettingsPage propertyId={propertyId} names={names} onNamesChange={(value) => { setNames(value); saveValue("geo.names", value); }} /> : <Loading />; break;
    default: content = <OverviewPage report={report} />;
  }

  return <>
    <div className="topline" aria-hidden="true" />
    <div className="shell">
      <aside className="sidebar">
        <div className="brandline"><span className="wordmark">komosion<i /></span><span className="product">GEO Intelligence</span></div>
        <label className="prop-pick"><span className="sr-only">Property</span><select value={propertyId} onChange={(event) => setPropertyId(event.target.value)} disabled={!properties.length}>
          {properties.length ? properties.map((property) => <option value={property.id} key={property.id}>{property.name}</option>) : <option value="">No property available</option>}
        </select></label>
        <nav className="side-nav" aria-label="Sections">
          {NAV.map(([id, label, icon], index) => <React.Fragment key={id}>
            {index === 0 && <div className="nav-group">Report</div>}
            {index === 5 && <div className="nav-group">Monthly workflow</div>}
            {index === 8 && <div className="nav-group">Data & setup</div>}
            <button type="button" aria-current={tab === id ? "page" : undefined} aria-selected={tab === id} onClick={() => navigate(id)}><span className="nav-icon" aria-hidden="true"><NavIcon icon={icon} /></span><span className="nav-label">{label}</span>{counts[id] ? <span className="nav-count" aria-label={`${counts[id]} to review`}>{counts[id]}</span> : null}</button>
          </React.Fragment>)}
        </nav>
        <label className="reviewer-box">Reviewer (your name on every decision)
          <input value={reviewer} placeholder="e.g. Angelia" onChange={(event) => { setReviewer(event.target.value); saveValue("geo.reviewer", event.target.value.trim()); }} />
        </label>
      </aside>
      <div className="main-col">
        <header className="pagehead">
          <div className="ph-text"><div className="ph-eyebrow">Monthly performance report{report?.period?.from && report?.period?.to ? ` · ${new Date(report.period.from).toLocaleDateString("en-AU", { day: "numeric", month: "short" })} – ${new Date(report.period.to).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}` : ""}</div><h1>{title}</h1><p>{subtitle(shortName(activeProperty?.name))}</p></div>
          <div className="ph-actions">
            {REPORT_TABS.has(tab) && <div className="period-pick" ref={periodPickerRef}>
              <button className="ghost-btn" type="button" aria-haspopup="true" aria-expanded={periodOpen} onClick={() => setPeriodOpen(!periodOpen)}><span aria-hidden="true">▦</span>{periodLabel}<span aria-hidden="true">▾</span></button>
              {periodOpen && <div className="period-menu">
                <div className="grp">Reporting period</div>
                {months.map((month) => { const preset = `m:${month.toISOString().slice(0, 7)}`; return <button className="opt" key={preset} type="button" onClick={() => applyPreset(preset)}>{month.toLocaleDateString("en-AU", { month: "long", year: "numeric" })}</button>; })}
                <div className="custom"><label>From<input type="date" value={period.from} onChange={(event) => setPeriod({ ...period, preset: "custom", from: event.target.value })} /></label><label>To<input type="date" value={period.to} onChange={(event) => setPeriod({ ...period, preset: "custom", to: event.target.value })} /></label></div>
                <button className="opt" type="button" onClick={() => { setPeriodOpen(false); }}>Apply custom range</button>
              </div>}
            </div>}
            {tab === "reports" && <button className="ghost-btn" type="button" onClick={() => window.print()}>Export PDF</button>}
            <button className="primary-btn" type="button" onClick={() => navigate("uploads")}>Upload new data</button>
          </div>
        </header>
        <main>
          {propertyError && <PageError error={propertyError} />}
          {reportError && REPORT_TABS.has(tab) && <PageError error={reportError} />}
          {!properties.length && !propertyError && tab !== "uploads" && <Notice tone="bad">No property is configured yet. Load a Rankscale export from Data &amp; Uploads or check the Supabase setup.</Notice>}
          {content}
        </main>
      </div>
    </div>
    {detail && <DetailDrawer item={detail} onClose={() => setDetail(null)} />}
  </>;
}