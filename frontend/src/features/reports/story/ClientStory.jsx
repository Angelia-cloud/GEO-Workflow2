import { useId, useMemo } from "react";
import { text } from "../assistant/reportContext";
import { buildClientStory } from "./buildClientStory";
const fmtAvailable2 = (A) =>
  Number.isFinite(A)
    ? A.toLocaleString("en-AU", {
        maximumFractionDigits: 2,
      })
    : "Not available";
function ChartTable({ title, headers = [], rows = [] }) {
  return (
    <div className="crd-table-scroll" role="region" aria-label={title} tabIndex="0">
      <table>
        <caption className="crd-sr-only">{title}</caption>
        <thead>
          <tr>
            {headers.map((i, n) => (
              <th scope="col" key={n}>
                {i}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((i, n) => (
            <tr key={n}>
              {i.map((o, a) =>
                a === 0 ? (
                  <th scope="row" key={a}>
                    {o}
                  </th>
                ) : (
                  <td key={a}>{o}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function EvidenceChart({ evidence }) {
  const e = useId(),
    t = evidence.values || [],
    i = evidence.labels || [],
    n = t.map((p, Y) => ({
      value: p,
      label: i[Y] || String(Y + 1),
    })),
    o = evidence.kind === "line" ? n : n.filter((p) => Number.isFinite(p.value));
  if (!o.length) {
    return <p className="crd-note">No recorded dates or values are available for this chart.</p>;
  }
  let a = 100,
    r = 700,
    l = 246,
    s = 44,
    c = 20,
    d = 20,
    B = 43,
    g = (p) => s + (o.length === 1 ? (r - s - c) / 2 : (p * (r - s - c)) / (o.length - 1)),
    M = (p) => d + (1 - p / a) * (l - d - B),
    h = [],
    U = [];
  o.forEach((p, Y) => {
    if (Number.isFinite(p.value)) {
      U.push({
        ...p,
        index: Y,
      });
    } else if (U.length) {
      h.push(U);
      U = [];
    }
  });
  if (U.length) {
    h.push(U);
  }
  const I = (p) => p.map((Y, E) => `${E ? "L" : "M"} ${g(Y.index)} ${M(Y.value)}`).join(" "),
    Q = [
      ...new Set([
        0,
        Math.round((o.length - 1) / 4),
        Math.round((o.length - 1) / 2),
        Math.round(((o.length - 1) * 3) / 4),
        o.length - 1,
      ]),
    ];
  return (
    <>
      {evidence.kind === "line" ? (
        <div className="crd-line-chart" role="region" tabIndex="0" aria-label={`${evidence.title} chart`}>
          <svg viewBox={`0 0 ${r} ${l}`} role="img" aria-labelledby={`${e}-title ${e}-desc`}>
            <title id={`${e}-title`}>{evidence.title}</title>
            <desc id={`${e}-desc`}>
              {o.map((p) => `${p.label}: ${fmtAvailable2(p.value)}`).join("; ")}. Exact values are also
              available in the chart data table.
            </desc>
            {[0, a / 2, a].map((p) => (
              <g key={p}>
                <line x1={s} x2={r - c} y1={M(p)} y2={M(p)} className="crd-chart-grid" />
                <text x={s - 9} y={M(p) + 4} textAnchor="end">
                  {fmtAvailable2(p)}
                </text>
              </g>
            ))}
            {h.map((p, Y) => (
              <g key={Y}>
                {p.length > 1 && (
                  <path
                    d={`${I(p)} L ${g(p.at(-1).index)} ${l - B} L ${g(p[0].index)} ${l - B} Z`}
                    className="crd-chart-area"
                  />
                )}
                <path d={I(p)} className="crd-chart-line" />
              </g>
            ))}
            {o.map(
              (p, Y) =>
                Number.isFinite(p.value) && (
                  <circle key={Y} cx={g(Y)} cy={M(p.value)} r="3.5" className="crd-chart-point">
                    <title>{`${p.label}: ${fmtAvailable2(p.value)}`}</title>
                  </circle>
                ),
            )}
            {Q.map((p) => (
              <text
                key={p}
                x={g(p)}
                y={l - 17}
                textAnchor={p === 0 ? "start" : p === o.length - 1 ? "end" : "middle"}
              >
                {o[p].label}
              </text>
            ))}
          </svg>
          {!h.length && <p className="crd-note">No visibility measurements were recorded for these dates.</p>}
        </div>
      ) : (
        <div className="crd-bar-chart" role="list" aria-label={evidence.title}>
          {o.map((p, Y) => (
            <div className="crd-bar-row" role="listitem" key={Y}>
              <span className="crd-bar-label">{p.label}</span>
              <strong>{fmtAvailable2(p.value)}</strong>
              <svg viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
                <rect width="100" height="8" rx="2" className="crd-bar-track" />
                <rect width={Math.max(0, (p.value / a) * 100)} height="8" rx="2" className="crd-bar-fill" />
              </svg>
            </div>
          ))}
          <div className="crd-bar-scale" aria-hidden="true">
            <span>0</span>
            <span>{fmtAvailable2(a / 2)}</span>
            <span>{fmtAvailable2(a)}</span>
          </div>
        </div>
      )}
      <details className="crd-chart-data">
        <summary>View chart values</summary>
        <ChartTable
          title={`${evidence.title} values`}
          headers={[evidence.kind === "line" ? "Recorded date" : "Group", "Visibility Score"]}
          rows={o.map((p) => [p.label, fmtAvailable2(p.value)])}
        />
      </details>
    </>
  );
}
function StorySections({ sections }) {
  return (
    <div className="client-report-details crd-sections">
      {sections.map((e, t) => (
        <article className="crd-detail" key={e.id}>
          <header className="crd-section-head">
            <span className="crd-detail-number">{String(t + 1).padStart(2, "0")}</span>
            <div>
              <h3>{e.title}</h3>
              <p>{e.scope}</p>
            </div>
          </header>
          <div className="crd-evidence-layout">
            <div className="crd-evidence">
              <h4>{e.evidence.title}</h4>
              {e.evidence.kind === "table" ? (
                <ChartTable title={e.evidence.title} headers={e.evidence.headers} rows={e.evidence.rows} />
              ) : (
                <EvidenceChart evidence={e.evidence} />
              )}
              <p className="crd-note">{e.evidence.note}</p>
            </div>
            <div className="crd-explanation">
              <aside className="crd-meaning">
                <h4>What it means</h4>
                <p>{e.meaning}</p>
              </aside>
              <aside className="crd-recommendation">
                <h4>Recommended next step</h4>
                <p>{e.recommendation}</p>
              </aside>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
function Takeaways({ items }) {
  return (
    <div className="client-report-details crd-takeaways" aria-label="Report takeaways">
      {items.map((e, t) => (
        <article key={t}>
          <span>{e.label}</span>
          <strong>{e.value}</strong>
          <p>{e.body}</p>
        </article>
      ))}
    </div>
  );
}
function ActionPlan({ items }) {
  return (
    <section className="client-report-details crd-action-plan" aria-label="Proposed action plan">
      <h3>Proposed action plan</h3>
      <p className="crd-intro">
        Suggested roles and timing help turn the findings into work. They are planning guidance, not assigned
        commitments.
      </p>
      <ChartTable
        title="Proposed action plan"
        headers={[
          "Order",
          "Action & scope",
          "Suggested owner",
          "Suggested timing",
          "How to measure progress",
        ]}
        rows={items.map((e) => [
          e.priority,
          <>
            <strong>{e.action}</strong>
            <p>{e.scope}</p>
          </>,
          e.owner,
          e.timing,
          e.measure,
        ])}
      />
    </section>
  );
}
function NextSteps() {
  return (
    <div className="client-report-details crd-timeline">
      <p className="crd-intro">Suggested sequence. Set dates and owners to suit the client’s work plan.</p>
      <ol>
        {[
          [
            "Now",
            "Set the focus",
            "Choose a finding to investigate and identify the supporting questions, answers and cited pages.",
          ],
          [
            "Next work cycle",
            "Make and record the change",
            "Update the relevant information where needed. Record the page, change and implementation date.",
          ],
          [
            "Next reporting cycle",
            "Measure with the same questions",
            "Keep questions, engines and collection timing comparable. Look for repeated patterns before drawing conclusions.",
          ],
        ].map(([e, t, i], n) => (
          <li key={e}>
            <span className="crd-timeline-label">{e}</span>
            <div>
              <span className="crd-timeline-number">{n + 1}</span>
              <h3>{t}</h3>
              <p>{i}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
function Availability({ rows }) {
  return (
    <section className="client-report-details crd-availability" aria-label="Report coverage and availability">
      <h3>What this report can and cannot show</h3>
      <p className="crd-intro">
        The report uses available source data. Other business measures need their own connected evidence.
      </p>
      <ChartTable
        title="Report coverage and availability"
        headers={["Information", "Availability"]}
        rows={rows}
      />
      <p className="crd-note">
        Changes in visibility alone do not establish a cause. Suggested actions are opportunities to
        investigate, not confirmed website defects or guaranteed results.
      </p>
    </section>
  );
}
function ClientStory({ report, mode = "sections" }) {
  const t = useMemo(() => buildClientStory(report), [report]);
  return mode === "takeaways" ? (
    <Takeaways items={t.takeaways} />
  ) : mode === "actionPlan" ? (
    <ActionPlan items={t.actionPlan} />
  ) : mode === "timeline" ? (
    <NextSteps />
  ) : mode === "availability" ? (
    <Availability rows={t.availability} />
  ) : (
    <StorySections sections={t.sections} />
  );
}
export { ClientStory };
