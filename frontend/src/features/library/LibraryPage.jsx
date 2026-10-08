import { createElement, useEffect, useRef, useState } from "react";
import { belongsToClient } from "../clients/clients";
import { RankscaleFiles } from "../rankscale/RankscaleFiles";
import { RankscaleImportHistory } from "../rankscale/RankscaleImportHistory";
import { ImportIcon } from "../settings/SettingsPage";
import { getLibraryFile, listLibrary, saveLibraryEntry } from "./libraryStore";
const personName = (A) =>
    typeof A == "string" ? A : A?.name || A?.displayName || A?.email || "Workspace member",
  fmtSavedDate = (A) =>
    A && !Number.isNaN(Date.parse(A))
      ? new Date(A).toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "Existing link",
  fmtKb = (A) => (Number.isFinite(Number(A)) ? `${(Number(A) / 1024).toFixed(1)} KB` : ""),
  fmtPeriodDate = (A) =>
    /^\d{4}-\d{2}-\d{2}$/.test(A || "")
      ? new Date(`${A}T00:00:00Z`).toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        })
      : A
        ? fmtSavedDate(A)
        : "Not recorded",
  fmtPeriod = (A) =>
    typeof A == "string"
      ? A
      : `${fmtPeriodDate(A?.from || A?.start)} \u2013 ${fmtPeriodDate(A?.to || A?.end)}`;
function csvCell(A) {
  let e = A == null ? "" : typeof A == "object" ? JSON.stringify(A) : String(A);
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(e) || /^[\t\r\n]/.test(e)) {
    e = `'${e}`;
  }
  return `"${e.replaceAll('"', '""')}"`;
}
function recordsCsv(A) {
  const e = [
    ...new Set(
      A.flatMap((i) =>
        i.sourceFields && typeof i.sourceFields == "object" && !Array.isArray(i.sourceFields)
          ? Object.keys(i.sourceFields)
          : [],
      ),
    ),
  ];
  return (
    "\uFEFF" +
    [
      ["Date", "Engine", "Prompt", "Answer", ...e.map((i) => `Source: ${i}`)],
      ...A.map((i) => [i.date, i.engine, i.prompt, i.answer, ...e.map((n) => i.sourceFields?.[n])]),
    ].map((i) => i.map(csvCell).join(",")).join(`\r
`)
  );
}
function downloadRecordsCsv(A) {
  const e = new Blob([recordsCsv(A.records || [])], {
      type: "text/csv;charset=utf-8",
    }),
    t = URL.createObjectURL(e),
    i = document.createElement("a");
  i.href = t;
  i.download = `Rankscale-selected-${A.period?.from || "data"}-${A.period?.to || "rows"}.csv`;
  i.click();
  setTimeout(() => URL.revokeObjectURL(t), 1e3);
}
function safeSheetUrl(A) {
  try {
    const e = new URL(A);
    return e.protocol === "https:" &&
      e.hostname === "docs.google.com" &&
      !e.username &&
      !e.password &&
      /^\/spreadsheets\/d\/[a-zA-Z0-9_-]+(?:\/|$)/.test(e.pathname)
      ? e.href
      : "";
  } catch {
    return "";
  }
}
function sheetPreviewUrl(A) {
  const e = safeSheetUrl(A);
  if (!e) {
    return "";
  }
  const t = new URL(e),
    i = t.pathname.split("/")[3],
    n = new URL(`https://docs.google.com/spreadsheets/d/${i}/preview`),
    o = t.searchParams.get("gid") || new URLSearchParams(t.hash.slice(1)).get("gid");
  if (o) {
    n.searchParams.set("gid", o);
  }
  return n.href;
}
function entryStatusLabel(A) {
  return A.isReference || A.status === "reference"
    ? "Reference workbook"
    : {
        draft: "Needs review",
        approved: "Human approved",
        complete: "Review complete",
        confirmed: "Data confirmed",
        ready: "Ready for review",
      }[A.status] || "Saved";
}
function DatasetStats({ entry }) {
  const e = entry.summary || entry.stats || entry.reviewSummary || {},
    t = [
      ["Rows", entry.rows ?? entry.rowCount ?? e.rowCount ?? e.rows ?? e.total_rows],
      ["Prompts", entry.prompts ?? entry.promptCount ?? e.promptCount ?? e.prompts ?? e.prompt_count],
      ["AI engines", entry.engines ?? entry.engineCount ?? e.engines ?? e.engine_count],
      ["Distinct answers", e.answerCount],
    ];
  return (
    <div className="library-stats">
      {t
        .filter(([, i]) => i != null)
        .map(([i, n]) => (
          <div key={i}>
            <strong>{Array.isArray(n) ? n.length : typeof n == "object" ? Object.keys(n).length : n}</strong>
            <span>{i}</span>
          </div>
        ))}
    </div>
  );
}
function DatasetMeta({ entry }) {
  return (
    <span
      className={`guided-status ${["approved", "complete", "confirmed"].includes(entry.status) ? "guided-status-approved" : ""}`}
    >
      {entryStatusLabel(entry)}
    </span>
  );
}
function WorkbookRecord({ entry }) {
  const [e, t] = useState(false),
    i = safeSheetUrl(entry.sheetUrl || entry.url);
  return (
    <article className="library-record">
      <div className="library-record-top">
        <div>
          <span className="guided-eyebrow">01 Prompt</span>
          <h3>{entry.title || "Property workbook"}</h3>
          <p>{entry.property || entry.client || "Prompt workbook"}</p>
        </div>
        <DatasetMeta entry={entry} />
      </div>
      <div className="library-record-bottom">
        <p>
          {entry.isReference
            ? "Existing project workbook \xB7 Access follows its Google sharing settings."
            : `Saved ${fmtSavedDate(entry.createdAt)} \xB7 ${personName(entry.createdBy)}`}
        </p>
        <div className="library-actions">
          {i ? (
            <>
              <button className="guided-secondary" aria-expanded={e} onClick={() => t((n) => !n)}>
                {e ? "Close preview" : "Preview"}
              </button>
              <a className="guided-primary" href={i} target="_blank" rel="noopener noreferrer">
                Open Google Sheets
              </a>
            </>
          ) : (
            <span className="guided-muted">No Google Sheets link was saved.</span>
          )}
        </div>
      </div>
      {!entry.isReference && <DatasetStats entry={entry} />}
      {e && (
        <div className="library-sheet-preview">
          <p>Google may ask you to sign in. Local approvals do not update this workbook.</p>
          <iframe
            title={`${entry.title || "Property workbook"} preview`}
            src={sheetPreviewUrl(i)}
            referrerPolicy="no-referrer"
            loading="lazy"
          />
          <p>If the preview cannot load, use Open Google Sheets.</p>
        </div>
      )}
    </article>
  );
}
function SelectedRecords({ records }) {
  const e = records.slice(0, 20);
  return (
    <section className="library-selected-data" aria-label="Selected Rankscale rows">
      <div className="library-selected-heading">
        <h4>Selected data</h4>
        <p>
          {records.length > 20
            ? `Showing the first 20 of ${records.length.toLocaleString()} rows. Download the selected CSV for every row.`
            : `${records.length.toLocaleString()} rows in the approved date range.`}
        </p>
      </div>
      <div className="library-table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">AI engine</th>
              <th scope="col">{"Prompt & answer"}</th>
            </tr>
          </thead>
          <tbody>
            {e.map((t, i) => (
              <tr key={`${t.id || t.answerId || "row"}-${i}`}>
                <td>{fmtPeriodDate(t.date)}</td>
                <td>{t.engine || "Not provided"}</td>
                <td>
                  <p>{t.prompt || "No prompt recorded"}</p>
                  {t.answer && (
                    <details>
                      <summary>View answer</summary>
                      <p className="library-answer">{t.answer}</p>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function DatasetRecord({ entry, relatedReview, onOpenReview }) {
  const [i, n] = useState(false),
    [o, a] = useState(""),
    [r, l] = useState(null),
    [s, c] = useState(false);
  async function d(I) {
    c(true);
    a("");
    try {
      const Q = await getLibraryFile(entry.id);
      if (!Q) {
        a("The original file is not stored. Its saved summary is still available.");
        return;
      }
      if (I === "preview") {
        l(
          (await Q.slice(0, 65536).text()).split(/\r?\n/).slice(0, 12).join(`
`),
        );
        return;
      }
      const p = URL.createObjectURL(Q),
        Y = document.createElement("a");
      Y.href = p;
      Y.download = entry.fileName || entry.title || "rankscale-data.csv";
      Y.click();
      setTimeout(() => URL.revokeObjectURL(p), 1e3);
    } catch {
      a("The saved file could not be opened. Try uploading the original again.");
    } finally {
      c(false);
    }
  }
  const B = entry.isSample || entry.sample || entry.mode === "sample" || entry.illustrative,
    g = entry.source === "rankscale",
    M = Array.isArray(entry.records) ? entry.records : [],
    h = entry.historySummary,
    U = Array.isArray(entry.sourceNames) ? entry.sourceNames : [];
  return (
    <article className="library-record">
      <div className="library-record-top">
        <div>
          <span className="guided-eyebrow">02 Rankscale{B ? " \xB7 Sample data" : ""}</span>
          <h3>{entry.title || entry.fileName || "Rankscale data"}</h3>
          <p>{entry.property || entry.client || "Rankscale dataset"}</p>
          {g && entry.period && (
            <p className="library-selected-period">
              {"Selected dates: "}
              {fmtPeriod(entry.period)}
            </p>
          )}
        </div>
        <DatasetMeta entry={relatedReview || entry} />
      </div>
      <div className="library-record-bottom">
        <p>
          {g ? "Saved" : "Uploaded"} {fmtSavedDate(entry.createdAt)}
          {" \xB7 "}
          {personName(entry.createdBy)}
          {entry.fileSize ? ` \xB7 ${fmtKb(entry.fileSize)}` : ""}
        </p>
        <div className="library-actions">
          <button className="guided-secondary" aria-expanded={i} onClick={() => n((I) => !I)}>
            {i ? "Close details" : "View data"}
          </button>
          {g && M.length > 0 && (
            <button className="guided-primary" onClick={() => downloadRecordsCsv(entry)}>
              Download selected CSV
            </button>
          )}
          {relatedReview && onOpenReview && (
            <button className="guided-primary" onClick={() => onOpenReview(relatedReview)}>
              View completed review
            </button>
          )}
        </div>
      </div>
      {i && (
        <div className="library-data-details">
          <DatasetStats entry={entry} />
          <dl>
            <div>
              <dt>{g ? "Source exports" : "Source file"}</dt>
              <dd>
                {g
                  ? U.join(", ") || entry.fileName || "Saved Rankscale history"
                  : entry.fileName || "File name not recorded"}
              </dd>
            </div>
            <div>
              <dt>Saved by</dt>
              <dd>{personName(entry.createdBy)}</dd>
            </div>
            {entry.approvedBy && (
              <div>
                <dt>{g ? "Data selection approved by" : "Approved by"}</dt>
                <dd>
                  {personName(entry.approvedBy)}
                  {entry.approvedAt ? ` \xB7 ${fmtSavedDate(entry.approvedAt)}` : ""}
                </dd>
              </div>
            )}
            <div>
              <dt>Storage</dt>
              <dd>
                {entry.fileStored ? "GEO database \xB7 original file kept" : "GEO database"}
              </dd>
            </div>
            {entry.period && (
              <div>
                <dt>{g ? "Approved date range" : "Reporting period"}</dt>
                <dd>{fmtPeriod(entry.period)}</dd>
              </div>
            )}
            {g && h?.dateFrom && h?.dateTo && (
              <div>
                <dt>Saved history at approval</dt>
                <dd>
                  {fmtPeriod({
                    from: h.dateFrom,
                    to: h.dateTo,
                  })}
                  {Number.isFinite(h.rowCount) ? ` \xB7 ${h.rowCount.toLocaleString()} rows` : ""}
                </dd>
              </div>
            )}
          </dl>
          {g && (
            <p className="library-source-note">
              Selected data approved. Ready for analysis. This saved dataset contains actual Rankscale rows;
              AI insights and report metrics have not been generated.
            </p>
          )}
          {entry.notes && <p className="guided-muted">{typeof entry.notes == "string" ? entry.notes : ""}</p>}
          {g && M.length > 0 && <SelectedRecords records={M} />}
          {g && !M.length && entry.rows > 0 && (
            <p className="guided-alert">
              Only this dataset’s summary is available. Open the dashboard and select these dates from the
              saved history, or import the export again.
            </p>
          )}
          <div className="library-actions">
            {entry.fileStored && (
              <>
                {!g && (
                  <button className="guided-secondary" disabled={s} onClick={() => d("preview")}>
                    Preview source file
                  </button>
                )}
                <button className="guided-secondary" disabled={s} onClick={() => d("download")}>
                  Download original
                </button>
              </>
            )}
            {!relatedReview && !g && (
              <span className="guided-muted">
                Complete the human review to save its decisions and action plan.
              </span>
            )}
          </div>
          {o && (
            <p className="guided-alert" role="status">
              {o}
            </p>
          )}
          {r !== null && (
            <div className="library-source">
              <div>
                <strong>Source file preview</strong>
                <button className="guided-evidence-link" onClick={() => l(null)}>
                  Close
                </button>
              </div>
              <p>First 12 lines of the original file.</p>
              <pre>{r}</pre>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
function LibraryPage({
  entries = [],
  onOpenReview,
  onStartWorkflow,
  onEntriesChange,
  onDatasetSaved,
  onOpenDashboard,
  account,
  initialPhase = 1,
  phaseOnly = null,
  selectedClient = null,
  active = true,
}) {
  const d = useRef(null);
  useEffect(() => {
    active &&
      d.current?.focus({
        preventScroll: true,
      });
  }, [active, phaseOnly, initialPhase]);
  const [B, g] = useState((phaseOnly || initialPhase) === 2 ? "data" : "sheet");
  useEffect(() => {
    g((phaseOnly || initialPhase) === 2 ? "data" : "sheet");
  }, [initialPhase, phaseOnly]);
  const [M, h] = useState(false),
    [U, I] = useState(""),
    [Q, p] = useState(""),
    [Y, E] = useState(""),
    [u, F] = useState(""),
    [m, j] = useState(""),
    [w, z] = useState(false),
    C = selectedClient
      ? [selectedClient.id, selectedClient.name, selectedClient.property].join("|")
      : "all-clients",
    R = useRef(C);
  R.current = C;
  useEffect(() => {
    h(false);
    I("");
    p("");
    E("");
    F("");
    j("");
    z(false);
  }, [C]);
  const N = selectedClient ? entries.filter((V) => belongsToClient(V, selectedClient)) : [],
    D = N.filter((V) => V.type === "sheet"),
    L = N.filter((V) => V.type === "data"),
    H = selectedClient ? N.filter((V) => V.type === "report") : [],
    pA = N.filter((V) => V.type === "review");
  function O(V) {
    return pA.find(
      (q) =>
        (q.dataId && q.dataId === V.id) ||
        (q.sourceId && q.sourceId === V.id) ||
        (q.batchId && q.batchId === V.batchId) ||
        (q.batch_id && q.batch_id === V.batch_id),
    );
  }
  const EA = pA.filter((V) => !L.some((q) => O(q)?.id === V.id));
  async function v(V) {
    V.preventDefault();
    F("");
    j("");
    const q = safeSheetUrl(Q.trim());
    if (!U.trim()) {
      F("Give this workbook a name.");
      return;
    }
    if (!q) {
      F("Use a Google Sheets link beginning with https://docs.google.com/spreadsheets/d/.");
      return;
    }
    const iA = C,
      rA = selectedClient
        ? {
            clientId: selectedClient.id,
            client: selectedClient.name,
            property: selectedClient.property || selectedClient.name,
          }
        : {
            property: Y.trim(),
          };
    z(true);
    try {
      const jA = await saveLibraryEntry({
        type: "sheet",
        title: U.trim(),
        sheetUrl: q,
        ...rA,
        createdBy: personName(account),
        status: "draft",
      });
      onEntriesChange?.(await listLibrary());
      if (R.current === iA) {
        h(false);
        I("");
        p("");
        E("");
        j(
          jA.storageMode === "session"
            ? "Workbook link saved for this open preview. Browser storage is unavailable."
            : "Workbook link saved on this device.",
        );
      }
    } catch (jA) {
      if (R.current === iA) {
        F(jA.message || "The workbook link could not be saved.");
      }
    } finally {
      if (R.current === iA) {
        z(false);
      }
    }
  }
  return (
    <section className="library-page" aria-label="Import history">
      <div className="library-heading">
        <div>
          <h1 ref={d} tabIndex="-1">
            <ImportIcon />
            {phaseOnly === 1 ? "Prompt imports" : phaseOnly === 2 ? "Rankscale imports" : "Import history"}
          </h1>
          <p>
            {phaseOnly === 1
              ? "Keep source transcripts and generated prompt workbooks together."
              : phaseOnly === 2
                ? "Find imported files and the reports created from them."
                : "View imported files and saved results for the client selected above."}
          </p>
        </div>
        <span className="library-device-label">Saved in the GEO database</span>
      </div>
      <div className="library-tabs" hidden={!!phaseOnly} role="tablist" aria-label="Import type">
        {[
          ["sheet", "Prompt"],
          ["data", "Rankscale"],
        ].map(([V, q]) => (
          <button
            id={`library-tab-${V}`}
            key={V}
            role="tab"
            aria-selected={B === V}
            aria-controls={`library-panel-${V}`}
            tabIndex={B === V ? 0 : -1}
            onClick={() => {
              g(V);
              j("");
            }}
            onKeyDown={(iA) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(iA.key)) {
                iA.preventDefault();
                const rA = iA.key === "Home" ? "sheet" : iA.key === "End" || V === "sheet" ? "data" : "sheet";
                g(rA);
                document.getElementById(`library-tab-${rA}`)?.focus();
              }
            }}
          >
            {q}
          </button>
        ))}
      </div>
      {m && (
        <p className="guided-notice" role="status">
          {m}
        </p>
      )}
      <div
        id="library-panel-sheet"
        role={phaseOnly ? "region" : "tabpanel"}
        aria-label={phaseOnly ? "Prompt import history" : undefined}
        aria-labelledby={phaseOnly ? undefined : "library-tab-sheet"}
        hidden={B !== "sheet"}
      >
        <RankscaleFiles
          key={C}
          onRefresh={async () => onEntriesChange?.(await listLibrary())}
          client={selectedClient}
          entries={selectedClient ? N.filter((V) => V.type === "upload" && V.phase === 1) : []}
          onUpload={() => onStartWorkflow?.(1)}
        />
        <div className="library-toolbar">
          <div>
            <h2>Prompt workbooks</h2>
            <p>Save a workbook link here, or complete Prompt to keep its generated results.</p>
          </div>
          <button
            className="guided-secondary"
            onClick={() => {
              h((V) => !V);
              F("");
            }}
            aria-expanded={M}
          >
            {M ? "Cancel" : "Add Google Sheets link"}
          </button>
        </div>
        {M && (
          <form className="library-add-form" onSubmit={v}>
            <div className="library-form-grid">
              <label className={`guided-field${selectedClient ? " library-url-field" : ""}`}>
                Workbook name
                <input
                  value={U}
                  onChange={(V) => I(V.target.value)}
                  maxLength="160"
                  placeholder={"Property intent & prompt review"}
                  required
                  autoFocus
                />
              </label>
              {!selectedClient && (
                <label className="guided-field">
                  Client / property
                  <input
                    value={Y}
                    onChange={(V) => E(V.target.value)}
                    maxLength="180"
                    placeholder="Property name"
                  />
                </label>
              )}
              <label className="guided-field library-url-field">
                Google Sheets link
                <input
                  type="url"
                  value={Q}
                  onChange={(V) => p(V.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/…"
                  required
                />
              </label>
            </div>
            {u && (
              <p className="guided-alert" role="alert">
                {u}
              </p>
            )}
            <div className="library-form-footer">
              <p>Saves the link only. Google sharing permissions stay the same.</p>
              <button className="guided-primary" disabled={w}>
                {w ? "Saving\u2026" : "Save workbook link"}
              </button>
            </div>
          </form>
        )}
        <div className="library-records">
          {D.map((V) => (
            <WorkbookRecord entry={V} key={`${C}:${V.id}`} />
          ))}
        </div>
        {!D.length && (
          <div className="guided-empty">
            <h2>No property workbooks yet</h2>
            <p>Complete the setup steps or add an existing Google Sheets link.</p>
            <button className="guided-primary" onClick={() => onStartWorkflow?.(1)}>
              Start Prompt
            </button>
          </div>
        )}
      </div>
      <div
        id="library-panel-data"
        role={phaseOnly ? "region" : "tabpanel"}
        aria-label={phaseOnly ? "Rankscale import history" : undefined}
        aria-labelledby={phaseOnly ? undefined : "library-tab-data"}
        hidden={B !== "data"}
      >
        {active && B === "data" && (
          <RankscaleImportHistory
            key={C}
            sources={selectedClient ? N.filter((V) => V.type === "upload" && V.phase === 2) : []}
            client={selectedClient}
            onUpload={() => onStartWorkflow?.(2)}
            onOpenDashboard={onOpenDashboard}
          />
        )}
        <section className="library-review-records">
          <h2>Saved reports</h2>
          <p>Reports created automatically from your uploaded data.</p>
          {H.map((V) => (
            <article className="library-record" key={V.id}>
              <div>
                <h3>{V.title}</h3>
                <p>
                  {fmtSavedDate(V.createdAt)}
                  {" \xB7 "}
                  {V.createdBy}
                  {" \xB7 "}
                  {V.storageMode === "session" ? "This session only" : "Saved on device"}
                </p>
              </div>
              <div className="library-actions">
                <span className="guided-status">Created</span>
                <button className="guided-secondary" onClick={() => onOpenReview?.(V)}>
                  Open report
                </button>
              </div>
            </article>
          ))}
          {!H.length && <p>Create a report from your Rankscale dashboard to save it here.</p>}
        </section>
        <details className="library-review-archive">
          <summary>
            {"Earlier saved datasets \xB7 "}
            {L.length}
          </summary>
          <section className="library-saved-datasets" aria-label="Earlier saved datasets">
            <h2>Earlier saved datasets</h2>
            <p>Previously saved snapshots are kept here for reference.</p>
            <div className="library-records">
              {L.map((V) => (
                <DatasetRecord
                  key={`${C}:${V.id}`}
                  entry={V}
                  relatedReview={O(V)}
                  onOpenReview={onOpenReview}
                />
              ))}
            </div>
            {!L.length && (
              <div className="guided-empty">
                <h3>No earlier datasets</h3>
                <p>Your uploaded history and automatically created reports are available above.</p>
              </div>
            )}
          </section>
        </details>
        {!!EA.length && (
          <details className="library-review-records">
            <summary>Earlier report records</summary>
            {EA.map((V) => (
              <article className="library-record" key={V.id}>
                <div>
                  <h3>{V.title || "Monthly review"}</h3>
                  <p>
                    {V.property || V.client}
                    {" \xB7 "}
                    {fmtSavedDate(V.createdAt)}
                    {" \xB7 "}
                    {personName(V.createdBy)}
                  </p>
                </div>
                <div className="library-actions">
                  <DatasetMeta entry={V} />
                  <button className="guided-secondary" onClick={() => onOpenReview?.(V)}>
                    View completed review
                  </button>
                </div>
              </article>
            ))}
          </details>
        )}
      </div>
    </section>
  );
}
export { LibraryPage };
