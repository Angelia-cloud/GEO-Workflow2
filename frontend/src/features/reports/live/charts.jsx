import { useCallback, useRef, useState } from "react";
import { pct0, pctTip, dayMon } from "./reportModel.js";

/* Geometry of the reference charts (viewBox 760 x 330). */
const X0 = 58, X1 = 740, Y0 = 278, Y1 = 28;
const r1 = (v) => Math.round(v * 10) / 10;

export function scaleFor(values, floor = 60) {
  const max = Math.max(0, ...values.filter((v) => v != null));
  let top = Math.max(floor, Math.ceil(max / 10) * 10);
  if (max > top - 4) top += 10;
  const step = top <= 60 ? 10 : 20;
  top = Math.ceil(top / step) * step;
  return { top, ticks: Array.from({ length: top / step + 1 }, (_, i) => i * step) };
}

export function xAt(i, n, x0 = X0, x1 = X1) {
  return n <= 1 ? (x0 + x1) / 2 : r1(x0 + (i * (x1 - x0)) / (n - 1));
}

export const yAt = (v, top) => r1(Y0 - (v / top) * (Y0 - Y1));

/** Shows only some x labels when there are many periods so they never overlap. */
const labelStep = (n) => (n <= 8 ? 1 : Math.ceil(n / 8));

/** Tooltip positioned like the reference: right of the point, flipped and clamped inside the card. */
export function useTooltip() {
  const wrap = useRef(null);
  const tip = useRef(null);
  const [state, setState] = useState(null);
  const show = useCallback((event, content) => {
    const box = wrap.current;
    const el = tip.current;
    if (!box || !el) return;
    setState({ content, left: -9999, top: 0 });
    window.requestAnimationFrame(() => {
      const wrapRect = box.getBoundingClientRect();
      const pointRect = event.target.getBoundingClientRect();
      const ttRect = el.getBoundingClientRect();
      let left = pointRect.left - wrapRect.left + 14;
      let top = pointRect.top - wrapRect.top - 10;
      if (left + ttRect.width > wrapRect.width - 8) left = pointRect.left - wrapRect.left - ttRect.width - 14;
      if (left < 8) left = 8;
      if (top + ttRect.height > wrapRect.height - 8) top = wrapRect.height - ttRect.height - 8;
      if (top < 8) top = 8;
      setState({ content, left, top });
    });
  }, []);
  const hide = useCallback(() => setState(null), []);
  return { wrap, tip, state, show, hide };
}

function GridAndAxis({ ticks, top, labels, unit = "%" }) {
  const step = labelStep(labels.length);
  return (
    <>
      {ticks.map((t) => (
        <g key={t}>
          <line className="grid" x1={X0} x2={X1} y1={yAt(t, top)} y2={yAt(t, top)} />
          <text className="axis" x="49" y={r1(yAt(t, top) + 4)} textAnchor="end">{t}{unit}</text>
        </g>
      ))}
      {labels.map((l, i) => (i % step === 0 || i === labels.length - 1) && (
        <text key={`${l}-${i}`} className="axis" x={xAt(i, labels.length)} y="310" textAnchor="middle">{l}</text>
      ))}
    </>
  );
}

function Milestones({ milestones, n }) {
  return milestones.map((m) => (
    <g key={m.index}>
      <line className="milestone-line" x1={xAt(m.index, n)} x2={xAt(m.index, n)} y1="38" y2={Y0} />
      <text className="milestone-label" x={xAt(m.index, n)} y="20" textAnchor="middle">{m.label}</text>
    </g>
  ));
}

const pts = (values, n, top) => values.map((v, i) => (v == null ? null : `${xAt(i, n)},${yAt(v, top)}`));

/** Runs of consecutive values as polyline point strings (a missing value breaks the line). */
function runs(values, n, top, from = 0) {
  const out = [];
  let run = [];
  pts(values, n, top).forEach((p, i) => {
    if (i < from || p == null) { if (run.length > 1) out.push(run.join(" ")); run = []; return; }
    run.push(p);
  });
  if (run.length > 1) out.push(run.join(" "));
  return out;
}

/** Progress chart: "All N questions" and "N comparison questions" views, as in the reference. */
export function TrendChart({ model, view, onView }) {
  const t = model.trend;
  const n = t.labels.length;
  const tip = useTooltip();
  const allLabel = `All ${t.trackedQuestions} questions`;
  const compLabel = `${t.comparisonQuestions} comparison questions`;
  const own = model.short;
  const scaleAll = scaleFor([...t.all, t.baseline?.detection]);
  const scaleComp = scaleFor(t.comparison.flatMap((s) => s.values));
  const latest = n - 1;
  const latestRows = t.comparison.map((s) => ({ ...s, v: s.values[latest] })).filter((s) => s.v != null);
  const ownLatest = latestRows.find((s) => s.cls === "own");
  const others = latestRows.filter((s) => s.cls !== "own").sort((a, b) => b.v - a.v);
  const ahead = ownLatest && others.every((o) => ownLatest.v > o.v);

  const tooltipFor = (index, series) => (series === "all22" ? (
    <>
      <div className="tt-title">{t.periodNames[index]}</div>
      <table><tbody><tr><th>{allLabel}</th><td>{pctTip(t.all[index])}</td></tr></tbody></table>
    </>
  ) : (
    <>
      <div className="tt-title">{t.periodNames[index]}</div>
      <div className="tt-sub" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>{compLabel}</div>
      <table><tbody>{t.comparison.map((s) => <tr key={s.name}><th>{s.name}</th><td>{pctTip(s.values[index])}</td></tr>)}</tbody></table>
    </>
  ));
  const hover = (index, series) => ({
    "data-period-index": index, "data-series": series,
    onMouseEnter: (e) => tip.show(e, tooltipFor(index, series)),
    onMouseMove: (e) => tip.show(e, tooltipFor(index, series)),
    onMouseLeave: tip.hide,
  });
  const start = t.startIsPartial;
  const baseline = t.baseline;

  return (
    <div className="chartcard" id="trend-chart">
      <div className="chart-wrap" ref={tip.wrap}>
        <div className="chart-tooltip" id="chart-tooltip" ref={tip.tip}
          style={tip.state ? { display: "block", left: tip.state.left, top: tip.state.top } : undefined}>{tip.state?.content}</div>
        <div className="trend-toggle">
          <button type="button" className={view === "all22" ? "active" : ""} data-view="all22" onClick={() => { tip.hide(); onView("all22"); }}>{allLabel}</button>
          <button type="button" className={view === "comp17" ? "active" : ""} data-view="comp17" onClick={() => { tip.hide(); onView("comp17"); }}>{compLabel}</button>
        </div>
        <div className="trend-view" id="view-all22" hidden={view !== "all22"}>
          <h3>How often your hotel appears in AI answers, by half-month</h3>
          {n ? (
            <svg className="line" viewBox="0 0 760 330" role="img" aria-label={`Detection Rate across all ${t.trackedQuestions} questions`}>
              <GridAndAxis ticks={scaleAll.ticks} top={scaleAll.top} labels={t.labels} />
              <Milestones milestones={t.milestones} n={n} />
              {baseline && <line className="baseline-line" x1={xAt(0, n)} x2={xAt(baseline.toIndex, n)} y1={yAt(baseline.detection, scaleAll.top)} y2={yAt(baseline.detection, scaleAll.top)} />}
              {start && t.all[0] != null && t.all[1] != null && <line className="start-link" x1={xAt(0, n)} y1={yAt(t.all[0], scaleAll.top)} x2={xAt(1, n)} y2={yAt(t.all[1], scaleAll.top)} />}
              {runs(t.all, n, scaleAll.top, start ? 1 : 0).map((p) => <polyline key={p} className="trend-line own" points={p} />)}
              {t.all.map((v, i) => v == null ? null : (
                <g key={i}>
                  <circle className={`trend-point ${i === 0 && start ? "start-point" : "own"} hover-point`} {...hover(i, "all22")}
                    cx={xAt(i, n)} cy={yAt(v, scaleAll.top)} r={i === 0 && start ? "5.5" : "4.5"} />
                  <text className="val" x={xAt(i, n)} y={r1(yAt(v, scaleAll.top) - 10)} textAnchor="middle">{pct0(v)}</text>
                </g>
              ))}
            </svg>
          ) : <p className="placeholder">No measured half-month periods yet.</p>}
          <div className="legend">
            <span><i className="own" />{own}</span>
            {start && t.all[0] != null && <span><i className="start-key" />{dayMon(t.firstDay)} starting point ({pct0(t.all[0])})</span>}
            {baseline && <span><i style={{ borderTop: "3px dashed #d97706" }} />{baseline.as_of ? `${dayMon(baseline.as_of)} baseline` : baseline.label} ({baseline.detection.toFixed(1)}%)</span>}
          </div>
          <p className="src">
            All {t.trackedQuestions} tracked guest questions, measured in half-month periods.
            {baseline ? ` The ${baseline.detection.toFixed(1)}% baseline (${baseline.label}${baseline.as_of ? `, ${dayMon(baseline.as_of)}` : ""}) applies to the tracking period before the reporting dates.` : ""}
            {start ? ` The line starts on ${dayMon(t.firstDay)} (${pct0(t.all[0])}), when tracking began, so the first period is partial.` : ""}
            {t.milestones.length ? ` Dashed vertical lines mark website work logged as done.` : ""}
            {` ${model.period.custom ? "The selected dates become" : `${model.period.month} becomes`} the reference point for future month-on-month comparison.`}
          </p>
        </div>
        <div className="trend-view" id="view-comp17" hidden={view !== "comp17"}>
          <h3>How often the comparison hotels appear in AI answers, by half-month</h3>
          {n ? (
            <svg className="line" viewBox="0 0 760 330" role="img" aria-label={`Detection Rate across ${t.comparisonQuestions} comparison questions`}>
              <GridAndAxis ticks={scaleComp.ticks} top={scaleComp.top} labels={t.labels.map((l, i) => (i === 0 && start ? t.trend[0].label : l))} />
              <Milestones milestones={t.milestones} n={n} />
              {t.comparison.map((s) => runs(s.values, n, scaleComp.top).map((p) => <polyline key={`${s.cls}-${p}`} className={`trend-line ${s.cls}`} points={p} />))}
              {t.comparison.map((s) => (
                <g key={s.cls} className={`trend-point ${s.cls}`}>
                  {s.values.map((v, i) => v == null ? null : (
                    <circle key={i} className="hover-point" {...hover(i, "comp17")} cx={xAt(i, n)} cy={yAt(v, scaleComp.top)} r="3.8" />
                  ))}
                </g>
              ))}
            </svg>
          ) : <p className="placeholder">No measured half-month periods yet.</p>}
          <div className="legend">{t.comparison.map((s) => <span key={s.cls}><i className={s.cls} />{s.name}</span>)}</div>
          <p className="src">{t.comparisonQuestions} neutral comparison questions.</p>
          <p className="src"><strong>How to read this view:</strong> this is the fair comparison set used for peer benchmarking because it excludes the {model.namedQ} question{model.namedQ === 1 ? "" : "s"} that name the hotel, its venues or its immediate area directly.</p>
          {ownLatest && others.length > 0 && (
            <p className="src"><strong>Key insight:</strong> At the latest half-month point ({t.labels[latest]}), {own} {ahead ? "remained clearly ahead" : "was not in front"} at {pctTip(ownLatest.v)}, compared with {others.map((o) => `${o.name} (${pctTip(o.v)})`).reduce((acc, s, i, a) => (i === 0 ? s : i === a.length - 1 ? `${acc} and ${s}` : `${acc}, ${s}`), "")}.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Appendix chart: Detection Rate by AI assistant, month by month (reference geometry, x 70–720). */
export function AssistantChart({ assistants }) {
  const tip = useTooltip();
  const months = assistants.months;
  const n = months.length;
  const values = assistants.engines.flatMap((e) => e.values);
  const max = Math.max(0, ...values.filter((v) => v != null));
  const top = Math.max(80, Math.ceil((max + 4) / 20) * 20);
  const ticks = Array.from({ length: top / 20 + 1 }, (_, i) => i * 20);
  const y = (v) => (278 - (v / top) * 240).toFixed(1);
  const x = (i) => (n <= 1 ? 390 : Math.round(120 + (i * 540) / (n - 1)));
  const CLS = ["own", "c2", "c3", "c4", "c5", "c6"];
  const show = (e, engine, month, value) => tip.show(e, (
    <>
      <div className="tt-title">{month}</div>
      <table><tbody><tr><th>{engine}</th><td>{value}</td></tr></tbody></table>
    </>
  ));
  return (
    <div className="chartcard assistant-chartcard" style={{ position: "relative" }} ref={tip.wrap}>
      <div className="chart-tooltip assistant-tooltip" id="assistant-tooltip" ref={tip.tip}
        style={tip.state ? { display: "block", left: tip.state.left, top: tip.state.top } : undefined}>{tip.state?.content}</div>
      <svg className="line" viewBox="0 0 760 330" role="img" aria-label={`Detection Rate by AI assistant${n ? ` from ${months[0]} to ${months[n - 1]}` : ""}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1="70" x2="720" y1={y(t)} y2={y(t)} />
            <text className="axis" x="58" y={(Number(y(t)) + 4).toFixed(1)} textAnchor="end">{t}%</text>
          </g>
        ))}
        {months.map((m, i) => <text key={m + i} className="axis" x={x(i)} y="312" textAnchor="middle">{m}</text>)}
        {assistants.engines.map((e, k) => {
          const cls = CLS[k % CLS.length];
          const line = e.values.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean);
          return (
            <g key={e.name}>
              {line.length > 1 && <polyline className={`trend-line ${cls}`} points={line.join(" ")} />}
              {e.values.map((v, i) => v == null ? null : (
                <circle key={i} className={`trend-point ${cls} assistant-hover-point`} style={{ cursor: "pointer" }}
                  data-assistant={e.name} data-month={months[i]} data-value={`${v.toFixed(1)}%`} cx={x(i)} cy={y(v)} r="5"
                  onMouseEnter={(ev) => show(ev, e.name, months[i], `${v.toFixed(1)}%`)}
                  onMouseMove={(ev) => show(ev, e.name, months[i], `${v.toFixed(1)}%`)}
                  onMouseLeave={tip.hide}>
                  <title>{e.name}: {v.toFixed(1)}%</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      <div className="legend">{assistants.engines.map((e, k) => <span key={e.name}><i className={CLS[k % CLS.length]} />{e.name}</span>)}</div>
      <p className="src">{n ? `${months[0]}${n > 1 ? ` to ${months[n - 1]}` : ""}` : "No months"} · all tracked questions. Each month uses the same calculation from stored answers.</p>
    </div>
  );
}
