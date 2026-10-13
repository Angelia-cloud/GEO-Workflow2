import { useEffect, useState } from "react";
import { apiFetch } from "../../api/client";
import "./monthly.css";

const f = (v, d = 1) => (v == null ? "n/a" : Number(v).toFixed(d));
const sign = (v) => (v == null ? "n/a" : `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}`);

function monthBounds(m) {
  const [y, n] = m.split("-").map(Number);
  const last = new Date(Date.UTC(y, n, 0)).getUTCDate();
  return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, "0")}` };
}

function GroupTable({ title, rows }) {
  return (
    <div>
      <h4>{title}</h4>
      <table>
        <thead><tr><th>Name</th><th>Answers</th><th>Detection %</th><th>Visibility</th><th>Avg position</th><th>Top 3 %</th><th>Sentiment</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.name}><td>{r.name}</td><td>{r.answers}</td><td>{f(r.detection)}</td><td>{f(r.visibility)}</td><td>{f(r.position)}</td><td>{f(r.top3)}</td><td>{f(r.sentiment, 0)}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export function MonthlyDashboard({ client, onMonthChange }) {
  const id = String(client.id);
  const [months, setMonths] = useState([]);
  const [month, setMonth] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let live = true;
    apiFetch(`/api/monthly/${id}/months`).then((r) => {
      if (!live) return;
      setMonths(r.months);
      setMonth((cur) => cur || r.months[r.months.length - 1]?.month || "");
    }).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [id]);

  useEffect(() => {
    if (!month) return;
    let live = true;
    setLoading(true);
    setError("");
    apiFetch(`/api/monthly/${id}/${month}`).then((r) => {
      if (!live) return;
      setData(r);
      onMonthChange?.({ month, label: r.label, partial: r.coverage.partial, ...monthBounds(month) });
    }).catch((e) => live && setError(e.message)).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [id, month]);

  const cmp = data?.comparison;
  const trendNames = data ? [...new Set(data.competitor_trend.flatMap((m) => m.competitors.map((c) => c.name)))] : [];
  return (
    <section className="mon-root" aria-label="Monthly data">
      <h2>Monthly data</h2>
      <p className="mon-note">Months follow Australia/Sydney dates of each measurement. All figures come from stored Supabase measurements.</p>
      <label>Month{" "}
        <select value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => <option key={m.month} value={m.month}>{m.label}{m.partial ? " (partial)" : ""}</option>)}
        </select>
      </label>
      {loading && <p>Loading…</p>}
      {error && <p className="mon-error" role="alert">{error}</p>}
      {data && !loading && (
        <>
          {data.coverage.partial && <p className="mon-partial">Partial month: data covers {data.coverage.first_day} to {data.coverage.last_day} ({data.coverage.days_with_data} days).</p>}
          <div className="mon-cards">
            {[["Detection rate", data.overall.detection, "%"], ["Visibility score", data.overall.visibility, ""], ["Average position", data.overall.position, ""], ["Top 3 visibility", data.overall.top3, "%"], ["Sentiment", data.overall.sentiment, ""]].map(([l, v, u]) => (
              <div key={l} className="mon-card"><span>{l}</span><strong>{f(v)}{u}</strong></div>
            ))}
            <div className="mon-card"><span>Answers</span><strong>{data.overall.answers}</strong></div>
          </div>
          <h3>Month-over-month</h3>
          {cmp.available ? (
            <>
              <p className="mon-note">vs {cmp.previous_month} ({cmp.basis.replace("_", " ")}{cmp.window ? `, ${cmp.window}` : ""})</p>
              <p>{Object.entries(cmp.metrics).map(([k, v]) => `${k} ${sign(v.change)}`).join(" · ")}</p>
              <ul>{[...cmp.engines, ...cmp.intents].filter((c) => c.status !== "stable").map((c) => (
                <li key={c.name}>{c.name}: {c.status} ({sign(c.change)} visibility pts)</li>
              ))}</ul>
            </>
          ) : <p className="mon-note">{cmp.reason}</p>}
          <GroupTable title="By AI engine" rows={data.engines} />
          <GroupTable title="By search intent" rows={data.intents} />
          <h3>Diagnosis findings</h3>
          {data.findings.diagnoses.length === 0 && data.findings.insights.length === 0
            ? <p className="mon-note">No stored diagnoses for this month yet. They are generated after an import.</p>
            : (
              <ul>
                {data.findings.insights.slice(0, 8).map((i) => <li key={i.id}><strong>{i.title}</strong>{i.finding ? `: ${i.finding}` : ""}</li>)}
                {data.findings.diagnoses.slice(0, 8).map((d) => <li key={d.id}>{d.intent} · {d.engine}: {d.root_cause} <small>({d.diagnosis_type}, {d.evidence_rows} evidence rows)</small></li>)}
              </ul>
            )}
          <h3>Recommendations <small>potential GEO improvements, not validated commercial priorities</small></h3>
          {data.findings.recommendations.length === 0 ? <p className="mon-note">No recommendations stored for this month.</p> : (
            <ul>{data.findings.recommendations.slice(0, 10).map((r) => (
              <li key={r.id}><strong>{r.title}</strong> — {r.intent} · {r.engine} <small>({r.status}; {r.evidence_rows} evidence rows)</small></li>
            ))}</ul>
          )}
          <h3>Competitor visibility by month <small>neutral prompts, same definition each month</small></h3>
          <table>
            <thead><tr><th>Brand</th>{data.competitor_trend.map((m) => <th key={m.month}>{m.month}{m.partial ? " (partial)" : ""}</th>)}</tr></thead>
            <tbody>{trendNames.map((n) => (
              <tr key={n}><td>{n}</td>{data.competitor_trend.map((m) => {
                const c = m.competitors.find((x) => x.name === n);
                return <td key={m.month}>{c ? f(c.visibility) : "—"}</td>;
              })}</tr>
            ))}</tbody>
          </table>
        </>
      )}
    </section>
  );
}
