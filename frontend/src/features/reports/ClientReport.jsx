import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { komosionLogo } from "../../assets/index";
import { loadRankscaleHistory } from "../rankscale/historyStore";
import { summariseRecords } from "../rankscale/parseRankscale";
import { ReportReader } from "./assistant/ReportChat";
import { buildReportContext } from "./assistant/reportContext";
import { buildClientReport, engineLabel } from "./model/clientReport";
import { reportTitle } from "./periods";
import { ReportPeriodToolbar } from "./ReportPeriodToolbar";
import { ClientStory } from "./story/ClientStory";
import { HeadlineMetrics } from "./story/HeadlineMetrics";
const fmtFullDate = (A) =>
    new Date(`${A}T00:00:00Z`).toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }),
  fmtCount3 = (A) => Number(A || 0).toLocaleString("en-AU");
const fmtMetricValue = (A, e) =>
  e == null
    ? "\u2014"
    : `${A === "position" ? "#" : ""}${Number(e).toLocaleString("en-AU", {
        maximumFractionDigits: 2,
      })}${["detection", "top3"].includes(A) ? "%" : ""}`;
function PerformanceOverview({ report }) {
  return report.performance ? (
    <div className="csr-performance-overview">
      <HeadlineMetrics report={report} />
      <p className="csr-source-note">
        {"Tracked brand references: "}
        {report.performance.brandReferences.join(", ")}. Scores describe the selected dates; no
        previous-period baseline is assumed.
      </p>
    </div>
  ) : null;
}
function EvidenceTable({ title, description, headers, rows, collapsed = false }) {
  const o = (
    <>
      {description && <p className="csr-source-note">{description}</p>}
      {rows.length ? (
        <div className="csr-evidence-table" role="region" tabIndex="0" aria-label={title}>
          <table>
            <thead>
              <tr>
                {headers.map((a) => (
                  <th key={a}>{a}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((a, r) => (
                <tr key={r}>
                  {a.map((l, s) => (
                    <td key={s}>{l}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="csr-source-note">These measurements were not provided in the imported records.</p>
      )}
    </>
  );
  return collapsed ? (
    <details className="csr-supporting-details">
      <summary>
        {title}
        <span>
          {fmtCount3(rows.length)} {rows.length === 1 ? "row" : "rows"}
        </span>
      </summary>
      {o}
    </details>
  ) : (
    <div className="csr-supporting-section">
      <h3>{title}</h3>
      {o}
    </div>
  );
}
function linkify(A) {
  try {
    const e = new URL(A);
    if (["http:", "https:"].includes(e.protocol) && !e.username && !e.password) {
      return (
        <a href={e.href} target="_blank" rel="noreferrer">
          {A}
        </a>
      );
    }
  } catch {}
  return A;
}
function FullPerformance({ performance }) {
  if (!performance) {
    return null;
  }
  const e = (n) =>
      ["visibility", "detection", "position", "top3", "sentiment"].map((o) =>
        fmtMetricValue(o, n.metrics[o].value),
      ),
    t = ["Visibility", "Detection", "Avg position", "Top 3", "Sentiment"];
  return (
    <div className="csr-full-performance">
      <EvidenceTable
        title="AI engine performance"
        description="Metrics exclude unavailable measurements. Average position uses detected answers with a rank; sentiment uses recorded tracked-brand sentiment. No neutral-prompt subset or previous-period change is assumed."
        headers={["AI engine", "Answers", ...t]}
        rows={performance.engines.map((n) => [engineLabel(n.engine), fmtCount3(n.answerCount), ...e(n)])}
      />
      <EvidenceTable
        title="Intent performance"
        description="Intent groups use the exported topic names. An answer can belong to more than one topic; group counts may not add up to the report total."
        headers={["Intent", "Answers", "Questions", ...t]}
        rows={performance.intents.map((n) => [
          n.name,
          fmtCount3(n.answerCount),
          fmtCount3(n.promptCount),
          ...e(n),
        ])}
      />
      <EvidenceTable
        title="Competitors in ranked answers"
        description={`Names explicitly listed in the ranked-brand fields, excluding tracked names. Detection is measured across ${fmtCount3(performance.summary.rankedAnswerCount)} answers with rank columns. Spelling variants remain separate.`}
        collapsed
        headers={["Name", "Mentions", "Detection", "Avg position", "Sentiment"]}
        rows={performance.competitors.map((n) => [
          n.name,
          fmtCount3(n.mentionCount),
          fmtMetricValue("detection", n.detection),
          fmtMetricValue("position", n.position),
          fmtMetricValue("sentiment", n.sentiment),
        ])}
      />
      <EvidenceTable
        title="Cited domains"
        description="Answers count each domain once per distinct answer. A domain may appear across multiple citation types."
        collapsed
        headers={["Domain", "Unique pages", "Answers citing domain", "Citation types"]}
        rows={performance.sourceDomains.map((n) => [
          n.domain,
          fmtCount3(n.urlCount),
          fmtCount3(n.answerCount),
          n.types.join(", "),
        ])}
      />
      <EvidenceTable
        title="All cited pages"
        description="Every valid URL in the selected records, deduplicated within each answer. Citation types describe the source field, not ownership or source credibility."
        collapsed
        headers={["Page", "Domain", "Answers citing page", "Citation types"]}
        rows={performance.sources.map((n) => [
          linkify(n.url),
          n.domain,
          fmtCount3(n.answerCount),
          n.types.join(", "),
        ])}
      />
      <EvidenceTable
        title="Performance by question"
        description="Full question-level results for the selected reporting period."
        collapsed
        headers={["Question", "Intent", "Answers", ...t]}
        rows={performance.prompts.map((n) => [n.prompt, n.topic, fmtCount3(n.answerCount), ...e(n)])}
      />
      <EvidenceTable
        title="Daily performance"
        description="Only dates with imported answers are shown. A missing date is not zero performance."
        collapsed
        headers={["Date", "Answers", ...t]}
        rows={performance.trend.map((n) => [fmtFullDate(n.date), fmtCount3(n.answerCount), ...e(n)])}
      />
    </div>
  );
}
function ClientReport({ client, account, request, onUpload, onPeriodApply, onReportSaved, onTeamReview }) {
  const [a, r] = useState(null),
    [l, s] = useState(true),
    [c, d] = useState(""),
    [B, g] = useState(""),
    [M, h] = useState(0),
    [U, I] = useState(false),
    Q = useRef(null),
    p = useMemo(() => (a ? buildReportContext(a) : null), [a]);
  function Y(F) {
    const m = document.getElementById(F);
    if (m && Q.current?.contains(m)) {
      m.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }
  useEffect(() => {
    let F = true;
    s(true);
    r(null);
    d("");
    g("");
    I(false);
    async function m() {
      if (!client?.id) {
        s(false);
        return;
      }
      try {
        if (request?.record?.clientId === String(client.id) && request.record.generatedReport) {
          r(request.record.generatedReport);
          g(request.record.storageMode === "session" ? "Available this session" : "Saved report");
          s(false);
          return;
        }
        const j = await loadRankscaleHistory(client.id);
        if (!F) {
          return;
        }
        if (!j.rows.length) {
          s(false);
          return;
        }
        const w = summariseRecords(j.rows),
          z =
            request?.clientId === String(client.id) && request.period
              ? request.period
              : {
                  from: w.dateFrom,
                  to: w.dateTo,
                };
        if (!j.rows.some((N) => N.date >= z.from && N.date <= z.to)) {
          I(true);
          s(false);
          return;
        }
        const C = buildClientReport({
          client: client,
          rows: j.rows,
          period: z,
          createdBy: account?.name,
        });
        if (!F) {
          return;
        }
        r(C);
        s(false);
        const R = await onReportSaved?.(C);
        if (F) {
          g(R?.storageMode === "session" ? "Available this session" : "Saved in Rankscale import history");
        }
      } catch (j) {
        if (F) {
          d(j.message || "The report could not be created. Please try again.");
          s(false);
        }
      }
    }
    m();
    return () => {
      F = false;
    };
  }, [client?.id, request, M, onReportSaved]);
  function E() {
    try {
      const F = Q.current.cloneNode(true);
      F.querySelectorAll("details").forEach((R) => R.setAttribute("open", ""));
      const m = [...document.querySelectorAll("head style")].map((R) => R.outerHTML).join(""),
        j = document.createElement("span");
      j.textContent = `${client.name} \u2014 Report`;
      const w = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${j.innerHTML}</title>${m}<style>body{background:#f5f7fa;margin:0}.client-report-export{max-width:1280px;margin:auto;padding:32px}.client-story.csr-document h3{font-size:15px;color:#20334f}@media(max-width:650px){.client-report-export{padding:20px}}@media print{.client-report-export{padding:0}.csr-chapter{break-inside:avoid}}</style></head><body><main class="report-hub client-report-export">${F.outerHTML}</main></body></html>`,
        z = URL.createObjectURL(
          new Blob([w], {
            type: "text/html;charset=utf-8",
          }),
        ),
        C = document.createElement("a");
      C.href = z;
      C.download = `Komosion-${client.name.replace(/[^a-z0-9_-]/gi, "-")}-${a.period.from}-${a.period.to}-Report.html`;
      C.click();
      setTimeout(() => URL.revokeObjectURL(z), 1e3);
    } catch {
      d("The report could not be downloaded. Please try again.");
    }
  }
  const u =
    request?.clientId === String(client?.id) && request.period
      ? request.period
      : a?.period || {
          from: "",
          to: "",
        };
  return (
    <section className="report-hub report-page" aria-label="Report">
      <div className="client-story">
        <header className="coogee-report-heading">
          <div>
            <span className="rh-eyebrow">{client?.name || "Rankscale"}</span>
            <h1>{reportTitle(u)}</h1>
            <p>AI visibility, insights and recommendations for the selected dates.</p>
          </div>
          <ReportPeriodToolbar
            period={u}
            onApply={onPeriodApply}
            onExport={E}
            exportDisabled={!a || l}
            onTeamReview={client?.hasMeasurements ? onTeamReview : undefined}
          />
        </header>
        {c && (
          <div className="guided-alert" role="alert">
            {c}{" "}
            <button className="rh-secondary" onClick={() => h((F) => F + 1)}>
              Try again
            </button>
          </div>
        )}
        {l ? (
          <p role="status">Creating your report…</p>
        ) : a ? (
          <>
            <ReportReader context={p} onSource={Y}>
              <p className="csr-save-state" role="status">
                {B || "Saving report\u2026"}
              </p>
              <div ref={Q} className="client-story csr-document">
                <div className="csr-report-brand">
                  <img src={komosionLogo} alt="Komosion" />
                  <span>GEO · AI visibility</span>
                </div>
                <section className="csr-cover">
                  <div>
                    <span className="csr-kicker">AI visibility · Report</span>
                    <h2>{a.client.name}</h2>
                    <p>
                      {fmtFullDate(a.period.from)}
                      {" \u2013 "}
                      {fmtFullDate(a.period.to)}
                    </p>
                  </div>
                  <span className="csr-report-status">{"Performance & next steps"}</span>
                </section>
                <p className="csr-data-note">
                  Based on the uploaded Rankscale records for this period. Insights describe the available
                  data; recommendations are suggested next steps.
                </p>
                <div className="csr-reading-key" aria-label="Report colour key">
                  <span className="is-meaning">What it means</span>
                  <span className="is-action">Recommended next steps</span>
                </div>
                <section className="csr-chapter" id="report-summary">
                  <div className="csr-chapter-heading">
                    <span>01</span>
                    <h2>This period at a glance</h2>
                  </div>
                  <p className="csr-chapter-intro">
                    {a.performance
                      ? "Each headline number is paired with what it means and a recommended next step."
                      : "A clear picture of the questions and answers covered in this report."}
                  </p>
                  <PerformanceOverview report={a} />
                  {a.performance && <ClientStory report={a} mode="takeaways" />}
                  <h3 className="csr-coverage-title">The data behind this report</h3>
                  <div className="csr-summary-grid csr-coverage-grid">
                    {[
                      ["AI answers", a.summary.answerCount, "Distinct answers captured in this period."],
                      [
                        "Questions tracked",
                        a.summary.promptCount,
                        "Different questions represented in the uploaded data.",
                      ],
                      ["AI engines", a.summary.engineCount, "Assistants represented in the selected dates."],
                      [
                        "Days with data",
                        a.summary.activeDayCount,
                        `Within the ${fmtCount3(a.summary.periodDayCount)}-day reporting period.`,
                      ],
                    ].map(([F, m, j]) => (
                      <article key={F}>
                        <span className="csr-topic">{F}</span>
                        <strong className="csr-big-number">{fmtCount3(m)}</strong>
                        <p>{j}</p>
                      </article>
                    ))}
                  </div>
                </section>
                <section className="csr-chapter" id="report-detail">
                  <div className="csr-chapter-heading">
                    <span>02</span>
                    <h2>Performance detail</h2>
                  </div>
                  <p className="csr-chapter-intro">
                    Explore the results by date, AI engine, guest intent, competitor and source. Each view
                    connects the evidence to its meaning and a suggested next step.
                  </p>
                  <ClientStory report={a} />
                </section>
                <section className="csr-chapter" id="report-insights">
                  <div className="csr-chapter-heading">
                    <span>03</span>
                    <h2>{"Insights & what they mean"}</h2>
                  </div>
                  <p className="csr-chapter-intro">
                    The finding is on the left. The light-blue panel explains why it matters.
                  </p>
                  {a.insights
                    .filter(
                      (F) =>
                        !["performance-detection", "performance-position", "performance-sentiment"].includes(
                          F.id,
                        ),
                    )
                    .sort(
                      (F, m) =>
                        Number(m.id.startsWith("performance-")) - Number(F.id.startsWith("performance-")),
                    )
                    .map((F, m) => (
                      <article key={F.id} className="csr-insight">
                        <div>
                          <span className="csr-mini-label">
                            {"Insight "}
                            {String(m + 1).padStart(2, "0")}
                            {" \xB7 What the data shows"}
                          </span>
                          <h3>{F.title}</h3>
                          <p>{F.body}</p>
                          <small>{Array.isArray(F.evidence) ? F.evidence.join(" \xB7 ") : F.evidence}</small>
                        </div>
                        <aside className="csr-meaning-panel">
                          <h4>What it means</h4>
                          <p>{F.meaning}</p>
                        </aside>
                      </article>
                    ))}
                </section>
                <section className="csr-chapter" id="report-recommendations">
                  <div className="csr-chapter-heading">
                    <span>04</span>
                    <h2>Recommendations</h2>
                  </div>
                  <p className="csr-chapter-intro">
                    Practical next steps to take from the findings, with the benefit of each action explained.
                  </p>
                  <div className="csr-recommendations">
                    {[...a.recommendations]
                      .sort(
                        (F, m) =>
                          Number(m.id.startsWith("performance-")) - Number(F.id.startsWith("performance-")),
                      )
                      .map((F, m) => (
                        <article key={F.id}>
                          <span className="csr-topic">
                            {"Recommendation "}
                            {String(m + 1).padStart(2, "0")}
                          </span>
                          <h3>{F.title}</h3>
                          <p>{F.detail}</p>
                          <div className="csr-benefit">
                            <strong>Why this helps</strong>
                            <p>{F.expected_impact}</p>
                          </div>
                        </article>
                      ))}
                  </div>
                  <ClientStory report={a} mode="actionPlan" />
                </section>
                <section className="csr-chapter" id="report-next">
                  <div className="csr-chapter-heading">
                    <span>05</span>
                    <h2>What happens next</h2>
                  </div>
                  <ClientStory report={a} mode="timeline" />
                </section>
                <section className="csr-chapter" id="report-data">
                  <div className="csr-chapter-heading">
                    <span>06</span>
                    <h2>{"Supporting data & method"}</h2>
                  </div>
                  <p className="csr-chapter-intro">
                    The complete figures behind the report, grouped by AI engine, intent, competitor and cited
                    source.
                  </p>
                  <FullPerformance performance={a.performance} />
                  <EvidenceTable
                    title="Import coverage by engine"
                    headers={["AI engine", "Answers", "Questions", "Source records"]}
                    rows={a.engines.map((F) => [
                      F.displayName || F.engine,
                      fmtCount3(F.answerCount),
                      fmtCount3(F.promptCount),
                      fmtCount3(F.recordCount),
                    ])}
                  />
                  <p className="csr-source-note">
                    {fmtCount3(a.summary.rowCount)}
                    {" source records \xB7 "}
                    {a.sources.length}
                    {" source "}
                    {a.sources.length === 1 ? "file" : "files"}
                    {". "}
                    {a.performance && "All source rows are included in the HTML report."}
                  </p>
                  <details className="csr-method">
                    <summary>How to read this report</summary>
                    {a.methodology.map((F, m) => (
                      <p key={m}>{F}</p>
                    ))}
                  </details>
                  <p className="csr-source-note">
                    {"Source files: "}
                    {a.sources.map((F) => F.name).join(", ") || "Uploaded Rankscale history"}
                  </p>
                  <ClientStory report={a} mode="availability" />
                </section>
                <footer className="csr-document-footer">
                  <img src={komosionLogo} alt="Komosion" />
                  <span>Performance, explained clearly.</span>
                  <span>
                    {fmtFullDate(a.period.from)}
                    {" \u2013 "}
                    {fmtFullDate(a.period.to)}
                  </span>
                </footer>
              </div>
            </ReportReader>
          </>
        ) : (
          <div className="rh-no-report">
            <h2>
              {U
                ? "No data for these dates"
                : client?.id
                  ? "Upload data to create your report"
                  : "Choose a client"}
            </h2>
            <p>
              {U
                ? "Choose another date range or import records covering these dates. Your complete saved history is kept."
                : client?.id
                  ? "Import a Rankscale file. Your report will be created automatically, with insights, recommendations and supporting data."
                  : "Select a client in the top bar to get started."}
            </p>
            {client?.id && (
              <button className="rh-primary" onClick={onUpload}>
                Import Rankscale file
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
export { ClientReport };
