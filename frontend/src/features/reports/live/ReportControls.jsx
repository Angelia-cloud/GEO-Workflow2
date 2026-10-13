import { useEffect, useId, useRef, useState } from "react";

const isDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const day = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value;
};

/**
 * Reporting-period bar above the report (never exported): quick month picker, From / To dates,
 * Apply dates, Export HTML and, when available, Team review.
 */
export function ReportControls({ title, months, month, onMonth, period, onApply, onExport, exportDisabled, busy, notice, onTeamReview }) {
  const id = useId();
  const fromRef = useRef(null);
  const toRef = useRef(null);
  const [dates, setDates] = useState({ from: period?.from || "", to: period?.to || "" });
  const [problem, setProblem] = useState({ field: "", message: "" });
  const [running, setRunning] = useState("");

  useEffect(() => {
    setDates({ from: period?.from || "", to: period?.to || "" });
    setProblem({ field: "", message: "" });
  }, [period?.from, period?.to]);

  const edited = dates.from !== (period?.from || "") || dates.to !== (period?.to || "");
  const status = edited ? "Apply dates before exporting the report." : notice;
  const describedBy = [problem.message && `${id}-error`, status && `${id}-status`].filter(Boolean).join(" ") || undefined;

  function change(field, value) {
    setDates((current) => ({ ...current, [field]: value }));
    setProblem({ field: "", message: "" });
  }

  async function apply(event) {
    event.preventDefault();
    if (running) return;
    const issue = !isDate(dates.from) ? { field: "from", message: "Enter a valid From date." }
      : !isDate(dates.to) ? { field: "to", message: "Enter a valid To date." }
        : dates.from > dates.to ? { field: "to", message: "To date must be on or after From date." } : null;
    if (issue) {
      setProblem(issue);
      (issue.field === "from" ? fromRef : toRef).current?.focus();
      return;
    }
    setRunning("apply");
    try {
      await onApply({ ...dates });
    } catch (failure) {
      setProblem({ field: "", message: failure?.message || "The dates could not be applied. Please try again." });
    } finally {
      setRunning("");
    }
  }

  async function exportReport() {
    if (running || edited || exportDisabled) return;
    setRunning("export");
    setProblem({ field: "", message: "" });
    try {
      await onExport();
    } catch (failure) {
      setProblem({ field: "", message: failure?.message || "The report could not be exported. Please try again." });
    } finally {
      setRunning("");
    }
  }

  return (
    <div className="report-controls" data-noexport="" aria-busy={!!running || busy}>
      <div className="rc-title">
        <span className="eyebrow">Reporting period</span>
        <strong>{title}</strong>
      </div>
      <form className="rc-form" aria-label="Reporting period" onSubmit={apply} noValidate>
        <label className="rc-field" htmlFor={`${id}-month`}>Month
          <select id={`${id}-month`} value={month} disabled={!months?.length || busy || !!running} onChange={(event) => event.target.value && onMonth(event.target.value)}>
            {month === "" && <option value="">Custom dates</option>}
            {(months || []).map((item) => <option key={item.month} value={item.month}>{item.label}{item.partial ? " (partial)" : ""}</option>)}
          </select>
        </label>
        <label className="rc-field" htmlFor={`${id}-from`}>From date
          <input ref={fromRef} id={`${id}-from`} type="date" lang="en-AU" required value={dates.from} disabled={!!running}
            onChange={(event) => change("from", event.target.value)}
            aria-invalid={!!problem.message && (!problem.field || problem.field === "from")} aria-describedby={describedBy} />
        </label>
        <svg className="rc-arrow" viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 10h13m-5-5 5 5-5 5" /></svg>
        <label className="rc-field" htmlFor={`${id}-to`}>To date
          <input ref={toRef} id={`${id}-to`} type="date" lang="en-AU" required value={dates.to} disabled={!!running}
            onChange={(event) => change("to", event.target.value)}
            aria-invalid={!!problem.message && (!problem.field || problem.field === "to")} aria-describedby={describedBy} />
        </label>
        <div className="rc-actions">
          <button className="rc-apply" type="submit" disabled={!!running}>{running === "apply" ? "Applying…" : "Apply dates"}</button>
          <button className="rc-export" type="button" onClick={exportReport} disabled={exportDisabled || edited || !!running} aria-describedby={describedBy}>
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M10 2v10m-4-4 4 4 4-4M3 12v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4" /></svg>
            {running === "export" ? "Exporting…" : "Export HTML"}
          </button>
          {onTeamReview && <button className="rc-export" type="button" onClick={onTeamReview}>Team review</button>}
        </div>
      </form>
      {(problem.message || status) && (
        <div className="rc-messages">
          {problem.message && <p className="rc-error" id={`${id}-error`} role="alert">{problem.message}</p>}
          {status && <p className="rc-notice" id={`${id}-status`} role="status">{status}</p>}
        </div>
      )}
    </div>
  );
}
