import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../api/client";
import { fmtDateTime, fmtDay } from "../../lib/workspaceSettings";
function EvidenceDrawer({ item, onClose }) {
  const [t, i] = useState(null),
    [n, o] = useState(""),
    [a, r] = useState(null),
    l = useRef(null),
    s = useRef(null),
    c = a || item.type === "measurement" ? "measurement" : "insight",
    d = a || item.value;
  useEffect(() => {
    r(null);
  }, [item]);
  useEffect(() => {
    let g = true;
    i(null);
    o("");
    const M = c === "measurement" ? `/api/measurements/${d}` : `/api/insights/item/${d}/evidence`;
    apiFetch(M)
      .then((h) => {
        if (g) {
          i(h);
        }
      })
      .catch((h) => {
        if (g) {
          o(h.message);
        }
      });
    return () => {
      g = false;
    };
  }, [c, d]);
  useEffect(() => {
    s.current = document.activeElement;
    l.current?.focus();
    const g = (M) => {
      if (M.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", g);
    return () => {
      document.removeEventListener("keydown", g);
      s.current?.focus?.();
    };
  }, [onClose]);
  function B(g) {
    if (g.key !== "Tab") {
      return;
    }
    const M = [
        ...g.currentTarget.querySelectorAll(
          'button:not([disabled]), a[href], input, textarea, select, [tabindex="0"]',
        ),
      ],
      h = M[0],
      U = M[M.length - 1];
    if (g.shiftKey && document.activeElement === h) {
      g.preventDefault();
      U?.focus();
    } else if (!g.shiftKey && document.activeElement === U) {
      g.preventDefault();
      h?.focus();
    }
  }
  return (
    <div className="guided-drawer-layer">
      <button
        type="button"
        className="guided-drawer-scrim"
        tabIndex={-1}
        aria-label="Close evidence"
        onClick={onClose}
      />
      <aside
        className="guided-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guided-drawer-title"
        onKeyDown={B}
      >
        <div className="guided-drawer-heading">
          <div>
            <span className="guided-eyebrow">Review evidence</span>
            <h2 id="guided-drawer-title">
              {c === "measurement" ? "Answer & cited sources" : "Supporting evidence"}
            </h2>
          </div>
          <button
            ref={l}
            className="guided-secondary"
            type="button"
            onClick={onClose}
            aria-label="Close evidence"
          >
            Close ×
          </button>
        </div>
        {a && (
          <button type="button" className="guided-evidence-link" onClick={() => r(null)}>
            ← Back to finding
          </button>
        )}
        <p className="guided-muted">
          Measured answers from the Rankscale export. Source links are available for your own verification.
        </p>
        {n ? (
          <p className="guided-error" role="alert">
            {n}
          </p>
        ) : t ? (
          c === "measurement" ? (
            <>
              <section className="guided-drawer-section">
                <h3>{t.prompt_text}</h3>
                <p className="guided-muted">
                  {t.engine}
                  {" \xB7 "}
                  {fmtDateTime(t.measured_at)}
                  {" \xB7 "}
                  {t.intent}
                </p>
                <span
                  className={`guided-status ${t.brand_found_any_alias ? "guided-status-approved" : "guided-status-rejected"}`}
                >
                  {t.brand_found_any_alias
                    ? `Hotel mentioned${t.own_brand_rank ? ` at #${t.own_brand_rank}` : ""}`
                    : "Hotel not mentioned"}
                </span>
              </section>
              <section className="guided-drawer-section">
                <h3>Answer excerpt</h3>
                <div className="guided-answer">{t.response_text}</div>
              </section>
              <section className="guided-drawer-section">
                <h3>Cited sources</h3>
                {t.evidence.map((g) => (
                  <div className="guided-source" key={g.id}>
                    <a href={g.url} target="_blank" rel="noreferrer">
                      {g.domain || g.url}
                      {" \u2197"}
                    </a>
                    <p>
                      {g.competitor || g.attributed_to}
                      {" \xB7 "}
                      {g.verification_status === "unverified"
                        ? "Not yet independently verified"
                        : g.verification_status}
                    </p>
                  </div>
                ))}
              </section>
            </>
          ) : (
            <>
              <section className="guided-drawer-section">
                <h3>{t.insight.title}</h3>
                <p>{t.insight.summary}</p>
                <p className="guided-muted">
                  {t.measurement_count}
                  {" answers \xB7 "}
                  {fmtDay(t.insight.period_start)}
                  {" \u2013 "}
                  {fmtDay(t.insight.period_end)}
                </p>
              </section>
              <section className="guided-drawer-section">
                <h3>Engine breakdown</h3>
                <div className="guided-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Engine</th>
                        <th>Answers</th>
                        <th>Detection</th>
                        <th>Visibility</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.engine_breakdown.map((g) => (
                        <tr key={g.name}>
                          <td>{g.name}</td>
                          <td>{g.answers}</td>
                          <td>{g.detection}%</td>
                          <td>{g.visibility}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="guided-drawer-section">
                <h3>Sources cited in these answers</h3>
                {t.citations.map((g) => (
                  <div className="guided-source" key={g.domain}>
                    <strong>{g.domain}</strong>
                    <p>
                      {g.count}
                      {" citations \xB7 "}
                      {g.source_type}
                      {" \xB7 "}
                      {g.for_hotel}
                      {" for the hotel"}
                    </p>
                  </div>
                ))}
              </section>
              <section className="guided-drawer-section">
                <h3>Inspect an answer</h3>
                {t.relevant_measurements.map((g) => (
                  <button
                    type="button"
                    key={g.measurement_id}
                    className="guided-answer-row"
                    onClick={() => r(g.measurement_id)}
                  >
                    <span>
                      <strong>{g.engine}</strong>
                      <small>{fmtDay(g.measured_at)}</small>
                    </span>
                    <span>
                      {g.detected ? "Hotel mentioned" : "Hotel not mentioned"}
                      {" \u2192"}
                    </span>
                  </button>
                ))}
              </section>
            </>
          )
        ) : (
          <p role="status">Loading supporting evidence…</p>
        )}
      </aside>
    </div>
  );
}
export { EvidenceDrawer };
