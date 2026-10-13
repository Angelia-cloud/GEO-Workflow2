import { createElement, useEffect, useRef, useState } from "react";
import { getLibraryFile } from "../library/libraryStore";
import { loadRankscaleHistory } from "./historyStore";
const fmtMaybe = (A) => (Number.isFinite(A) ? A.toLocaleString("en-AU") : "\u2014"),
  fmtImportTime = (A) =>
    A && Number.isFinite(Date.parse(A))
      ? new Intl.DateTimeFormat("en-AU", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        }).format(new Date(A))
      : "Not recorded";
function RankscaleImportHistory({ client, sources = [], onUpload, onOpenDashboard }) {
  const [n, o] = useState(null),
    [a, r] = useState(true),
    [l, s] = useState(""),
    [c, d] = useState(0),
    [B, g] = useState(""),
    [M, h] = useState(""),
    U = useRef(client?.id);
  U.current = client?.id;
  useEffect(() => {
    let m = true;
    r(true);
    s("");
    o(null);
    h("");
    g("");
    return client?.id
      ? (loadRankscaleHistory(client.id)
          .then((j) => {
            if (m) {
              o(j);
              r(false);
            }
          })
          .catch((j) => {
            if (m) {
              s(j.message || "Import history could not be opened.");
              r(false);
            }
          }),
        () => {
          m = false;
        })
      : (r(false),
        () => {
          m = false;
        });
  }, [client?.id, c]);
  const I = String(n?.clientId) === String(client?.id) ? n?.imports || [] : [],
    Q = sources.filter((m) => m.phase === 2 && String(m.clientId) === String(client?.id)),
    p = new Set(),
    Y = I.map((m) => {
      const j = Q.find((w) => w.importId === m.id && !p.has(w.id));
      if (j) {
        p.add(j.id);
      }
      return {
        ...m,
        source: j,
      };
    });
  for (const m of Q.filter((j) => !p.has(j.id)))
    Y.push({
      id: `source-${m.id}`,
      importedAt: m.createdAt,
      fileName: m.fileName,
      importedBy: m.createdBy,
      storageMode: m.fileStorageMode,
      source: m,
      sourceOnly: true,
    });
  Y.sort((m, j) => (Date.parse(j.importedAt) || 0) - (Date.parse(m.importedAt) || 0));
  async function E(m) {
    const j = client?.id;
    if (String(m.clientId) === String(j)) {
      g(m.id);
      h("");
      try {
        const w = await getLibraryFile(m.id);
        if (U.current !== j) {
          return;
        }
        if (!w) {
          throw new Error(
            "The original file is no longer stored. Import it again to keep a new copy.",
          );
        }
        const z = URL.createObjectURL(w),
          C = document.createElement("a");
        C.href = z;
        C.download = m.fileName || "Rankscale.csv";
        C.click();
        setTimeout(() => URL.revokeObjectURL(z), 1e3);
      } catch (w) {
        if (U.current === j) {
          h(w.message || "This file could not be downloaded.");
        }
      } finally {
        if (U.current === j) {
          g("");
        }
      }
    }
  }
  const u = I.some((m) => m.legacy),
    F = I.some((m) => !Number.isFinite(m.evidenceAdded));
  return (
    <section className="rankscale-import-history" aria-labelledby="rankscaleImportTitle">
      <div className="rankscale-import-heading">
        <div>
          <h2 id="rankscaleImportTitle">Import history</h2>
          <p>{client?.name || "Choose a client in the top bar to view their imports."}</p>
        </div>
        <div className="library-actions">
          <button className="guided-secondary" disabled={a || !client?.id} onClick={() => d((m) => m + 1)}>
            Refresh
          </button>
          <button className="guided-primary" disabled={!client?.id} onClick={onUpload}>
            Import Rankscale file
          </button>
        </div>
      </div>
      {M && (
        <p className="guided-alert" role="alert">
          {M}
        </p>
      )}
      {a ? (
        <p className="rankscale-import-state" role="status">
          Loading import history…
        </p>
      ) : l ? (
        <div className="rankscale-import-state">
          <p className="guided-alert" role="alert">
            {l}
          </p>
          <button className="guided-secondary" onClick={() => d((m) => m + 1)}>
            Try again
          </button>
        </div>
      ) : (
        <>
          {n?.storageWarning && (
            <p className="guided-alert" role="status">
              {n.storageWarning}
            </p>
          )}
          <div
            className="rankscale-import-table-wrap"
            role="region"
            aria-label="Rankscale import history"
            tabIndex="0"
          >
            <table className="rankscale-import-table rankscale-import-table-with-download">
              <caption className="rankscale-import-sr-only">
                {"Rankscale imports for "}
                {client?.name || "the selected client"}
              </caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">File</th>
                  <th scope="col">By</th>
                  <th scope="col">Status</th>
                  <th scope="col">Rows</th>
                  <th scope="col">Answers added</th>
                  <th scope="col">Evidence added</th>
                  <th scope="col">Original file</th>
                </tr>
              </thead>
              <tbody>
                {Y.length ? (
                  Y.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <time
                          dateTime={m.importedAt || undefined}
                          title={m.importedAt ? new Date(m.importedAt).toLocaleString() : undefined}
                        >
                          {fmtImportTime(m.importedAt)}
                        </time>
                      </td>
                      <td className="rankscale-import-file">
                        {m.fileName || "Rankscale file"}
                        {m.sourceOnly && <small>Earlier saved file · import counts not recorded</small>}
                      </td>
                      <td>
                        {m.importedBy || <span className="rankscale-import-missing">Not recorded</span>}
                      </td>
                      <td>
                        <span
                          className={`rankscale-import-status${m.storageMode === "session" ? " is-session" : ""}`}
                        >
                          {m.storageMode === "session"
                            ? "session only"
                            : m.sourceOnly
                              ? "file saved"
                              : "loaded"}
                        </span>
                      </td>
                      <td
                        title={
                          m.legacy || m.sourceOnly
                            ? "The original file totals were not recorded."
                            : `${fmtMaybe(m.rowsAdded)} new records \xB7 ${fmtMaybe(m.duplicates)} existing records skipped`
                        }
                      >
                        {m.sourceOnly ? "\u2014" : `${fmtMaybe(m.rowsProcessed)} / ${fmtMaybe(m.rowsTotal)}`}
                      </td>
                      <td
                        title={
                          m.legacy ? "New-answer count was not recorded for this earlier import." : undefined
                        }
                      >
                        {fmtMaybe(m.answersAdded)}
                      </td>
                      <td
                        title={
                          Number.isFinite(m.evidenceAdded)
                            ? undefined
                            : "Evidence additions are not tracked for this import."
                        }
                      >
                        {fmtMaybe(m.evidenceAdded)}
                      </td>
                      <td>
                        {m.source ? (
                          <button
                            className="guided-secondary rankscale-import-download"
                            disabled={!!B}
                            onClick={() => E(m.source)}
                            aria-label={`Download original ${m.fileName || "Rankscale file"}`}
                          >
                            {B === m.source.id ? "Opening\u2026" : "Download"}
                          </button>
                        ) : (
                          <span className="rankscale-import-missing">Not saved</span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="8" className="rankscale-import-empty">
                      {client?.id
                        ? "No imports yet. Import a Rankscale file to save it here."
                        : "Select a client to see their import history."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="rankscale-import-footer">
            <div>
              <p>
                {n?.rows.length
                  ? `${fmtMaybe(n.summary.rowCount)} records ${n.storageMode === "session" ? "available this session" : "saved across the full history"}.`
                  : "Uploaded records are saved automatically."}
              </p>
              {u && <p>Earlier imports did not record the uploader, original row totals or added counts.</p>}
              {F && (
                <p>— means the count was not recorded.</p>
              )}
            </div>
            <button className="guided-secondary" disabled={!n?.rows.length} onClick={onOpenDashboard}>
              View report
            </button>
          </div>
        </>
      )}
    </section>
  );
}
export { RankscaleImportHistory };
