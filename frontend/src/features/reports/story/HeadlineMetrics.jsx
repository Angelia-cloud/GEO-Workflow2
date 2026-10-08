import { useMemo } from "react";
const HEADLINE_LABELS = {
    visibility: "Visibility Score",
    detection: "Detection Rate",
    position: "Average Position",
    sentiment: "Sentiment Score",
  },
  isFin = Number.isFinite,
  fmtLocale = (A, e = 2) =>
    A.toLocaleString("en-AU", {
      maximumFractionDigits: e,
    }),
  fmtHeadline = (A, e) =>
    isFin(A)
      ? `${e === "position" ? "#" : ""}${fmtLocale(A, e === "sentiment" ? 1 : 2)}${e === "detection" ? "%" : ""}`
      : "Not available";
function headlineMetrics(A) {
  if (!A.performance?.metrics) {
    return [];
  }
  const e = {
      visibility: "Combines how often the brand appears with its rank in AI answers. Higher is better.",
      detection: "The share of measured AI answers that mention the tracked brand.",
      position: "Average rank when the brand appears. A lower number is better.",
      sentiment: A.example
        ? "The recorded tone of brand mentions in the example."
        : "Average recorded tone of brand mentions on a \u2212100 to 100 scale.",
    },
    t = {
      visibility:
        "Compare topics and AI engines. Check the questions and cited pages before choosing a content change.",
      detection:
        "Read the answers where the brand is missing. Check that relevant pages clearly address those questions.",
      position:
        "Compare the answers and sources that place other brands ahead. Strengthen useful information for the same questions.",
      sentiment:
        "Read the answer wording and cited sources. Correct inaccurate descriptions and keep property information consistent.",
    };
  return Object.entries(HEADLINE_LABELS).map(([i, n]) => {
    let o = A.performance.metrics[i] || {},
      a = o.value,
      r = o.baseline,
      l = isFin(a),
      s = l && isFin(r),
      c = s ? a - r : null,
      d = s && r !== 0 ? Math.abs(c / r) * 100 : null,
      B = s
        ? c === 0
          ? "No change"
          : d === null
            ? `${c > 0 ? "Up" : "Down"} ${fmtLocale(Math.abs(c))} points`
            : `${c > 0 ? "Up" : "Down"} ${fmtLocale(d, 1)}%`
        : null,
      g = c === null || c === 0 ? null : i === "position" ? c < 0 : c > 0,
      M;
    if (l) {
      if (i === "visibility") {
        M = s
          ? `The score is ${c > 0 ? "above" : c < 0 ? "below" : "unchanged from"} the supplied baseline of ${fmtHeadline(r, i)}. ${c > 0 ? "The brand is more visible across the tracked answers." : c < 0 ? "The brand is less visible across the tracked answers." : "Overall visibility is steady across the tracked answers."}`
          : `Visibility is ${fmtHeadline(a, i)} for the selected dates. It describes this collection of answers; an equivalent earlier period is needed to judge improvement.`;
      } else if (i === "detection") {
        M = `The brand appears in ${fmtHeadline(a, i)} of measured answers${a === 100 || a === 0 ? "." : `, or about ${Math.round(a)} in every 100.`} This measures presence in AI answers, not visits or bookings.`;
      } else if (i === "position") {
        M = `When the brand appears, its average rank is ${fmtHeadline(a, i)}.${s ? ` That is ${c < 0 ? "closer to the top than" : c > 0 ? "further from the top than" : "unchanged from"} the baseline of ${fmtHeadline(r, i)}.` : " Answers where it is absent are excluded."}`;
      } else {
        M = `Recorded language about the brand is ${a > 0 ? "positive on average" : a < 0 ? "negative on average" : "neutral on average"}. This measures the tone of AI answers, not customer satisfaction.`;
      }
    } else {
      M =
        "The imported records do not contain enough measurements to calculate this score. This is not a zero result.";
    }
    return {
      key: i,
      label: n,
      value: fmtHeadline(a, i),
      baseline: s ? fmtHeadline(r, i) : null,
      change: B,
      favourable: g,
      definition: e[i],
      coverage:
        !A.example && isFin(o.denominator)
          ? `${fmtLocale(o.denominator, 0)} measured answers${o.missingCount > 0 ? ` \xB7 ${fmtLocale(o.missingCount, 0)} excluded` : ""}`
          : A.example
            ? "Full tracking set \xB7 Illustrative data"
            : "Coverage not recorded",
      meaning: M,
      recommendation: l
        ? i === "detection" && a === 100
          ? "Keep the same questions in the next collection. Check additional relevant guest needs to see whether this coverage extends beyond the current set."
          : i === "position" && a === 1
            ? "Keep the information that supports this leading position current. Track the same questions next period and check whether other engines show the same result."
            : t[i]
        : "Include the missing measurement fields in your next Rankscale import before comparing this score.",
    };
  });
}
export { headlineMetrics };
function HeadlineMetrics({ report }) {
  const e = useMemo(() => headlineMetrics(report), [report]);
  return e.length ? (
    <div className="client-report-metrics" aria-label="Headline metrics, meaning and recommendations">
      {e.map((t) => (
        <article className="crm-row" key={t.key} aria-label={t.label}>
          <div className="crm-number">
            <h3>{t.label}</h3>
            <strong className={t.value === "Not available" ? "crm-unavailable" : ""}>{t.value}</strong>
            {t.baseline && (
              <p className="crm-comparison">
                <span data-favourable={t.favourable}>{t.change}</span>
                <span>
                  {"vs baseline "}
                  {t.baseline}
                </span>
              </p>
            )}
            <p className="crm-definition">{t.definition}</p>
            <small>{t.coverage}</small>
          </div>
          <aside className="crm-meaning">
            <h4>What it means</h4>
            <p>{t.meaning}</p>
          </aside>
          <aside className="crm-recommendation">
            <h4>Recommended next step</h4>
            <p>{t.recommendation}</p>
          </aside>
        </article>
      ))}
    </div>
  ) : null;
}
export { HeadlineMetrics };
