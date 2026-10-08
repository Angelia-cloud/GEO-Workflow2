import { createElement, useId, useRef, useState } from "react";
function ReportCitations({ sources = [], context, onSource }) {
  const [i, n] = useState(false),
    o = useId(),
    a = useRef(null);
  if (!sources.length) {
    return null;
  }
  const r = typeof onSource == "function",
    l = sources.length,
    s = sources[0].label;
  function c(d) {
    if (!(d.key !== "Escape" || !i)) {
      d.preventDefault();
      d.stopPropagation();
      n(false);
      a.current?.focus();
    }
  }
  return (
    <span className="report-citations" onKeyDown={c}>
      <button
        ref={a}
        className="report-citations-pill"
        type="button"
        aria-expanded={i}
        aria-controls={o}
        aria-label={`${i ? "Hide" : "Show"} sources: ${s}${l > 1 ? ` and ${l - 1} more` : ""}`}
        title={s}
        onClick={() => n((d) => !d)}
      >
        <svg
          className="report-citations-icon"
          width="12"
          height="12"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 2.5h6l4 4v11H5zM11 2.5v4h4M8 10h4M8 13h4" />
        </svg>
        <span className="report-citations-pill-label">{s}</span>
        {l > 1 && (
          <span className="report-citations-count" aria-hidden="true">
            +{l - 1}
          </span>
        )}
      </button>
      <span className="report-citations-expanded" id={o} hidden={!i} role="group" aria-label="Report sources">
        <span className="report-citations-heading">
          {"Sources \xB7 "}
          {l}
        </span>
        <span className="report-citations-list" role="list">
          {sources.map((d, B) => {
            const g = r ? "button" : "span";
            return (
              <span className="report-citations-item" role="listitem" key={`${d.id}-${B}`}>
                {createElement(
                  g,
                  {
                    className: "report-citation-row",
                    ...(r
                      ? {
                          type: "button",
                          onClick: () => onSource(d.id),
                          "aria-label": `Open source: ${d.label}`,
                        }
                      : {}),
                  },
                  <span className="report-citation-content">
                    <span className="report-citation-title">{d.label}</span>
                    {context?.periodLabel && (
                      <span className="report-citation-period">{context.periodLabel}</span>
                    )}
                  </span>,
                  r && (
                    <svg
                      className="report-citation-open"
                      width="14"
                      height="14"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M4 10h12m-5-5 5 5-5 5" />
                    </svg>
                  ),
                )}
              </span>
            );
          })}
        </span>
      </span>
    </span>
  );
}
export { ReportCitations };
