import { useEffect, useRef, useState } from "react";
import { isCoogee } from "../clients/clients";
import { saveSourceFile } from "../library/libraryStore";
import { importRankscaleFile, loadRankscaleHistory } from "./historyStore";
import { summariseRecords } from "./parseRankscale";
import { RankscaleIntake } from "./RankscaleIntake";

const fmtNumber = (value) => Number(value || 0).toLocaleString("en-AU");
const emptyHistory = () => ({ rows: [], sources: [], summary: summariseRecords([]) });
const MAX_BYTES = 64 * 1024 * 1024;

/** Phase 2 · step 1 — upload a Rankscale export for the selected client. */
function RankscaleUpload({ client, reviewer, onOpenDashboard }) {
  const [history, setHistory] = useState(emptyHistory);
  const [lastFile, setLastFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const activeClient = useRef(client?.id);
  const inFlight = useRef(false);
  activeClient.current = client?.id;

  useEffect(() => {
    let live = true;
    activeClient.current = client?.id;
    setHistory(emptyHistory());
    setLastFile(null);
    setError("");
    setNotice("");
    setLoading(true);
    setUploading(false);
    loadRankscaleHistory(client?.id)
      .then((saved) => {
        if (!live) return;
        setHistory(saved);
        setLoading(false);
      })
      .catch((failure) => {
        if (!live) return;
        setError(failure.message || "Stored Rankscale data could not be opened. Please try again.");
        setLoading(false);
      });
    return () => {
      live = false;
      activeClient.current = null;
    };
  }, [client?.id]);

  async function upload(file) {
    if (!file || loading || inFlight.current) return;
    if (!client?.id) {
      setError("Choose a client in the top bar first.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Choose a Rankscale file smaller than 64 MB.");
      return;
    }
    const clientId = client.id;
    inFlight.current = true;
    setUploading(true);
    setError("");
    setNotice("");
    try {
      const result = await importRankscaleFile(clientId, file, reviewer);
      if (activeClient.current !== clientId) return;
      await saveSourceFile({
        phase: 2,
        clientId,
        client: client.name,
        property: client.property,
        uploadedBy: reviewer,
        file,
        importId: result.latestImport?.id,
        summary: { rowCount: result.latestImport?.rowsProcessed ?? result.added },
      }).catch(() => null); // the records are saved even if the copy of the file is not
      if (activeClient.current !== clientId) return;
      setHistory(result);
      setLastFile(file);
      setNotice(
        `${fmtNumber(result.added)} records added${result.duplicates ? ` \xB7 ${fmtNumber(result.duplicates)} existing records skipped` : ""}. Upload complete. All records are saved in the GEO database.`,
      );
      onOpenDashboard?.(result);
    } catch (failure) {
      if (activeClient.current === clientId) setError(failure.message || "This file could not be read.");
    } finally {
      inFlight.current = false;
      if (activeClient.current === clientId) setUploading(false);
    }
  }

  const busy = loading || uploading;
  return (
    <div className="guided-shell rankscale-flow">
      <main className="guided-container guided-main">
        <div className="guided-page-heading">
          <div>
            <h1>Upload Rankscale data</h1>
            <p>
              {isCoogee(client)
                ? "Import your Rankscale file to open the September 2026 report."
                : "Import your Rankscale file to create a report. Choose your reporting dates in the report."}
            </p>
          </div>
        </div>
        <RankscaleIntake
          clientName={client?.name}
          historySummary={history.summary}
          onFileChange={upload}
          busy={busy}
          uploading={uploading}
          error={error}
          importNotice={notice}
          hasHistory={!!history.rows.length}
          sourceName={lastFile?.name || history.sources.at(-1)}
        />
      </main>
      <footer className="guided-footer">
        <div className="guided-container guided-footer-inner">
          <div className="guided-footer-next">
            <span role="status">
              {uploading
                ? "Reading and saving all records…"
                : loading
                  ? "Loading saved history…"
                  : history.rows.length
                    ? `${fmtNumber(history.summary.rowCount)} records saved`
                    : "Import a file to save your data"}
            </span>
            <button className="guided-primary" disabled={busy || !history.rows.length} onClick={() => onOpenDashboard?.()}>
              View report<span aria-hidden="true">{" →"}</span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
export { RankscaleUpload };
