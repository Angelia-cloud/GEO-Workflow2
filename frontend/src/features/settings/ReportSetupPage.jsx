import { useEffect, useId, useMemo, useState } from "react";
import { apiFetch, jsonBody } from "../../api/client";
import "./report-setup.css";

/**
 * Settings → Report setup: what the report needs to know about the selected client's hotel that the
 * Rankscale export doesn't say — its other names, the words that mark a question as naming it, its own
 * websites, the comparison hotels and the baseline. Suggestions come from the client's own answers.
 */
const lines = (text) => [...new Set(String(text || "").split(/\n|;/).map((x) => x.trim()).filter(Boolean))];
const joinLines = (list) => (list || []).join("\n");
const notIn = (items, names) => {
  const taken = new Set(names.map((n) => n.replace(/\*$/, "").trim().toLowerCase()));
  return (items || []).filter((item) => !taken.has(item.name.trim().toLowerCase()));
};
const emptyCompetitor = () => ({ key: Math.random().toString(36).slice(2), name: "", displayName: "", aliases: "" });

function toForm(setup) {
  return {
    shortName: setup.shortName || "",
    aliases: joinLines(setup.aliases),
    namedTerms: joinLines(setup.namedTerms),
    ownDomains: joinLines(setup.ownDomains),
    ignoredNames: joinLines(setup.ignoredNames),
    competitors: (setup.competitors || []).map((c) => ({ ...emptyCompetitor(), name: c.name, displayName: c.displayName, aliases: joinLines(c.aliases) })),
    baselineOn: !!setup.baseline,
    baseline: {
      label: setup.baseline?.label || "Baseline",
      asOf: setup.baseline?.asOf || "",
      detection: setup.baseline?.detection ?? "",
      visibility: setup.baseline?.visibility ?? "",
    },
  };
}

function toPayload(form) {
  return {
    shortName: form.shortName.trim(),
    aliases: lines(form.aliases),
    namedTerms: lines(form.namedTerms),
    ownDomains: lines(form.ownDomains),
    ignoredNames: lines(form.ignoredNames),
    competitors: form.competitors
      .filter((c) => c.name.trim() || c.displayName.trim() || c.aliases.trim())
      .map((c) => ({ name: c.name.trim() || c.displayName.trim(), displayName: c.displayName.trim(), aliases: lines(c.aliases) })),
    baseline: form.baselineOn
      ? {
          label: form.baseline.label.trim() || "Baseline",
          asOf: form.baseline.asOf || null,
          detection: form.baseline.detection === "" ? null : Number(form.baseline.detection),
          visibility: form.baseline.visibility === "" ? null : Number(form.baseline.visibility),
        }
      : null,
  };
}

function Field({ label, hint, children, id }) {
  return (
    <div className="rsu-field">
      <label htmlFor={id}>{label}</label>
      {hint && <p className="rsu-hint">{hint}</p>}
      {children}
    </div>
  );
}

function Suggestions({ title, items, onAdd }) {
  if (!items?.length) return null;
  return (
    <div className="rsu-suggestions">
      <span className="rsu-suggestions-title">{title}</span>
      <div className="rsu-chips">
        {items.map((item) => (
          <button type="button" key={item.name} className="rsu-chip" onClick={() => onAdd(item.name)} title={`Add ${item.name}`}>
            <span aria-hidden="true">+</span> {item.name} <span className="rsu-chip-count">{item.answers.toLocaleString("en-AU")} answers</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ReportSetupPage({ client }) {
  const uid = useId();
  const [setup, setSetup] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    setSetup(null);
    setForm(null);
    setError("");
    setNotice("");
    if (!client?.id) return undefined;
    apiFetch(`/api/clients/${encodeURIComponent(client.id)}/report-setup`)
      .then((data) => {
        if (!live) return;
        setSetup(data);
        setForm(toForm(data));
      })
      .catch((failure) => live && setError(failure.message || "The report setup could not be loaded."));
    return () => {
      live = false;
    };
  }, [client?.id]);

  const dirty = useMemo(() => setup && form && JSON.stringify(toPayload(form)) !== JSON.stringify(toPayload(toForm(setup))), [setup, form]);
  const update = (patch) => {
    setForm((current) => ({ ...current, ...patch }));
    setNotice("");
  };
  const updateCompetitor = (key, patch) => update({ competitors: form.competitors.map((c) => (c.key === key ? { ...c, ...patch } : c)) });
  const addLine = (field, value) => update({ [field]: joinLines(lines(`${form[field]}\n${value}`)) });

  async function save(event) {
    event.preventDefault();
    const payload = toPayload(form);
    // an untouched baseline is kept exactly as saved (including baselines back-calculated from a report)
    payload.baselineUnchanged = JSON.stringify(payload.baseline) === JSON.stringify(toPayload(toForm(setup)).baseline);
    if (payload.baseline && (payload.baseline.detection == null || Number.isNaN(payload.baseline.detection))) {
      setError("Enter the baseline detection rate, or turn the baseline off.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = await apiFetch(`/api/clients/${encodeURIComponent(client.id)}/report-setup`, jsonBody(payload, "PUT"));
      setSetup(saved);
      setForm(toForm(saved));
      setNotice("Saved. The report now uses this setup; answers already imported were updated.");
    } catch (failure) {
      setError(failure.message || "The report setup could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (!client?.id) {
    return (
      <section className="rsu-page">
        <h1>Report setup</h1>
        <p className="rsu-lead">Choose a client in the top bar to set up its report.</p>
      </section>
    );
  }

  return (
    <section className="rsu-page" aria-labelledby={`${uid}-title`}>
      <header className="rsu-header">
        <h1 id={`${uid}-title`}>Report setup</h1>
        <p className="rsu-lead">
          How the report recognises <strong>{client.name}</strong> in AI answers, which questions count for the comparison and which hotels it is
          compared with.
        </p>
      </header>
      {!form && !error && <p role="status" className="rsu-hint">Loading the report setup…</p>}
      {error && !form && (
        <p className="guided-alert" role="alert">
          {error}
        </p>
      )}
      {form && (
        <form onSubmit={save} noValidate>
          <div className="rsu-card">
            <h2>The hotel’s names</h2>
            <p className="rsu-hint">An answer mentions the hotel when it uses any of these names. Add outlets (restaurant, spa, bar) and former names.</p>
            <div className="rsu-grid">
              <Field id={`${uid}-short`} label="Name in report sentences" hint={`Leave empty to use “${setup.property}” without brand and city words.`}>
                <input id={`${uid}-short`} value={form.shortName} maxLength={80} onChange={(e) => update({ shortName: e.target.value })} placeholder="e.g. Coogee Beach" />
              </Field>
              <Field id={`${uid}-aliases`} label="Names AI answers use for the hotel" hint="One per line. End a name with * to match anything that starts with it.">
                <textarea id={`${uid}-aliases`} rows={6} value={form.aliases} onChange={(e) => update({ aliases: e.target.value })} />
              </Field>
            </div>
            <Suggestions
              title="Names Rankscale matched to this hotel"
              items={notIn(setup.suggestions?.aliases, lines(form.aliases))}
              onAdd={(name) => addLine("aliases", name)}
            />
          </div>

          <div className="rsu-card">
            <h2>Questions that name the hotel</h2>
            <p className="rsu-hint">
              A question that contains one of the hotel’s names, or one of these words, naturally favours the hotel. It is still tracked, but left out of
              the comparison with other hotels.
            </p>
            <Field id={`${uid}-terms`} label="Other words that name the hotel" hint="One per line, at least 3 characters: suburb, venue, landmark, outlet.">
              <textarea id={`${uid}-terms`} rows={4} value={form.namedTerms} onChange={(e) => update({ namedTerms: e.target.value })} />
            </Field>
            <p className="rsu-stat">
              <strong>{setup.questions.neutral}</strong> of {setup.questions.total} tracked questions are used for the comparison.
            </p>
            {setup.questions.naming.length > 0 && (
              <details className="rsu-details">
                <summary>Questions left out ({setup.questions.naming.length})</summary>
                <ul>
                  {setup.questions.naming.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <div className="rsu-card">
            <h2>Comparison hotels</h2>
            <p className="rsu-hint">The hotels the report compares {client.name} with, on the questions that don’t name it.</p>
            {form.competitors.length === 0 && <p className="rsu-empty">No comparison hotels yet. The report shows no ranking until you add some.</p>}
            {form.competitors.map((c, index) => (
              <div className="rsu-competitor" key={c.key}>
                <div className="rsu-competitor-head">
                  <span className="rsu-number">{index + 1}</span>
                  <button type="button" className="rsu-link" onClick={() => update({ competitors: form.competitors.filter((x) => x.key !== c.key) })}>
                    Remove
                  </button>
                </div>
                <div className="rsu-grid rsu-grid-3">
                  <Field id={`${uid}-c-${c.key}-name`} label="Short name">
                    <input id={`${uid}-c-${c.key}-name`} value={c.name} maxLength={80} onChange={(e) => updateCompetitor(c.key, { name: e.target.value })} placeholder="e.g. Pier One" />
                  </Field>
                  <Field id={`${uid}-c-${c.key}-full`} label="Full name">
                    <input id={`${uid}-c-${c.key}-full`} value={c.displayName} onChange={(e) => updateCompetitor(c.key, { displayName: e.target.value })} placeholder="e.g. Pier One Sydney Harbour" />
                  </Field>
                  <Field id={`${uid}-c-${c.key}-aliases`} label="Names AI answers use" hint="One per line; * = starts with.">
                    <textarea id={`${uid}-c-${c.key}-aliases`} rows={3} value={c.aliases} onChange={(e) => updateCompetitor(c.key, { aliases: e.target.value })} />
                  </Field>
                </div>
              </div>
            ))}
            <button type="button" className="guided-secondary rsu-add" onClick={() => update({ competitors: [...form.competitors, emptyCompetitor()] })}>
              + Add comparison hotel
            </button>
            <Suggestions
              title="Mentioned most often in this client’s answers"
              items={notIn(setup.suggestions?.competitors, [
                ...lines(form.aliases),
                ...form.competitors.flatMap((c) => [c.name, c.displayName, ...lines(c.aliases)]),
              ])}
              onAdd={(name) => update({ competitors: [...form.competitors, { ...emptyCompetitor(), name, displayName: name, aliases: name }] })}
            />
          </div>

          <div className="rsu-card">
            <h2>Websites and other names</h2>
            <div className="rsu-grid">
              <Field id={`${uid}-domains`} label="The hotel’s own websites" hint="One domain per line, e.g. hotel.com. Shown as “your site” in the sources.">
                <textarea id={`${uid}-domains`} rows={4} value={form.ownDomains} onChange={(e) => update({ ownDomains: e.target.value })} />
              </Field>
              <Field id={`${uid}-ignored`} label="Names to ignore" hint="Neither the hotel nor a competitor, e.g. a lounge found in every hotel of the brand.">
                <textarea id={`${uid}-ignored`} rows={4} value={form.ignoredNames} onChange={(e) => update({ ignoredNames: e.target.value })} />
              </Field>
            </div>
          </div>

          <div className="rsu-card">
            <h2>Baseline</h2>
            <label className="rsu-check">
              <input type="checkbox" checked={form.baselineOn} onChange={(e) => update({ baselineOn: e.target.checked })} /> Measure the report against a
              starting point
            </label>
            {form.baselineOn && (
              <div className="rsu-grid rsu-grid-4">
                <Field id={`${uid}-b-label`} label="Name">
                  <input id={`${uid}-b-label`} value={form.baseline.label} maxLength={80} onChange={(e) => update({ baseline: { ...form.baseline, label: e.target.value } })} />
                </Field>
                <Field id={`${uid}-b-date`} label="Measured on">
                  <input id={`${uid}-b-date`} type="date" value={form.baseline.asOf} onChange={(e) => update({ baseline: { ...form.baseline, asOf: e.target.value } })} />
                </Field>
                <Field id={`${uid}-b-det`} label="Detection rate (%)">
                  <input id={`${uid}-b-det`} type="number" min="0" max="100" step="0.01" value={form.baseline.detection} onChange={(e) => update({ baseline: { ...form.baseline, detection: e.target.value } })} />
                </Field>
                <Field id={`${uid}-b-vis`} label="Visibility score (optional)">
                  <input id={`${uid}-b-vis`} type="number" min="0" max="100" step="0.01" value={form.baseline.visibility} onChange={(e) => update({ baseline: { ...form.baseline, visibility: e.target.value } })} />
                </Field>
              </div>
            )}
            {setup.baseline?.derived && form.baselineOn && (
              <p className="rsu-hint">These figures were back-calculated from an earlier report. They are kept as they are unless you change them.</p>
            )}
          </div>

          <div className="rsu-footer">
            <span role="status" className={error ? "rsu-error" : "rsu-notice"}>
              {error || notice || (dirty ? "Unsaved changes" : "")}
            </span>
            <button type="submit" className="guided-primary" disabled={saving || !dirty}>
              {saving ? "Saving…" : "Save report setup"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
