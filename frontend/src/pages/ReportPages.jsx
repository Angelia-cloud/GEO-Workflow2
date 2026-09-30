import React, { useEffect, useState } from "react";
import { api, jsonOptions } from "../api.js";
import { date, number, savedValue, shortName } from "../format.js";
import { Badge, Bars, Card, DataTable, Delta, Heatmap, Loading, MetricGrid, Notice, PageError, Segmented } from "../components.jsx";
import { LearningMemoryCard } from "./WorkflowPages.jsx";

const metricNames = { visibility: "Visibility Score", detection: "Detection Rate", position: "Average Position", top3: "Top 3", sentiment: "Sentiment Score" };
const ENGINE_ORDER = ["ChatGPT", "Gemini", "Claude", "Google AI Overview", "Perplexity", "Bing Copilot"];

function fmtValue(key, value) {
  if (value == null) return "–";
  if (key === "position") return `#${number(value, 2)}`;
  return `${number(value, key === "sentiment" ? 1 : 2)}${key === "detection" || key === "top3" ? "%" : ""}`;
}

function metrics(report, selected = ["visibility", "detection", "position", "sentiment"]) {
  return selected.map((key) => {
    const entry = report.overall.find((item) => item.metric === key) || {};
    const target = entry.target;
    const progress = target == null || entry.current == null ? null
      : key === "position" ? Math.min(100, target / entry.current * 100) : Math.min(100, entry.current / target * 100);
    return {
      label: metricNames[key], value: fmtValue(key, entry.current),
      delta: entry.vs_baseline || null, note: entry.vs_baseline ? `vs baseline ${fmtValue(key, entry.vs_baseline.reference)}` : "No baseline yet",
      target: target == null ? null : fmtValue(key, target), progress,
    };
  });
}

function engineRows(report) {
  return report.engines.map((engine) => ({ cells: [engine.name, number(engine.visibility, 2), `${number(engine.detection, 1)}%`, engine.position == null ? "–" : `#${number(engine.position, 2)}`, `${number(engine.top3, 1)}%`, <Delta mv={engine.vs_baseline} />] }));
}

function engineVisibilityRows(report) {
  return report.engines.map((engine) => ({ cells: [engine.name, number(engine.visibility, 2), <Delta mv={engine.vs_baseline} />] }));
}

function intentVisibilityRows(report) {
  return (report.intents || []).map((intent) => ({ cells: [intent.name, number(intent.visibility, 2), <Delta mv={intent.vs_baseline} />] }));
}

const trendMetrics = ["visibility", "detection", "position", "top3", "sentiment"];

function TrendChart({ report, metric = "visibility", compact = false }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const points = report.trend || [];
  if (!points.length) return <div className="empty">No trend data</div>;
  const width = 700, height = 140, left = 38, right = 16, top = 8, bottom = 22;
  const values = points.map((point) => Number(point[metric] ?? 0));
  const baseline = report.overall?.find((item) => item.metric === metric)?.vs_baseline?.reference;
  const scaleValues = baseline == null ? values : [...values, baseline];
  const min = Math.max(0, Math.floor((Math.min(...scaleValues) - 5) / 10) * 10);
  const max = Math.max(min + 10, Math.min(100, Math.ceil((Math.max(...scaleValues) + 5) / 10) * 10));
  const x = (index) => left + (points.length < 2 ? (width - left - right) / 2 : index * (width - left - right) / (points.length - 1));
  const y = (value) => top + (1 - (value - min) / (max - min)) * (height - top - bottom);
  const path = points.map((point, index) => `${index ? "L" : "M"}${x(index)},${y(Number(point[metric] ?? 0))}`).join(" ");
  const areaPath = `${path} L${x(points.length - 1)},${height - bottom} L${x(0)},${height - bottom} Z`;
  const formatValue = (value) => metric === "position" ? `#${number(value, 2)}` : `${number(value, metric === "sentiment" ? 1 : 2)}${metric === "detection" || metric === "top3" ? "%" : ""}`;
  const hoveredPoint = hoveredIndex == null ? null : points[hoveredIndex];
  const tooltipX = hoveredIndex == null ? 0 : Math.min(Math.max(x(hoveredIndex) - 76, left), width - right - 152);
  const tooltipY = hoveredIndex == null ? 0 : Math.max(8, y(Number(hoveredPoint[metric] ?? 0)) - 48);
  function updateHoveredPoint(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const chartX = left + ((event.clientX - bounds.left) / bounds.width) * (width - left - right);
    const nearest = points.reduce((best, point, index) => Math.abs(x(index) - chartX) < Math.abs(x(best) - chartX) ? index : best, 0);
    setHoveredIndex(nearest);
  }
  return <div className={`ui-chart ${compact ? "intelligence-trend" : ""}`.trim()}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${metricNames[metric]} over time`}>
    {[min, Math.round((min + max) / 2), max].map((tick) => <g key={tick}><line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} stroke="var(--ui-line)" /><text x={left - 6} y={y(tick) + 4} textAnchor="end">{tick}</text></g>)}
    {baseline != null && <><line x1={left} x2={width - right} y1={y(baseline)} y2={y(baseline)} stroke="var(--ui-red, #e0322f)" strokeWidth="2" strokeDasharray="10 8" /><text className="chart-baseline-label" x={width - right - 4} y={y(baseline) + 17} textAnchor="end">Pre-schema baseline {number(baseline, 1)}</text></>}
    <path d={areaPath} fill="var(--ui-blue-soft)" fillOpacity=".7" stroke="none" />
    <path d={path} fill="none" stroke="var(--ui-blue)" strokeWidth="3" strokeLinejoin="round" />
    <rect className="trend-interaction-layer" x={left} y={top} width={width - left - right} height={height - top - bottom} onMouseMove={updateHoveredPoint} onMouseLeave={() => setHoveredIndex(null)} aria-hidden="true" />
    {points.map((point, index) => <g className="trend-point" key={`${point.day}-${index}`} tabIndex="0" onMouseEnter={() => setHoveredIndex(index)} onMouseLeave={() => setHoveredIndex(null)} onFocus={() => setHoveredIndex(index)} onBlur={() => setHoveredIndex(null)}>
      <title>{`${date(point.day)}: ${metricNames[metric]} ${formatValue(Number(point[metric] ?? 0))}`}</title>
      <circle className="trend-hit-area" cx={x(index)} cy={y(Number(point[metric] ?? 0))} r="8" fill="transparent" stroke="none" />
      {hoveredIndex === index && <circle className="trend-active-point" cx={x(index)} cy={y(Number(point[metric] ?? 0))} r="4.5" fill="var(--ui-blue)" />}
      <text x={x(index)} y={height - 7} textAnchor="middle">{date(point.day)}</text>
    </g>)}
    {hoveredPoint && <g className="trend-tooltip" pointerEvents="none"><line className="trend-crosshair" x1={x(hoveredIndex)} x2={x(hoveredIndex)} y1={top} y2={height - bottom} /><rect x={tooltipX} y={tooltipY} width="152" height="56" rx="4" /><text className="tooltip-value" x={tooltipX + 8} y={tooltipY + 18}>{formatValue(Number(hoveredPoint[metric] ?? 0))}</text><text x={tooltipX + 8} y={tooltipY + 34}>{metricNames[metric]} · {date(hoveredPoint.day)}</text><text x={tooltipX + 8} y={tooltipY + 49}>{number(hoveredPoint.answers ?? hoveredPoint.answer_count ?? 0)} AI answers</text></g>}
  </svg></div>;
}

function TrendMetricSelect({ value, onChange }) {
  return <label className="chart-metric-select"><span className="sr-only">Chart metric</span><select value={value} onChange={(event) => onChange(event.target.value)}>{trendMetrics.map((metric) => <option value={metric} key={metric}>{metricNames[metric]}</option>)}</select></label>;
}

function benchmarkRows(report) {
  return report.competitors.map((competitor) => ({ className: competitor.is_self ? "self-row" : "", cells: [competitor.is_self ? shortName(report.property.name) : competitor.name,
    number(competitor.visibility, 2), `${number(competitor.detection, 1)}%`, competitor.position == null ? "–" : `#${number(competitor.position, 2)}`, `${number(competitor.top3, 1)}%`, number(competitor.sentiment, 1)] }));
}

function competitorBars(report) {
  const last = report.last_report?.neutral_visibility || {};
  return report.competitors.map((competitor) => ({
    label: competitor.is_self ? shortName(report.property.name) : competitor.short || competitor.name,
    value: competitor.visibility || 0, highlight: competitor.is_self,
    marker: competitor.is_self ? last.__self__ : last[competitor.short],
  }));
}

function DatasetBadge({ children, tone = "full" }) {
  return <span className={`dataset-badge ${tone}`}>{children}</span>;
}

function intentRows(report) {
  return report.intent_competition.map((intent) => ({ cells: [intent.intent, number(intent.coogee, 1), intent.leaders?.[0]?.name || "–",
    intent.leaders?.[0] ? number(intent.leaders[0].visibility, 1) : "–", <Badge tone={intent.status === "lead" ? "good" : "bad"}>{intent.status === "lead" ? "Leading" : "Behind"}</Badge>, intent.implication] }));
}

function IntentMatrix({ report }) {
  const cells = report.intent_engine || [];
  const intents = [...new Set(cells.map((c) => c.intent))].sort((a, b) => {
    const va = report.intents.find((i) => i.name === a)?.visibility || 0; const vb = report.intents.find((i) => i.name === b)?.visibility || 0; return vb - va;
  });
  const engines = [...new Set(cells.map((c) => c.engine))].sort((a, b) => ENGINE_ORDER.indexOf(a) - ENGINE_ORDER.indexOf(b));
  const lookup = Object.fromEntries(cells.map((c) => [`${c.intent}|${c.engine}`, c]));
  return <>
    <Heatmap rows={intents} cols={engines} value={(r, c) => lookup[`${r}|${c}`]?.visibility ?? null}
      title={(r, c) => { const x = lookup[`${r}|${c}`]; return x ? `${r} · ${c}: visibility ${number(x.visibility, 1)}, found in ${number(x.detection, 0)}% of ${x.answers} answers` : `${r} · ${c}: no answers`; }} />
    <div className="hm-legend"><span>Visibility</span>{[0, 2, 4, 6, 7].map((l) => <i key={l} className={`hm hm-${l}`} />)}<span>0 → 100</span></div>
  </>;
}

function InsightCards({ report, editor }) {
  const monitorItems = (report.notes?.monitor_next?.body || "").split("\n").map((item) => item.trim()).filter(Boolean);
  return <div className="r-cards3">
    <article className="r-card"><h4>1. The good news</h4><ul>{(report.insights.good_news || []).map((item, index) => <li key={index}>{item}</li>)}</ul></article>
    <article className="r-card grey"><h4>2. The qualification</h4><ul>{(report.insights.qualification || []).map((item, index) => <li key={index}>{item}</li>)}</ul></article>
    {editor || <article className="r-card plain"><h4>3. What we’ll monitor next</h4>{monitorItems.length ? <ul>{monitorItems.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="muted">Not written yet for this period — add it on Monthly Intelligence.</p>}</article>}
  </div>;
}

function AlertStrip({ report, onOpen }) {
  const open = (report.alerts || []).filter((alert) => alert.status === "draft");
  if (!open.length) return null;
  const high = open.filter((alert) => alert.metrics?.severity === "high").length;
  return <div className="alert-strip-bar" role="status">
    <span className="alert-icon" aria-hidden="true">!</span>
    <div className="alert-text"><strong>{open.length} auto alert{open.length > 1 ? "s" : ""} to review</strong>{high ? ` · ${high} high` : ""}
      <span className="muted"> — {open.slice(0, 2).map((alert) => `${alert.metrics?.name} ${alert.metrics?.metric === "visibility" ? "visibility" : "detection"} −${number(alert.metrics?.drop_pct, 0)}%`).join(", ")}{open.length > 2 ? ", …" : ""}</span></div>
    <button className="secondary" onClick={onOpen}>Review</button>
  </div>;
}

export function OverviewPage({ report, onOpenAlerts }) {
  const [trendMetric, setTrendMetric] = useState("visibility");
  if (!report) return <Loading />;
  const baselineIntent = (name) => report.intents.find((i) => i.name === name)?.vs_baseline;
  return <>
    <AlertStrip report={report} onOpen={onOpenAlerts} />
    <MetricGrid items={metrics(report)} />
    <div className="ov-row">
      <Card title={`${metricNames[trendMetric]} over time`} subtitle={<><DatasetBadge>FULL TRACKING SET</DatasetBadge> {report.prompt_sets.full} prompts · each point is one ~2-day tracking run</>} action={<TrendMetricSelect value={trendMetric} onChange={setTrendMetric} />} className="ui-card trend-card"><TrendChart report={report} metric={trendMetric} /></Card>
      <Card title="By AI engine" subtitle={<><DatasetBadge>FULL TRACKING SET</DatasetBadge> Visibility Score</>} className="ui-card">
        <Bars rows={report.engines.map((engine) => ({ label: engine.name, value: engine.visibility }))} format={(v) => number(v, 1)} />
      </Card>
    </div>
    <div className="ov-row even">
      <Card title="By search intent" subtitle={<><DatasetBadge>FULL TRACKING SET</DatasetBadge> Visibility Score and movement vs baseline</>} className="ui-card">
        <div className="bars-with-delta">{report.intents.map((intent) => <div className="bwd" key={intent.name}><Bars rows={[{ label: intent.name, value: intent.visibility }]} format={(v) => number(v, 1)} /><Delta mv={baselineIntent(intent.name)} /></div>)}</div>
      </Card>
      <Card title="Competitive benchmark" subtitle={<><DatasetBadge tone="neutral">NEUTRAL COMPETITOR SET</DatasetBadge> {report.prompt_sets.neutral} prompts · marker = last report</>} className="ui-card">
        <Bars rows={competitorBars(report)} format={(v) => number(v, 1)} markerLabel="Last report" />
      </Card>
    </div>
    <Card title="Where the hotel wins by intent" subtitle={<><DatasetBadge tone="neutral">NEUTRAL COMPETITOR SET</DatasetBadge> vs the strongest tracked competitor</>} className="ui-card">
      <DataTable headers={["Intent", shortName(report.property.name), "Nearest / leader", "Leader", "Status", "Implication"]} rows={intentRows(report)} />
    </Card>
    <Card title="Key insights" className="ui-card"><InsightCards report={report} /></Card>
  </>;
}

function MonitorNextEditor({ report, propertyId }) {
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const saved = report?.notes?.monitor_next;
    setNote(saved?.body || "Whether the softening in neutral competitive visibility persists.\nWhere the hotel leads and where competitors are stronger.\nEngagement and conversion measures once tracking access is available.");
    setStatus(saved ? `Saved by ${saved.updated_by || "someone"} · ${date(saved.updated_at)}` : "Draft — edit and save for this period");
  }, [report]);

  async function save() {
    setBusy(true); setStatus("Saving…");
    try {
      await api(`/api/report/${propertyId}/notes`, jsonOptions({ period_key: report.period.key, section: "monitor_next", body: note, updated_by: savedValue("geo.reviewer") || null }, "PUT"));
      setStatus("Saved");
    } catch (error) { setStatus(error.message); }
    finally { setBusy(false); }
  }

  return <article className="r-card plain"><h4>3. What we’ll monitor next</h4>
    <textarea aria-label="What we’ll monitor next" value={note} onChange={(event) => { setNote(event.target.value); setStatus("Unsaved changes"); }} />
    <div className="note-actions"><button disabled={busy} onClick={save}>{busy ? "Saving…" : "Save note"}</button><span className="saved" role="status">{status}</span></div>
  </article>;
}

function LensCards({ report }) {
  const lenses = (report.lenses || []).filter((lens) => lens.lens !== "Unclear" || lens.diagnoses);
  return <div className="lens-grid">{lenses.map((lens, index) => <article className={`r-card ${index === 1 ? "grey" : index === 2 ? "plain" : ""}`} key={lens.lens}><h4>{index + 1}. {lens.lens}</h4>
    <ul>{lens.questions.map((question) => <li key={question}>{question}</li>)}</ul>
    <div className="lens-stats"><div><strong>{number(lens.diagnoses)}</strong><span>diagnosed</span></div><div><strong>{number(lens.open_recommendations)}</strong><span>open actions</span></div><div><strong>{number(lens.done_recommendations)}</strong><span>done</span></div></div>
    {lens.examples?.slice(0, 1).map((example) => <p className="muted" key={example.type}>e.g. {example.intent} on {example.engine}: {example.text.slice(0, 150)}</p>)}</article>)}</div>;
}

export function IntelligencePage({ report, propertyId }) {
  if (!report) return <Loading />;
  return <>
    <AlertStrip report={report} onOpen={() => { localStorage.setItem("geo.tab", "evidence"); window.location.reload(); }} />
    <section className="r-section"><div className="report-eyebrow">EXECUTIVE OVERVIEW</div><h2>What changed this period</h2><p className="lede">{shortName(report.property.name)} · {date(report.period.from)} – {date(report.period.to)} · {number(report.overall_answers)} AI answers</p>
      <TrendChart report={report} compact /><InsightCards report={report} editor={<MonitorNextEditor report={report} propertyId={propertyId} />} /></section>
    <section className="r-section"><div className="report-eyebrow">PROMPT ARCHITECTURE</div><h2>Performance across prompt sets</h2>
      <div className="r-grid2">
        <div className="qa-card"><DatasetBadge>FULL TRACKING SET · {report.prompt_sets.full} PROMPTS</DatasetBadge><p className="q">{report.prompt_set_answers?.full?.question}</p><p className="a">{report.prompt_set_answers?.full?.answer}</p></div>
        <div className="qa-card"><DatasetBadge tone="neutral">NEUTRAL COMPETITOR SET · {report.prompt_sets.neutral} PROMPTS</DatasetBadge><p className="q">{report.prompt_set_answers?.neutral?.question}</p><p className="a">{report.prompt_set_answers?.neutral?.answer}</p></div>
      </div>
      <DataTable headers={["Metric", "Baseline", "Current", "Movement", "Target", "Interpretation"]} rows={report.overall.map((item) => ({ cells: [metricNames[item.metric], fmtValue(item.metric, item.baseline), <strong>{fmtValue(item.metric, item.current)}</strong>, <Delta mv={item.vs_baseline} />, fmtValue(item.metric, item.target), item.interpretation] }))} /></section>
    <section className="r-section"><div className="report-eyebrow">UNDERSTANDING AI SELECTION</div><h2>Why AI chooses {shortName(report.property.name)} — or someone else</h2><LensCards report={report} /></section>
    <section className="r-section"><h2>Engagement</h2><div className="r-pending">Engagement metrics will populate when hotel GTM/GA4 tracking access is configured.</div></section>
  </>;
}

function SourceIntelligence({ report }) {
  const sources = report.sources || {};
  return <>
    <div className="r-grid2 r-source-grid">
      <div><h3>Citation share by source type</h3>
        <DataTable headers={["Source type", "All citations", "Share", "Hotel citations", "Hotel share", "Domains"]}
          rows={(sources.categories || []).map((category) => ({ cells: [category.category, number(category.citations), `${number(category.share, 1)}%`, number(category.for_hotel), `${number(category.share_for_hotel, 1)}%`, number(category.domains)] }))} />
      </div>
      <div><h3>Top cited sources for the hotel</h3>
        <DataTable headers={["Domain", "Type", "Citations", "Intents"]}
          rows={(sources.top_cited || []).map((source) => ({ cells: [source.domain, source.category, number(source.citations), number(source.intents)] }))} />
      </div>
    </div>
    <div className="r-grid2 r-source-grid" style={{ marginTop: 12 }}>
      <div><h3>Missing sources cited for competitors</h3>
        <DataTable headers={["Source", "Type", "Rival citations", "Cited for"]}
          rows={(sources.missing || []).map((source) => ({ cells: [source.domain, source.category, number(source.for_competitors), (source.competitors || []).join(", ")] }))} />
      </div>
      <div><h3>Cited pages by prompt cluster</h3>
        <DataTable headers={["Intent", "Page", "Citations"]}
          rows={(sources.pages_by_intent || []).map((page) => ({ cells: [page.intent, <a href={page.url} target="_blank" rel="noreferrer">{page.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\?.*$/, "").slice(0, 70)}</a>, number(page.citations)] }))} />
      </div>
    </div>
    <h3>Competitor sources</h3>
    <DataTable headers={["Competitor", "Source", "Citations"]}
      rows={(sources.competitor_sources || []).map((source) => ({ cells: [source.competitor, source.domain, number(source.citations)] }))} />
    <div className="r-callout"><strong>Action triggers:</strong> low owned-site share or stale pages suggest refreshing owned content; competitor sources absent for the hotel suggest PR, listing or citation opportunities.</div>
  </>;
}

export function EnginesPage({ report }) {
  if (!report) return <Loading />;
  return <>
    <MetricGrid items={metrics(report, ["visibility", "detection", "position", "top3"])} />
    <Card title="Engine scorecard" subtitle="Full prompt set · movement vs baseline" className="ui-card">
      <DataTable headers={["Engine", "Visibility Score", "Detection", "Avg position", "Top 3", "vs baseline"]} rows={report.engines.map((engine) => ({ cells: [<strong>{engine.name}</strong>,
        <span className="inline-bar"><span className="bar-track"><span className="bar-fill" style={{ width: `${Math.min(100, engine.visibility || 0)}%` }} /></span><b>{number(engine.visibility, 1)}</b></span>,
        `${number(engine.detection, 1)}%`, engine.position == null ? "–" : `#${number(engine.position, 2)}`, `${number(engine.top3, 1)}%`, <Delta mv={engine.vs_baseline} />] }))} />
      {report.engine_view && <p className="card-foot">{report.engine_view}</p>}
    </Card>
    <Card title="Search intent × engine" subtitle="Visibility Score per cell · darker = more visible · hover for detail" className="ui-card"><IntentMatrix report={report} /></Card>
  </>;
}

export function CompetitivePage({ report }) {
  if (!report) return <Loading />;
  return <>
    <div className="ov-row">
      <Card title="Current competitive position" subtitle={<><DatasetBadge tone="neutral">NEUTRAL COMPETITOR SET</DatasetBadge> {report.prompt_sets.neutral} prompts · headline measures</>} className="ui-card">
        <DataTable headers={["Property", "Visibility", "Detection", "Avg position", "Top 3", "Sentiment"]} rows={benchmarkRows(report)} />
        {report.competitive_notes?.length > 0 && <ul className="card-notes">{report.competitive_notes.map((line, index) => <li key={index}>{line}</li>)}</ul>}
      </Card>
      <Card title="Visibility Score" subtitle="marker = Aug 2026 report" className="ui-card"><Bars rows={competitorBars(report)} format={(v) => number(v, 1)} markerLabel="Aug 2026 report" /></Card>
    </div>
    <Card title="Neutral benchmark movement" subtitle={`Current period vs the ${report.benchmark_label}`} className="ui-card">
      <DataTable headers={["Metric", report.benchmark_label, "Current", "Movement", "Implication"]} rows={report.neutral_vs_benchmark.map((item) => ({ cells: [metricNames[item.metric], fmtValue(item.metric, item.benchmark), <strong>{fmtValue(item.metric, item.current)}</strong>, <Delta mv={item.movement} />, item.implication] }))} />
    </Card>
  </>;
}

export function IntentsPage({ report }) {
  if (!report) return <Loading />;
  const leading = report.intent_competition.filter((i) => i.status === "lead").length;
  return <>
    <div className="ov-kpis three">
      <article className="kpi-card"><div className="kpi-body"><div className="k-label">Intents where the hotel leads</div><div className="k-value">{leading} / {report.intent_competition.length}</div><div className="k-note">neutral set, vs tracked competitors</div></div></article>
      <article className="kpi-card"><div className="kpi-body"><div className="k-label">Strongest intent</div><div className="k-value small">{report.intents[0]?.name || "–"}</div><div className="k-note">Visibility {number(report.intents[0]?.visibility, 1)}</div></div></article>
      <article className="kpi-card"><div className="kpi-body"><div className="k-label">Weakest intent</div><div className="k-value small">{report.intents.at(-1)?.name || "–"}</div><div className="k-note">Visibility {number(report.intents.at(-1)?.visibility, 1)}</div></div></article>
    </div>
    <Card title="Competitive position by intent" subtitle={<><DatasetBadge tone="neutral">NEUTRAL COMPETITOR SET</DatasetBadge> hotel vs the strongest tracked competitor</>} className="ui-card">
      <DataTable headers={["Intent", shortName(report.property.name), "Nearest / leader", "Leader", "Status", "Implication"]} rows={intentRows(report)} />
    </Card>
    <Card title="Intent × engine" subtitle="Visibility Score per cell · darker = more visible" className="ui-card"><IntentMatrix report={report} /></Card>
      <Card title="Intent scorecard" subtitle="Full tracked prompt set" className="ui-card">
        <DataTable headers={["Intent", "Visibility", "Detection", "Avg pos.", "Top 3", "vs baseline"]} rows={report.intents.map((intent) => ({ cells: [intent.name, number(intent.visibility, 2), `${number(intent.detection, 1)}%`, intent.position == null ? "–" : `#${number(intent.position, 2)}`, `${number(intent.top3, 1)}%`, <Delta mv={intent.vs_baseline} />] }))} />
      </Card>
  </>;
}

const pct = (mv) => mv ? `${mv.relative_pct >= 0 ? "+" : ""}${mv.relative_pct}%` : "–";
const fmtMetric = (metric, value) => value == null ? "–" : metric === "position" ? `#${number(value, 2)}` : number(value, metric === "sentiment" ? 1 : 2);
const moveTone = (mv) => !mv || mv.better == null ? "" : mv.better ? "good" : "bad";

function AlertsList({ alerts }) {
  if (!alerts?.length) return <p className="muted">No sharp drops flagged in this period.</p>;
  return <DataTable headers={["Scope", "Metric", "Baseline", "Latest", "Drop", "Severity", "Review"]}
    rows={alerts.map((alert) => ({ key: alert.id, cells: [alert.metrics?.name, metricNames[alert.metrics?.metric] || alert.metrics?.metric, number(alert.metrics?.baseline, 2), number(alert.metrics?.current, 2), `−${number(alert.metrics?.drop_pct, 1)}%`, <Badge tone={alert.metrics?.severity === "high" ? "bad" : "warn"}>{alert.metrics?.severity}</Badge>, <Badge tone={alert.status === "approved" ? "good" : alert.status === "rejected" ? "bad" : ""}>{alert.status}</Badge>] }))} />;
}

export function ReportsPage({ report, propertyId, openMeasurement }) {
  const [note, setNote] = useState("");
  const [noteStatus, setNoteStatus] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setNote(report?.notes?.monitor_next?.body || "Whether the softening in neutral competitive visibility persists.\nWhere the hotel leads and where competitors are stronger.\nEngagement and conversion measures once GTM/GA4 access is available.");
    setNoteStatus(report?.notes?.monitor_next ? `Saved by ${report.notes.monitor_next.updated_by || "someone"} · ${date(report.notes.monitor_next.updated_at)}` : "Draft — edit and save for this period");
  }, [report]);
  if (!report) return <Loading />;

  async function saveNote() {
    setBusy(true); setNoteStatus("Saving…");
    try {
      await api(`/api/report/${propertyId}/notes`, jsonOptions({ period_key: report.period.key, section: "monitor_next", body: note, updated_by: savedValue("geo.reviewer") || null }, "PUT"));
      setNoteStatus("Saved");
    } catch (error) { setNoteStatus(error.message); }
    finally { setBusy(false); }
  }

  const name = shortName(report.property.name);
  const hasTargets = report.overall.some((item) => item.target != null);
  const outcomes = report.outcomes || [];
  return <div id="report-print-root">
    <section className="r-hero"><div className="prop">{report.property.name}</div><h2>GEO-AI Discoverability Program</h2><div className="meta">Monthly performance report · {date(report.period.from)} – {date(report.period.to)} · {number(report.overall_answers)} AI answers across {report.engines.length} engines</div><div className="rule" /></section>
    <nav className="r-nav" aria-label="Report sections">{[["r-exec", "Executive overview"], ["r-perf", "Performance"], ["r-sets", "Prompt sets"], ["r-comp", "Competitive position"], ["r-bench", "Neutral benchmark"], ["r-intent", "Intent intelligence"], ["r-alerts", "Alerts"], ["r-why", "Why AI chooses"], ["r-actions", "Actions & outcomes"], ["r-sources", "Source intelligence"], ["r-engage", "Engagement"], ["r-method", "Method"]].map(([id, text]) => <a key={id} href={`#${id}`}>{text}</a>)}</nav>

    <section className="r-section page" id="r-exec"><h2>Executive overview</h2><p className="lede">Visibility Score over time · dashed line = {report.baseline_label.toLowerCase()}</p><TrendChart report={report} />
      <div className="r-cards3">
        <article className="r-card"><h4>1. The good news</h4><ul>{(report.insights.good_news || []).map((item, index) => <li key={index}>{item}</li>)}</ul></article>
        <article className="r-card grey"><h4>2. The qualification</h4><ul>{(report.insights.qualification || []).map((item, index) => <li key={index}>{item}</li>)}</ul></article>
        <article className="r-card plain"><h4>3. What we’ll monitor next</h4>
          <textarea aria-label="What we’ll monitor next" value={note} onChange={(event) => { setNote(event.target.value); setNoteStatus("Unsaved changes"); }} />
          <ul className="print-note">{note.split("\n").filter(Boolean).map((line, index) => <li key={index}>{line}</li>)}</ul>
          <button disabled={busy} onClick={saveNote}>{busy ? "Saving…" : "Save note"}</button><div className="saved no-print">{noteStatus}</div></article>
      </div>
    </section>

    <section className="r-section page" id="r-perf"><div className="report-eyebrow">BRAND-AWARE + LOCATION-AWARE MEASUREMENT</div><h2>Performance overview: full {name} prompt set</h2>
      <p className="lede">Overall discoverability across the full {report.prompt_sets.full}-prompt set. Reporting period: {date(report.period.from)} – {date(report.period.to)}.</p>
      <DataTable headers={["Metric", "Baseline", "Current", "Movement", ...(hasTargets ? ["Target", "vs target"] : []), "Interpretation"]}
        rows={report.overall.map((item) => ({ cells: [metricNames[item.metric], fmtMetric(item.metric, item.baseline), fmtMetric(item.metric, item.current), <Delta mv={item.vs_baseline} />, ...(hasTargets ? [fmtMetric(item.metric, item.target), pct(item.vs_target)] : []), item.interpretation] }))} />
      {!hasTargets && <p className="target-note no-print">No targets set yet. Add a “Target” benchmark in Settings to show baseline, current, movement and target together.</p>}
      {report.engine_view && <div className="r-callout center"><strong>Engine view:</strong> {report.engine_view}</div>}
      <MetricGrid items={metrics(report, ["visibility", "detection", "position", "sentiment"])} />
      <div className="r-grid2">
        <div><h3>Visibility Score by AI engine</h3><DataTable headers={["Engine", "Visibility Score", "% Δ"]} rows={engineVisibilityRows(report)} /></div>
        <div><h3>Visibility Score by search intent</h3><DataTable headers={["Search intent", "Visibility Score", "% Δ"]} rows={intentVisibilityRows(report)} /></div>
      </div>
    </section>

    <section className="r-section page" id="r-sets"><h2>Performance across prompt sets</h2><div className="r-grid2">
      <div><h3>1. Full {name} tracking set</h3><ul>
        <li>{report.prompt_sets.full} prompts retained for single-property tracking.</li><li>Includes brand- and location-specific prompts.</li>
        <li>Answers: “{report.prompt_set_answers?.full?.question}”</li><li><strong>Current answer:</strong> {report.prompt_set_answers?.full?.answer}</li></ul></div>
      <div><h3>2. Neutral competitor set</h3><ul>
        <li>{report.prompt_sets.neutral} broad prompts used for like-for-like comparison across competitors.</li><li>Excludes brand/location prompts that would unfairly favour {name}.</li>
        <li>Answers: “{report.prompt_set_answers?.neutral?.question}”</li><li><strong>Current answer:</strong> {report.prompt_set_answers?.neutral?.answer}</li></ul></div>
    </div><div className="r-callout center">Full-set and neutral competitor metrics serve different purposes and should not be directly compared.</div></section>

    <section className="r-section page" id="r-comp"><div className="report-eyebrow">NEUTRAL {report.prompt_sets.neutral}-PROMPT BENCHMARK</div><h2>Current competitive position</h2>
      <DataTable headers={["Property", "Visibility", "Detection", "Average position", "Top 3", "Sentiment"]} rows={benchmarkRows(report)} />
      {report.competitive_notes?.length > 0 && <div className="r-callout"><strong>Interpretation</strong><ul>{report.competitive_notes.map((line, index) => <li key={index}>{line}</li>)}</ul></div>}
    </section>

    <section className="r-section page" id="r-bench"><div className="report-eyebrow">{report.benchmark_label.toUpperCase()} VS CURRENT REPORT</div><h2>Neutral benchmark movement</h2>
      <DataTable headers={["Metric", report.benchmark_label, "Current", "Movement", "Implication"]} rows={report.neutral_vs_benchmark.map((item) => ({ cells: [metricNames[item.metric], fmtMetric(item.metric, item.benchmark), fmtMetric(item.metric, item.current), <Delta mv={item.movement} />, item.implication] }))} />
    </section>

    <section className="r-section page" id="r-intent"><div className="report-eyebrow">INTENT-LEVEL COMPETITIVE INTELLIGENCE</div><h2>Where {name} wins and where competitors are stronger</h2><DataTable headers={["Intent", name, "Nearest / leader", "Leader visibility", "Status", "Implication"]} rows={intentRows(report)} /></section>

    <section className="r-section" id="r-alerts"><div className="report-eyebrow">AUTO ALERTS</div><h2>Sharp score drops this period</h2><p className="lede">Flagged automatically after each upload and reviewed by the team before acting. AI responses are non-deterministic; a single drop is a prompt to watch, not a conclusion.</p><AlertsList alerts={report.alerts} /></section>

    <section className="r-section page" id="r-why"><div className="report-eyebrow">UNDERSTANDING AI SELECTION</div><h2>Why AI chooses {name} — or someone else</h2><LensCards report={report} /></section>
    <section className="r-section page" id="r-actions"><div className="report-eyebrow">MOVE FROM DIAGNOSIS TO ACTION</div><h2>Actions & outcomes</h2>
      <p className="lede">Recommendations approved by the team, and the before/after Visibility Score of the prompt each one targets. Language: “following implementation”, not “caused by”, unless a controlled test proves it.</p>
      <DataTable headers={["Action", "Intent", "Live since", "Before", "After", "Change", "State"]} empty="No actions have been marked done yet."
        rows={outcomes.map((row) => ({ key: row.recommendation_id, cells: [row.title, row.intent, date(row.done_on), number(row.before_visibility, 1), row.after_visibility == null ? "–" : number(row.after_visibility, 1), row.change_points == null ? "–" : <Badge tone={row.change_points > 0 ? "good" : row.change_points < 0 ? "bad" : ""}>{row.change_points > 0 ? "+" : ""}{number(row.change_points, 1)} pts</Badge>, row.state] }))} />
    </section>

    <section className="r-section page" id="r-sources"><div className="report-eyebrow">MOVE FROM MEASUREMENT TO DIAGNOSIS</div><h2>Source intelligence: who is informing AI about {name}?</h2>
      <DataTable headers={["Source", "What to report", "Why it matters", "Action trigger", "This period"]} rows={(report.source_playbook || []).map((row) => ({ cells: [<strong>{row.source}</strong>, row.what_to_report, row.why, row.trigger, <span><span className={`status-dot ${row.status === "action" ? "needs-action" : ""}`} />{row.note}</span>] }))} />
      <SourceIntelligence report={report} />
    </section>

    <section className="r-section page" id="r-engage"><h2>Engagement and conversion</h2><div className="r-pending">These metrics require conversion tracking to be configured in Google Tag Manager. This depends on Editor-level GTM/GA4 access from the hotel; they will populate once tracking is configured.</div><div className="r-grid2"><div className="r-panel"><h4>Engagement</h4><p className="it">Pending hotel GTM/GA4 access</p><p>High-intent page time — · Check-availability click behaviour — · Booking engine handoff —</p></div><div className="r-panel"><h4>Conversion</h4><p className="it">Declared-intent proxies; booking conversion itself sits in PMS data, outside program scope</p><p>Enquiry submissions — · Brochure downloads — · Dining click-outs — · Booking engine referrals —</p></div></div></section>

    <section className="r-section page appendix" id="r-method"><h2>Appendix: measurement method</h2><div className="r-grid2">
      <div><h4>Prompt architecture</h4><ul><li>{report.prompt_sets.full} prompts retained for {name}-only tracking.</li><li>{report.prompt_sets.neutral} neutral prompts used for competitor comparison.</li><li>Prompt clusters are organised around guest intent, not just brand terms.</li></ul>
        <h4>Engine coverage</h4><ul><li>{report.engines.map((engine) => engine.name).join(", ")}.</li><li>Engine-level performance is reported separately because each engine behaves differently.</li></ul></div>
      <div><h4>Metric definitions (Rankscale)</h4><ul><li>Visibility Score: average answer score, 100 ÷ (1 + 0.1 × (rank − 1)) when mentioned, else 0.</li><li>Detection Rate: % of answers that mention the hotel.</li><li>Average Position: average rank when mentioned. Top 3: % of answers ranking it 1–3.</li><li>Sentiment: average sentiment × 100 when mentioned.</li></ul>
        <h4>Interpretation rules</h4><ul><li>Full-set and neutral competitor metrics serve different purposes and should not be directly compared.</li><li>AI responses are non-deterministic; repeated trends are more meaningful than individual observations.</li><li>Hotel counted by {report.names === "all" ? "every confirmed hotel name" : "Rankscale's own detection"}.</li></ul></div>
    </div></section>
    <footer className="r-foot"><span className="wordmark">komosion</span><p>Helping organisations use AI to be more efficient and effective.</p></footer>
  </div>;
}

export function SettingsPage({ propertyId, names = "rankscale", onNamesChange }) {
  const [settings, setSettings] = useState(null);
  const [benchmarks, setBenchmarks] = useState([]);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ label: "Target", prompt_set: "full", metric: "visibility", value: "" });
  const [message, setMessage] = useState("");

  async function load() {
    try {
      const [nextSettings, nextBenchmarks] = await Promise.all([api(`/api/report/${propertyId}/settings`), api(`/api/report/${propertyId}/benchmarks`)]);
      setSettings(nextSettings); setBenchmarks(nextBenchmarks); setError(null);
    } catch (reason) { setError(reason); }
  }
  useEffect(() => { load(); }, [propertyId]);

  async function saveBenchmark(event) {
    event.preventDefault(); setMessage("");
    try {
      await api(`/api/report/${propertyId}/benchmarks`, jsonOptions({ ...form, value: Number(form.value), kind: form.label.toLowerCase().includes("target") ? "target" : "benchmark" }, "PUT"));
      setMessage("Benchmark saved"); setForm({ ...form, value: "" }); await load();
    } catch (reason) { setError(reason); }
  }

  if (!settings) return <><PageError error={error} onRetry={load} /><Loading /></>;
  const chips = (values = []) => <div>{values.map((value) => <span className="chip" key={value}>{value}</span>)}</div>;
  return <>
    <PageError error={error} onRetry={load} />
    <div className="settings-grid">
      <Card title="Report mention counting" subtitle="Choose which hotel mentions count in report metrics. Rankscale detection is recommended for matching its dashboard." className="ui-card">
        <Segmented label="Count a hotel mention when" value={names} onChange={onNamesChange} options={[
          ["rankscale", "Rankscale detects it"], ["all", "Any confirmed hotel name appears"],
        ]} />
      </Card>
      <Card title="Tracked competitor set" subtitle="Names are maintained in Supabase competitor_groups." className="ui-card"><DataTable headers={["Competitor", "Names engines use"]} rows={settings.competitor_groups.map((group) => ({ cells: [group.display_name || group.name, chips(group.aliases)] }))} /></Card>
      <Card title="Hotel names and domains" subtitle={settings.property?.name} className="ui-card"><h4>Counts as the hotel</h4>{chips(settings.property?.aliases)}<h4>Ignored names</h4>{chips(settings.property?.ignored_names)}<h4>Own domains</h4>{chips(settings.property?.own_domains)}</Card>
      <Card title="Neutral prompt set" subtitle={`${settings.prompts.filter((prompt) => prompt.is_neutral).length} neutral of ${settings.prompts.length} tracked prompts`} className="ui-card"><h4>Exclusion terms</h4>{chips(settings.neutral_exclusion_terms)}<details><summary>See tracked prompts</summary><DataTable headers={["Prompt", "Intent", "Neutral"]} rows={settings.prompts.map((prompt) => ({ cells: [prompt.prompt_text, prompt.intent, prompt.is_neutral ? "Yes" : "No"] }))} /></details></Card>
      <Card title="AI model for agents" subtitle="Configured on the FastAPI server." className="ui-card"><DataTable headers={["Setting", "Value"]} rows={[["Provider", settings.llm.provider], ["Model", settings.llm.model], ["API key", settings.llm.key_set ? "Set" : "Missing; agents will not run"]].map((row) => ({ cells: row }))} /></Card>
    </div>
    <Card title="Benchmarks and targets" subtitle="Add or update a target for a prompt set and metric." className="ui-card">
      <DataTable headers={["Label", "Set", "Dimension", "Metric", "Value", "Derived"]} rows={benchmarks.map((benchmark) => ({ cells: [benchmark.label, benchmark.prompt_set, benchmark.dim_key || benchmark.dimension, metricNames[benchmark.metric], number(benchmark.value, 2), benchmark.is_derived ? "Yes" : ""] }))} />
      <form className="row" onSubmit={saveBenchmark}>
        <label>Label<input required value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} /></label>
        <label>Prompt set<select value={form.prompt_set} onChange={(event) => setForm({ ...form, prompt_set: event.target.value })}><option value="full">Full set</option><option value="neutral">Neutral set</option></select></label>
        <label>Metric<select value={form.metric} onChange={(event) => setForm({ ...form, metric: event.target.value })}>{Object.entries(metricNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Value<input type="number" step="0.01" required value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} /></label>
        <button>Save benchmark</button>{message && <span className="muted">{message}</span>}
      </form>
      <p className="muted">Benchmarks labelled exactly “Target” appear in the report next to baseline, current and movement.</p>
    </Card>
    <LearningMemoryCard propertyId={propertyId} />
  </>;
}