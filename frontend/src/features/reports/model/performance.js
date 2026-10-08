import { parseTimestamp, recordsInPeriod } from "../../rankscale/parseRankscale";
const hasValue = (A) =>
    !["", "-", "n/a"].includes(
      String(A ?? "")
        .trim()
        .toLowerCase(),
    ),
  mean = (A) => (A.length ? A.reduce((e, t) => e + t, 0) / A.length : null),
  lowerTrim = (A) =>
    String(A || "")
      .trim()
      .toLowerCase(),
  inRange = (A, e, t = 1 / 0) => Number.isFinite(A) && A >= e && A <= t,
  visibilityFromRank = (A) => 100 / (1 + 0.1 * (A - 1)),
  METRIC_DEFINITIONS = {
    visibility:
      "Calculated using this app's documented formula: 100 \xF7 (1 + 0.1 \xD7 (rank \u2212 1)) for a detected answer; 0 when not detected. Uses the best explicitly detected tracked-brand rank in each answer. It is not an average of the export's latest/24h/7d/30d snapshot fields.",
    detection:
      "Percentage of distinct answers with an explicit brand_found value that detect the tracked brand. Multiple tracked-name records within one answer count once.",
    position:
      "Average best tracked-brand rank among detected answers with a rank. Answers without a detection or rank are excluded.",
    sentiment:
      "Mean exported tracked-brand sentiment \xD7 100, on a \u2212100 to 100 scale. Multiple distinct tracked-name sentiments are averaged within each answer before averaging answers.",
    top3: "Percentage of answers with a known detection and rank outcome that place the tracked brand in positions 1\u20133. Known non-detections count as 0.",
  };
function metricValue(A, e, t) {
  return {
    value: mean(A),
    denominator: A.length,
    missingCount: e - A.length,
    definition: t,
  };
}
function computeMetrics(A) {
  const e = A.filter((o) => o.detected !== null),
    t = A.filter((o) => o.detected === true && o.position !== null),
    i = A.filter((o) => o.detected === false || (o.detected === true && o.position !== null)),
    n = A.filter((o) => o.sentiment !== null);
  return {
    visibility: metricValue(
      i.map((o) => (o.detected ? visibilityFromRank(o.position) : 0)),
      A.length,
      METRIC_DEFINITIONS.visibility,
    ),
    detection: metricValue(
      e.map((o) => (o.detected ? 100 : 0)),
      A.length,
      METRIC_DEFINITIONS.detection,
    ),
    position: metricValue(
      t.map((o) => o.position),
      A.length,
      METRIC_DEFINITIONS.position,
    ),
    sentiment: metricValue(
      n.map((o) => o.sentiment * 100),
      A.length,
      METRIC_DEFINITIONS.sentiment,
    ),
    top3: metricValue(
      i.map((o) => (o.detected && o.position <= 3 ? 100 : 0)),
      A.length,
      METRIC_DEFINITIONS.top3,
    ),
  };
}
function dedupeRecords(A) {
  const e = new Set();
  return A.filter((t) => {
    const i = JSON.stringify(
        Object.keys(t.sourceFields || {})
          .sort()
          .map((o) => [o, t.sourceFields[o]]),
      ),
      n = JSON.stringify([t.id, t.answerId, i]);
    return e.has(n) ? false : (e.add(n), true);
  });
}
function groupAnswers(A) {
  const e = new Map();
  for (const t of A) {
    if (!e.has(t.answerId)) {
      e.set(t.answerId, []);
    }
    e.get(t.answerId).push(t);
  }
  return [...e.entries()].map(([t, i]) => {
    const n = i.filter((r) => r.brandFound === true),
      o = n.map((r) => r.brandRank).filter((r) => inRange(r, 1)),
      a = new Map();
    for (const r of n) {
      if (inRange(r.sentiment, -1, 1)) {
        a.set(JSON.stringify([lowerTrim(r.brandNameMentioned), r.brandRank, r.sentiment]), r.sentiment);
      }
    }
    return {
      answerId: t,
      records: i,
      date: i[0].date,
      timestamp: i[0].timestamp,
      engine: i[0].engine,
      prompt: i[0].prompt,
      topics: [...new Set(i.map((r) => r.topic).filter(Boolean))],
      detected: n.length ? true : i.some((r) => r.brandFound === false) ? false : null,
      position: o.length ? Math.min(...o) : null,
      sentiment: mean([...a.values()]),
    };
  });
}
function groupBy(A, e, t) {
  const i = new Map();
  for (const n of A)
    for (const o of new Set([e(n)].flat())) {
      if (!i.has(o)) {
        i.set(o, []);
      }
      i.get(o).push(n);
    }
  return [...i.entries()]
    .map(([n, o]) => ({
      [t]: n,
      answerCount: o.length,
      promptCount: new Set(o.map((a) => a.prompt)).size,
      metrics: computeMetrics(o),
    }))
    .sort((n, o) => o.answerCount - n.answerCount || n[t].localeCompare(o[t]));
}
function parseUrls(A) {
  if (!hasValue(A)) {
    return [];
  }
  const e = String(A).split(/[,;\n\r]+\s*(?=https?:\/\/)/i),
    t = new Set();
  for (const i of e)
    try {
      const n = new URL(i.trim());
      if (!["https:", "http:"].includes(n.protocol) || n.username || n.password) {
        continue;
      }
      n.hash = "";
      t.add(n.href);
    } catch {}
  return [...t];
}
function citationRows(A) {
  const e = new Map();
  for (const i of A)
    for (const n of i.records)
      for (const [o, a] of Object.entries(n.sourceFields || {})) {
        const r =
          o === "brand_citations"
            ? "Tracked brand"
            : o === "other_citations"
              ? "Other citation"
              : /^rank\d+_citations$/.test(o)
                ? "Ranked brand"
                : null;
        if (r) {
          for (const l of parseUrls(a)) {
            if (!e.has(l)) {
              e.set(l, {
                url: l,
                domain: new URL(l).hostname,
                answers: new Set(),
                types: new Set(),
              });
            }
            e.get(l).answers.add(i.answerId);
            e.get(l).types.add(r);
          }
        }
      }
  const t = new Map();
  for (const i of e.values()) {
    if (!t.has(i.domain)) {
      t.set(i.domain, {
        domain: i.domain,
        urls: new Set(),
        answers: new Set(),
        types: new Set(),
      });
    }
    const n = t.get(i.domain);
    n.urls.add(i.url);
    i.answers.forEach((o) => n.answers.add(o));
    i.types.forEach((o) => n.types.add(o));
  }
  return {
    sources: [...e.values()]
      .map(({ url, domain, answers, types }) => ({
        url: url,
        domain: domain,
        answerCount: answers.size,
        types: [...types].sort(),
      }))
      .sort((i, n) => n.answerCount - i.answerCount || i.url.localeCompare(n.url)),
    sourceDomains: [...t.values()]
      .map(({ domain, urls, answers, types }) => ({
        domain: domain,
        urlCount: urls.size,
        answerCount: answers.size,
        types: [...types].sort(),
      }))
      .sort((i, n) => n.answerCount - i.answerCount || i.domain.localeCompare(n.domain)),
    citedAnswerCount: new Set([...e.values()].flatMap((i) => [...i.answers])).size,
  };
}
function brandRows(A) {
  let e = new Set(
      A.flatMap((n) =>
        n.records.flatMap((o) => [
          o.brandReference,
          ...(o.brandFound === true ? [o.brandNameMentioned] : []),
        ]),
      )
        .filter(hasValue)
        .map(lowerTrim),
    ),
    t = new Map(),
    i = 0;
  for (const n of A) {
    let o = new Map(),
      a = false;
    for (const r of n.records)
      for (const [l, s] of Object.entries(r.sourceFields || {})) {
        const c = l.match(/^rank(\d+)_brandname$/);
        if (!c || ((a = true), !hasValue(s) || e.has(lowerTrim(s)))) {
          continue;
        }
        const d = lowerTrim(s),
          B = Number(c[1]),
          g = r.sourceFields[`rank${B}_sentiment`],
          M = hasValue(g) ? Number(g) : null,
          h = o.get(d);
        if (!h || B < h.rank) {
          o.set(d, {
            name: String(s).trim(),
            rank: B,
            sentiment: inRange(M, -1, 1) ? M : null,
          });
        }
      }
    if (a) {
      i++;
    }
    for (const [r, l] of o) {
      if (!t.has(r)) {
        t.set(r, {
          name: l.name,
          mentions: [],
        });
      }
      t.get(r).mentions.push(l);
    }
  }
  return {
    rankedAnswerCount: i,
    competitors: [...t.values()]
      .map(({ name, mentions }) => ({
        name: name,
        isTracked: false,
        answerCount: i,
        mentionCount: mentions.length,
        detection: i ? (mentions.length / i) * 100 : null,
        position: mean(mentions.map((a) => a.rank)),
        sentiment: mean(mentions.filter((a) => a.sentiment !== null).map((a) => a.sentiment * 100)),
      }))
      .sort((n, o) => o.mentionCount - n.mentionCount || n.name.localeCompare(o.name)),
  };
}
function buildPerformance({ clientId, client, rows, period, brandReference } = {}) {
  const o = String(clientId ?? client?.id ?? "").trim();
  if (!Array.isArray(rows)) {
    throw new Error("Saved Rankscale records are required.");
  }
  const a = recordsInPeriod(rows, {
    clientId: o,
    from: period?.from,
    to: period?.to,
  });
  for (const U of a) {
    if (!U.answerId || !U.engine || !U.prompt || !U.brandReference || !U.sourceFields) {
      throw new Error("Rankscale records must be normalized before reporting.");
    }
    if (parseTimestamp(U.timestamp).date !== U.date) {
      throw new Error("A saved Rankscale record has an inconsistent UTC date.");
    }
  }
  const r = [...new Set(a.map((U) => U.brandReference))].sort();
  if (brandReference && !r.includes(brandReference)) {
    throw new Error("This tracked brand reference has no records in the selected period.");
  }
  const l = dedupeRecords(brandReference ? a.filter((U) => U.brandReference === brandReference) : a),
    s = groupAnswers(l),
    c = groupBy(s, (U) => U.engine, "engine"),
    d = groupBy(s, (U) => (U.topics.length ? U.topics : ["Unassigned"]), "name"),
    B = groupBy(s, (U) => U.date, "date").sort((U, I) => U.date.localeCompare(I.date)),
    g = groupBy(s, (U) => U.prompt, "prompt").map((U) => ({
      ...U,
      topic:
        [...new Set(s.filter((I) => I.prompt === U.prompt).flatMap((I) => I.topics))].join(" \xB7 ") ||
        "Unassigned",
    })),
    M = citationRows(s),
    h = brandRows(s);
  return {
    clientId: o,
    period: {
      from: period.from,
      to: period.to,
    },
    brandReferences: r,
    selectedBrand: brandReference || "All tracked brand references",
    summary: {
      recordCount: l.length,
      answerCount: s.length,
      promptCount: g.length,
      engineCount: c.length,
      intentCount: d.filter((U) => U.name !== "Unassigned").length,
      citationCount: M.sources.length,
      citedAnswerCount: M.citedAnswerCount,
      rankedAnswerCount: h.rankedAnswerCount,
      activeDayCount: B.length,
    },
    metrics: computeMetrics(s),
    engines: c,
    intents: d,
    competitors: h.competitors,
    sources: M.sources,
    sourceDomains: M.sourceDomains,
    trend: B,
    daily: B,
    prompts: g,
    methodology: [
      "Reporting dates are inclusive and use UTC. Records belong only to the selected client.",
      "A distinct answer uses the imported normalized answer ID: timestamp, engine, question, tracked brand reference and answer text. Repeated tracked-name rows within an answer count once; different tracked brand references remain separate observations.",
      "Tracked-brand identity comes from the explicit brand_reference and brand_found fields, never from guessing the client name. When several tracked names are detected in an answer, the best rank is used and their distinct sentiment measurements are averaged.",
      METRIC_DEFINITIONS.visibility,
      "Missing measurements are excluded from the relevant metric denominator and remain unavailable rather than being treated as zero. No prior-period baseline or change is inferred.",
      "Competitors are names explicitly listed in rankN_brandname columns, excluding explicitly tracked references and detected tracked names. Competitor detection uses answers with rank columns. Name spelling variants are not merged. These comparisons cover the selected prompts; no neutral-prompt subset is assumed.",
      "Citation counts deduplicate each valid source URL per answer, across brand, other and ranked-brand citation fields. A cited source is not necessarily owned by the tracked brand. No source category or credibility is inferred from its domain.",
      "Intent groups use the exported topic_name. Unassigned topics remain unassigned. Missing dates do not represent zero performance.",
    ],
  };
}
export { buildPerformance };
