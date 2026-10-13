import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../../../api/client";
import { ReportReader } from "../assistant/ReportChat.jsx";
import { ReportControls } from "./ReportControls.jsx";
import { PriorityForm } from "../../opportunities/OpportunityAssessment.jsx";
import { ReportNavigation } from "./ReportNavigation.jsx";
import { buildReportModel } from "./reportModel.js";
import { downloadReportHtml, exportFilename } from "./exportReport.js";
import { ActionPlanSection, AppendixSection, Glance, MeasureSection, ProgressSection, ReportFooter, WinSection } from "./ReportSections.jsx";
import "./report.css";

function monthBounds(m) {
  const [y, n] = m.split("-").map(Number);
  const last = new Date(Date.UTC(y, n, 0)).getUTCDate();
  return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, "0")}` };
}

function monthForRange(months, from, to) {
  return months.find((item) => {
    const bounds = monthBounds(item.month);
    return bounds.from === from && bounds.to === to;
  })?.month || "";
}

/**
 * The client report, generated live from the stored Rankscale measurements for the applied dates
 * (a calendar month or any From/To range) in the approved report layout. Every import updates it.
 * `emptyState` is rendered when the client has no measurements yet.
 */
export function LiveReport({ client, account, emptyState = null, onTeamReview }) {
  const id = String(client.id);
  const [months, setMonths] = useState(null);
  const [month, setMonth] = useState("");
  const [trendView, setTrendView] = useState("all22");
  const [period, setPeriod] = useState(null);
  const [data, setData] = useState(null);
  const [opps, setOpps] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);
  const requestId = useRef(0);
  const wrapRef = useRef(null);

  const loadPeriod = useCallback(async (nextPeriod) => {
    const request = ++requestId.current;
    setPeriod(nextPeriod);
    setMonth(nextPeriod.month || "");
    setLoading(true);
    setError("");
    setEditing(null);
    const reportPath = nextPeriod.month
      ? `/api/monthly/${encodeURIComponent(id)}/${encodeURIComponent(nextPeriod.month)}`
      : `/api/monthly/${encodeURIComponent(id)}/range?date_from=${encodeURIComponent(nextPeriod.from)}&date_to=${encodeURIComponent(nextPeriod.to)}`;
    const opportunitiesPath = `/api/opportunities/${encodeURIComponent(id)}?save=true&date_from=${encodeURIComponent(nextPeriod.from)}&date_to=${encodeURIComponent(nextPeriod.to)}`;
    try {
      const report = await apiFetch(reportPath);
      if (request !== requestId.current) return;
      setData(report);
      setOpps(null);
      setLoading(false);
      const assessment = await apiFetch(opportunitiesPath).catch(() => ({ opportunities: [] }));
      if (request !== requestId.current) return;
      setOpps(assessment.opportunities || []);
    } catch (e) {
      if (request !== requestId.current) return;
      setLoading(false);
      const message = e.status === 404
        ? `No Rankscale measurements exist between ${nextPeriod.from} and ${nextPeriod.to}. Choose dates that have imported data.`
        : e.message || "The report could not be refreshed. Please try again.";
      setError(message);
      throw new Error(message);
    }
  }, [id]);

  useEffect(() => {
    let live = true;
    setMonths(null);
    setMonth("");
    setPeriod(null);
    setData(null);
    setOpps(null);
    setError("");
    apiFetch(`/api/monthly/${encodeURIComponent(id)}/months`).then((response) => {
      if (!live) return;
      setMonths(response.months);
      const latest = response.months[response.months.length - 1]?.month || "";
      if (latest) loadPeriod({ ...monthBounds(latest), month: latest }).catch(() => {});
    }).catch((failure) => live && setError(failure.message));
    return () => { live = false; requestId.current += 1; };
  }, [id, loadPeriod]);

  const applyDates = useCallback(({ from, to }) => loadPeriod({ from, to, month: monthForRange(months || [], from, to) }), [loadPeriod, months]);

  const model = useMemo(() => (data ? buildReportModel(data, opps) : null), [data, opps]);
  const activePeriod = useMemo(() => (period ? { ...period, label: data?.label || `${period.from} – ${period.to}`, partial: data?.coverage?.partial || false } : null), [data, period]);
  const chatContext = useMemo(
    () => (activePeriod && data ? {
      key: `live:${id}:${activePeriod.from}:${activePeriod.to}`, propertyId: id, client: { name: client.name },
      periodLabel: `${activePeriod.label}${activePeriod.partial ? " (partial period)" : ""}`,
      period: { from: activePeriod.from, to: activePeriod.to }, topics: [],
      suggestions: [`Summarise visibility from ${activePeriod.from} to ${activePeriod.to}`, "How does this period compare with the previous period?"],
    } : null),
    [id, client.name, activePeriod, data],
  );
  const jumpToTrend = useCallback((event, nextView) => {
    event.preventDefault();
    setTrendView(nextView);
    window.requestAnimationFrame(() => document.getElementById("trend-chart")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);
  const exportHtml = useCallback(() => {
    if (!data || !model) throw new Error("The report is not ready to export yet.");
    const title = `${data.property.name} – ${data.range.custom ? `${data.range.from} to ${data.range.to}` : data.label} report`;
    downloadReportHtml(wrapRef.current, model, title, exportFilename(data.property.name, data.range.from, data.range.to));
  }, [data, model]);

  if (months && !months.length && !error && emptyState) return emptyState;

  const sections = [
    { id: "glance", label: "At a glance" },
    { id: "plan", label: "Action plan" },
    { id: "progress", label: model ? `Progress since ${model.trend.firstDay ? new Date(`${model.trend.firstDay}T00:00:00Z`).toLocaleDateString("en-AU", { month: "long", timeZone: "UTC" }) : "tracking began"}` : "Progress" },
    { id: "win", label: "Where you win" },
    { id: "measure", label: "How we measure & refine" },
    { id: "appendix", label: "Appendix" },
  ];

  const controls = (
    <ReportControls
      title={data ? `${client.name} · ${data.label}` : client.name}
      months={months}
      month={month}
      onMonth={(value) => loadPeriod({ ...monthBounds(value), month: value }).catch(() => {})}
      period={activePeriod}
      onApply={applyDates}
      onExport={exportHtml}
      exportDisabled={!data || !model || opps == null || loading}
      busy={loading}
      notice={loading ? "Loading the report…" : data && opps == null ? "Preparing the action plan…" : ""}
      onTeamReview={onTeamReview}
    />
  );

  return (
    <ReportReader context={chatContext}>
      <div className="rp" id="live-report-content">
        <div className="wrap" ref={wrapRef}>
          {controls}
          <ReportNavigation sections={sections} />
          {error && <div className="notice warn" role="alert" data-noexport="">{error}</div>}
          {!model && !error && <p className="report-empty muted" data-noexport="">{months && !months.length ? "No Rankscale measurements have been imported for this client yet." : "Loading the report…"}</p>}
          {model && (
            <>
              <Glance m={model} data={data} onTrendJump={jumpToTrend} />
              <ActionPlanSection
                m={model} data={data} opportunities={opps}
                onPriority={account ? setEditing : null}
                priorityForm={editing && (
                  <div className="opp-form" data-noexport="">
                    <PriorityForm item={editing} account={account} propertyId={id} onCancel={() => setEditing(null)}
                      onSaved={() => { setEditing(null); if (period) loadPeriod(period).catch(() => {}); }} />
                  </div>
                )}
              />
              <ProgressSection m={model} data={data} view={trendView} onView={setTrendView} />
              <WinSection m={model} data={data} />
              <MeasureSection m={model} data={data} />
              <AppendixSection m={model} data={data} />
              <ReportFooter m={model} data={data} />
            </>
          )}
        </div>
      </div>
    </ReportReader>
  );
}
