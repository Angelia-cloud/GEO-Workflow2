import React, { useEffect, useState } from "react";
import { api, jsonOptions, queryString } from "../api.js";
import { date, dateTime, number, savedValue } from "../format.js";
import { Badge, Card, DataTable, Drawer, Loading, Notice, PageError, Segmented } from "../components.jsx";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
const LENS = { content_gap: "Relevance", entity_confusion: "Clarity", negative_sentiment: "Clarity", citation_gap: "Credibility", competitor_dominance: "Credibility", other: "Unclear" };
const INSIGHT_LABEL = { alert: "Auto alert", competitor_threat: "Neutral-set alert", INTENT_WEAKNESS: "Intent weakness", visibility_gap: "Intent weakness", trend: "Trend", visibility_summary: "Summary", other: "Other" };
const statusTone = (status) => ["approved", "confirmed", "verified", "done"].includes(status) ? "good" : ["rejected", "disputed"].includes(status) ? "bad" : "";

/** The agent appends "Evidence: <uuid>, <uuid>" to details; show a count instead of raw IDs. */
function splitEvidence(text = "") {
  const match = (text || "").match(/\n*\s*Evidence:\s*([0-9a-f-,\s]+)$/i);
  if (!match) return [text, 0];
  return [text.slice(0, match.index).trim(), match[1].split(",").filter((id) => id.trim()).length];
}

function reviewerName() {
  const name = savedValue("geo.reviewer").trim();
  if (!name) throw new Error("Add your name under “Reviewer” in the sidebar first, so every decision is attributed.");
  return name;
}

async function sendFeedback(target, targetId, decision, extra = {}) {
  return api("/api/feedback", jsonOptions({ target, target_id: targetId, reviewer: reviewerName(), decision, ...extra }));
}

function ReviewBar({ target, id, status, onDone, editFields = [], current = {} }) {
  const [mode, setMode] = useState(null);   // null | "reject" | "comment" | "edit"
  const [comment, setComment] = useState("");
  const [draft, setDraft] = useState({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function act(decision) {
    setBusy(true); setMessage("");
    try {
      const changes = decision === "edit" ? Object.fromEntries(Object.entries(draft).filter(([key, value]) => value !== (current[key] ?? ""))) : undefined;
      if (decision === "edit" && !Object.keys(changes).length) throw new Error("Change at least one field before saving the edit.");
      await sendFeedback(target, id, decision, { comment: comment || null, changes });
      setComment(""); setMode(null); setDraft({});
      setMessage(decision === "edit" || decision === "reject" ? "Saved — this correction is now in learning memory." : decision === "approve" ? "Approved" : "Comment saved");
      onDone?.();
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  const confirmLabel = { reject: "Confirm reject", comment: "Save comment", edit: "Save edit" }[mode];
  return <div className="review-bar">
    {mode === "edit" && <div className="edit-grid">{editFields.map(([key, label, kind, options]) => <label key={key}>{label}
      {kind === "select" ? <select value={draft[key] ?? current[key] ?? ""} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}>{options.map((option) => <option key={option}>{option}</option>)}</select>
        : kind === "textarea" ? <textarea value={draft[key] ?? current[key] ?? ""} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
          : <input value={draft[key] ?? current[key] ?? ""} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />}
    </label>)}</div>}
    {mode ? <div className="actions">
      <input autoFocus placeholder={mode === "comment" ? "Your comment" : "Why? The agents learn from this (optional)"} value={comment} onChange={(event) => setComment(event.target.value)} onKeyDown={(event) => event.key === "Enter" && mode !== "edit" && act(mode)} />
      <button disabled={busy || (mode === "comment" && !comment)} className={mode === "reject" ? "danger" : ""} onClick={() => act(mode)}>{busy ? "Saving…" : confirmLabel}</button>
      <button className="secondary" onClick={() => { setMode(null); setDraft({}); setComment(""); }}>Cancel</button>
    </div> : <div className="actions compact">
      <button disabled={busy || status === "approved" || status === "confirmed"} onClick={() => act("approve")}>{status === "approved" || status === "confirmed" ? "Approved ✓" : "Approve"}</button>
      <button className="secondary" disabled={busy || status === "rejected"} onClick={() => setMode("reject")}>Reject</button>
      {editFields.length > 0 && <button className="secondary" disabled={busy} onClick={() => setMode("edit")}>Edit</button>}
      <button className="link-btn" disabled={busy} onClick={() => setMode("comment")}>Comment</button>
      {message && <span className="muted" role="status">{message}</span>}
    </div>}
    {mode && message && <p className="muted" role="status">{message}</p>}
  </div>;
}

// ---------------------------------------------------------------------------
// Step 1 · Measurements: validate → map → human review → save
// ---------------------------------------------------------------------------
function StatusPill({ status }) {
  const tone = status === "MATCHED" ? "good" : status === "UNMATCHED" ? "bad" : "warn";
  return <Badge tone={tone}>{status.toLowerCase()}</Badge>;
}

export function UploadsPage({ properties = [], propertyId, onPropertyChange, onSaved }) {
  const [file, setFile] = useState(null);
  const [review, setReview] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [history, setHistory] = useState([]);

  const loadHistory = () => api("/api/imports?limit=15").then(setHistory).catch(() => {});
  useEffect(() => { loadHistory(); }, []);

  async function validate() {
    if (!file || !propertyId) { setError(new Error("Select a Rankscale export and the property first.")); return; }
    setBusy("validate"); setError(null); setReview(null); setSaved(null); setConfirmed(false);
    try {
      const body = new FormData(); body.append("file", file); body.append("property_id", propertyId);
      const who = savedValue("geo.reviewer"); if (who) body.append("uploaded_by", who);
      setReview(await api("/api/import-reviews", { method: "POST", body }));
    } catch (reason) { setError(reason); }
    finally { setBusy(""); }
  }

  async function updateMapping(payload) {
    setBusy("map"); setError(null);
    try { setReview(await api(`/api/import-reviews/${review.batch_id}/mapping`, jsonOptions(payload, "PUT"))); }
    catch (reason) { setError(reason); }
    finally { setBusy(""); }
  }

  async function save() {
    setBusy("save"); setError(null);
    try {
      const result = await api(`/api/import-reviews/${review.batch_id}/save`, jsonOptions({ confirmed, uploaded_by: savedValue("geo.reviewer") || null }));
      setSaved(result); setReview(null); setFile(null); onSaved?.(); loadHistory();
    } catch (reason) { setError(reason); }
    finally { setBusy(""); }
  }

  const v = review?.validation;
  const m = review?.mapping;
  const ready = review?.readiness;
  return <>
    <Card title="1 · Upload the Rankscale export" subtitle="Upload the file exactly as Rankscale downloads it (CSV or TSV, any encoding). Nothing is saved until you confirm the mappings." className="ui-card">
      <div className="row">
        <label className="grow">Rankscale export<input type="file" accept=".csv,.tsv,.txt" onChange={(event) => { setFile(event.target.files?.[0] || null); setReview(null); setSaved(null); }} /></label>
        {properties.length > 0 && <label>Property<select value={propertyId} onChange={(event) => onPropertyChange(event.target.value)}>{properties.map((property) => <option value={property.id} key={property.id}>{property.name}</option>)}</select></label>}
        <button type="button" disabled={!!busy || !file} onClick={validate}>{busy === "validate" ? "Validating…" : "Validate & map file"}</button>
      </div>
      {file && <p className="muted">{file.name} · {(file.size / 1e6).toFixed(1)} MB</p>}
    </Card>

    {error && <Notice><strong>{error.message}</strong>{error.body?.detail?.report?.errors?.length > 0 && <ul>{error.body.detail.report.errors.slice(0, 8).map((item, index) => <li key={index}>{item.row ? `Row ${item.row}: ` : ""}{item.message}</li>)}</ul>}</Notice>}

    {review && <>
      <Card title="2 · Validation" subtitle={v.filename} className="ui-card">
        <div className="validation-grid">
          <div><span className="muted">Rows valid</span><strong>{number(v.rows_valid)} / {number(v.rows_in_file)}</strong></div>
          <div><span className="muted">Rejected rows</span><strong>{number(v.rows_rejected)}</strong></div>
          <div><span className="muted">Dates</span><strong>{v.summary?.date_from ? `${date(v.summary.date_from)} – ${date(v.summary.date_to)}` : "–"}</strong></div>
          <div><span className="muted">Prompts · engines</span><strong>{m.counts.prompts} · {m.counts.engines}</strong></div>
        </div>
        {(v.warnings || []).length > 0 && <Notice tone="warn"><ul>{v.warnings.map((warning, index) => <li key={index}>{warning.message}</li>)}</ul></Notice>}
        {(v.errors || []).length > 0 && <details className="import-errors"><summary>{v.errors.length} row errors</summary><ul>{v.errors.slice(0, 30).map((item, index) => <li key={index}>{item.row ? `Row ${item.row}: ` : ""}{item.message}</li>)}</ul></details>}
        {v.rows_rejected > 0 && <label className="review-ack"><input type="checkbox" checked={!!ready.invalid_rows_acknowledged} onChange={(event) => updateMapping({ accept_invalid_rows: event.target.checked })} />Skip the {v.rows_rejected} invalid rows and save the rest</label>}
      </Card>

      <Card title="3 · Mapping review" subtitle="Each file value must map to the property, a tracked prompt and an engine before anything is saved." className="ui-card">
        <div className="import-section-title">Property</div>
        <div className="mapping-property">
          <span>File brand: <strong>{m.property.source_values.join(", ") || "–"}</strong></span>
          <select value={m.property.selected_id || ""} onChange={(event) => updateMapping({ property_id: event.target.value })}>{m.property.options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select>
          <StatusPill status={m.property.status} />
          {m.property.status !== "MATCHED" && <label className="review-ack"><input type="checkbox" checked={!!m.property.confirmed} onChange={(event) => updateMapping({ confirm_property: event.target.checked })} />These rows belong to {m.property.selected_name}</label>}
        </div>

        <div className="import-section-title">Prompts ({m.prompts.filter((item) => item.status === "MATCHED").length}/{m.prompts.length} matched)</div>
        <DataTable headers={["Intent (file)", "Prompt (file)", "Rows", "Status", "Maps to"]} rows={m.prompts.map((item) => ({ key: item.key, cells: [item.source_topic, item.source_prompt, number(item.row_count), <StatusPill status={item.status} />,
          item.status === "MATCHED" ? <span className="muted">{item.intent}{item.method === "human selection" ? " · chosen by reviewer" : ""}</span>
            : <select value="" onChange={(event) => updateMapping({ prompt_resolutions: { [item.key]: event.target.value } })}><option value="">Choose the tracked prompt…</option>{item.options.map((option) => <option key={option.id} value={option.id}>{option.intent} · {option.prompt.slice(0, 90)}</option>)}</select>] }))} />

        <div className="import-section-title">Engines</div>
        <DataTable headers={["Engine (file)", "Rows", "Status", "Maps to"]} rows={m.engines.map((item) => ({ key: item.source, cells: [item.source, number(review.summary.engine_row_counts?.[item.source]), <StatusPill status={item.status} />,
          item.status === "MATCHED" ? item.name : <select value="" onChange={(event) => updateMapping({ engine_resolutions: { [item.source]: event.target.value } })}><option value="">Choose…</option>{item.options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select>] }))} />

        <div className="import-section-title">Competitors named in answers</div>
        <p className="muted">{m.competitors.filter((item) => item.status === "MATCHED").length} already known · {ready.unmatched_competitors} new names will be added as observed competitors (not the tracked set).</p>
        {ready.unmatched_competitors > 0 && <details><summary>See new names</summary><p className="muted">{m.competitors.filter((item) => item.status !== "MATCHED").map((item) => item.source).join(" · ")}</p></details>}
        {ready.unmatched_competitors > 0 && <label className="review-ack"><input type="checkbox" checked={!!review.review.unmatched_competitors_confirmed} onChange={(event) => updateMapping({ confirm_unmatched_competitors: event.target.checked })} />Add the {ready.unmatched_competitors} new names as observed competitors</label>}
      </Card>

      <Card title="4 · Confirm & save" className="ui-card">
        {ready.ready ? <Notice tone="ok">Ready: {number(review.summary.rows_ready)} rows for {review.summary.property}. Re-uploading the same file never duplicates answers.</Notice>
          : <Notice tone="warn"><strong>Not ready yet</strong><ul>{ready.blocking_reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></Notice>}
        <label className="review-ack"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I've reviewed the mappings above</label>
        <button disabled={!ready.ready || !confirmed || !!busy} onClick={save}>{busy === "save" ? "Saving…" : "Confirm mappings & save to Supabase"}</button>
      </Card>
    </>}

    {saved && <Card title="Saved" className="ui-card"><Notice tone="ok">
      <strong>{number(saved.summary.measurements_inserted)} new AI answers saved</strong>
      <ul>
        <li>{number(saved.summary.mentions_inserted)} brand mentions · {number(saved.summary.evidence_inserted)} evidence rows · {number(saved.summary.competitors_added)} new competitors</li>
        {saved.summary.measurements_skipped > 0 && <li>{number(saved.summary.measurements_skipped)} answers were already loaded and were skipped</li>}
        {saved.follow_up?.alerts_checked ? <li>Auto alerts: {saved.follow_up.alerts ? `${saved.follow_up.alerts} sharp drop(s) flagged — review them under Evidence & Diagnosis` : "no sharp drops"}</li>
          : saved.follow_up?.alerts_note ? <li>Auto alerts: {saved.follow_up.alerts_note}</li> : null}
      </ul></Notice></Card>}

    <Card title="Import history" className="ui-card">
      <DataTable headers={["When", "File", "By", "Status", "Rows", "Answers added", "Evidence added"]} empty="Nothing imported yet"
        rows={history.map((row) => ({ key: row.id, cells: [dateTime(row.created_at), row.filename || "–", row.uploaded_by || "–", <Badge tone={row.status === "loaded" ? "good" : row.status === "validated" ? "" : "bad"}>{row.status === "validated" ? "awaiting review" : row.status}</Badge>, `${number(row.rows_valid)} / ${number(row.rows_in_file)}`, number(row.measurements_added), number(row.evidence_added)] }))} />
    </Card>
  </>;
}

// ---------------------------------------------------------------------------
// Steps 2–3 · Insights & alerts → Diagnosis
// ---------------------------------------------------------------------------
function InsightCard({ insight, onChanged, openInsight }) {
  const metrics = insight.metrics || {};
  const isAlert = insight.insight_type === "alert" || insight.insight_type === "competitor_threat";
  return <article className={`rec ${isAlert ? "alert-rec" : ""}`}>
    <div className="meta"><Badge tone={isAlert ? "bad" : ""}>{INSIGHT_LABEL[insight.insight_type] || insight.insight_type}</Badge>
      {metrics.severity && <Badge tone={metrics.severity === "high" ? "bad" : "warn"}>{metrics.severity}</Badge>}
      <Badge tone={statusTone(insight.status)}>{insight.status}</Badge>
      <span className="muted">{date(insight.period_start)} – {date(insight.period_end)}{insight.measurement_count ? ` · ${number(insight.measurement_count)} answers` : ""}</span></div>
    <div className="rec-head"><h3>{insight.title}</h3><button className="secondary small" onClick={() => openInsight(insight)}>See evidence</button></div>
    <p>{insight.summary}</p>
    <ReviewBar target="intelligence" id={insight.id} status={insight.status} onDone={onChanged} current={{ title: insight.title, summary: insight.summary }}
      editFields={[["title", "Title", "input"], ["summary", "Summary", "textarea"]]} />
  </article>;
}

export function EvidencePage({ propertyId, report, openDetail }) {
  const [insights, setInsights] = useState(null);
  const [prompts, setPrompts] = useState([]);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState("open");
  const [view, setView] = useState("alerts");
  const period = report?.period ? { date_from: report.period.from, date_to: report.period.to } : {};

  async function load() {
    try {
      const [rows, scorecard] = await Promise.all([api(`/api/insights/${propertyId}?${queryString(period)}`), api(`/api/dashboard/${propertyId}/prompts`)]);
      setInsights(rows); setPrompts(scorecard); setError(null);
    } catch (reason) { setError(reason); }
  }
  useEffect(() => { load(); }, [propertyId, report?.period?.key]);

  async function run(kind) {
    setBusy(kind); setMessage("");
    try {
      if (kind === "insights") {
        const result = await api("/api/insights/generate", jsonOptions({ property_id: propertyId, ...period }));
        setMessage(`${result.generated} insights refreshed for ${date(result.period_start)} – ${date(result.period_end)}.`);
      } else if (kind === "alerts") {
        const result = await api(`/api/alerts/${propertyId}/run`, { method: "POST" });
        setMessage(result.checked ? `${result.alerts.length} sharp drop(s) in ${date(result.window[0])} – ${date(result.window[1])}.` : result.reason);
      } else {
        const result = await api("/api/diagnoses/batch", jsonOptions({ property_id: propertyId, limit: kind === "agent" ? 5 : 20, mode: kind }));
        setMessage(`${result.diagnosed} misses diagnosed (${kind === "rules" ? "rule-based, no LLM cost" : "agent"}). Review the drafts under Recommendations.${result.errors.length ? ` ${result.errors.length} failed: ${result.errors[0].error}` : ""}`);
      }
      await load();
    } catch (reason) { setMessage(reason.message); }
    finally { setBusy(""); }
  }

  if (error) return <PageError error={error} onRetry={load} />;
  if (!insights) return <Loading />;
  const shown = insights.filter((row) => row.insight_type !== "visibility_summary" && (filter === "all" || (filter === "open" ? row.status === "draft" : row.status === filter)));
  const alerts = shown.filter((row) => row.insight_type === "alert" || row.insight_type === "competitor_threat");
  const others = shown.filter((row) => !(row.insight_type === "alert" || row.insight_type === "competitor_threat"));
  return <>
    <ol className="flow-steps" aria-label="Workflow 2">{[["Measure", "Upload & map"], ["Alert", "Sharp drops"], ["Insight", "Evidence-backed"], ["Diagnose", "3 causes"], ["Recommend", "Next action"], ["Outcome", "Before / after"]].map(([step, sub], index) => <li key={step} className={index >= 1 && index <= 3 ? "here" : ""}><strong>{step}</strong><span>{sub}</span></li>)}</ol>
    <div className="diagnosis-lens-grid">
      {(report?.lenses || [{ lens: "Relevance", questions: ["Does the hotel match the guest intent?"] }, { lens: "Clarity", questions: ["Can AI understand the hotel as one entity?"] }, { lens: "Credibility", questions: ["Which sources does AI cite?"] }]).filter((lens) => lens.lens !== "Unclear").map((lens) => <Card key={lens.lens} title={lens.lens} subtitle={lens.questions[0]} className="ui-card">
        <p>{lens.diagnoses != null ? <><strong>{number(lens.diagnoses)}</strong> diagnoses · <strong>{number(lens.open_recommendations)}</strong> open actions</> : "No diagnoses yet"}</p>
        {lens.examples?.[0] && <p className="muted">e.g. {lens.examples[0].intent} · {lens.examples[0].engine}: {lens.examples[0].text.slice(0, 140)}</p>}
      </Card>)}
    </div>
    <Card title="Run the monthly checks" subtitle="These also run automatically after every upload (alerts) — rerun after changing the period." className="ui-card">
      <div className="actions">
        <button disabled={!!busy} onClick={() => run("alerts")}>{busy === "alerts" ? "Checking…" : "Check for sharp drops"}</button>
        <button disabled={!!busy} onClick={() => run("insights")}>{busy === "insights" ? "Generating…" : "Generate insights for this period"}</button>
        <button className="secondary" disabled={!!busy} onClick={() => run("rules")}>{busy === "rules" ? "Diagnosing…" : "Diagnose misses (rule-based)"}</button>
        <button className="secondary" disabled={!!busy} onClick={() => run("agent")}>{busy === "agent" ? "Diagnosing…" : "Diagnose 5 misses (AI agent)"}</button>
      </div>
      {message && <p className="muted" role="status">{message}</p>}
    </Card>
    <div className="toolbar">
      <Segmented label="View" value={view} onChange={setView} options={[["alerts", "Auto alerts", alerts.length], ["insights", "Insights", others.length], ["prompts", "Prompts & answers", prompts.length]]} />
      {view !== "prompts" && <Segmented label="Status" value={filter} onChange={setFilter} options={[["open", "Awaiting review"], ["approved", "Approved"], ["rejected", "Rejected"], ["all", "All"]]} />}
    </div>
    {view === "alerts" && <Card title="Auto alerts" subtitle="Sharp score drops against the recent baseline. Approve the ones worth acting on; reject noise." className="ui-card">
      {!alerts.length ? <div className="empty">No alerts in this view.</div> : <div className="rec-list tight">{alerts.map((row) => <InsightCard key={row.id} insight={row} onChanged={load} openInsight={(item) => openDetail({ type: "insight", value: item.id })} />)}</div>}
    </Card>}
    {view === "insights" && <Card title="Insights" subtitle="Where tracked competitors beat the hotel by intent and engine (min-evidence rule applied), plus period trends." className="ui-card">
      {!others.length ? <div className="empty">No insights in this view. Click “Generate insights for this period”.</div> : <div className="rec-list tight">{others.map((row) => <InsightCard key={row.id} insight={row} onChanged={load} openInsight={(item) => openDetail({ type: "insight", value: item.id })} />)}</div>}
    </Card>}
    {view === "prompts" && <Card title="Prompt scorecard" subtitle="Every tracked prompt, weakest first. Click one to see each engine's answer and diagnose it." className="ui-card">
      <DataTable headers={["Prompt", "Intent", "Found", "Best rank", "Top competitor", "Answers", "Actions"]} onRow={(index) => openDetail({ type: "prompt", value: prompts[index] })}
        rows={prompts.map((row) => ({ key: row.prompt_id, cells: [row.prompt_text, row.intent, <span className="nowrap"><span className="meter"><span style={{ width: `${Math.round((row.found_rate || 0) * 100)}%` }} /></span> {Math.round((row.found_rate || 0) * 100)}%</span>, row.best_rank ? `#${row.best_rank}` : "–", row.top_competitor || "–", number(row.answers), number(row.recommendations)] }))} />
    </Card>}
  </>;
}

// ---------------------------------------------------------------------------
// Steps 4–5 · Recommendations → next action → outcome logging
// ---------------------------------------------------------------------------
function NextAction({ row, onDone }) {
  const [owner, setOwner] = useState(row.owner || "");
  const [due, setDue] = useState(row.due_date || "");
  const [doneOn, setDoneOn] = useState(row.done_on || new Date().toISOString().slice(0, 10));
  const [message, setMessage] = useState("");
  async function update(status) {
    try {
      await api(`/api/recommendations/${row.recommendation_id}`, jsonOptions({ status, owner: owner || null, due_date: due || null, done_on: status === "done" ? doneOn : null, reviewer: savedValue("geo.reviewer") || null }, "PUT"));
      setMessage(status === "done" ? "Marked done — before/after score is being tracked." : "Saved"); onDone?.();
    } catch (error) { setMessage(error.message); }
  }
  return <div className="next-action">
    <label>Owner<input value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="Who does it" /></label>
    <label>Due<input type="date" value={due || ""} onChange={(event) => setDue(event.target.value)} /></label>
    <button className="secondary" onClick={() => update("in_progress")}>Start</button>
    <label>Live since<input type="date" value={doneOn} onChange={(event) => setDoneOn(event.target.value)} /></label>
    <button onClick={() => update("done")}>Mark done</button>
    {message && <span className="muted">{message}</span>}
  </div>;
}

function Outcome({ row }) {
  if (!row.done_on) return null;
  const change = row.after_visibility != null && row.before_visibility != null ? row.after_visibility - row.before_visibility : null;
  return <p className="outcome">Outcome for this prompt (all engines): <strong>{number(row.before_visibility, 1)}</strong> before → <strong>{row.after_visibility == null ? "waiting for data" : number(row.after_visibility, 1)}</strong> after {date(row.done_on)}
    {change != null && <Badge tone={change > 0 ? "good" : change < 0 ? "bad" : ""}>{change > 0 ? "+" : ""}{number(change, 1)} pts</Badge>}</p>;
}

const REC_STATUSES = [["proposed", "Awaiting review"], ["approved", "Approved"], ["in_progress", "In progress"], ["done", "Done"], ["rejected", "Rejected"], ["", "All"]];

export function RecommendationsPage({ propertyId, openMeasurement, onChanged }) {
  const [all, setAll] = useState(null);
  const [outcomes, setOutcomes] = useState([]);
  const [status, setStatus] = useState("proposed");
  const [lens, setLens] = useState("");
  const [error, setError] = useState(null);
  async function load() {
    try {
      const [queue, logged] = await Promise.all([api(`/api/recommendations?${queryString({ property_id: propertyId, limit: 500 })}`), api(`/api/outcomes/${propertyId}`)]);
      setAll(queue); setOutcomes(logged); setError(null); onChanged?.();
    } catch (reason) { setError(reason); }
  }
  useEffect(() => { load(); }, [propertyId]);
  if (error) return <PageError error={error} onRetry={load} />;
  if (!all) return <Loading />;
  const byStatus = (key) => all.filter((row) => !key || row.status === key);
  const rows = byStatus(status).filter((row) => !lens || row.lens === lens);
  const lenses = [...new Set(byStatus(status).map((row) => row.lens))];
  return <>
    <div className="toolbar">
      <Segmented label="Status" value={status} onChange={setStatus} options={REC_STATUSES.map(([key, text]) => [key, text, byStatus(key).length])} />
      {lenses.length > 1 && <Segmented label="Lens" value={lens} onChange={setLens} options={[["", "All lenses"], ...lenses.map((name) => [name, name, byStatus(status).filter((row) => row.lens === name).length])]} />}
    </div>
    {!rows.length ? <Card className="ui-card"><div className="empty">{status === "proposed" ? "Nothing waiting for review. Diagnose misses from Evidence & Diagnosis to create drafts." : "Nothing in this view."}</div></Card>
      : <div className="rec-list">{rows.map((row) => {
        const [detail, evidenceCount] = splitEvidence(row.detail);
        return <article className={`rec rec-${row.priority}`} key={row.recommendation_id}>
          <div className="rec-head">
            <div>
              <div className="meta"><Badge tone="lens">{row.lens}</Badge><Badge>{row.action_type.replace("_", " ")}</Badge><Badge tone={row.priority === "high" ? "bad" : row.priority === "low" ? "" : "warn"}>{row.priority}</Badge>{status === "" && <Badge tone={statusTone(row.status)}>{row.status.replace("_", " ")}</Badge>}</div>
              <h3>{row.title}</h3>
              <p className="rec-context">{row.intent} · {row.engine} · {date(row.measured_at)}{row.owner ? ` · owner ${row.owner}` : ""}{row.due_date ? ` · due ${date(row.due_date)}` : ""}</p>
            </div>
            <button className="secondary small" onClick={() => openMeasurement?.(row.measurement_id)}>Open answer</button>
          </div>
          <p>{detail}</p>
          <p className="muted">{row.expected_impact && <>Expected impact: {row.expected_impact}</>}{evidenceCount ? ` · based on ${evidenceCount} cited source${evidenceCount > 1 ? "s" : ""}` : ""}</p>
          <details><summary>Why: {(row.diagnosis_type || "–").replace("_", " ")} · severity {row.severity || "–"} · confidence {row.diagnosis_confidence ?? "–"} · by {row.generated_by || "–"}</summary><p className="muted">Prompt: {row.prompt_text}</p><p className="pre">{row.root_cause}</p></details>
          <Outcome row={row} />
          {["proposed", "rejected"].includes(row.status) && <ReviewBar target="recommendation" id={row.recommendation_id} status={row.status} onDone={load}
            current={{ title: row.title, detail, priority: row.priority, action_type: row.action_type }}
            editFields={[["title", "Title", "input"], ["detail", "Detail", "textarea"], ["priority", "Priority", "select", ["high", "medium", "low"]], ["action_type", "Action type", "select", ["content", "technical", "pr_outreach", "listing", "other"]]]} />}
          {["approved", "in_progress"].includes(row.status) && <NextAction row={row} onDone={load} />}
        </article>;
      })}</div>}
    <Card title="Outcome log" subtitle="Before/after Visibility Score for the prompt behind each completed recommendation (Rankscale detection, all engines, equal windows either side of the go-live date)." className="ui-card">
      <DataTable headers={["Recommendation", "Intent", "Live since", "Before", "After", "Change", "Intent before → after", "State"]} empty="No completed recommendations yet"
        rows={outcomes.map((row) => ({ key: row.recommendation_id, cells: [row.title, row.intent, date(row.done_on), number(row.before_visibility, 1), row.after_visibility == null ? "–" : number(row.after_visibility, 1),
          row.change_points == null ? "–" : <Badge tone={row.change_points > 0 ? "good" : row.change_points < 0 ? "bad" : ""}>{row.change_points > 0 ? "+" : ""}{number(row.change_points, 1)}</Badge>,
          `${number(row.intent_before_visibility, 1)} → ${row.intent_after_visibility == null ? "–" : number(row.intent_after_visibility, 1)}`, row.state] }))} />
    </Card>
  </>;
}

export function PromptGenerationPage({ propertyId }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState("");
  const [status, setStatus] = useState("candidate");
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState(() => new Set());

  async function loadCandidates(nextStatus = status) {
    setError(null);
    try {
      const candidates = await api(`/api/prompt-generation/candidates?${queryString({ property_id: propertyId, status: nextStatus })}`);
      setRows(candidates);
      setSelected(new Set());
    } catch (reason) { setError(reason); }
  }

  useEffect(() => { setRows(null); loadCandidates(status); }, [propertyId, status]);

  async function generate() {
    setBusy(true); setMessage(""); setError(null);
    try {
      const result = await api("/api/prompt-generation/run", jsonOptions({ property_id: propertyId, focus: focus.trim() || null, created_by: savedValue("geo.reviewer") || null }));
      setStatus("candidate");
      await loadCandidates("candidate");
      setMessage(`${result.saved ?? result.summary?.kept ?? 0} prompts ready for review.`);
    }
    catch (reason) { setError(reason); }
    finally { setBusy(false); }
  }

  async function setSelectedStatus(nextStatus) {
    if (!selected.size) return;
    setBusy(true); setError(null); setMessage("");
    try {
      const result = await api("/api/prompt-generation/status", jsonOptions({ prompt_ids: [...selected], status: nextStatus }));
      setMessage(`${result.updated} prompt${result.updated === 1 ? "" : "s"} ${nextStatus}.`);
      await loadCandidates();
    } catch (reason) { setError(reason); }
    finally { setBusy(false); }
  }

  function toggleSelected(id) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const allSelected = !!rows?.length && selected.size === rows.length;
  return <>
    <Card title="Prompt generation" subtitle="Generate candidate prompts, review them, and export approved prompts for Rankscale." className="ui-card">
      <div className="prompt-generation-form">
        <label className="prompt-focus-field">What should the prompts focus on? <span>Required</span>
          <textarea rows={3} maxLength={1000} required value={focus} onChange={(event) => setFocus(event.target.value)}
            placeholder="For example: accessible beach weddings, family stays during school holidays, or dining experiences for anniversary trips." />
        </label>
        <div className="prompt-generation-actions">
          <button disabled={busy || !focus.trim()} onClick={generate}>{busy ? "Generating…" : "Run prompt generation"}</button>
          <span className="muted">Enter a focus first. Prompts are generated only when you click the button.</span>
        </div>
      </div>
      {message && <p className="muted" role="status">{message}</p>}
      {error && <PageError error={error} onRetry={() => loadCandidates()} />}
    </Card>

    <Card title="Prompt review" subtitle="Review each candidate and approve prompts that should be added to Rankscale." className="ui-card">
      <div className="prompt-review-controls">
        <div className="prompt-review-filters">
          <Segmented label="Prompt status" value={status} onChange={setStatus} options={[
          ["candidate", "Needs review", status === "candidate" ? rows?.length : undefined],
          ["approved", "Approved"], ["rejected", "Rejected"], ["exported", "Exported"],
          ]} />
        </div>
        <div className="prompt-review-actions">
        <button className="secondary" disabled={status !== "candidate" || !rows?.length || busy} onClick={() => setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.id)))}>
          {allSelected ? "Clear selection" : "Select all"}
        </button>
        {status === "candidate" && <>
          <button disabled={!selected.size || busy} onClick={() => setSelectedStatus("approved")}>Approve selected ({selected.size})</button>
          <button className="secondary" disabled={!selected.size || busy} onClick={() => setSelectedStatus("rejected")}>Reject selected</button>
        </>}
        {status === "approved" && rows?.length > 0 && <a className="primary-btn" href={`/api/prompt-generation/export.csv?${queryString({ property_id: propertyId })}`}>Export approved for Rankscale</a>}
        </div>
      </div>
      {!rows ? <Loading /> : <DataTable className="prompt-review-table" headers={["Select", "Prompt", "Intent", "Type", "Persona", "Quality", "Rationale"]}
        empty={status === "candidate" ? "No prompts waiting for review. Run prompt generation to create candidates." : `No ${status} prompts.`}
        rows={rows.map((row) => ({ key: row.id, cells: [
          <input type="checkbox" aria-label={`Select prompt: ${row.prompt_text}`} checked={selected.has(row.id)} disabled={status !== "candidate" || busy} onChange={() => toggleSelected(row.id)} />,
          row.prompt_text, row.intent, row.prompt_type || "–", row.persona || "–", row.quality_score == null ? "–" : number(row.quality_score, 2), row.rationale || "–",
        ] }))} />}
    </Card>
  </>;
}

// ---------------------------------------------------------------------------
// Drawer: prompt → answers → one measurement (answer, brands, evidence, diagnosis)
// ---------------------------------------------------------------------------
function MeasurementView({ id, openMeasurement }) {
  const [m, setM] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const load = () => api(`/api/measurements/${id}`).then(setM).catch(setError);
  useEffect(() => { setM(null); load(); }, [id]);
  async function diagnose(mode) {
    setBusy(mode); setMessage("");
    try {
      const result = await api("/api/diagnoses/run", jsonOptions({ measurement_id: id, mode }));
      setMessage(result.output.diagnosis_needed ? `Draft saved with ${result.recommendation_ids?.length || 0} recommendation(s). Rule check: ${result.rule_check.reason}.${result.corrections_used ? ` Used ${result.corrections_used} past reviewer corrections.` : ""}` : `Nothing to fix: ${result.output.summary}`);
      load();
    } catch (reason) { setMessage(reason.message); }
    finally { setBusy(""); }
  }
  if (error) return <PageError error={error} />;
  if (!m) return <Loading />;
  return <>
    <h3>{m.prompt_text}</h3>
    <p className="muted">{m.engine} · {dateTime(m.measured_at)} · {m.intent}</p>
    <div className="meta">{m.brand_found_any_alias ? <Badge tone="good">Hotel found{m.own_brand_rank ? ` at #${m.own_brand_rank}` : ""}</Badge> : <Badge tone="bad">Hotel not mentioned</Badge>}
      {m.brand_found_any_alias && !m.brand_found && <Badge tone="warn">Rankscale missed it ({m.own_brand_name_mentioned || "other name"})</Badge>}</div>
    <div className="actions"><button disabled={!!busy} onClick={() => diagnose("agent")}>{busy === "agent" ? "Diagnosing…" : m.diagnoses.length ? "Diagnose again (AI agent)" : "Diagnose with agent"}</button>
      <button className="secondary" disabled={!!busy} onClick={() => diagnose("rules")}>{busy === "rules" ? "Diagnosing…" : "Rule-based diagnosis"}</button></div>
    {message && <p className="muted" role="status">{message}</p>}
    {m.diagnoses.map((d) => <article className="rec" key={d.id}>
      <div className="meta"><Badge>{LENS[d.diagnosis_type] || "Unclear"}</Badge><Badge>{d.diagnosis_type}</Badge><Badge>severity {d.severity}</Badge><Badge tone={statusTone(d.status)}>{d.status}</Badge><span className="muted">by {d.generated_by} · {date(d.created_at)}</span></div>
      <p className="pre">{d.root_cause}</p>
      <ReviewBar target="diagnosis" id={d.id} status={d.status} onDone={load} current={{ diagnosis_type: d.diagnosis_type, severity: d.severity, root_cause: d.root_cause }}
        editFields={[["diagnosis_type", "Cause", "select", ["content_gap", "citation_gap", "entity_confusion", "negative_sentiment", "competitor_dominance", "other"]], ["severity", "Severity", "select", ["high", "medium", "low"]], ["root_cause", "Root cause", "textarea"]]} />
    </article>)}
    {m.recommendations.length > 0 && <><h4>Recommendations</h4><ul>{m.recommendations.map((r) => <li key={r.id}><Badge tone={statusTone(r.status)}>{r.status}</Badge> {r.title}</li>)}</ul></>}
    <h4>Brands ranked ({m.mentions.length})</h4>
    <DataTable headers={["#", "Brand", "Sentiment", "Described as"]} rows={m.mentions.map((x) => ({ className: x.is_own_brand ? "self-row" : "", cells: [x.rank, `${x.brand_name_raw}${x.is_own_brand ? " (hotel)" : ""}`, x.sentiment == null ? "–" : number(x.sentiment, 2), (x.positive_keywords || []).join(", ")] }))} />
    <h4>Answer</h4>
    <div className="answer">{(m.response_text || "").replaceAll("\\n", "\n")}</div>
    <h4>Evidence ({m.evidence.length} sources)</h4>
    <DataTable headers={["Domain", "Cited for", "Confidence", "Status"]} rows={m.evidence.map((e) => ({ key: e.id, cells: [<a href={e.url} target="_blank" rel="noreferrer">{e.domain || e.url}</a>, e.competitor || e.attributed_to.replace("_", " "), `${number(e.confidence_score, 2)} ${e.confidence_level}`, e.verification_status] }))} />
  </>;
}

function PromptView({ prompt, openMeasurement }) {
  const [answers, setAnswers] = useState(null);
  useEffect(() => { api(`/api/prompts/${prompt.prompt_id}/answers`).then(setAnswers); }, [prompt.prompt_id]);
  return <>
    <h3>{prompt.prompt_text}</h3>
    <p className="muted">{prompt.intent} · found in {Math.round((prompt.found_rate || 0) * 100)}% of {prompt.answers} answers</p>
    {!answers ? <Loading /> : <DataTable headers={["Date", "Engine", "Hotel found", "Rank", "Brands"]} onRow={(index) => openMeasurement(answers[index].measurement_id)}
      rows={answers.map((a) => ({ key: a.measurement_id, cells: [dateTime(a.measured_at), a.engine, a.brand_found_any_alias ? <Badge tone="good">{a.brand_found ? "yes" : "yes (other name)"}</Badge> : <Badge tone="bad">no</Badge>, a.own_brand_rank ? `#${a.own_brand_rank}` : "–", number(a.brands_total)] }))} />}
  </>;
}

function InsightView({ id, openMeasurement }) {
  const [pack, setPack] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { api(`/api/insights/item/${id}/evidence`).then(setPack).catch(setError); }, [id]);
  if (error) return <PageError error={error} />;
  if (!pack) return <Loading />;
  const mt = pack.metrics || {};
  return <>
    <h3>{pack.insight.title}</h3>
    <p>{pack.insight.summary}</p>
    <p className="muted">{date(pack.insight.period_start)} – {date(pack.insight.period_end)} · {number(pack.measurement_count)} answers{mt.baseline != null ? ` · baseline ${mt.baseline} → ${mt.current}` : ""}</p>
    <h4>By engine</h4>
    <DataTable headers={["Engine", "Answers", "Detection", "Visibility"]} rows={pack.engine_breakdown.map((r) => ({ cells: [r.name, number(r.answers), `${number(r.detection, 1)}%`, number(r.visibility, 2)] }))} />
    <h4>Tracked competitors</h4>
    <DataTable headers={["Competitor", "Detection", "Visibility"]} rows={pack.competitors.map((r) => ({ cells: [r.display_name || r.name, `${number(r.detection, 1)}%`, number(r.visibility, 2)] }))} />
    <h4>Most cited sources</h4>
    <DataTable headers={["Domain", "Type", "Citations", "For hotel", "For rivals"]} rows={pack.citations.slice(0, 12).map((r) => ({ cells: [r.domain, r.source_type, number(r.count), number(r.for_hotel), number(r.for_competitors)] }))} />
    <h4>Answers behind it (misses first){pack.measurements_truncated ? ` · first ${pack.measurements_returned}` : ""}</h4>
    <DataTable headers={["Prompt", "Engine", "Found", "Rank", "Date"]} onRow={(index) => openMeasurement(pack.relevant_measurements[index].measurement_id)}
      rows={pack.relevant_measurements.slice(0, 60).map((r) => ({ key: r.measurement_id, cells: [r.prompt, r.engine, r.detected ? <Badge tone="good">yes</Badge> : <Badge tone="bad">no</Badge>, r.position ? `#${r.position}` : "–", date(r.measured_at)] }))} />
  </>;
}

export function DetailDrawer({ item, onClose }) {
  const [stack, setStack] = useState([item]);
  useEffect(() => { setStack([item]); }, [item]);
  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey); return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const top = stack[stack.length - 1];
  const openMeasurement = (id) => setStack([...stack, { type: "measurement", value: id }]);
  const title = top.type === "measurement" ? "AI answer" : top.type === "prompt" ? "Prompt answers" : "Insight evidence";
  return <Drawer title={title} onClose={onClose}>
    {stack.length > 1 && <button className="secondary back-btn" onClick={() => setStack(stack.slice(0, -1))}>← Back</button>}
    {top.type === "measurement" && <MeasurementView id={top.value} openMeasurement={openMeasurement} />}
    {top.type === "prompt" && <PromptView prompt={top.value} openMeasurement={openMeasurement} />}
    {top.type === "insight" && <InsightView id={top.value} openMeasurement={openMeasurement} />}
  </Drawer>;
}

// ---------------------------------------------------------------------------
// Learning memory + agent versions (shown on Settings)
// ---------------------------------------------------------------------------
export function LearningMemoryCard({ propertyId }) {
  const [rows, setRows] = useState(null);
  const [versions, setVersions] = useState([]);
  const load = () => Promise.all([api(`/api/learning-memory/${propertyId}`), api("/api/agent-versions")]).then(([memory, agentVersions]) => { setRows(memory); setVersions(agentVersions); }).catch(() => setRows([]));
  useEffect(() => { load(); }, [propertyId]);
  async function toggle(row) { await api(`/api/learning-memory/item/${row.id}`, jsonOptions({ feeds_agent: !row.feeds_agent }, "PUT")); load(); }
  const show = (value) => Object.entries(value || {}).map(([key, v]) => `${key}: ${String(v).slice(0, 80)}`).join(" · ") || "–";
  return <>
    <Card title="Learning memory" subtitle="What reviewers changed, at which step, and why. Corrections marked ‘feeds agents’ are passed to the diagnosis agent on its next run." className="ui-card">
      {!rows ? <Loading /> : <DataTable headers={["When", "Step", "Action", "Before", "After", "Why", "By", "Feeds agents"]} empty="No corrections yet — edits and reasoned rejections appear here."
        rows={rows.map((row) => ({ key: row.id, cells: [dateTime(row.created_at), row.step, row.action, show(row.before), show(row.after), row.reason || "–", row.reviewer || "–", <button className="secondary" onClick={() => toggle(row)}>{row.feeds_agent ? "Yes" : "No"}</button>] }))} />}
    </Card>
    <Card title="Agent versions" subtitle="Every distinct prompt or rule text an agent has run with; a new version is recorded automatically when it changes." className="ui-card">
      <DataTable headers={["Step", "Version", "Model", "First used", "Diagnoses"]} empty="No agent runs yet"
        rows={versions.map((row) => ({ key: row.id, cells: [row.step, <code title={row.preview}>{row.prompt_hash.slice(0, 10)}</code>, row.model || "–", dateTime(row.created_at), number(row.diagnoses)] }))} />
    </Card>
  </>;
}
