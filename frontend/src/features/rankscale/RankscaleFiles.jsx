import { createElement, useState } from "react";
import { downloadSample } from "../../lib/samples";
import { getLibraryFile } from "../library/libraryStore";
const fmtFileTime = (A) =>
  A && Number.isFinite(Date.parse(A))
    ? new Intl.DateTimeFormat("en-AU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }).format(new Date(A))
    : "Not recorded";
function RankscaleFiles({ entries = [], client, onUpload, onRefresh }) {
  const [n, o] = useState(""),
    [a, r] = useState(false),
    [l, s] = useState("");
  async function c() {
    r(true);
    s("");
    try {
      await onRefresh?.();
    } catch {
      s("Import history could not be refreshed. Please try again.");
    } finally {
      r(false);
    }
  }
  async function d(B) {
    o(B.id);
    s("");
    try {
      const g = await getLibraryFile(B.id);
      if (!g) {
        throw new Error(
          "The original file is no longer stored. Import it again to keep a new copy.",
        );
      }
      const M = URL.createObjectURL(g),
        h = document.createElement("a");
      h.href = M;
      h.download = B.fileName;
      h.click();
      setTimeout(() => URL.revokeObjectURL(M), 1e3);
    } catch (g) {
      s(g.message || "This file could not be opened.");
    } finally {
      o("");
    }
  }
  return (
    <section className="rankscale-import-history prompt-import-history" aria-labelledby="promptImportTitle">
      <div className="rankscale-import-heading">
        <div>
          <h2 id="promptImportTitle">Import history</h2>
          <p>{client?.name || "Choose a client in the top bar to view their imports."}</p>
        </div>
        <div className="library-actions">
          <button className="guided-secondary" disabled={a || !client?.id} onClick={c}>
            {a ? "Refreshing\u2026" : "Refresh"}
          </button>
          <button className="guided-primary" disabled={!client?.id} onClick={onUpload}>
            Import transcript
          </button>
        </div>
      </div>
      {l && (
        <p className="guided-alert" role="alert">
          {l}
        </p>
      )}
      <div
        className="rankscale-import-table-wrap"
        role="region"
        tabIndex="0"
        aria-label="Prompt import history"
      >
        <table className="rankscale-import-table prompt-import-table">
          <caption className="rankscale-import-sr-only">
            {"Prompt imports for "}
            {client?.name || "the selected client"}
          </caption>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">File</th>
              <th scope="col">By</th>
              <th scope="col">Status</th>
              <th scope="col">Size</th>
              <th scope="col">
                <span className="rankscale-import-sr-only">Download</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.length ? (
              entries.map((B) => (
                <tr key={B.id}>
                  <td>
                    <time dateTime={B.createdAt}>{fmtFileTime(B.createdAt)}</time>
                  </td>
                  <td className="rankscale-import-file">
                    {B.fileName}
                    <small>
                      {B.kind === "paste" ? "Saved text" : B.sample ? "Sample transcript" : "Transcript"}
                    </small>
                  </td>
                  <td>
                    {typeof B.createdBy == "string" ? B.createdBy : B.createdBy?.name || "Not recorded"}
                  </td>
                  <td>
                    <span
                      className={`rankscale-import-status${B.fileStorageMode === "session" ? " is-session" : ""}`}
                    >
                      {B.fileStorageMode === "session" ? "session only" : "loaded"}
                    </span>
                  </td>
                  <td>
                    {Number.isFinite(B.fileSize)
                      ? `${(B.fileSize / 1024).toLocaleString("en-AU", {
                          maximumFractionDigits: 1,
                        })} KB`
                      : "\u2014"}
                  </td>
                  <td>
                    <button
                      className="guided-secondary"
                      disabled={!!n}
                      onClick={() => d(B)}
                      aria-label={`Download ${B.fileName}`}
                    >
                      {n === B.id ? "Opening\u2026" : "Download"}
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="6" className="rankscale-import-empty">
                  {client?.id
                    ? "No imports yet. Import a transcript to save it here."
                    : "Select a client to see their import history."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="rankscale-import-footer">
        <p>
          {entries.length
            ? `${entries.length} ${entries.length === 1 ? "file" : "files"} in your import history.`
            : "Imported transcripts and pasted text appear here automatically."}
        </p>
        <button className="guided-secondary" onClick={() => downloadSample("prompt")}>
          Download sample transcript
        </button>
      </div>
    </section>
  );
}
export { RankscaleFiles };
