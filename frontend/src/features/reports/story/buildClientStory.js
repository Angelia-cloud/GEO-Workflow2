import { engineLabel } from "../model/clientReport";
const fmtAvailable = (A) =>
    Number.isFinite(A)
      ? A.toLocaleString("en-AU", {
          maximumFractionDigits: 2,
        })
      : "Not available",
  metricValueOf = (A, e) => A?.metrics?.[e]?.value,
  isFiniteNumber = (A) => Number.isFinite(A),
  fmtDayMonth = (A) =>
    new Date(`${A}T00:00:00Z`).toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }),
  byVisibility = (A) =>
    [...A].sort(
      (e, t) => (metricValueOf(t, "visibility") ?? -1 / 0) - (metricValueOf(e, "visibility") ?? -1 / 0),
    ),
  compareToReference = (A, e) =>
    !isFiniteNumber(A) || !isFiniteNumber(e)
      ? "cannot be compared with an available reference"
      : A > e
        ? "is above its supplied reference"
        : A < e
          ? "is below its supplied reference"
          : "matches its supplied reference";
function buildClientStory(A) {
  const e = A.performance,
    t = A.example === true ? A.exampleData : null,
    i = [],
    n = (p, Y, E, u, F, m) =>
      i.push({
        id: p,
        title: Y,
        scope: E,
        evidence: u,
        meaning: F,
        recommendation: m,
      }),
    o = e?.trend || [],
    a = o.map((p) => metricValueOf(p, "visibility")).filter(isFiniteNumber),
    r = byVisibility(e?.engines || []).filter((p) => isFiniteNumber(metricValueOf(p, "visibility"))),
    l = byVisibility(e?.intents || []).filter((p) => isFiniteNumber(metricValueOf(p, "visibility"))),
    s = l[0],
    c = l.at(-1),
    d = r[0],
    B = l.length > 1 && metricValueOf(s, "visibility") !== metricValueOf(c, "visibility"),
    g = e?.metrics?.visibility,
    M = [
      {
        label: "Overall visibility",
        value: fmtAvailable(g?.value),
        body: A.example
          ? `The full tracking score ${compareToReference(g?.value, g?.baseline)}.`
          : "Calculated from measured detection and rank in the selected dates.",
      },
      {
        label: l.length > 1 ? "Leading guest need" : "Measured guest need",
        value: s?.name === "Unassigned" ? "Topic not provided" : s?.name || "Not available",
        body: s
          ? `${fmtAvailable(metricValueOf(s, "visibility"))} visibility across ${fmtAvailable(s.answerCount)} answers.`
          : "Topic-level measurements are needed to identify a strong area.",
      },
      {
        label: "Area to explore",
        value: B ? c.name : "Comparable coverage",
        body: B
          ? `${fmtAvailable(metricValueOf(c, "visibility"))} visibility. Check the underlying questions before choosing a content change.`
          : "There is no measured gap between topics in this selection. Keep questions and engines consistent for the next collection.",
      },
      {
        label: "Engine to understand",
        value: d ? engineLabel(d.engine) : "Not available",
        body: d
          ? r.length === 1
            ? `${fmtAvailable(metricValueOf(d, "visibility"))} visibility. This is the only measured engine in the selection.`
            : `${fmtAvailable(metricValueOf(d, "visibility"))} is the highest engine visibility in this selection. Coverage can differ.`
          : "Engine measurements will appear after an import.",
      },
    ];
  if (
    (a.length &&
      n(
        "trend",
        "Visibility through the reporting period",
        "Daily observations within the selected dates",
        {
          kind: "line",
          title: "Visibility Score by recorded date",
          labels: o.map((p) => fmtDayMonth(p.date)),
          values: o.map((p) => metricValueOf(p, "visibility") ?? null),
          note: A.example
            ? "Illustrative tracking runs. The line shows the example pattern."
            : "Only recorded dates are plotted. Gaps are not zero measurements; connected points do not imply daily tracking.",
        },
        `Recorded scores range from ${fmtAvailable(Math.min(...a))} to ${fmtAvailable(Math.max(...a))}. A single high or low run does not establish a lasting change.`,
        "Keep the tracking schedule and questions consistent. Investigate repeated movements before linking a result to a website change.",
      ),
    r.length &&
      n(
        "engines",
        "How performance differs by AI engine",
        "Full tracking set; each engine uses its own measured answers",
        {
          kind: "bars",
          title: "Visibility by AI engine",
          labels: r.slice(0, 6).map((p) => engineLabel(p.engine)),
          values: r.slice(0, 6).map((p) => metricValueOf(p, "visibility")),
          note:
            r.length > 6
              ? `Six of ${r.length} measured engines shown. All engines remain in the supporting tables.`
              : "Visibility uses explicit detection and rank. Engine answer counts can differ.",
        },
        `${engineLabel(r[0].engine)} has the highest recorded visibility at ${fmtAvailable(metricValueOf(r[0], "visibility"))}. This comparison describes the collected questions, not the whole search market.`,
        "Compare the same guest questions across engines. Check which property and third-party pages appear in the weaker answers.",
      ),
    l.length &&
      n(
        "intents",
        "Which guest needs the hotel is visible for",
        "Intent labels come from the tracked topics",
        {
          kind: "bars",
          title: "Visibility by guest intent",
          labels: l.slice(0, 6).map((p) => p.name),
          values: l.slice(0, 6).map((p) => metricValueOf(p, "visibility")),
          note:
            l.length > 6
              ? `Six of ${l.length} topics shown. See the full intent table for every topic.`
              : "Scores can reflect the mix of questions and engines. Topic differences alone do not explain a cause.",
        },
        l.length === 1
          ? `${s.name} is the only measured topic, with visibility of ${fmtAvailable(metricValueOf(s, "visibility"))}. More topics are needed for a comparison.`
          : metricValueOf(s, "visibility") === metricValueOf(c, "visibility")
            ? `The measured topics share the same visibility score of ${fmtAvailable(metricValueOf(s, "visibility"))}. The data does not identify a stronger or weaker topic.`
            : `${s.name} leads this selection at ${fmtAvailable(metricValueOf(s, "visibility"))}. ${c.name} is lower at ${fmtAvailable(metricValueOf(c, "visibility"))}.`,
        `Start with the questions behind ${c.name}. Check whether the current pages answer the specific guest need clearly.`,
      ),
    t)
  ) {
    const p = t.neutral_vs_benchmark?.find((C) => C.metric === "visibility"),
      Y = t.intent_competition?.find((C) => C.intent === "Romance & Events"),
      E = [...(Y?.leaders || [])]
        .filter((C) => isFiniteNumber(C.visibility))
        .sort((C, R) => R.visibility - C.visibility)[0],
      u = t.competitors.find((C) => C.is_self),
      F = u?.short || u?.name || t.property.name,
      m = [...t.competitors]
        .filter((C) => isFiniteNumber(C.visibility))
        .sort((C, R) => R.visibility - C.visibility),
      j = m.filter((C) => C.visibility === m[0]?.visibility),
      w = j.length
        ? `${j.map((C) => C.short || C.name).join(" and ")} ${j.length > 1 ? "share the highest" : "has the highest"} neutral-set visibility at ${fmtAvailable(j[0].visibility)}.`
        : "No neutral competitor scores are available for these dates.",
      z = (t.intent_competition || []).filter((C) => C.status === "behind").map((C) => C.intent);
    n(
      "comparison",
      "Full tracking and neutral searches answer different questions",
      `Full set: ${fmtAvailable(t.prompt_sets.full)} prompts. Neutral comparison: ${fmtAvailable(t.prompt_sets.neutral)} prompts.`,
      {
        kind: "table",
        title: "Comparison context",
        headers: ["Measure", "Reference", "Current"],
        rows: [
          [
            "Full-set visibility",
            fmtAvailable(t.baseline_visibility),
            fmtAvailable(e.metrics.visibility.value),
          ],
          ["Neutral visibility", fmtAvailable(p?.benchmark), fmtAvailable(p?.current)],
          ...(Y ? [[`${Y.intent}: ${F}`, "Neutral prompts", fmtAvailable(Y.coogee)]] : []),
          ...(E ? [[`${Y.intent}: ${E.name}`, "Same neutral prompts", fmtAvailable(E.visibility)]] : []),
        ],
        note: "Illustrative values. Full-set and neutral scores use different question sets and must be interpreted separately.",
      },
      `Full-set visibility ${compareToReference(g?.value, t.baseline_visibility)}. Neutral visibility ${compareToReference(p?.current, p?.benchmark)}. These fixed illustrative references do not change with the selected dates.`,
      "Use full-set results to understand brand discoverability. Use the same neutral prompts when comparing the hotel with competitors.",
    );
    n(
      "competitors",
      "Competitive position on neutral guest searches",
      "Illustrative neutral competitor set only",
      {
        kind: "bars",
        title: "Neutral-set visibility",
        labels: m.map((C) => C.short || C.name),
        values: m.map((C) => C.visibility),
        note: "Overall neutral-set scores and individual guest intents can have different leaders.",
      },
      `${w}${z.length ? ` The hotel is behind the strongest tracked competitor for ${z.join(", ")}.` : ""}`,
      "Focus competitor research on the guest intents with a gap, rather than copying every competitor page.",
    );
    n(
      "sources",
      "Where AI finds supporting information",
      "Illustrative citations for the property",
      {
        kind: "table",
        title: "Top cited sources for the hotel",
        headers: ["Source", "Source type", "Citations"],
        rows: t.sources.top_cited.slice(0, 5).map((C) => [C.domain, C.category, fmtAvailable(C.citations)]),
        note: "Citation counts are illustrative. They describe supporting references, not website visits or bookings.",
      },
      "These cited pages provide supporting information for AI answers in the selected dates. Citation counts show where to check the property information.",
      "Keep property facts consistent across these sources. Prioritise outdated facts and missing occasion information on pages already cited.",
    );
    n(
      "source-gaps",
      "Sources where competitors have a presence",
      "Illustrative opportunities to investigate",
      {
        kind: "table",
        title: "Source gaps in the example",
        headers: ["Source", "Type", "Competitor citations"],
        rows: t.sources.missing.map((C) => [C.domain, C.category, fmtAvailable(C.for_competitors)]),
        note: "Presence does not establish that a listing causes visibility. Check suitability and accuracy before taking action.",
      },
      "Venue guides and editorial sources appear in competitor answers where this example has no equivalent property citation.",
      "Check relevant venue listings and editorial opportunities. Add accurate capacity, location and occasion details where appropriate.",
    );
  } else if (e) {
    if (e.competitors?.length) {
      n(
        "competitors",
        "Other brands appearing in the same answers",
        "Observed ranking fields; not a separate neutral-prompt benchmark",
        {
          kind: "table",
          title: "Five most frequently mentioned other brands",
          headers: ["Brand", "Mentions", "Detection", "Avg. rank"],
          rows: e.competitors
            .slice(0, 5)
            .map((Y) => [
              Y.name,
              fmtAvailable(Y.mentionCount),
              isFiniteNumber(Y.detection) ? `${fmtAvailable(Y.detection)}%` : "Not available",
              isFiniteNumber(Y.position) ? `#${fmtAvailable(Y.position)}` : "Not available",
            ]),
          note: `Top five of ${fmtAvailable(e.competitors.length)} observed spellings. Rates use ${fmtAvailable(e.summary.rankedAnswerCount)} answers with rank columns; spelling variants remain separate.`,
        },
        `${e.competitors[0].name} appears most often among the other observed brand names. The prompt mix may favour particular places or services.`,
        "Examine the questions where competitors appear. Compare their cited pages and relevant guest information before selecting a response.",
      );
    }
    if (e.sourceDomains?.length) {
      n(
        "sources",
        "Where AI finds supporting information",
        "Explicit citation URLs in the selected records",
        {
          kind: "table",
          title: "Five most frequently cited domains",
          headers: ["Domain", "Answers citing", "Unique pages"],
          rows: e.sourceDomains
            .slice(0, 5)
            .map((Y) => [Y.domain, fmtAvailable(Y.answerCount), fmtAvailable(Y.urlCount)]),
          note: `${fmtAvailable(e.sources.length)} unique URLs across ${fmtAvailable(e.sourceDomains.length)} domains. Each domain counts once per answer. Counts do not establish ownership or credibility.`,
        },
        "These sources are part of the evidence AI used. Citation frequency shows where to check information; it does not measure traffic or bookings.",
        "Start with frequently cited pages relevant to the property. Check names, location, services and contact details, then correct outdated information.",
      );
    }
    const p = [...(e.prompts || [])]
      .filter((Y) => isFiniteNumber(metricValueOf(Y, "detection")))
      .sort(
        (Y, E) =>
          metricValueOf(Y, "detection") - metricValueOf(E, "detection") || E.answerCount - Y.answerCount,
      );
    if (p.length) {
      n(
        "questions",
        "Questions that need a closer look",
        "Lowest recorded detection rates among tracked questions",
        {
          kind: "table",
          title: "Questions to investigate",
          headers: ["Question", "Measured answers", "Detection"],
          columnWidths: [0.65, 0.18, 0.17],
          rows: p
            .slice(0, 5)
            .map((Y) => [
              Y.prompt,
              fmtAvailable(Y.metrics.detection.denominator),
              `${fmtAvailable(metricValueOf(Y, "detection"))}%`,
            ]),
          note: "A lower detection rate can reflect topic fit, wording or source coverage. It does not by itself prove that content is missing.",
        },
        p.length > 1 && metricValueOf(p[0], "detection") < metricValueOf(p.at(-1), "detection")
          ? "These questions identify where the tracked brand appears less often in this collection. Read the answers and supporting pages to understand the difference."
          : "These questions have the same recorded detection rate. Use the answer text and cited pages to assess the guest experience.",
        "Check whether existing pages answer these specific questions. Prioritise clear, useful information over changes aimed only at the score.",
      );
    }
  }
  if (!A.example && e?.metrics) {
    n(
      "reliability",
      "How complete is the measurement?",
      "Denominators differ because each metric needs different recorded fields",
      {
        kind: "table",
        title: "Measured answers behind each score",
        headers: ["Measure", "Included", "Excluded"],
        rows: Object.entries({
          visibility: "Visibility",
          detection: "Detection",
          position: "Average position",
          sentiment: "Sentiment",
        }).map(([p, Y]) => [
          Y,
          fmtAvailable(e.metrics[p]?.denominator),
          fmtAvailable(e.metrics[p]?.missingCount),
        ]),
        note: "Average position excludes answers where the brand is not detected and answers without a usable rank. Excluded does not always mean an import error.",
      },
      `${fmtAvailable(A.summary.activeDayCount)} of ${fmtAvailable(A.summary.periodDayCount)} selected days have records. Missing dates describe collection coverage, not zero performance.`,
      "Retain the collection schedule and the original files. Compare equivalent questions and engines when assessing the next period.",
    );
  }
  for (const [p, Y] of (A.answerExamples || []).entries())
    n(
      `answer-${p}`,
      "From a score to an actual guest question",
      `${fmtDayMonth(Y.date)} \xB7 ${engineLabel(Y.engine)} \xB7 ${Y.topic}`,
      {
        kind: "table",
        title: "One answer from the selected period",
        headers: ["Evidence", "Imported text"],
        columnWidths: [0.2, 0.8],
        rows: [
          ["Question", Y.prompt],
          [Y.isExcerpt ? "Answer excerpt" : "Answer", Y.excerpt],
        ],
        note: `${Y.selection} Source: ${Y.sourceName}.`,
      },
      "Read the wording alongside the score to see what a traveller was shown. This single answer is an example, not a finding about every response.",
      "Check the property information relevant to this question. Re-run the same question across engines after a change and compare repeated results.",
    );
  n(
    "checks",
    "What to check before changing content",
    "Interpretation checklist for the next work cycle",
    {
      kind: "table",
      title: "Relevance, clarity and credibility",
      headers: ["Lens", "What to check"],
      columnWidths: [0.2, 0.8],
      rows: [
        ["Relevance", "Do the pages answer the guest intent, including specific occasions and use cases?"],
        ["Clarity", "Are property names, facilities, venues and location details connected and consistent?"],
        ["Credibility", "Are cited property, brand and third-party pages accurate and consistent?"],
      ],
      note: "These are investigation lenses. The export does not verify a root cause or confirm a website defect.",
    },
    "The data identifies where to investigate. A page-level check is needed to distinguish a content gap, inconsistent information or limited third-party support.",
    "Record the evidence and the change you make. Compare equivalent questions and dates afterwards, without assuming the change caused every movement.",
  );
  const h = {
      "performance-intent-opportunity": "Compare topic detection and cited pages using the same questions.",
      "performance-source-opportunity": "Log corrected pages and compare citations in the next period.",
      "maintain-comparable-questions": "Track coverage of the same question-and-engine combinations.",
      "collection-schedule": "Compare recorded dates with the agreed collection schedule.",
      "establish-comparison": "Compare scores using equivalent questions, engines and dates.",
    },
    I = [...(A.recommendations || [])]
      .sort(
        (p, Y) =>
          Number(String(Y.id).startsWith("performance-")) - Number(String(p.id).startsWith("performance-")),
      )
      .map((p, Y) => ({
        priority: Y === 0 ? "First" : "Next",
        action: p.title,
        scope: p.detail,
        owner: /citation|source|third.party|listing/i.test(p.title)
          ? "Marketing / listings team"
          : /question|collect|period|schedule|compar/i.test(p.title)
            ? "Reporting team"
            : "Website / content team",
        timing: Y === 0 ? "Next work cycle" : "Following work cycle",
        measure: p.measure || h[p.id] || p.expected_impact,
      })),
    Q = [
      [
        "AI visibility and rankings",
        e ? "Included from recorded fields" : "Unavailable in this saved import",
      ],
      [
        A.example ? "Comparison references" : "Earlier-period performance",
        A.example ? "Fixed illustrative benchmarks supplied" : "No equivalent comparison baseline selected",
      ],
      ["Website traffic and conversions", "Requires linked analytics data"],
      ["Paid media spend and audience profiles", "Requires advertising / analytics data"],
      ["Delivery budget, hours and deadlines", "To be set by the client team"],
    ];
  return {
    takeaways: M,
    sections: i,
    actionPlan: I,
    availability: Q,
  };
}
export { buildClientStory };
