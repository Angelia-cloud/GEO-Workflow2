/**
 * Turns the stored-measurement report (`/api/monthly/...`) and the opportunity assessment
 * (`/api/opportunities/...`) into everything the client report shows, in the approved layout
 * (IC Coogee September 2026 reference). Nothing here is fixed text about one hotel or one month:
 * every figure, name, date and ranking comes from the imported Rankscale data for the applied dates.
 */
import { stripTags } from "./format.js";

/* ---------- formatting ---------- */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON = MONTHS.map((m) => m.slice(0, 3));
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const RANK_WORDS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

export const num = (v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
export const d1 = (v) => (num(v) == null ? "n/a" : Number(v).toFixed(1));
export const pct0 = (v) => (num(v) == null ? "n/a" : `${Math.round(Number(v))}%`);
export const pct1 = (v) => (num(v) == null ? "n/a" : `${Number(v).toFixed(1)}%`);
/** 1 decimal, dropping a trailing ".0" (the reference tooltip format). */
export const pctTip = (v) => (num(v) == null ? "no data" : `${(Math.round(Number(v) * 10) / 10).toFixed(1).replace(/\.0$/, "")}%`);
export const signed1 = (v) => `${Number(v) > 0 ? "+" : Number(v) < 0 ? "−" : ""}${Math.abs(Number(v)).toFixed(1)}`;
export const count = (v) => Number(v || 0).toLocaleString("en-AU");
export const word = (n) => (n >= 0 && n < WORDS.length ? WORDS[n] : String(n));
export const capital = (s = "") => s.charAt(0).toUpperCase() + s.slice(1);

export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

const parseDay = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return { y, m, d };
};
/** "15 Jul" */
export const dayMon = (iso) => { const { m, d } = parseDay(iso); return `${d} ${MON[m - 1]}`; };
/** "15 July" */
export const dayMonth = (iso) => { const { m, d } = parseDay(iso); return `${d} ${MONTHS[m - 1]}`; };
/** "15 July 2026" */
export const dayMonthYear = (iso) => { const { y, m, d } = parseDay(iso); return `${d} ${MONTHS[m - 1]} ${y}`; };
export const monthOf = (iso) => MONTHS[parseDay(iso).m - 1];

export function listJoin(items) {
  const xs = items.filter(Boolean);
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** Short hotel names as the reference uses them (e.g. "Pier One", "IC Double Bay", "The Langham"). */
export function hotelShort(name = "") {
  return name
    .replace(/\s*\(.*?\)/g, "")
    .replace(/^InterContinental Sydney /, "IC ")
    .replace(/^InterContinental /, "IC ")
    .replace(/ Sydney Harbour$/, "")
    .replace(/, Sydney$/, "")
    .trim();
}

/** The client's own hotel, short: brand and city words removed ("InterContinental Sydney Coogee Beach" → "Coogee Beach"). */
export function selfShort(name = "") {
  const short = name
    .replace(/\s*\(.*?\)/g, "")
    .replace(/^(InterContinental|Crowne Plaza|Holiday Inn( Express)?|voco|Hotel Indigo|Kimpton|Regent|Six Senses|Vignette|Even Hotels|Hotel)\s+/i, "")
    .replace(/^(Sydney|Melbourne|Brisbane|Perth|Adelaide|Canberra(?= \S))\s+/i, "")
    .trim();
  return short || name;
}

/** "nearly half", "about a third"… for a percentage. */
export function shareWords(p) {
  if (p == null) return "an unknown share";
  const bands = [
    [95, "almost all"], [80, "most"], [70, "about three in four"], [63, "about two thirds"], [55, "more than half"],
    [50, "about half"], [44, "nearly half"], [38, "about two in five"], [30, "about a third"], [23, "about a quarter"],
    [17, "about one in five"], [12, "about one in seven"], [7, "about one in ten"], [0, "very few"],
  ];
  return (bands.find(([min]) => p >= min) || bands[bands.length - 1])[1];
}

/* ---------- period ---------- */
function periodInfo(data) {
  const custom = !!data.range?.custom;
  const month = monthOf(data.range.to);
  const sameMonth = data.range.from.slice(0, 7) === data.range.to.slice(0, 7);
  const name = custom ? `${dayMon(data.range.from)} – ${dayMon(data.range.to)}` : month;
  const { y, m } = parseDay(data.range.to);
  const next = MONTHS[m % 12];
  const cmp = data.comparison || {};
  const previousName = cmp.available
    ? (cmp.previous_month ? MONTHS[Number(cmp.previous_month.slice(5, 7)) - 1] : `the previous ${dayDiff(data.range.from, data.range.to) + 1} days`)
    : null;
  return {
    custom, name, month, next, year: y, sameMonth,
    in: custom ? `Between ${dayMon(data.range.from)} and ${dayMonthYear(data.range.to)}` : `In ${month}`,
    inLower: custom ? `between ${dayMon(data.range.from)} and ${dayMon(data.range.to)}` : `in ${month}`,
    previousName,
  };
}

function dayDiff(a, b) {
  return Math.round((Date.UTC(...ymd(b)) - Date.UTC(...ymd(a))) / 86400000);
}
const ymd = (iso) => { const { y, m, d } = parseDay(iso); return [y, m - 1, d]; };

/* ---------- comparison set ---------- */
function rankRows(selfName, selfDetection, competitors) {
  const rows = [{ name: selfName, short: selfShort(selfName), detection: num(selfDetection), self: true },
    ...competitors.filter((c) => !c.is_self).map((c) => ({
      name: c.display_name || c.name, short: hotelShort(c.display_name || c.name), detection: num(c.detection), self: false,
    }))];
  rows.sort((a, b) => (b.detection ?? -1) - (a.detection ?? -1));
  const self = rows.find((r) => r.self);
  const rank = self?.detection == null ? null : 1 + rows.filter((r) => !r.self && (r.detection ?? -1) > self.detection).length;
  const tie = self?.detection != null && rows.some((r) => !r.self && r.detection === self.detection);
  return { rows, rank, tie, total: rows.length, self };
}

function previousRanking(data) {
  const prev = data.comparison?.previous_month;
  if (!prev) return null;
  const entry = (data.competitor_trend || []).find((t) => t.month === prev);
  if (!entry?.hotel) return null;
  return rankRows(data.property.name, entry.hotel.detection, entry.competitors || []);
}

/* ---------- guest needs (intents) ---------- */
function intentTable(data) {
  const rows = (data.intent_competitors || []).map((r) => {
    const cells = [{ name: data.property.name, short: selfShort(data.property.name), v: num(r.hotel.detection), self: true },
      ...r.competitors.map((c) => ({ name: c.name, short: hotelShort(c.name), v: num(c.detection), self: false }))];
    const best = Math.max(...cells.map((c) => c.v ?? -1));
    const leaders = cells.filter((c) => c.v === best);
    const own = cells[0].v;
    const rank = 1 + cells.filter((c) => !c.self && (c.v ?? -1) > (own ?? -1)).length;
    const tie = rank === 1 && leaders.length > 1;
    return { intent: r.intent, questions: r.questions ?? null, answers: r.answers, cells, best, leaders, rank, tie, own };
  });
  rows.sort((a, b) => (a.rank - b.rank) || (Number(a.tie) - Number(b.tie)) || ((b.own ?? 0) - (a.own ?? 0)));
  const competitorNames = (data.intent_competitors?.[0]?.competitors || []).map((c) => hotelShort(c.name));
  return { rows, competitorNames };
}

function winStatement(data, ranking, table, period) {
  const short = selfShort(data.property.name);
  const lead = ranking.rank === 1
    ? (ranking.tie ? `Overall, ${short} is level first among the hotels in the comparison set.` : `Overall, ${short} remains the most frequently mentioned hotel in the comparison set.`)
    : ranking.rank ? `Overall, ${short} ranks ${ordinal(ranking.rank)} in the comparison set, behind ${ranking.rows[0].short}.` : `No comparison is available for ${period.name}.`;
  const first = table.rows.filter((r) => r.rank === 1 && !r.tie).map((r) => r.intent.toLowerCase());
  const tied = table.rows.filter((r) => r.tie).map((r) => r.intent.toLowerCase());
  const lower = {};
  table.rows.filter((r) => r.rank > 1).forEach((r) => { (lower[r.rank] ||= []).push(r.intent.toLowerCase()); });
  const parts = [];
  if (first.length) parts.push({ pre: "ranks ", strong: "1st", post: ` for ${listJoin(first)}` });
  if (tied.length) parts.push({ pre: "ties for ", strong: "1st", post: ` in ${listJoin(tied)}` });
  Object.keys(lower).sort((a, b) => a - b).forEach((r) => parts.push({ pre: "ranks ", strong: ordinal(Number(r)), post: ` for ${listJoin(lower[r])}` }));
  return { lead, parts };
}

/* ---------- opportunity ---------- */
function pickOpportunity(opportunities, table) {
  if (!opportunities) return null;
  const gaps = opportunities.filter((o) => o.visibility.status === "gap").sort((a, b) => (b.visibility.gap_points ?? 0) - (a.visibility.gap_points ?? 0));
  let item = gaps[0];
  if (!item) {
    const weakest = [...table.rows].sort((a, b) => (a.own ?? 0) - (b.own ?? 0))[0];
    item = weakest && opportunities.find((o) => o.intent === weakest.intent);
  }
  if (!item) return null;
  const engines = [...(item.evidence?.engines || [])]
    .map((e) => ({ ...e, mentions: e.mentions ?? Math.round((num(e.detection) || 0) * e.answers / 100) }))
    .sort((a, b) => (b.mentions - a.mentions) || (b.answers - a.answers) || a.engine.localeCompare(b.engine));
  const answers = engines.reduce((s, e) => s + e.answers, 0);
  const mentions = engines.reduce((s, e) => s + e.mentions, 0);
  const share = answers ? (100 * mentions) / answers : null;
  return { item, intent: item.intent, engines, answers, mentions, share, isGap: item.visibility.status === "gap" };
}

/* ---------- trend ---------- */
export function trendModel(data) {
  const trend = data.period_trend || [];
  const firstDay = data.available_months?.[0]?.first_day || trend[0]?.from;
  const startIsPartial = trend.length > 1 && trend[0].partial && firstDay && firstDay > trend[0].from;
  const labels = trend.map((t, i) => (i === 0 && startIsPartial ? `${dayMon(firstDay)} (start)` : t.label));
  const periodNames = trend.map((t, i) => (i === 0 && startIsPartial ? `${dayMon(firstDay)} · starting point` : t.label));
  const all = trend.map((t) => num(t.detection));
  const competitorNames = [...new Set(trend.flatMap((t) => (t.comparison?.competitors || []).filter((c) => !c.is_self).map((c) => c.name)))];
  const comparison = [
    { name: selfShort(data.property.name), cls: "own", values: trend.map((t) => num(t.comparison?.hotel?.detection)) },
    ...competitorNames.map((name, i) => ({
      name: hotelShort(name), cls: `c${(i % 5) + 2}`,
      values: trend.map((t) => num((t.comparison?.competitors || []).find((c) => c.name === name)?.detection)),
    })),
  ];
  const milestones = [];
  (data.website_work || []).forEach((w) => {
    const index = trend.findIndex((t) => w.done_on >= t.from && w.done_on <= t.to);
    if (index < 0) return;
    const existing = milestones.find((m) => m.index === index);
    const text = `${dayMon(w.done_on)} · ${w.title}`;
    if (existing) existing.label = `${existing.label}; ${w.title}`;
    else milestones.push({ index, label: text, date: w.done_on, title: w.title });
  });
  const firstSelected = trend.findIndex((t) => t.selected_period);
  const baseline = data.baseline && trend.length > 1 ? {
    ...data.baseline,
    toIndex: firstSelected > 0 ? firstSelected - 1 : trend.length - 1,
  } : null;
  return {
    trend, labels, periodNames, all, comparison, milestones, baseline, startIsPartial, firstDay,
    trackedQuestions: data.coverage?.tracked_questions || trend.at(-1)?.tracked_questions || 0,
    comparisonQuestions: data.coverage?.comparison_questions || trend.at(-1)?.comparison?.questions || 0,
  };
}

/* ---------- AI assistants ---------- */
function engineContributions(data) {
  const cmp = data.comparison;
  if (!cmp?.available) return [];
  const rows = (cmp.engines || []).filter((e) => e.previous_answers != null && e.answers != null);
  const N = cmp.current_answers || rows.reduce((s, e) => s + e.answers, 0);
  const P = cmp.previous_answers || rows.reduce((s, e) => s + e.previous_answers, 0);
  if (!N || !P) return [];
  const out = rows.map((e) => ({
    name: e.name, detection: num(e.detection), previous: num(e.previous_detection),
    effect: (e.answers / N) * (num(e.detection) || 0) - (e.previous_answers / P) * (num(e.previous_detection) || 0),
    answers: e.answers, previousAnswers: e.previous_answers,
  }));
  const max = Math.max(...out.map((e) => Math.abs(e.effect)), 0.0001);
  return out.sort((a, b) => b.effect - a.effect).map((e) => ({ ...e, width: Math.round((Math.abs(e.effect) / max) * 94) }));
}

function engineMonths(data) {
  const months = (data.monthly_trend || []).filter((m) => m.month <= data.month);
  const names = [...new Set(months.flatMap((m) => m.engines.map((e) => e.name)))];
  const byEngine = names.map((name) => ({
    name, values: months.map((m) => num(m.engines.find((e) => e.name === name)?.detection)),
  })).sort((a, b) => (b.values.at(-1) ?? -1) - (a.values.at(-1) ?? -1));
  return { months: months.map((m) => MONTHS[Number(m.month.slice(5, 7)) - 1]), monthKeys: months.map((m) => m.month), engines: byEngine, raw: months };
}

/* ---------- action plan ---------- */
const priorityChip = (gap, i) => (gap >= 10 || i === 0 ? ["High priority", "chip-bad"] : gap >= 5 ? ["Medium priority", "chip-warn"] : ["Low priority", "chip-neutral"]);

function actions(data, opportunities, period) {
  if (!opportunities) return null;
  const recs = data.findings?.recommendations || [];
  const short = selfShort(data.property.name);
  return opportunities
    .filter((o) => o.visibility.status === "gap")
    .sort((a, b) => (b.visibility.gap_points ?? 0) - (a.visibility.gap_points ?? 0))
    .map((o, i) => {
      const v = o.visibility;
      const engines = (o.evidence?.engines || []).map((e) => ({ ...e, mentions: e.mentions ?? Math.round((num(e.detection) || 0) * e.answers / 100) }));
      const answers = engines.reduce((s, e) => s + e.answers, 0) || v.answers;
      const mentions = engines.reduce((s, e) => s + e.mentions, 0);
      const leader = hotelShort(v.top_competitor || "");
      const leaderDetection = (o.competitor_evidence || []).find((c) => c.name === v.top_competitor)?.detection;
      const domains = [...new Map((o.evidence?.citations || []).map((c) => [c.domain, c])).values()].slice(0, 3).map((c) => c.domain).filter(Boolean);
      const mine = recs.filter((r) => (r.intent || "").toLowerCase() === o.intent.toLowerCase());
      const owners = [...new Set(mine.map((r) => r.owner).filter(Boolean))];
      const due = mine.map((r) => r.due_date).filter(Boolean).sort()[0];
      const strong = engines.filter((e) => e.answers && e.mentions / e.answers >= 0.4).map((e) => e.engine);
      const weak = engines.filter((e) => e.answers && e.mentions / e.answers < 0.15).map((e) => e.engine);
      const [label, cls] = priorityChip(v.gap_points ?? 0, i);
      const p = o.commercial?.priority;
      return {
        n: i + 1, item: o, intent: o.intent, priority: label, priorityClass: cls,
        effort: `${count(answers)} answers · ${engines.length} AI assistants · ${d1(v.gap_points)}-point gap to ${leader}`,
        title: `Get chosen for ${o.intent.toLowerCase()}`,
        action: o.proposed_action
          ? { strong: o.proposed_action.text, rest: (o.other_actions || []).length ? ` Also: ${listJoin(o.other_actions)}.` : "" }
          : { strong: `Make ${short} easier for AI to find for ${o.intent.toLowerCase()}`, rest: domains.length ? `: update the hotel's pages and listings on the sources AI already cites for these questions (${listJoin(domains)}).` : ": publish a page that answers these guest questions directly." },
        who: o.commercial?.status === "Commercially validated" && p
          ? `Priority confirmed${p.confirmed_by_name ? ` by ${p.confirmed_by_name}` : ""} (${p.evidence_source}).${owners.length ? ` Owner: ${listJoin(owners)}.` : ""}`
          : owners.length ? `${listJoin(owners)} · the hotel confirms priority and timing.` : "Agency drafts the change · the hotel confirms priority, owner and timing (not yet recorded).",
        why: `Only ${pct0(answers ? (100 * mentions) / answers : v.hotel_detection)} of answers about ${o.intent.toLowerCase()} mention ${short}${leaderDetection != null ? `, against ${pct0(leaderDetection)} for ${leader}` : ""}.`
          + (strong.length ? ` ${listJoin(strong)} already mention${strong.length === 1 ? "s" : ""} the hotel often;` : "")
          + (weak.length ? ` ${listJoin(weak)} rarely or never ${weak.length === 1 ? "does" : "do"}.` : strong.length ? " the gap is with the other assistants." : ""),
        timing: `${due ? `Due ${dayMonthYear(due)}. ` : ""}We re-measure these questions on the next Rankscale import and compare them with questions the change does not touch.`,
        evidence: {
          engines: [...engines].sort((a, b) => (b.mentions / (b.answers || 1)) - (a.mentions / (a.answers || 1))),
          citations: o.evidence?.citations || [],
          weakest: o.evidence?.weakest_prompts || [],
          competitors: o.competitor_evidence || [],
          answers, mentions,
        },
        plan: mine.slice(0, 5),
      };
    });
}

/* ---------- main ---------- */
export function buildReportModel(data, opportunities) {
  const period = periodInfo(data);
  const short = selfShort(data.property.name);
  const engines = data.engines || [];
  const det = num(data.overall?.detection);
  const cmp = data.comparison || {};
  const change = cmp.available ? num(cmp.metrics?.detection?.change) : null;
  const ranking = data.hotel_neutral ? rankRows(data.property.name, data.hotel_neutral.detection, data.competitors || []) : { rows: [], rank: null };
  const prevRanking = previousRanking(data);
  const table = intentTable(data);
  const opp = pickOpportunity(opportunities, table);
  const trend = trendModel(data);
  const firstDay = trend.firstDay || data.range.from;
  const tracked = trend.trackedQuestions;
  const neutralQ = trend.comparisonQuestions;
  const steady = change != null && Math.abs(change) < 2;
  const inName = period.custom ? "the selected dates" : period.name;

  /* headline */
  const rankPhrase = ranking.rank === 1
    ? { verb: prevRanking?.rank === 1 ? "stayed" : prevRanking?.rank ? "moved up to" : "ranked",
        strong: ranking.tie ? "level first among the comparison hotels" : "first among the comparison hotels" }
    : ranking.rank ? { verb: "ranked", strong: `${RANK_WORDS[ranking.rank] || ordinal(ranking.rank)} of the ${ranking.total} comparison hotels` } : null;
  const movement = change == null ? "This period becomes the reference point for future comparison."
    : steady ? `Compared with ${period.previousName}, performance was steady.`
      : `Compared with ${period.previousName}, detection ${change > 0 ? "rose" : "fell"} by ${Math.abs(change).toFixed(1)} points.`;
  const headline = {
    lead: `${period.in}, your hotel appeared in ${shareWords(det)} of the tracked AI answers`,
    rank: rankPhrase,
    movement,
    opportunity: opp ? `${short} easier for AI to find for ${opp.intent.toLowerCase()}` : null,
  };

  /* vital signs */
  const detChip = change == null ? "New reference point" : steady ? "Steady" : `${signed1(change)} pts vs ${period.previousName}`;
  const detText = change == null
    ? `${pct1(det)} of ${count(data.overall?.answers)} tracked answers mentioned the hotel. With no earlier period to compare, ${period.name} becomes the reference point for future months.`
    : `${steady ? "Steady" : change > 0 ? "Up" : "Down"}. Detection moved from ${pct1(cmp.metrics.detection.previous)} in ${period.previousName} to ${pct1(det)} in ${inName}${cmp.basis === "matched_days" ? " (compared on the days both periods cover)" : ""}.`;
  const posChip = !ranking.rank ? null : !prevRanking?.rank ? "New reference point" : prevRanking.rank === ranking.rank ? "Consistent" : prevRanking.rank > ranking.rank ? `Up from ${ordinal(prevRanking.rank)}` : `Down from ${ordinal(prevRanking.rank)}`;
  const second = ranking.rows?.find((r) => !r.self);
  const gapToNext = ranking.rank === 1 && second ? (ranking.self.detection - second.detection) : null;
  const posText = !ranking.rank ? `No comparison-hotel data is available for ${period.name}.`
    : ranking.rank === 1 ? `${short} ${gapToNext != null && gapToNext >= 5 ? "remained clearly ahead of" : "stayed narrowly ahead of"} the comparison hotels in ${inName} (${pct1(ranking.self.detection)} vs ${second.short} ${pct1(second.detection)}).`
      : `${short} was behind ${ranking.rows[0].short} in ${inName} (${pct1(ranking.self.detection)} vs ${pct1(ranking.rows[0].detection)}) on the ${neutralQ} comparison questions.`;

  /* progress timeline */
  const monthly = (data.monthly_trend || []).filter((m) => m.month <= data.month);
  const timeline = [];
  if (trend.trend.length) {
    timeline.push({ d: dayMonth(firstDay), t: "Tracking starts", p: `Starting point: ${pct0(trend.all[0])} of answers.` });
  }
  // Between the start and the reporting period: logged website work first, then earlier months (max two cards).
  const middle = (data.website_work || []).slice(-2).map((w) => ({
    key: w.done_on, d: dayMonth(w.done_on), t: w.title,
    p: w.intent ? `Website work for ${w.intent.toLowerCase()} questions.` : "Website work logged as done.",
  }));
  monthly.filter((m) => m.month < data.range.from.slice(0, 7)).reverse().forEach((m) => {
    if (middle.length >= 2) return;
    middle.push({ key: `${m.month}-31`, d: MONTHS[Number(m.month.slice(5, 7)) - 1], t: `${d1(m.detection)}% Detection Rate`,
      p: `${count(m.answers)} tracked answers${m.partial ? ` (${m.partial_reason})` : ""}.` });
  });
  middle.sort((a, b) => a.key.localeCompare(b.key)).forEach(({ key, ...card }) => timeline.push(card));
  timeline.push({ d: period.custom ? `${dayMon(data.range.from)} – ${dayMon(data.range.to)}` : period.month, t: `${d1(det)}% Detection Rate`, p: change == null ? "Reference point for future comparison." : `${signed1(change)} points on ${period.previousName}. Reference point for future comparison.` });

  /* website work grid */
  const work = (data.website_work || []).map((w) => {
    const diff = w.after_detection != null && w.before_detection != null ? w.after_detection - w.before_detection : null;
    const read = w.state !== "complete" ? "Too early to tell" : diff == null ? "No reading" : diff >= 5 ? "Rising" : diff <= -5 ? "Falling" : "Steady";
    const means = w.after_answers
      ? `On the questions this work targets, the hotel was mentioned in ${pct0(w.before_detection)} of ${count(w.before_answers)} answers before and ${pct0(w.after_detection)} of ${count(w.after_answers)} answers after (${w.window_days}-day windows${w.state === "partial window" ? ", after window still filling" : ""}).`
      : `Logged as done on ${dayMonthYear(w.done_on)}; the after-window has no measured answers yet.`;
    return { title: w.title, status: `Live ${dayMon(w.done_on)}`, read, means: w.note ? `${means} ${w.note}` : means };
  });
  const plan = actions(data, opportunities, period);

  /* methodology */
  const days = data.coverage?.days_with_data || 0;
  const cadence = days ? Math.max(1, Math.round((data.coverage.calendar_days || days) / days)) : null;
  const namedQ = Math.max(0, tracked - neutralQ);

  /* appendix: reach finding */
  const reach = monthly.slice(-3).map((m) => ({
    name: MONTHS[Number(m.month.slice(5, 7)) - 1], found: Math.round((m.detection * m.answers) / 100), answers: m.answers, detection: m.detection,
  })).reverse();
  const contributions = engineContributions(data);
  const sources = data.sources || [];
  const assistants = engineMonths(data);

  return {
    period, short, property: data.property.name, det, change, steady, ranking, prevRanking, table, opp, trend,
    tracked, neutralQ, namedQ, engines, cadence, firstDay, headline,
    vitals: { detChip, detText, posChip, posText },
    timeline, work, plan, reach, contributions, sources, assistants,
    win: winStatement(data, ranking, table, period),
    footer: {
      period: `${dayMonth(firstDay)} – ${dayMonthYear(data.range.to)} (focus: ${period.custom ? `${dayMon(data.range.from)} – ${dayMon(data.range.to)}` : period.month})`,
      answers: data.coverage?.answers,
      lastImport: data.last_import,
    },
    waitlist: waitlist(data, opportunities, plan, short),
  };
}

function waitlist(data, opportunities, plan, short) {
  const items = [];
  const planned = new Set((plan || []).map((p) => p.intent));
  (opportunities || []).filter((o) => o.visibility.status === "insufficient_data")
    .forEach((o) => items.push(`Re-check ${o.intent.toLowerCase()} once there are enough answers to judge (${o.visibility.answers} neutral answers so far).`));
  const recs = (data.findings?.recommendations || []).filter((r) => r.status !== "rejected" && r.status !== "done" && !planned.has(r.intent));
  [...new Map(recs.map((r) => [r.title, r])).values()].slice(0, 4)
    .forEach((r) => items.push(`${stripTags(r.title)}${r.intent ? ` (${r.intent.toLowerCase()})` : ""}: proposed in a stored diagnosis, not in this month's plan.`));
  if (!items.length) items.push(`No open items for ${short} beyond this month's action plan.`);
  return items;
}
