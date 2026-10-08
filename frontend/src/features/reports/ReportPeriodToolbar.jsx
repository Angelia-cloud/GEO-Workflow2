import { useEffect, useId, useRef, useState } from "react";
const isDateString = (A) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(A || "")) {
    return false;
  }
  const e = new Date(`${A}T00:00:00Z`);
  return Number.isFinite(e.getTime()) && e.toISOString().slice(0, 10) === A;
};
function ReportPeriodToolbar({ period, onApply, onExport, exportDisabled = false, error = "", notice = "", onTeamReview }) {
  const a = useId(),
    r = useRef(null),
    l = useRef(null),
    [s, c] = useState({
      from: period?.from || "",
      to: period?.to || "",
    }),
    [d, B] = useState({
      message: "",
      field: "",
    }),
    [g, M] = useState(""),
    [h, U] = useState("");
  useEffect(() => {
    c({
      from: period?.from || "",
      to: period?.to || "",
    });
    B({
      message: "",
      field: "",
    });
    M("");
  }, [period?.from, period?.to]);
  const I = s.from !== (period?.from || "") || s.to !== (period?.to || ""),
    Q = d.message || error,
    p = Q || g,
    Y = I ? "Apply dates before exporting the report." : notice,
    E = [p && `${a}-error`, Y && `${a}-status`].filter(Boolean).join(" ") || undefined;
  function u(j, w) {
    c((z) => ({
      ...z,
      [j]: w,
    }));
    B({
      message: "",
      field: "",
    });
    M("");
  }
  async function F(j) {
    if ((j.preventDefault(), h)) {
      return;
    }
    let w = null;
    if (
      (isDateString(s.from)
        ? isDateString(s.to)
          ? s.from > s.to &&
            (w = {
              field: "to",
              message: "To date must be on or after From date.",
            })
          : (w = {
              field: "to",
              message: "Enter a valid To date.",
            })
        : (w = {
            field: "from",
            message: "Enter a valid From date.",
          }),
      w)
    ) {
      B(w);
      (w.field === "from" ? r : l).current?.focus();
      return;
    }
    B({
      message: "",
      field: "",
    });
    M("");
    U("apply");
    try {
      await onApply({
        ...s,
      });
    } catch (z) {
      B({
        field: "",
        message: z?.message || "The dates could not be applied. Please try again.",
      });
    } finally {
      U("");
    }
  }
  async function m() {
    if (!(h || I || exportDisabled || Q)) {
      M("");
      U("export");
      try {
        await onExport();
      } catch (j) {
        M(j?.message || "The report could not be exported. Please try again.");
      } finally {
        U("");
      }
    }
  }
  return (
    <div className="report-period-toolbar" aria-busy={!!h}>
      <form className="rpt-date-form" aria-label="Reporting period" onSubmit={F} noValidate>
        <div className="rpt-range-fields">
          <label className="rpt-date-field" htmlFor={`${a}-from`}>
            From date
            <input
              ref={r}
              id={`${a}-from`}
              type="date"
              required
              value={s.from}
              disabled={!!h}
              onInput={(j) => u("from", j.currentTarget.value)}
              onChange={(j) => u("from", j.target.value)}
              aria-invalid={!!(error || (d.message && (!d.field || d.field === "from")))}
              aria-describedby={E}
            />
          </label>
          <svg
            className="rpt-range-arrow"
            viewBox="0 0 20 20"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M3 10h13m-5-5 5 5-5 5" />
          </svg>
          <label className="rpt-date-field" htmlFor={`${a}-to`}>
            To date
            <input
              ref={l}
              id={`${a}-to`}
              type="date"
              required
              value={s.to}
              disabled={!!h}
              onInput={(j) => u("to", j.currentTarget.value)}
              onChange={(j) => u("to", j.target.value)}
              aria-invalid={!!(error || (d.message && (!d.field || d.field === "to")))}
              aria-describedby={E}
            />
          </label>
        </div>
        <div className="rpt-actions">
          <button className="rpt-apply" type="submit" disabled={!!h}>
            {h === "apply" ? "Applying\u2026" : "Apply dates"}
          </button>
          <span className="rpt-action-divider" aria-hidden="true" />
          <button
            className="rpt-export"
            type="button"
            disabled={exportDisabled || I || !!h || !!Q}
            onClick={m}
            aria-describedby={E}
          >
            <svg
              viewBox="0 0 20 20"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path d="M10 2v10m-4-4 4 4 4-4M3 12v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4" />
            </svg>
            {h === "export" ? "Exporting\u2026" : "Export HTML"}
          </button>
          {onTeamReview && (
            <>
              <span className="rpt-action-divider" aria-hidden="true" />
              <button className="rpt-export" type="button" onClick={onTeamReview}>
                Team review
              </button>
            </>
          )}
        </div>
      </form>
      {p && (
        <p className="rpt-error" id={`${a}-error`} role="alert">
          {p}
        </p>
      )}
      {Y && (
        <p className="rpt-notice" id={`${a}-status`} role="status">
          {Y}
        </p>
      )}
    </div>
  );
}
export { ReportPeriodToolbar };
