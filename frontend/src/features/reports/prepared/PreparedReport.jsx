import { createElement, useCallback, useEffect, useRef, useState } from "react";
import { ReportReader } from "../assistant/ReportChat";
import { buildPreparedContext } from "../assistant/reportContext";
import { SEPTEMBER_2026 } from "../periods";
import { ReportPeriodToolbar } from "../ReportPeriodToolbar";
import __embed_IC from "./september-2026-embedded.html?raw";
import __embed_hC from "./september-2026-download.html?raw";
const preparedReportHtml = __embed_IC,
  preparedReportDownloadHtml = __embed_hC;
const PREPARED_CONTEXT = buildPreparedContext(),
  PREPARED_NAV = [
    ["glance", "At a glance"],
    ["progress", "Progress since July"],
    ["win", "Where you win"],
    ["plan", "Action plan"],
    ["measure", "How we measure & refine"],
    ["appendix", "Appendix"],
  ];
function PreparedReport({ onPeriodApply, client, onTeamReview }) {
  const e = useRef(null),
    t = useRef(null),
    i = useRef([]),
    [n, o] = useState(800),
    [a, r] = useState("glance"),
    l = useCallback(() => {
      const d = e.current;
      if (!d) {
        return;
      }
      const B = (t.current?.offsetHeight || 52) + 24 - d.getBoundingClientRect().top,
        g = i.current.filter((M) => M.top <= B).at(-1);
      r(g?.id || "glance");
    }, []),
    s = useCallback((d) => {
      const g = e.current?.contentDocument?.getElementById(d);
      if (!g) {
        return;
      }
      let M = g.closest("details");
      for (; M;) {
        M.open = true;
        M = M.parentElement?.closest("details");
      }
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!e.current || !g.isConnected) {
            return;
          }
          const h = window.scrollY + e.current.getBoundingClientRect().top + g.getBoundingClientRect().top,
            U = (t.current?.offsetHeight || 52) + 16;
          window.scrollTo({
            top: Math.max(0, h - U),
            behavior: "instant",
          });
        }),
      );
    }, []);
  useEffect(() => {
    let d = 0,
      B = () => {
        if (!d) {
          d = requestAnimationFrame(() => {
            d = 0;
            l();
          });
        }
      },
      g = (M) => {
        if (M.source !== e.current?.contentWindow) {
          return;
        }
        const h = M.data;
        if (h?.type === "komosion:report-layout") {
          if (Number.isFinite(h.height) && h.height > 0 && h.height < 1e6) {
            o(Math.ceil(h.height));
          }
          if (Array.isArray(h.sections)) {
            i.current = h.sections.filter(
              (U) => PREPARED_NAV.some(([I]) => I === U?.id) && Number.isFinite(U.top),
            );
          }
          B();
        } else if (h?.type === "komosion:report-scroll" && typeof h.id == "string") {
          s(h.id);
        }
      };
    window.addEventListener("message", g);
    window.addEventListener("scroll", B, {
      passive: true,
    });
    window.addEventListener("resize", B);
    return () => {
      cancelAnimationFrame(d);
      window.removeEventListener("message", g);
      window.removeEventListener("scroll", B);
      window.removeEventListener("resize", B);
    };
  }, [s, l]);
  function c() {
    const d = URL.createObjectURL(
        new Blob([preparedReportDownloadHtml], {
          type: "text/html;charset=utf-8",
        }),
      ),
      B = document.createElement("a");
    B.href = d;
    B.download = "Komosion-IC-Coogee-September-2026-Report.html";
    B.click();
    setTimeout(() => URL.revokeObjectURL(d), 1e4);
  }
  return (
    <section className="report-hub report-page coogee-client-report" aria-label="September 2026 report">
      <header className="coogee-report-heading">
        <div>
          <span className="rh-eyebrow">InterContinental Sydney Coogee Beach</span>
          <h1>September 2026 report</h1>
          <p>AI visibility, what it means and the October action plan.</p>
        </div>
        <ReportPeriodToolbar
          period={SEPTEMBER_2026}
          onApply={onPeriodApply}
          onExport={c}
          onTeamReview={client?.hasMeasurements ? onTeamReview : undefined}
        />
      </header>
      <nav ref={t} className="coogee-report-sections" aria-label="Report sections">
        {PREPARED_NAV.map(([d, B]) => (
          <a
            key={d}
            href={`#${d}`}
            aria-current={a === d ? "location" : undefined}
            onClick={(g) => {
              g.preventDefault();
              s(d);
            }}
          >
            {B}
          </a>
        ))}
      </nav>
      <ReportReader context={PREPARED_CONTEXT} onSource={s}>
        <iframe
          ref={e}
          className="coogee-report-frame"
          style={{
            height: n,
          }}
          scrolling="no"
          title="InterContinental Sydney Coogee Beach — September 2026 report"
          srcDoc={preparedReportHtml}
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        />
      </ReportReader>
    </section>
  );
}
export { PreparedReport };
