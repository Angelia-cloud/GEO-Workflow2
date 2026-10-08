import { parseTimestamp, recordsInPeriod, summariseRecords } from "../../rankscale/parseRankscale";
import { dailyAndEngineCounts } from "./dailyCounts";
import { buildPerformance } from "./performance";
const DAY_MS = 864e5,
  fmtLocaleNumber = (A) => Number(A).toLocaleString("en-AU"),
  plural = (A, e, t = `${e}s`) => `${fmtLocaleNumber(A)} ${A === 1 ? e : t}`,
  answerCount = (A) => new Set(A.map((e) => e.answerId)).size,
  fmtUtcDate = (A) =>
    new Date(`${A}T00:00:00.000Z`).toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }),
  ENGINE_NAMES = {
    chatgpt: "ChatGPT",
    chatgpt_gui: "ChatGPT GUI",
    chatgpt_api: "ChatGPT API",
    google_gemini: "Google Gemini",
    google_gemini_gui: "Google Gemini GUI",
    google_gemini_api: "Google Gemini API",
    gemini_gui: "Gemini GUI",
    gemini_api: "Gemini API",
    bing_copilot_gui: "Bing Copilot GUI",
    bing_copilot_api: "Bing Copilot API",
    microsoft_copilot_gui: "Microsoft Copilot GUI",
    google_ai_overview: "Google AI Overview",
    google_ai_mode: "Google AI Mode",
    google_ai_mode_gui: "Google AI Mode GUI",
    perplexity_gui: "Perplexity GUI",
    perplexity_api: "Perplexity API",
    anthropic_claude_gui: "Claude GUI",
    anthropic_claude_api: "Claude API",
    claude_gui: "Claude GUI",
    claude_api: "Claude API",
    anthropic_claude_4_5_haiku: "Claude Haiku 4.5",
  };
function engineLabel(A) {
  const e = String(A ?? "");
  return ENGINE_NAMES[e.trim().toLowerCase()] || e;
}
export { engineLabel };
function validateRecords(A, e) {
  if (!Array.isArray(A)) {
    throw new Error("Saved Rankscale records are required to create a report.");
  }
  if (A.some((t) => !t || t.clientId !== e)) {
    throw new Error("Rankscale records must belong to the selected client.");
  }
  for (const t of A) {
    if (!t.answerId || !String(t.engine || "").trim() || !String(t.prompt || "").trim()) {
      throw new Error("Rankscale records must be normalized before creating a report.");
    }
    let i;
    try {
      i = parseTimestamp(t.timestamp);
    } catch {
      throw new Error("A saved Rankscale record has an invalid timestamp. Re-upload its source export.");
    }
    if (i.date !== t.date) {
      throw new Error("A saved Rankscale record has an inconsistent UTC date. Re-upload its source export.");
    }
  }
}
function promptRows(A) {
  const e = new Map();
  A.forEach((t) => {
    if (!e.has(t.prompt)) {
      e.set(t.prompt, []);
    }
    e.get(t.prompt).push(t);
  });
  return [...e.entries()]
    .map(([t, i]) => ({
      prompt: t,
      answerCount: answerCount(i),
      recordCount: i.length,
      engineCount: new Set(i.map((n) => n.engine)).size,
    }))
    .sort((t, i) => i.answerCount - t.answerCount || t.prompt.localeCompare(i.prompt));
}
const fmtDecimal = (A, e = 1) =>
  Number(A).toLocaleString("en-AU", {
    maximumFractionDigits: e,
  });
function buildInsights(A) {
  if (!A) {
    return {
      insights: [],
      recommendations: [],
    };
  }
  const { metrics, summary } = A,
    i = [],
    n = [],
    o =
      A.brandReferences.length === 1
        ? `The tracked brand is ${A.brandReferences[0]}.`
        : `This combines ${plural(A.brandReferences.length, "tracked brand reference")} from the export; each reference remains a separate observation.`;
  if (metrics.detection.value !== null) {
    i.push({
      id: "performance-detection",
      title: `The tracked brand appears in ${fmtDecimal(metrics.detection.value)}% of measured answers`,
      body: `${o} ${plural(metrics.detection.denominator, "answer")} ${metrics.detection.denominator === 1 ? "has" : "have"} a recorded detection outcome in this period.`,
      meaning:
        "Detection shows how often the explicitly tracked brand is present in the collected answers. It does not measure traffic or bookings, and this report does not assume a previous-period baseline.",
      evidence: [
        `${fmtDecimal(metrics.detection.value)}% detection`,
        `${plural(metrics.detection.missingCount, "answer")} without a detection measurement`,
      ],
    });
  }
  if (metrics.position.value !== null) {
    i.push({
      id: "performance-position",
      title: `Average position is ${fmtDecimal(metrics.position.value, 2)} when the brand is ranked`,
      body: `The tracked brand\u2019s best recorded rank averages ${fmtDecimal(metrics.position.value, 2)} across ${plural(metrics.position.denominator, "detected answer")} with a rank.${metrics.top3.value !== null ? ` It appears in the top three in ${fmtDecimal(metrics.top3.value)}% of answers with a known ranking outcome.` : ""}`,
      meaning:
        "Lower positions mean the brand appears nearer the top of an answer. Answers without a usable rank are excluded from this average.",
      evidence: [
        `${plural(metrics.position.denominator, "ranked answer")}`,
        `${plural(metrics.position.missingCount, "answer")} excluded from average position`,
      ],
    });
  }
  const a = A.intents
    .filter((r) => r.name !== "Unassigned" && r.metrics.detection.value !== null)
    .sort((r, l) => l.metrics.detection.value - r.metrics.detection.value || r.name.localeCompare(l.name));
  if (a.length > 1) {
    const r = a[0],
      l = a.at(-1);
    i.push({
      id: "performance-intents",
      title:
        r.metrics.detection.value === l.metrics.detection.value
          ? "Measured intent groups have the same detection rate"
          : `${r.name} has the highest recorded detection rate`,
      body: `${r.name}: ${fmtDecimal(r.metrics.detection.value)}% across ${plural(r.metrics.detection.denominator, "measured answer")}. ${l.name}: ${fmtDecimal(l.metrics.detection.value)}% across ${plural(l.metrics.detection.denominator, "measured answer")}.`,
      meaning:
        "Intent groups use the topic names in the uploaded file. Differences may also reflect the mix of questions, engines and collection runs; they do not by themselves explain a cause.",
      evidence: [
        `${plural(a.length, "intent group")} with detection data`,
        "Full intent results appear in Supporting data",
      ],
    });
    if (r.metrics.detection.value > l.metrics.detection.value) {
      n.push({
        id: "performance-intent-opportunity",
        title: `Explore answers for ${l.name}`,
        detail: `This intent has the lowest recorded detection rate among the measured topic groups (${fmtDecimal(l.metrics.detection.value)}%). Check the actual questions and cited pages to understand what travellers are being shown, then decide whether existing content answers those needs clearly.`,
        expected_impact:
          "A focused content investigation based on a measured topic, without assuming the cause of the difference.",
      });
    }
  }
  if (metrics.sentiment.value !== null) {
    i.push({
      id: "performance-sentiment",
      title: `Recorded sentiment averages ${fmtDecimal(metrics.sentiment.value)} on a \u2212100 to 100 scale`,
      body: `This is the mean of the exported tracked-brand sentiment measurements, scaled from \u22121\u20261 to \u2212100\u2026100, across ${plural(metrics.sentiment.denominator, "answer")}.`,
      meaning:
        "Sentiment describes the tone assigned to mentions in the export. It is a directional signal, rather than a customer satisfaction score.",
      evidence: [
        `${plural(metrics.sentiment.denominator, "answer")} with sentiment`,
        `${plural(metrics.sentiment.missingCount, "answer")} without sentiment`,
      ],
    });
  }
  if (summary.citationCount) {
    i.push({
      id: "performance-citations",
      title: `${plural(summary.citationCount, "cited page")} support the collected answers`,
      body: `Valid citation links appear in ${plural(summary.citedAnswerCount, "answer")}. They cover ${plural(A.sourceDomains.length, "domain")} in the selected period.`,
      meaning:
        "These are the pages referenced in the export, including tracked-brand, ranked-brand and other citations. A citation does not imply that a source belongs to the client.",
      evidence: [
        `${plural(summary.citationCount, "unique URL")}`,
        "Every citation URL is listed in Supporting data",
      ],
    });
    n.push({
      id: "performance-source-opportunity",
      title: "Keep the most frequently cited information current",
      detail:
        "Start with the cited pages most often present in these answers. Check that pages relevant to the client describe services, location and contact details accurately, and use the source list to identify specific corrections or content improvements.",
      expected_impact: "Clearer information on the pages AI answers already reference.",
    });
  }
  return {
    insights: i,
    recommendations: n,
  };
}
function buildClientReport({ client, rows, period, createdBy = "" } = {}) {
  const n = String(client?.id ?? "").trim();
  if (!n || !String(client?.name || "").trim()) {
    throw new Error("Select a client before creating a report.");
  }
  validateRecords(rows, n);
  const o = recordsInPeriod(rows, {
    clientId: n,
    from: period?.from,
    to: period?.to,
  });
  if (!o.length) {
    throw new Error("No Rankscale records match these dates. Choose a period with saved data.");
  }
  const a = summariseRecords(o),
    { engines, daily } = dailyAndEngineCounts(o, period),
    s = engines.map((w) => ({
      ...w,
      displayName: engineLabel(w.engine),
    })),
    c =
      Math.round(
        (Date.parse(`${period.to}T00:00:00.000Z`) - Date.parse(`${period.from}T00:00:00.000Z`)) / DAY_MS,
      ) + 1,
    d = {
      rowCount: a.rowCount,
      answerCount: a.answerCount,
      promptCount: a.promptCount,
      engineCount: a.engineCount,
      dateFrom: a.dateFrom,
      dateTo: a.dateTo,
      activeDayCount: a.dates.length,
      periodDayCount: c,
      daysWithoutRecords: c - a.dates.length,
    },
    B = new Map();
  o.forEach((w) => {
    const z = String(w.source?.name || "").trim() || "Unnamed Rankscale export";
    B.set(z, (B.get(z) || 0) + 1);
  });
  const g = [...B.entries()]
      .map(([w, z]) => ({
        name: w,
        recordCount: z,
      }))
      .sort((w, z) => w.name.localeCompare(z.name)),
    M = promptRows(o),
    h = o.every((w) => w.brandReference && w.sourceFields)
      ? buildPerformance({
          clientId: n,
          rows: o,
          period: period,
        })
      : null,
    U = buildInsights(h),
    I = h?.intents
      .filter((w) => w.metrics.detection.value !== null)
      .sort(
        (w, z) => w.metrics.detection.value - z.metrics.detection.value || w.name.localeCompare(z.name),
      )[0]?.name,
    Q = [...o]
      .filter((w) => String(w.answer || "").trim() && (!I || (w.topic || "Unassigned") === I))
      .sort((w, z) => w.timestamp.localeCompare(z.timestamp) || w.answerId.localeCompare(z.answerId))[0],
    p =
      Q?.answer
        .replace(
          /\\r\\n|\\n/g,
          `
`,
        )
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/\*\*/g, "") || "",
    Y = Q
      ? [
          {
            answerId: Q.answerId,
            date: Q.date,
            engine: Q.engine,
            topic: Q.topic || "Unassigned",
            prompt: Q.prompt,
            excerpt: p.length > 500 ? `${p.slice(0, 500).trimEnd()}\u2026` : p,
            isExcerpt: p.length > 500,
            sourceName: Q.source?.name || "Saved Rankscale import",
            selection: `${I ? "Earliest recorded answer in the topic with the lowest detection rate." : "Earliest recorded answer in the selected dates."} Formatting simplified. One answer does not represent every response.`,
          },
        ]
      : [],
    E = new Set(o.map((w) => JSON.stringify([w.prompt, w.engine]))).size,
    u = d.promptCount * d.engineCount - E,
    F = `${fmtUtcDate(period.from)} \u2013 ${fmtUtcDate(period.to)}`,
    m = [
      {
        id: "report-coverage",
        title: `${plural(d.answerCount, "answer")} in this report`,
        body: `The saved exports contain ${plural(d.answerCount, "distinct answer")} for ${plural(d.promptCount, "question")} across ${plural(d.engineCount, "AI engine")} during ${F}.`,
        meaning:
          "This shows the scope of the evidence available for this period. Answer counts describe the collected data, rather than how well the business performed.",
        evidence: [
          plural(d.rowCount, "source record"),
          `${plural(d.activeDayCount, "day")} with imported data in a ${fmtLocaleNumber(c)}-day period`,
        ],
      },
      {
        id: "engine-coverage",
        title:
          d.engineCount === 1
            ? `The report covers ${s[0].displayName}`
            : `Coverage across ${plural(d.engineCount, "AI engine")}`,
        body:
          s
            .map(
              (w) =>
                `${w.displayName}: ${plural(w.answerCount, "answer")} from ${plural(w.promptCount, "question")}`,
            )
            .join("; ") + ".",
        meaning:
          d.engineCount === 1
            ? "These results describe the engine in the export. They do not show how other engines respond."
            : u
              ? "The engines do not all have the same set of questions in this period. Use matching questions when comparing their answers."
              : "Each engine has at least one answer for every question in this period. The number of runs may still differ, so raw answer counts do not indicate which engine performs best.",
        evidence: [
          `${plural(E, "question-and-engine combination")} ${E === 1 ? "is" : "are"} present`,
          `${plural(u, "combination")} ${u === 1 ? "is" : "are"} absent from the selected data`,
        ],
      },
      {
        id: "date-coverage",
        title: d.daysWithoutRecords
          ? `${plural(d.activeDayCount, "day")} of recorded activity`
          : "Recorded activity covers every selected day",
        body: d.daysWithoutRecords
          ? `There are saved records on ${plural(d.activeDayCount, "day")} between ${fmtUtcDate(period.from)} and ${fmtUtcDate(period.to)}. ${plural(d.daysWithoutRecords, "day")} in this period ${d.daysWithoutRecords === 1 ? "has" : "have"} no imported records.`
          : `At least one imported record is available ${c === 1 ? "on the selected day" : `on each of the ${plural(c, "selected day")}`}.`,
        meaning: d.daysWithoutRecords
          ? "An empty date means no data was imported for that day. It does not mean the business disappeared from AI answers; the tracking schedule or export may simply omit that day."
          : "Daily records make the collection schedule visible. This does not confirm that every question and engine was checked every day.",
        evidence: [
          `First available record: ${fmtUtcDate(d.dateFrom)}`,
          `Last available record: ${fmtUtcDate(d.dateTo)}`,
        ],
      },
    ],
    j = [
      {
        id: "maintain-comparable-questions",
        title: u
          ? "Use matching questions for engine comparisons"
          : "Keep the same questions for the next reporting period",
        detail: u
          ? `${fmtLocaleNumber(u)} of the possible question-and-engine combinations ${u === 1 ? "is" : "are"} absent from these exports. If an engine comparison is needed, collect the missing combinations or compare only the questions shared by those engines.`
          : `Keep ${d.promptCount === 1 ? "this question" : `these ${plural(d.promptCount, "question")}`} and the same engine set for the next collection. A consistent question set makes period-to-period comparisons more useful.`,
        expected_impact: "A fairer comparison based on like-for-like evidence.",
      },
      {
        id: "collection-schedule",
        title: d.daysWithoutRecords
          ? "Check the collection schedule for dates without records"
          : "Maintain a consistent collection schedule",
        detail: d.daysWithoutRecords
          ? `The selected range has ${plural(d.daysWithoutRecords, "day")} without imported records. If checks ran on those dates, upload the missing exports. If collection was scheduled less often, retain that schedule in the next report.`
          : "Continue collecting on the same schedule, with the same questions and engines. Save the full export so future reports can use any reporting dates.",
        expected_impact: "Clearer coverage and fewer gaps in future comparisons.",
      },
      {
        id: "establish-comparison",
        title: "Compare with an equivalent reporting period",
        detail:
          "Use a previous period of similar length with matching questions, engines and collection dates before describing a change in performance. This report summarizes the selected period and does not calculate a before-and-after result.",
        expected_impact:
          "Evidence for whether an observed difference reflects a real change or different data coverage.",
      },
    ];
  return {
    client: {
      id: n,
      name: String(client.name),
      property: String(client.property || client.name),
    },
    period: {
      from: period.from,
      to: period.to,
    },
    createdBy: String(createdBy || ""),
    summary: d,
    performance: h,
    engines: s,
    daily: daily,
    questions: M,
    answerExamples: Y,
    insights: [...m, ...U.insights],
    recommendations: [...j, ...U.recommendations],
    sources: g,
    methodology: [
      "Both reporting dates are included. All dates use UTC.",
      "Records are saved Rankscale source rows. A distinct answer is identified by its source timestamp, AI engine, question, tracked brand reference and answer text; multiple records for the same normalized answer count once.",
      "Questions count unique prompt text; AI engines count unique engine names in the selected period.",
      "Insights and recommended next steps are generated automatically from data coverage and any explicitly recorded performance measurements.",
      ...(h
        ? h.methodology
        : [
            "Performance fields are unavailable in this older import. This report describes data collection only.",
          ]),
    ],
  };
}
export { buildClientReport };
