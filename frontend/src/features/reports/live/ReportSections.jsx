/**
 * The client report in the approved layout (IC Coogee September 2026 reference). Markup and class names
 * follow the reference one to one so the in-app view and the exported HTML look identical; all content
 * comes from the report model (reportModel.js), i.e. from the imported Rankscale data.
 */
import { Fragment, useState } from "react";
import { AssistantChart, TrendChart } from "./charts.jsx";
import { hotelShort, count, d1, dayMon, dayMonthYear, listJoin, pct0, pct1, signed1, word, capital } from "./reportModel.js";
import { stripTags } from "./format.js";

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

const External = ({ href, children }) => {
  const url = safeUrl(href);
  return url ? <a href={url} target="_blank" rel="noopener">{children}</a> : <>{children}</>;
};

/* ---------------- At a glance ---------------- */
export function Glance({ m, data, onTrendJump }) {
  const h = m.headline;
  const cov = data.coverage;
  return (
    <section id="glance">
      <header>
        <div className="eyebrow">AI visibility report · {m.property} · {data.label}</div>
        <h1>
          {h.lead}{h.rank ? <> and {h.rank.verb} <strong>{h.rank.strong}</strong></> : ""}. {h.movement}
          {h.opportunity && <> The clearest opportunity is to make <strong>{h.opportunity}</strong>.</>}
        </h1>
        <span className="focus">Tracking since {dayMonthYear(m.firstDay)} · {m.tracked} guest questions · {m.engines.length} AI assistants</span>
      </header>
      {cov.partial ? (
        <div className="notice"><strong>Measurement note:</strong> {data.range.custom ? "The selected dates are" : `${m.period.month} is`} only partly covered ({cov.partial_reason}); {cov.days_with_data} of {cov.calendar_days} days have measurements{data.comparison?.basis === "matched_days" ? ", so the comparison with the previous month uses the days both months cover" : ""}.</div>
      ) : (
        <div className="notice"><strong>Measurement note:</strong> Every figure is recalculated from the stored Rankscale answers for {data.range.custom ? "the selected dates" : m.period.month}, with the same method each month. If we ever need to change it, we will show results under the old and new method side by side for one month.</div>
      )}
      <div className="notice"><strong>Key term:</strong> Detection Rate = the share of tracked AI answers that mention the hotel.</div>
      <h2>Your three vital signs</h2>
      <div className="vitals">
        <div className="vital">
          <div className="vt">How often the hotel appears in AI answers</div>
          <div className="vn">{d1(m.det)}</div>
          <div className="vu">% of tracked AI answers in {data.range.custom ? "the selected dates" : m.period.month}</div>
          <div className="vmove"><span className="chip">{m.vitals.detChip}</span></div>
          <p>{m.vitals.detText}</p>
          <div className="vhelp"><a href="#trend-chart" className="trend-jump" data-view="all22" onClick={(e) => onTrendJump(e, "all22")}>See the trend over time ↓</a></div>
        </div>
        <div className="vital">
          <div className="vt">Position vs comparison hotels</div>
          {m.ranking.rank ? (
            <>
              <div className="vn">{m.ranking.tie ? "=" : ""}{m.ranking.rank === 1 ? "1st" : `${m.ranking.rank}${["", "st", "nd", "rd"][m.ranking.rank] || "th"}`}</div>
              <div className="vu">of {m.ranking.total} hotels</div>
              {m.vitals.posChip && <div className="vmove"><span className="chip">{m.vitals.posChip}</span></div>}
            </>
          ) : null}
          <p>{m.vitals.posText}</p>
          <div className="vhelp"><a href="#trend-chart" className="trend-jump" data-view="comp17" onClick={(e) => onTrendJump(e, "comp17")}>See the trend over time ↓</a></div>
        </div>
        <div className="vital">
          <div className="vt">Opportunity</div>
          {m.opp ? (
            <p className="opp-sentence">Only <span className="opp-key-inline">{pct0(m.opp.share)}</span> of answers about {m.opp.intent.toLowerCase()} mention {m.short}. Closing this gap could help more guests discover the hotel when they ask AI about {m.opp.intent.toLowerCase()}.</p>
          ) : (
            <p className="opp-sentence">Loading the opportunity assessment…</p>
          )}
          <div className="vhelp"><a href="#f-events">See the breakdown ↓</a></div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- Action plan ---------------- */
function useRecTools({ n, extra }) {
  const [openIds, setOpenIds] = useState([]);
  const toggle = (id) => setOpenIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const isOpen = (id) => openIds.includes(id);
  return { isOpen, buttons: (
    <div className="rec-tools">
      <button type="button" className="rt-btn" aria-expanded={isOpen(`ev-${n}`)} aria-controls={`ev-${n}`} onClick={() => toggle(`ev-${n}`)}>Evidence behind this action</button>
      <button type="button" className="rt-btn" aria-expanded={isOpen(`pl-${n}`)} aria-controls={`pl-${n}`} onClick={() => toggle(`pl-${n}`)}>Mockup &amp; detailed plan</button>
      {extra}
    </div>
  ) };
}

function Rec({ a, m, onPriority }) {
  const extra = onPriority && (
    <button type="button" className="rt-btn" data-noexport="" onClick={() => onPriority(a.item)}>
      {a.item.commercial?.priority ? "Update business priority" : "Record business priority"}
    </button>
  );
  const tools = useRecTools({ n: a.n, extra });
  const ev = a.evidence;
  const topCitations = [...new Map(ev.citations.map((c) => [c.domain || c.url, c])).values()].slice(0, 6);
  return (
    <div className="rec" id={`action-${a.n}`}>
      <div className="top"><span className="anum">{a.n}</span><span className={`chip ${a.priorityClass}`}>{a.priority}</span><span className="muted">Evidence: {a.effort}</span></div>
      <h3 className="rec-title">{a.title}</h3>
      <dl>
        <dt>Action</dt><dd><strong>{a.action.strong}</strong>{a.action.rest}</dd>
        <dt>Who</dt><dd>{a.who}</dd>
        <dt>Why</dt><dd>{a.why}</dd>
        <dt>Timing &amp; check</dt><dd>{a.timing}</dd>
      </dl>
      {tools.buttons}
      <div className="rt-panel" id={`ev-${a.n}`} hidden={!tools.isOpen(`ev-${a.n}`)}>
        <p className="ph">Each AI assistant reads different sources for {a.intent.toLowerCase()} questions ({m.period.name})</p>
        <div className="tw"><table className="plan-table">
          <thead><tr><th>Assistant</th><th>What it reads</th><th>Mentions you</th><th>What moves it</th></tr></thead>
          <tbody>{ev.engines.map((e) => {
            const rate = e.answers ? e.mentions / e.answers : 0;
            const linked = e.answers_with_links ?? null;
            const reads = e.sources?.length
              ? `${listJoin(e.sources.slice(0, 2).map((s) => s.domain))}${e.sources[0] ? ` (${e.sources[0].answers} of ${e.answers} answers cite ${e.sources[0].domain})` : ""}`
              : linked === 0 ? "Few or no links" : "No cited sources recorded";
            const moves = rate >= 0.4 ? "Already working" : (linked === 0 || !e.sources?.length) ? "Watch only" : e.sources[0] ? `Pages and listings on ${e.sources[0].domain}` : "The new content";
            return <tr key={e.engine}><td>{e.engine}</td><td>{reads}</td><td>{e.mentions} of {e.answers}</td><td>{moves}</td></tr>;
          })}</tbody>
        </table></div>
        <p className="ph">Sources AI cites for these questions</p>
        {topCitations.length ? (
          <ul>{topCitations.map((c, i) => (
            <li key={i}><External href={c.url}>{c.title || c.domain || c.url}</External>{c.domain && c.title ? ` (${c.domain})` : ""}: cited in {c.answer_count} answer{c.answer_count === 1 ? "" : "s"}{c.attributed_to === "competitor" ? ", for a comparison hotel" : c.attributed_to === "own_brand" ? ", for your hotel" : ""}.</li>
          ))}</ul>
        ) : <p>No cited web sources were recorded for these answers.</p>}
        {ev.weakest.length > 0 && (
          <>
            <p className="ph">The questions where you are missing most</p>
            <ul>{ev.weakest.map((w, i) => <li key={i}>“{w.prompt}” – mentioned in {pct0(w.detection)} of {w.answers} answers</li>)}</ul>
          </>
        )}
        <p className="ph">Starting point we will measure against</p>
        <p>All assistants: {ev.mentions} of {count(ev.answers)} answers ({pct0(ev.answers ? (100 * ev.mentions) / ev.answers : null)}) in {m.period.name}. Compared with questions this change does not touch.</p>
      </div>
      <div className="rt-panel" id={`pl-${a.n}`} hidden={!tools.isOpen(`pl-${a.n}`)}>
        <p className="ph">Steps</p>
        {a.plan.length ? (
          <ol className="steps">{a.plan.map((r, i) => (
            <li key={r.id || i}><strong>{r.owner || "Agency"}</strong> · {stripTags(r.title)}{r.due_date ? ` (due ${dayMon(r.due_date)})` : ""}. <span className="muted">{stripTags(r.detail || "").split("\n")[0]}</span></li>
          ))}</ol>
        ) : (
          <ol className="steps">
            <li><strong>Agency</strong> drafts the content for {a.intent.toLowerCase()} questions from the evidence above.</li>
            <li><strong>Hotel</strong> confirms the facts, priority and owner in Team review.</li>
            <li><strong>Web team</strong> publishes the change and logs it as done, so its before/after effect is tracked.</li>
          </ol>
        )}
        <div className="tw"><table className="plan-table">
          <thead><tr><th>Comparison hotel</th><th>Mentioned in</th><th>Visibility score</th></tr></thead>
          <tbody>
            <tr><td><strong>{m.short} (you)</strong></td><td>{pct0(a.item.visibility.hotel_detection)}</td><td>{d1(a.item.visibility.hotel_visibility)}</td></tr>
            {ev.competitors.map((c) => <tr key={c.name}><td>{hotelShort(c.name)}</td><td>{pct0(c.detection)}</td><td>{d1(c.visibility)}</td></tr>)}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

export function ActionPlanSection({ m, data, opportunities, onPriority, priorityForm }) {
  const plan = m.plan;
  return (
    <section id="plan" className="section">
      <h2>Action plan for {m.period.next}</h2>
      <p className="muted">{plan == null ? "Loading the opportunity assessment…"
        : plan.length ? `${capital(word(plan.length))} action${plan.length === 1 ? "" : "s"}, ordered by the gap each one closes${plan.length > 1 ? ": your biggest gap first" : ""}. Open the buttons for the evidence and the plan.`
          : `No guest need trails a comparison hotel by 5 points or more in ${m.period.name}, so no new action is proposed.`}</p>
      {priorityForm}
      {(plan || []).map((a) => <Rec key={a.intent} a={a} m={m} onPriority={onPriority} />)}
    </section>
  );
}

/* ---------------- Progress ---------------- */
export function ProgressSection({ m, data, view, onView }) {
  return (
    <section id="progress" className="section">
      <h2>Progress since tracking began</h2>
      <div className="timeline">{m.timeline.map((t, i) => (
        <div className="tl" key={i}><div className="d">{t.d}</div><div className="t">{t.t}</div><p>{t.p}</p></div>
      ))}</div>
      <TrendChart model={m} view={view} onView={onView} />
      <h3 className="supporting-title">What we’re seeing from the website work</h3>
      <div className="status-grid">
        <div className="status-row hd"><div>Work</div><div>Status</div><div>Read</div><div>What it means</div></div>
        {m.work.length ? m.work.map((w, i) => (
          <div className="status-row" key={i}>
            <div><strong>{w.title}</strong></div>
            <div><span className="chip">{w.status}</span></div>
            <div><span className="chip">{w.read}</span></div>
            <div className="muted">{w.means}</div>
          </div>
        )) : (
          <div className="status-row">
            <div><strong>Website changes</strong></div>
            <div><span className="chip">None logged</span></div>
            <div><span className="chip">Not started</span></div>
            <div className="muted">No recommendation has been marked as done yet. When one is marked done in Team review, its before/after reading appears here and on the trend chart.</div>
          </div>
        )}
        <div className="status-row">
          <div><strong>Changes in AI assistants</strong></div>
          <div><span className="chip">{m.period.previousName ? `vs ${m.period.previousName}` : "First period"}</span></div>
          <div><span className="chip">{m.change == null ? "Reference" : m.steady ? "Steady" : m.change > 0 ? "Rising" : "Falling"}</span></div>
          <div className="muted">{m.contributions.length
            ? `${m.contributions[0].name} moved the overall figure most (${signed1(m.contributions[0].effect)} pts, ${pct0(m.contributions[0].previous)} → ${pct0(m.contributions[0].detection)}). `
            : ""}<a href="#september-context">See the detail ↓</a></div>
        </div>
        <div className="status-row">
          <div><strong>{m.period.next} actions</strong></div>
          <div><span className="chip">Next</span></div>
          <div><span className="chip">Focused</span></div>
          <div className="muted">{m.plan?.length
            ? `We’ll focus on the ${m.plan.length === 1 ? "biggest gap" : `${word(m.plan.length)} biggest gaps`} identified this month (${listJoin(m.plan.map((a) => a.intent.toLowerCase()))}) and track whether the recommended changes improve future results.`
            : "No new gap needs action; we keep tracking every guest need."}</div>
        </div>
      </div>
      <div className="notice" style={{ marginTop: 14 }}>
        <strong>Measurement note:</strong> {m.period.previousName ? `${capital(m.period.previousName)} and ${m.period.name} results are calculated the same way from stored answers${data.comparison?.basis === "matched_days" ? ", over the days both periods cover" : ""}.` : `${capital(m.period.name)} is the first reporting period.`} {m.period.name} becomes the reference point for future month-on-month comparison.
        <div className="refine-link"><a href="#measure"><strong>See methodology &amp; refinements ↓</strong></a></div>
      </div>
    </section>
  );
}

/* ---------------- Where you win ---------------- */
export function WinSection({ m, data }) {
  const t = m.table;
  const indicative = t.rows.filter((r) => r.questions === 1).map((r) => r.intent.toLowerCase());
  const o = m.opp;
  const top = o?.engines.filter((e) => e.mentions > 0) || [];
  const none = o?.engines.filter((e) => e.mentions === 0).map((e) => e.engine) || [];
  return (
    <section id="win" className="section">
      <h2>Where you win and where you don't</h2>
      <div className="chartcard">
        <p className="statement"><strong>{m.win.lead}</strong>{m.win.parts.length ? <> By guest need, it {m.win.parts.map((p, i) => (
          <Fragment key={i}>{i > 0 ? (i === m.win.parts.length - 1 ? "; and " : "; ") : ""}{p.pre}<strong>{p.strong}</strong>{p.post}</Fragment>
        ))}.</> : null}</p>
        <div className="breakdown-wrap">
          <table className="breakdown-table">
            <thead><tr>
              <th>What guests ask about</th><th>Questions</th><th>Your rank</th><th>{m.short}</th>
              {t.competitorNames.map((c) => <th key={c}>{c}</th>)}<th>Leader</th>
            </tr></thead>
            <tbody>{t.rows.map((r) => (
              <tr key={r.intent} id={`intent-${r.intent.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
                <th>{r.intent}</th>
                <td className="num">{r.questions ?? "–"}</td>
                <td className="rank"><span className={`rank-chip${r.tie ? " tie" : r.rank > 1 ? " second" : ""}`}>{r.tie ? "Level 1st" : r.rank === 1 ? "1st" : `${r.rank}${["", "st", "nd", "rd"][r.rank] || "th"}`}</span></td>
                {r.cells.map((c, i) => <td key={i} className={c.v === r.best ? "lead" : undefined}>{pct0(c.v)}</td>)}
                <td className="leader">{r.leaders.map((l) => l.short).join(" = ")}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="breakdown-note">{m.period.name} · {m.neutralQ} neutral comparison questions. The table shows how often each hotel appears in answers for each guest need.{indicative.length ? ` ${capital(listJoin(indicative))} ${indicative.length === 1 ? "rests" : "rest"} on one question${indicative.length === 1 ? "" : " each"}, so treat ${indicative.length === 1 ? "that row" : `those ${word(indicative.length)} rows`} as indicative only.` : ""}</p>

        <h3 id="f-events" style={{ marginTop: 22 }}>{o ? `${o.intent} breakdown` : "Opportunity breakdown"}</h3>
        {o ? (
          <>
            <div className="breakdown-wrap">
              <table className="breakdown-table">
                <thead><tr><th>AI assistant</th><th>Answers</th><th>Mention the hotel</th></tr></thead>
                <tbody>
                  {o.engines.map((e) => <tr key={e.engine}><th>{e.engine}</th><td>{e.answers}</td><td>{e.mentions} ({pct0(e.answers ? (100 * e.mentions) / e.answers : 0)})</td></tr>)}
                  <tr className="lead"><th>All assistants</th><td>{count(o.answers)}</td><td>{o.mentions} ({pct0(o.share)})</td></tr>
                </tbody>
              </table>
            </div>
            <div className="insight-box">
              <p><strong>What this means:</strong> across {count(o.answers)} answers about {o.intent.toLowerCase()}, only {o.mentions} mentioned {m.short} — the {pct0(o.share)} opportunity highlighted above.</p>
              {top.length > 0 && (
                <p>Visibility is also uneven across AI assistants. {top[0].engine} accounts for {top[0].mentions} of the {o.mentions} mentions{top[1] ? ` and ${top[1].engine} another ${top[1].mentions}` : ""}{none.length ? `, while ${listJoin(none)} did not mention the hotel at all` : ""}.</p>
              )}
              <p><strong>Why it matters:</strong> {top.length ? "the hotel is already being surfaced for these questions in some AI experiences, but not consistently." : "no AI assistant mentioned the hotel for these questions yet."} The opportunity is to make the hotel's offer for {o.intent.toLowerCase()} easier for more AI assistants to recognise and recommend.</p>
            </div>
          </>
        ) : <p className="breakdown-note">Loading the opportunity assessment…</p>}
      </div>
    </section>
  );
}

/* ---------------- How we measure ---------------- */
export function MeasureSection({ m, data }) {
  const names = m.engines.map((e) => e.name);
  const cmp = data.comparison || {};
  const prevMonth = (data.available_months || []).find((x) => x.month === cmp.previous_month);
  return (
    <section id="measure" className="section">
      <h2>How we measure &amp; refine</h2>
      <p className="statement">Every month is measured the same way from the stored Rankscale answers, so results stay consistent for future comparison.</p>
      <div className="flow">
        <div className="step"><span className="n">1</span><div className="t">{m.tracked} guest questions</div><p>Questions a future guest might ask across {word(data.intents.length)} guest needs.</p></div>
        <div className="step"><span className="n">2</span><div className="t">Asked to {m.engines.length} AI assistants</div><p>{listJoin(names)}{m.cadence ? `, approximately every ${m.cadence === 1 ? "day" : `${word(m.cadence)} days`}` : ""}.</p></div>
        <div className="step"><span className="n">3</span><div className="t">Full answers saved</div><p>Each answer and its cited web sources are retained for review.</p></div>
        <div className="step"><span className="n">4</span><div className="t">Mentions counted</div><p>We identify mentions of the hotel, its venues and the comparison hotels.</p></div>
        <div className="step"><span className="n">5</span><div className="t">Detection Rate</div><p>Mentions ÷ tracked answers, using consistent question sets and settings for each comparison period.</p></div>
      </div>
      <div className="notice"><strong>Comparing with other hotels:</strong> all {m.tracked} questions are used to track {m.short}. {capital(word(m.namedQ))} question{m.namedQ === 1 ? "" : "s"} name the hotel, its venues or its immediate area and would naturally favour it, so the competitive comparison uses the remaining {m.neutralQ} neutral questions.</div>

      <details className="method-detail" id="refinements">
        <summary>Measurement refinements</summary>
        <div className="inner">
          <p className="muted">The settings behind this report, next to the previous period, so you can see the two are comparable.</p>
          <div className="breakdown-wrap">
            <table className="method-table">
              <thead><tr><th>What we measure</th><th>{m.period.previousName ? capital(m.period.previousName) : "Previous period"}</th><th>{capital(m.period.name)}</th><th>Why it matters</th></tr></thead>
              <tbody>
                <tr><th>Reporting window</th><td>{prevMonth ? `${dayMon(prevMonth.first_day)} – ${dayMon(prevMonth.last_day)} (data), calendar month` : cmp.previous_label || "No earlier data"}</td><td>{dayMon(data.range.from)} – {dayMon(data.range.to)}{data.range.custom ? " (selected dates)" : ", calendar month"}</td><td>Every period is compared on the same date basis.</td></tr>
                <tr><th>Tracked answers</th><td>{cmp.previous_answers != null ? count(cmp.previous_answers) : "–"}</td><td>{count(data.coverage.answers)}</td><td>More answers make each percentage more reliable.</td></tr>
                <tr><th>Question sets</th><td>{prevMonth ? `${prevMonth.tracked_questions} tracked · ${prevMonth.comparison_questions} neutral` : "–"}</td><td>{m.tracked} tracked · {m.neutralQ} neutral</td><td>The same questions keep month-on-month changes like for like.</td></tr>
                <tr><th>Comparison basis</th><td colSpan={2}>{cmp.basis === "matched_days" ? `Matched days (${cmp.window})` : cmp.basis === "equal_length_period" ? `Equal-length period before (${cmp.window})` : cmp.basis === "full_month" ? "Full calendar months" : cmp.reason || "No previous period"}</td><td>{cmp.caveat || "Both periods cover the same kind of days, so the comparison is fair."}</td></tr>
                <tr><th>Hotel name matching</th><td colSpan={2}>Hotel names are matched across the full answers, including former names.</td><td>This gives a fairer comparison when the same hotel appears under different names.</td></tr>
                <tr><th>Headline measure</th><td colSpan={2}>Detection Rate (Rankscale brand found), shown with the visibility score where useful.</td><td>It keeps the report focused on the clearest question: how often the hotel appears in tracked AI answers.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </details>

      <details className="method-detail" id="september-context">
        <summary>{capital(m.period.name)} measurement context</summary>
        <div className="inner">
          {m.contributions.length ? (
            <>
              <p>{capital(m.period.name)} looks {m.steady ? "similar to" : "different from"} {m.period.previousName} overall ({pct1(cmp.metrics?.detection?.previous)} → {pct1(m.det)}). These are the AI assistants behind the change.</p>
              <div className="chartcard bars contrib">
                {m.contributions.map((e) => (
                  <div className="brow" key={e.name}>
                    <div>{e.name}</div>
                    <div className="btrack"><div className={`bar${e.effect < 0 ? " neg" : e === m.contributions[0] && e.effect > 0 ? " own" : ""}`} style={{ width: `${e.width}%` }} /></div>
                    <div className="bval">{signed1(e.effect)} pts</div>
                    <div className="why">{pct0(e.previous)} → {pct0(e.detection)}. {Math.abs(e.detection - e.previous) < 2 ? "Broadly stable." : e.detection > e.previous ? `${e.name} mentioned the hotel more often.` : `${e.name} mentioned the hotel less often.`}{e.answers < e.previousAnswers * 0.85 ? ` Fewer ${e.name} answers were completed (${count(e.answers)} vs ${count(e.previousAnswers)}), which lowers its weight in the overall figure.` : ""}</div>
                  </div>
                ))}
                <p className="src">These bars show what contributed to the change from {m.period.previousName}. Each bar shows the effect on the overall figure, not that assistant’s own rate, and the bars may not add up exactly to the headline because of rounding. They should not be read as a direct measure of business performance.</p>
              </div>
            </>
          ) : <p>There is no comparable previous period, so {m.period.name} is the reference point.</p>}
        </div>
      </details>
      <p className="src">The purpose of this method is to keep the reporting consistent and decision-useful as the evidence base grows.</p>
    </section>
  );
}

/* ---------------- Appendix ---------------- */
export function AppendixSection({ m, data }) {
  const reach = m.reach;
  const latest = reach[0];
  const rest = reach.slice(1);
  const c0 = m.contributions[0];
  const sources = m.sources;
  const third = sources.filter((s) => !s.own);
  const ownS = sources.filter((s) => s.own);
  const cmp = data.comparison || {};
  const intents = [...(data.intents || [])].sort((a, b) => (b.detection ?? 0) - (a.detection ?? 0));
  const prevIntent = Object.fromEntries((cmp.intents || []).map((i) => [i.name, i]));
  const trendWord = m.change == null ? "Measured" : m.steady ? "Mentioned about as often" : m.change > 0 ? "Mentioned more often" : "Mentioned less often";
  return (
    <section id="appendix" className="section">
      <h2>Appendix – for anyone who wants the detail</h2>
      <details id="glossary"><summary>1. Plain-English glossary</summary><div className="inner"><dl className="gl">
        <dt>Detection Rate</dt><dd>Answers that mention the hotel ÷ all tracked answers × 100. A mention is not always a recommendation.</dd>
        <dt>Neutral questions</dt><dd>The {m.neutralQ} questions that do not name the hotel, its venues or its immediate area. Used only to compare with other hotels.</dd>
        <dt>Cited</dt><dd>The assistant links to a web page as a source for its answer.</dd>
      </dl></div></details>

      <details id="f-reach"><summary>2. {trendWord}{c0 && m.change != null && !m.steady ? `; ${c0.name} moved the figure most` : ""}</summary><div className="inner"><div className="cols">
        <div><div className="lbl">What we see</div><p>{reach.map((r) => `${r.name} ${count(r.found)}/${count(r.answers)} (${d1(r.detection)}%)`).join("; ") || "No monthly history yet"}.</p></div>
        <div><div className="lbl">Why</div><p>{c0 ? `${c0.name} contributes ${signed1(c0.effect)} points to the change since ${m.period.previousName}${m.contributions[1] ? `; ${m.contributions[1].name} adds ${signed1(m.contributions[1].effect)}` : ""}.` : "There is no earlier period to explain a change against."}</p></div>
        <div><div className="lbl">What it means</div><p>{latest ? `${d1(m.det)}% is the comparable base for the next report.` : ""} Do not read it as booking or traffic growth.</p></div>
      </div></div></details>

      <details id="f-sources"><summary>3. Third-party sources are a second route into answers</summary><div className="inner"><div className="cols">
        <div><div className="lbl">What we see</div><p>{third.length ? `${listJoin(third.slice(0, 3).map((s) => `${s.domain} (${pct0(s.share)} of answers)`))} are the most-cited third-party sources in ${m.period.name}.` : "No third-party sources were cited."}{ownS.length ? ` The hotel's own sites appear in ${listJoin(ownS.map((s) => `${s.domain} (${pct0(s.share)})`))}.` : ""}</p></div>
        <div><div className="lbl">Why it matters</div><p>These are sources the assistants already read, so accurate and complete information there is a practical lever.</p></div>
        <div><div className="lbl">Caution</div><p>Citations are not visits, and a new listing is not guaranteed to be used. We will measure before and after.</p></div>
      </div></div></details>

      <details id="assistant-detection">
        <summary>4. Detection Rate by assistant</summary>
        <div className="inner">
          <p className="cap">How often each AI assistant mentioned the hotel across all {m.tracked} tracked questions.</p>
          <AssistantChart assistants={m.assistants} />
        </div>
      </details>

      <details id="f-traffic"><summary>5. Detection Rate by guest need and most-cited sources</summary><div className="inner">
        <p className="cap">All tracked questions, {m.period.name}{cmp.available ? `, with the change since ${m.period.previousName}` : ""}.</p>
        <div className="chartcard"><h3>How often the hotel appears, by guest need</h3>
          <div className="scroll"><table>
            <thead><tr><th>Guest need</th><th>Answers</th><th>Detection Rate</th>{cmp.available && <th>Change</th>}</tr></thead>
            <tbody>{intents.map((i) => (
              <tr key={i.name}><td>{i.name}</td><td>{count(i.answers)}</td><td>{pct1(i.detection)}</td>
                {cmp.available && <td>{prevIntent[i.name]?.detection_change != null ? `${signed1(prevIntent[i.name].detection_change)} pts` : "–"}</td>}</tr>
            ))}</tbody>
          </table></div>
        </div>
        <div className="chartcard"><h3>Web sources cited most often in AI answers</h3>
          <div className="scroll"><table>
            <thead><tr><th>Source</th><th>Answers citing it</th><th>Share of answers</th><th>You mentioned</th></tr></thead>
            <tbody>{sources.map((s) => (
              <tr key={s.domain} className={s.own ? "hl" : undefined}><td>{s.domain}{s.own ? " (your site)" : ""}</td><td>{count(s.answers)}</td><td>{pct0(s.share)}</td><td>{pct0(s.mention_share)}</td></tr>
            ))}</tbody>
          </table></div>
          <p className="src">Share of all {count(data.coverage.answers)} tracked answers in {m.period.name} that cite each source. “You mentioned” is the share of those answers that mention the hotel.</p>
        </div>
      </div></details>

      <details id="waitlist"><summary>6. Waitlist</summary><div className="inner"><p className="cap">Items to revisit in a future reporting cycle when they become relevant.</p><ul>
        {m.waitlist.map((w, i) => <li key={i}>{w}</li>)}
      </ul></div></details>
    </section>
  );
}

export function ReportFooter({ m, data }) {
  const li = data.last_import;
  return (
    <footer>
      Prepared by: GEO reporting team · Period: {m.footer.period} · Issued: {dayMonthYear(new Date().toISOString())}
      <br />
      Data: Rankscale answer records, recalculated ({count(data.coverage.answers)} answers in the reporting dates){li ? `; latest import ${li.filename || "Rankscale export"}, loaded ${dayMonthYear(li.created_at)}` : ""}
    </footer>
  );
}
