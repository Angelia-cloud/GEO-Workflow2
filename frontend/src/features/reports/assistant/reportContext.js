const PREPARED_CLIENT = {
    id: "coogee-september-prepared",
    name: "InterContinental Sydney Coogee Beach",
  },
  PREPARED_SECTIONS = {
    glance: "At a glance",
    progress: "Progress since July",
    win: "Where you win",
    plan: "Action plan",
    measure: "How we measure & refine",
    appendix: "Appendix",
  },
  CLIENT_REPORT_SECTIONS = {
    "report-summary": "This period at a glance",
    "report-detail": "Performance detail",
    "report-insights": "Insights & what they mean",
    "report-recommendations": "Recommendations",
    "report-next": "What happens next",
    "report-data": "Supporting data & method",
  },
  fmtNum = (A, e = 1) =>
    Number(A).toLocaleString("en-AU", {
      maximumFractionDigits: e,
    }),
  isNum = (A) => typeof A == "number" && Number.isFinite(A),
  fmtLongUtc = (A) =>
    new Date(`${A}T00:00:00Z`).toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }),
  isIsoDay = (A) =>
    /^\d{4}-\d{2}-\d{2}$/.test(A || "") &&
    !Number.isNaN(Date.parse(`${A}T00:00:00Z`)) &&
    new Date(`${A}T00:00:00Z`).toISOString().slice(0, 10) === A,
  text = (A) => String(A ?? "").trim(),
  sectionSources = (A, e) =>
    e.map((t) => ({
      id: t,
      label: A[t],
    })),
  topic = (A, e, t, i) => ({
    id: A,
    terms: e,
    text: t,
    sources: i,
  }),
  TOPIC_TERMS = {
    summary:
      "summary summarise summarize overview overall headline headlines takeaways takeaway highlights highlight numbers results performance",
    action:
      "action actions recommendation recommendations priority priorities prioritise prioritize first next improve improvement opportunity opportunities do focus plan",
    detection: "detection detect detected appears appear mention mentions mentioned frequency often rate",
    competitor:
      "competitor competitors competition competitive comparison compare versus vs rank ranking win wins winning leader lead outperform",
    engine: "engine engines assistant assistants chatgpt claude gemini copilot bing perplexity google",
    progress:
      "progress trend trends change changes changed growth grew rise rose increase increased uplift baseline august july before previous since",
    method:
      "method methodology measured measure measurement calculated calculate calculation tracking tracked questions question coverage evidence reliable limitations confidence accuracy records answers data",
    source: "source sources citation citations cited cites links website websites domain domains",
    position: "position positions rank ranked ranking average",
    sentiment: "sentiment tone satisfaction",
    visibility: "visibility visible discoverability",
    intent: "intent intents topic topics need needs strongest weakest guest guests",
  },
  DEFAULT_SUGGESTIONS = [
    "Summarise this report",
    "What should we prioritise?",
    "Explain the detection rate",
    "How do we compare with competitors?",
  ];
export { text };
function buildPreparedContext() {
  const A = (...e) => sectionSources(PREPARED_SECTIONS, e);
  return {
    key: "prepared:coogee:2026-09-01:2026-09-30:v1",
    client: {
      ...PREPARED_CLIENT,
    },
    periodLabel: "1\u201330 September 2026",
    ready: true,
    kind: "prepared",
    suggestions: [...DEFAULT_SUGGESTIONS],
    topics: [
      topic(
        "summary",
        TOPIC_TERMS.summary,
        "In September, InterContinental Sydney Coogee Beach appeared in 48.5% of tracked answers and ranked first among the five comparison hotels. The clearest opportunity is small celebrations: only 34 of 247 answers (14%) about birthdays and showers mentioned Shutters or the hotel. The report prioritises a Private Celebrations page and refreshed venue listings.",
        A("glance", "win", "plan"),
      ),
      topic(
        "detection",
        TOPIC_TERMS.detection,
        "Detection Rate is the share of tracked AI answers that mention the hotel. September recorded 879 mentions in 1,814 answers: 48.5%. A mention is not necessarily a recommendation, visit or booking. September is the new comparison reference because the Claude tracking setup changed on 31 August.",
        A("glance", "appendix", "measure"),
      ),
      topic(
        "action",
        `${TOPIC_TERMS.action} shutters celebration celebrations birthday birthdays shower showers`,
        "The first priority is small celebrations. Publish a Private Celebrations page for baby showers, bridal showers and birthdays, with spaces, capacities, menus and an enquiry button. Update the old Crowne Plaza listing on Tagvenue and claim the inactive Shutters listing on VenueNow. This responds to the 14% detection rate for these occasions; it is a recommended action, not a guaranteed uplift.",
        A("plan", "win"),
      ),
      topic(
        "competitor",
        TOPIC_TERMS.competitor,
        "Coogee is first overall among five hotels. Across 17 neutral comparison questions, it leads luxury coastal stays (61%), dining-led discovery (49%) and wellness & spa (46%). It ties Elysium Manly for business / bleisure (34%), and is second to Pier One for family stays (37% vs 40%) and romance & events (23% vs 38%). These percentages are detection rates for each guest need, not booking market share.",
        A("glance", "win", "measure"),
      ),
      topic(
        "engine",
        TOPIC_TERMS.engine,
        "September detection rates across all 22 tracked questions are ChatGPT 68.0%, Claude 58.9%, Bing Copilot 47.7%, Gemini 43.2%, Perplexity 39.2% and Google AI Overviews 32.1%. Claude\u2019s setup changed on 31 August to search the web for every question, so its increase is not a like-for-like measure of website impact.",
        A("appendix", "measure"),
      ),
      topic(
        "progress",
        TOPIC_TERMS.progress,
        "Detection was 45.6% in July, 43.8% in August and 48.5% in September. Most of the August\u2013September rise follows the Claude setting change on 31 August; Claude contributed +3.3 percentage points. Excluding Claude, September is level with July and August. Use September as the reference for future comparisons, rather than treating the rise as proven website or business growth.",
        A("progress", "appendix", "measure"),
      ),
      topic(
        "method",
        TOPIC_TERMS.method,
        "The report tracks 22 guest questions across six AI assistants, approximately every two days, and retains full answers and their cited sources. Detection counts mentions divided by tracked answers. Competitive comparisons use 17 neutral questions, excluding five that name the hotel, its venues or Coogee. The Claude setup changed on 31 August; September is the new reference for consistent future comparisons.",
        A("measure", "appendix"),
      ),
      topic(
        "source",
        `${TOPIC_TERMS.source} tagvenue venuenow sydney.com`,
        "Tagvenue and VenueNow are the most-cited sources in small-celebration answers; the Tagvenue page still uses the Crowne Plaza name. sydney.com appears in 15% of all answers. The report recommends accurate, complete information on these sources. Citations are not visits, and a new or updated listing is not guaranteed to be used.",
        A("appendix", "plan"),
      ),
      topic(
        "romance",
        "romance romantic wellness anniversary proposal couples escapes",
        "Romance & events is second in the comparison set: Coogee appears in 23% of answers versus Pier One at 38%. The report recommends a Romantic Escapes page combining balcony suites, \xC8liva\u2019s couples suite, Rick Stein and current packages, plus an ATDW listing refresh and a Destination NSW pitch. Guide inclusion remains Destination NSW\u2019s decision.",
        A("win", "plan"),
      ),
      topic(
        "name",
        "crowne plaza former old name rebrand redirects redirect accuracy",
        "In September, 72 of 1,814 answers still called the hotel Crowne Plaza. The report recommends matching old URLs to their new pages, retiring IHG\u2019s old hotel page, updating three listing sites and adding \u201Cformerly Crowne Plaza Coogee Beach\u201D to the About page. Former-name mentions already count as detection, so this action improves accuracy rather than the headline score.",
        A("plan", "measure"),
      ),
      topic(
        "visibility",
        TOPIC_TERMS.visibility,
        "This report uses Detection Rate as its headline measure of AI visibility: how often the hotel appears in tracked answers. September detection is 48.5%. It does not provide a September headline Visibility Score; these two measures should not be substituted for one another.",
        A("glance", "measure"),
      ),
      topic(
        "sentiment",
        TOPIC_TERMS.sentiment,
        "The glossary defines Tone score as Rankscale\u2019s rating of the wording when the hotel is mentioned, on a 0\u2013100 scale. This report does not supply a headline September tone score, and it should not be read as a customer satisfaction measure.",
        A("appendix"),
      ),
    ],
  };
}
export { buildPreparedContext };
function hashKey(A) {
  let e = 2166136261;
  for (const t of JSON.stringify(A)) e = Math.imul(e ^ t.charCodeAt(0), 16777619);
  return (e >>> 0).toString(36);
}
function unavailableContext(A) {
  return {
    key: `unavailable:${text(A?.client?.id)}:${text(A?.period?.from)}:${text(A?.period?.to)}`,
    client: A?.client
      ? {
          id: text(A.client.id),
          name: text(A.client.name),
        }
      : null,
    periodLabel: "No report available",
    ready: false,
    kind: "generated",
    suggestions: [],
    topics: [],
  };
}
function buildReportContext(A) {
  if (
    !A?.client?.id ||
    !text(A.client.name) ||
    !isIsoDay(A?.period?.from) ||
    !isIsoDay(A?.period?.to) ||
    A.period.from > A.period.to ||
    !isNum(A?.summary?.answerCount) ||
    A.summary.answerCount < 1 ||
    (A.performance &&
      (String(A.performance.clientId) !== String(A.client.id) ||
        A.performance.period?.from !== A.period.from ||
        A.performance.period?.to !== A.period.to))
  ) {
    return unavailableContext(A);
  }
  const e = (...p) => sectionSources(CLIENT_REPORT_SECTIONS, p),
    t = A.summary,
    i = A.performance,
    n = `${fmtLongUtc(A.period.from)} \u2013 ${fmtLongUtc(A.period.to)}`,
    o = {
      id: String(A.client.id),
      name: text(A.client.name),
    },
    a = (p) => i?.metrics?.[p],
    r = (p) => isNum(a(p)?.value),
    l = `${o.name}: ${fmtNum(t.answerCount, 0)} distinct AI ${t.answerCount === 1 ? "answer" : "answers"}, ${fmtNum(t.promptCount, 0)} ${t.promptCount === 1 ? "question" : "questions"} and ${fmtNum(t.engineCount, 0)} ${t.engineCount === 1 ? "engine" : "engines"} for ${n}.`,
    c = [...(A.recommendations || [])].sort(
      (p, Y) =>
        Number(String(Y.id).startsWith("performance-")) - Number(String(p.id).startsWith("performance-")),
    )[0],
    d = c
      ? `${c.title}. ${c.detail} ${c.expected_impact ? `Why this helps: ${c.expected_impact}` : ""}`
      : "This report does not include a recommendation.",
    B = r("detection")
      ? `Detection is ${fmtNum(a("detection").value)}%, based on ${fmtNum(a("detection").denominator, 0)} answers with a recorded detection outcome.`
      : "Detection measurements are unavailable in this report. Answer counts describe data coverage, not how often the brand is detected.",
    g = [
      topic(
        "summary",
        TOPIC_TERMS.summary,
        `${l} ${B}${c ? ` First recommended next step: ${c.title}.` : ""}`,
        e("report-summary", "report-recommendations"),
      ),
      topic(
        "action",
        TOPIC_TERMS.action,
        `${d} These are suggested next steps from this report; outcomes are not guaranteed.`,
        e("report-recommendations"),
      ),
      topic(
        "detection",
        TOPIC_TERMS.detection,
        `${B} ${r("detection") ? `${fmtNum(a("detection").missingCount, 0)} answers without a detection measurement are excluded. ` : ""}Detection means the explicitly tracked brand is present in an answer. It does not measure traffic or bookings, and no prior-period change is assumed.`,
        e("report-summary", "report-data"),
      ),
      topic(
        "method",
        TOPIC_TERMS.method,
        `${l} ${(A.methodology || []).slice(0, 4).join(" ")} Missing measurements remain unavailable rather than being counted as zero. No previous-period change is inferred.`,
        e("report-data"),
      ),
      topic(
        "progress",
        TOPIC_TERMS.progress,
        "This report summarizes the selected dates. It does not calculate a previous-period baseline or before-and-after change. Use an equivalent period with matching questions, engines and collection dates before claiming improvement.",
        e("report-recommendations", "report-data"),
      ),
    ];
  for (const [p, Y] of [
    ["visibility", "Visibility Score"],
    ["position", "Average Position"],
    ["sentiment", "Sentiment Score"],
  ]) {
    const E = a(p);
    g.push(
      topic(
        p,
        TOPIC_TERMS[p],
        r(p)
          ? `${Y} is ${p === "position" ? "#" : ""}${fmtNum(E.value, 2)}, using ${fmtNum(E.denominator, 0)} measured answers. ${E.definition ? `${E.definition} ` : ""}${fmtNum(E.missingCount, 0)} answers are excluded because the required measurements are unavailable.`
          : `${Y} is unavailable in this report. The uploaded records do not provide the required measurements; it cannot be inferred from answer counts.`,
        e("report-summary", "report-data"),
      ),
    );
  }
  const M = i?.competitors || [];
  g.push(
    topic(
      "competitor",
      `${TOPIC_TERMS.competitor} ${M.map((p) => p.name).join(" ")}`,
      M.length
        ? `Competitors explicitly listed in ranked answers include ${M.slice(0, 5)
            .map(
              (p) =>
                `${p.name}: ${fmtNum(p.mentionCount, 0)} mentions${isNum(p.detection) ? ` (${fmtNum(p.detection)}% detection)` : ""}`,
            )
            .join(
              "; ",
            )}. Competitor detection uses ${fmtNum(i.summary.rankedAnswerCount, 0)} answers with rank columns. The comparison uses the selected prompts; no neutral-question subset or overall market ranking is assumed.`
        : "No competitor measurements are available in this report. Competitors must be explicitly present in the imported ranked-brand fields; no comparison can be inferred from answer counts.",
      e("report-detail", "report-data"),
    ),
  );
  const h = i?.engines || A.engines || [];
  g.push(
    topic(
      "engine",
      `${TOPIC_TERMS.engine} ${h.map((p) => p.engine).join(" ")}`,
      h.length
        ? `The selected report includes ${h.map((p) => `${A.engines?.find((Y) => Y.engine === p.engine)?.displayName || p.engine}: ${fmtNum(p.answerCount, 0)} answers${isNum(p.metrics?.detection?.value) ? `, ${fmtNum(p.metrics.detection.value)}% detection` : ""}`).join("; ")}. Different question sets and collection runs may affect comparisons; answer counts alone do not show which engine performs best.`
        : "No engine breakdown is available in the selected report.",
      e("report-detail", "report-data"),
    ),
  );
  const U = i?.intents || [];
  g.push(
    topic(
      "intent",
      `${TOPIC_TERMS.intent} ${U.map((p) => p.name).join(" ")}`,
      U.length
        ? `Intent results use the topic names in the imported file: ${U.slice(0, 6)
            .map(
              (p) =>
                `${p.name}: ${isNum(p.metrics?.detection?.value) ? `${fmtNum(p.metrics.detection.value)}% detection` : "detection unavailable"} across ${fmtNum(p.answerCount, 0)} answers`,
            )
            .join("; ")}. Differences alone do not establish a cause.`
        : "No measured intent breakdown is available in this report. The topic cannot be inferred from answer counts.",
      e("report-detail", "report-data"),
    ),
  );
  const I = i?.sourceDomains || [],
    Q = A.sources || [];
  g.push(
    topic(
      "source",
      TOPIC_TERMS.source,
      I.length
        ? `The selected records contain ${fmtNum(i.summary.citationCount, 0)} unique cited pages across ${fmtNum(I.length, 0)} domains. Frequently cited domains include ${I.slice(
            0,
            5,
          )
            .map((p) => `${p.domain} (${fmtNum(p.answerCount, 0)} answers)`)
            .join(
              "; ",
            )}. A citation does not establish ownership, source credibility or a visit to that page.`
        : `${Q.length ? `Source files: ${Q.map((p) => p.name).join(", ")}. ` : ""}No valid citation links are available in this report. File coverage should not be treated as website citation performance.`,
      e("report-data"),
    ),
  );
  return {
    key: `generated:${o.id}:${A.period.from}:${A.period.to}:${hashKey(g)}`,
    propertyId: o.id,
    period: { from: A.period.from, to: A.period.to },
    client: o,
    periodLabel: n,
    ready: true,
    kind: "generated",
    suggestions: [...DEFAULT_SUGGESTIONS],
    topics: g,
  };
}
export { buildReportContext };
