import { useId, useRef, useState } from "react";
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
  onFileChange,
  busy = false,
  uploading = false,
  error = "",
  importNotice = "",
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
            <p>Import a Rankscale CSV to create a report for this client.</p>
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
                ? "Your file is imported automatically. No date selection is needed here."
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
    </div>
  );
}
export { RankscaleIntake };
