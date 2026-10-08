import { useId, useRef, useState } from "react";
import { downloadSample } from "../../lib/samples";
const fmtInteger = (A) => new Intl.NumberFormat("en-AU").format(Number(A) || 0);
function fmtHistoryDate(A) {
  if (!A) {
    return "\u2014";
  }
  const e = new Date(`${A.slice(0, 10)}T12:00:00`);
  return Number.isNaN(e.getTime())
    ? A
    : new Intl.DateTimeFormat("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(e);
}
function historyRange(A) {
  return !A?.dateFrom || !A?.dateTo
    ? "No dates available"
    : `${fmtHistoryDate(A.dateFrom)} \u2013 ${fmtHistoryDate(A.dateTo)}`;
}
function UploadIcon() {
  return (
    <svg
      aria-hidden="true"
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 16V3m-5 5 5-5 5 5M4 14v6h16v-6" />
    </svg>
  );
}
function RankscaleIntake({
  clientName,
  historySummary = {},
  onFileChange,
  busy = false,
  uploading = false,
  error = "",
  importNotice = "",
  hasHistory = false,
  sourceName = "",
}) {
  const c = useRef(null),
    d = useRef(0),
    [B, g] = useState(false),
    M = useId(),
    h = !!clientName && !busy;
  function U(I) {
    d.current = 0;
    g(false);
    I && h && onFileChange?.(I);
  }
  return (
    <div className="rankscale-intake">
      <div className="rankscale-context">
        <span>Client</span>
        <strong>{clientName || "Select a client in the top bar"}</strong>
      </div>
      <section className="rankscale-stage" aria-labelledby={`${M}-upload-title`}>
        <div className="rankscale-stage-heading">
          <div>
            <h2 id={`${M}-upload-title`}>Import your Rankscale file</h2>
            <p>
              Every record is added to this client’s saved history. Existing records are skipped
              automatically.
            </p>
          </div>
        </div>
        <div
          className={`rankscale-dropzone${B ? " is-dragging" : ""}${busy ? " is-busy" : ""}`}
          onDragEnter={(I) => {
            I.preventDefault();
            if (h) {
              d.current += 1;
              g(true);
            }
          }}
          onDragOver={(I) => {
            I.preventDefault();
            I.dataTransfer.dropEffect = h ? "copy" : "none";
          }}
          onDragLeave={(I) => {
            I.preventDefault();
            d.current = Math.max(0, d.current - 1);
            if (!d.current) {
              g(false);
            }
          }}
          onDrop={(I) => {
            I.preventDefault();
            U(I.dataTransfer.files?.[0]);
          }}
          aria-busy={busy}
        >
          <span className="rankscale-upload-icon">
            <UploadIcon />
          </span>
          <div>
            <h3>{uploading ? "Importing your file\u2026" : "Drop your Rankscale CSV here"}</h3>
            <p>
              {clientName
                ? "Your full file is imported and saved automatically. No date selection is needed here."
                : "Choose a client in the top bar before importing data."}
            </p>
          </div>
          <input
            ref={c}
            type="file"
            accept=".csv,text/csv"
            hidden
            aria-label="Rankscale CSV file"
            onChange={(I) => {
              const Q = I.target.files?.[0];
              I.target.value = "";
              U(Q);
            }}
          />
          <button type="button" className="guided-secondary" disabled={!h} onClick={() => c.current?.click()}>
            {uploading ? "Importing\u2026" : busy ? "Loading\u2026" : "Import Rankscale file"}
          </button>
        </div>
        <div className="rankscale-sample-download">
          <span>Try a fictional dataset</span>
          <button type="button" className="guided-evidence-link" onClick={() => downloadSample("rankscale")}>
            Download sample CSV
          </button>
        </div>
        {error && (
          <p className="rankscale-message rankscale-message-error" role="alert">
            {error}
          </p>
        )}
        {importNotice && (
          <p className="rankscale-message rankscale-message-success" role="status">
            {importNotice}
          </p>
        )}
        {sourceName && (
          <p className="rankscale-source">
            {"Latest import: "}
            <strong>{sourceName}</strong>
          </p>
        )}
      </section>
      {hasHistory && (
        <section className="rankscale-stage rankscale-saved-summary" aria-labelledby={`${M}-saved-title`}>
          <div className="rankscale-stage-heading">
            <div>
              <h2 id={`${M}-saved-title`}>Saved history</h2>
              <p>Open your report to choose From and To dates and explore the selected data.</p>
            </div>
          </div>
          <div className="rankscale-history-summary">
            <div>
              <span className="rankscale-kicker">Available dates</span>
              <strong>{historyRange(historySummary)}</strong>
            </div>
            <p>
              <strong>{fmtInteger(historySummary.rowCount)}</strong>
              {" records \xB7 "}
              {fmtInteger(historySummary.answerCount)}
              {" distinct answers \xB7 "}
              {fmtInteger(historySummary.promptCount)}
              {" prompts"}
            </p>
          </div>
        </section>
      )}
      <div className="rankscale-intake-footnote">
        <p>
          Imported records are saved to the GEO database for this client. Records already saved are skipped, so
          you can upload overlapping exports.
        </p>
      </div>
    </div>
  );
}
export { RankscaleIntake };
