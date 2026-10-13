import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../api/client";
import "./opportunities.css";

const LEVELS = ["high", "medium", "low"];
const FIELDS = [
  ["commercial_importance", "Commercial importance"],
  ["strategic_relevance", "Strategic relevance"],
  ["feasibility", "Feasibility of improvement"],
];

function pct(v) {
  return v == null ? "n/a" : `${Number(v).toFixed(1)}`;
}

export function PriorityForm({ item, account, propertyId, onSaved, onCancel }) {
  const p = item.commercial.priority || {};
  const [form, setForm] = useState({
    commercial_importance: p.commercial_importance || "",
    strategic_relevance: p.strategic_relevance || "",
    feasibility: p.feasibility || "",
    revenue_potential: p.revenue_potential ?? "",
    revenue_currency: p.revenue_currency || "",
    revenue_basis: p.revenue_basis || "",
    confirmation_status: p.confirmation_status || "proposed",
    evidence_source: p.evidence_source || "",
    notes: p.notes || "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const body = { user_id: account?.id, confirmation_status: form.confirmation_status };
    for (const [k] of FIELDS) body[k] = form[k] || null;
    body.revenue_potential = form.revenue_potential === "" ? null : Number(form.revenue_potential);
    body.revenue_currency = form.revenue_currency || null;
    body.revenue_basis = form.revenue_basis || null;
    body.evidence_source = form.evidence_source || null;
    body.notes = form.notes || null;
    try {
      await apiFetch(`/api/opportunities/${propertyId}/priorities/${item.intent_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="opp-form" onSubmit={submit}>
      <h4>Hotel business priority: {item.intent}</h4>
      <p className="opp-note">Enter only what the hotel has told us. Leave a field blank if unknown. Recorded by {account?.name || "unknown user"}.</p>
      <div className="opp-grid">
        {FIELDS.map(([k, label]) => (
          <label key={k}>{label}
            <select value={form[k]} onChange={set(k)}>
              <option value="">Not provided</option>
              {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        ))}
        <label>Estimated revenue potential (optional)
          <input type="number" min="0" value={form.revenue_potential} onChange={set("revenue_potential")} />
        </label>
        <label>Currency
          <input value={form.revenue_currency} onChange={set("revenue_currency")} placeholder="e.g. AUD" />
        </label>
        <label>Revenue basis
          <input value={form.revenue_basis} onChange={set("revenue_basis")} placeholder="how it was calculated" />
        </label>
        <label>Status
          <select value={form.confirmation_status} onChange={set("confirmation_status")}>
            <option value="not_provided">Not provided</option>
            <option value="proposed">Proposed (awaiting client confirmation)</option>
            <option value="confirmed">Confirmed by hotel</option>
          </select>
        </label>
        <label className="opp-wide">Evidence source (required to confirm)
          <input value={form.evidence_source} onChange={set("evidence_source")} placeholder="who confirmed it and where it is documented" />
        </label>
        <label className="opp-wide">Notes
          <textarea rows="2" value={form.notes} onChange={set("notes")} />
        </label>
      </div>
      {error && <p className="opp-error" role="alert">{error}</p>}
      <div className="opp-actions">
        <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save priority"}</button>
        <button type="button" className="opp-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function OpportunityCard({ item, onEdit }) {
  const v = item.visibility;
  const c = item.commercial;
  const validated = c.status === "Commercially validated";
  return (
    <article className={`opp-card ${v.status}`}>
      <header>
        <h3>{item.intent}</h3>
        <span className={`opp-badge ${validated ? "ok" : "warn"}`}>{c.status}</span>
        {c.rank && <span className="opp-badge rank">Priority #{c.rank}</span>}
      </header>

      <section>
        <h4>AI visibility gap <small>verified RankScale finding</small></h4>
        <p>{v.finding}</p>
        <p className="opp-meta">
          Hotel visibility {pct(v.hotel_visibility)} · best competitor {v.top_competitor || "n/a"} {pct(v.top_competitor_visibility)} ·
          gap {pct(v.gap_points)} pts · {v.answers} neutral answers
        </p>
      </section>

      <section>
        <h4>Competitor evidence</h4>
        <table>
          <thead><tr><th>Brand</th><th>Visibility</th><th>Detection %</th></tr></thead>
          <tbody>
            {item.competitor_evidence.map((x) => (
              <tr key={x.name}><td>{x.name}</td><td>{pct(x.visibility)}</td><td>{pct(x.detection)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h4>Commercial priority <small>hotel-confirmed inputs only</small></h4>
        {c.priority ? (
          <p className="opp-meta">
            Importance {c.priority.commercial_importance || "—"} · relevance {c.priority.strategic_relevance || "—"} ·
            feasibility {c.priority.feasibility || "—"}
            {c.priority.revenue_potential != null && ` · revenue ${c.priority.revenue_potential} ${c.priority.revenue_currency} (${c.priority.revenue_basis})`}
            {c.priority.evidence_source && ` · source: ${c.priority.evidence_source}`}
          </p>
        ) : <p className="opp-meta">No business priority recorded.</p>}
        {c.missing.length > 0 && <p className="opp-missing">Missing: {c.missing.join(", ")}</p>}
      </section>

      <section>
        <h4>Recommended GEO action <small>potential improvement, not a validated priority</small></h4>
        <p>{item.proposed_action ? item.proposed_action.text : "No action proposed. No visibility gap detected."}</p>
        <p className="opp-meta">{item.rationale}</p>
      </section>

      <details>
        <summary>Supporting evidence</summary>
        <p className="opp-meta">
          Measurements {item.evidence.period.first_measurement?.slice(0, 10)} to {item.evidence.period.last_measurement?.slice(0, 10)}
        </p>
        <p className="opp-meta">Engines: {(item.evidence.engines || []).map((e) => `${e.engine} ${pct(e.detection)}% detection (${e.answers} answers)`).join(" · ") || "n/a"}</p>
        {(item.evidence.weakest_prompts || []).length > 0 && (
          <ul>{item.evidence.weakest_prompts.map((w, i) => <li key={i}>{w.prompt || w.text || JSON.stringify(w)}</li>)}</ul>
        )}
      </details>

      <button type="button" className="opp-edit" onClick={() => onEdit(item)}>
        {c.priority ? "Update business priority" : "Record business priority"}
      </button>
    </article>
  );
}

export function OpportunityAssessment({ client, account, period }) {
  const propertyId = String(client.id);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const q = period?.from && period?.to ? `&date_from=${period.from}&date_to=${period.to}` : "";
      setData(await apiFetch(`/api/opportunities/${propertyId}?save=true${q}`));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [propertyId, period?.from, period?.to]);

  useEffect(() => { load(); }, [load]);

  const items = data?.opportunities || [];
  const pending = items.filter((i) => i.commercial.status !== "Commercially validated").length;

  return (
    <section className="opp-root" aria-label="Opportunity assessment">
      <h2>Opportunity assessment</h2>
      <p className="opp-note">
        Visibility gaps are measured from RankScale data. Commercial priority is shown only where the hotel has confirmed it;
        otherwise the opportunity is marked “Commercial validation required” and is not ranked.
      </p>
      {loading && <p>Loading opportunities…</p>}
      {error && <p className="opp-error" role="alert">{error}</p>}
      {data && (
        <>
          <p className="opp-meta">
            Period {data.period.from} to {data.period.to} · {items.length} intents · {pending} awaiting commercial validation
          </p>
          {editing && (
            <PriorityForm item={editing} account={account} propertyId={propertyId}
              onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
          )}
          <div className="opp-list">
            {items.map((i) => <OpportunityCard key={i.intent_id} item={i} onEdit={setEditing} />)}
          </div>
        </>
      )}
    </section>
  );
}
