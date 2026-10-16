import { useEffect, useRef, useState } from "react";
import { isCoogee } from "../clients/clients";
import { importRankscaleFile, waitForImport } from "./historyStore";
import { summariseRecords } from "./parseRankscale";
import { RankscaleIntake } from "./RankscaleIntake";

const fmtNumber = (value) => Number(value || 0).toLocaleString("en-AU");
const emptyHistory = () => ({ rows: [], summary: summariseRecords([]) });
const MAX_BYTES = 64 * 1024 * 1024;

/** Phase 2 · step 1 — upload a Rankscale export for the selected client. */
function RankscaleUpload({ client, reviewer, onOpenDashboard }) {
  const [history, setHistory] = useState(emptyHistory);
  const [lastFile, setLastFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const activeClient = useRef(client?.id);
  const inFlight = useRef(false);
  activeClient.current = client?.id;

  useEffect(() => {
    activeClient.current = client?.id;
    setHistory(emptyHistory());
    setLastFile(null);
    setError("");
    setNotice("");
    setUploading(false);
    setPreparing(false);
    return () => {
      activeClient.current = null;
    };
  }, [client?.id]);

  async function upload(file) {
    if (!file || inFlight.current) return;
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
      // the server keeps the original file in the import history
      if (activeClient.current !== clientId) return;
      setHistory(result);
      setLastFile(file);
      const counts = `${fmtNumber(result.added)} records added${result.duplicates ? ` \xB7 ${fmtNumber(result.duplicates)} existing records skipped` : ""}`;
      // The answers are added to the report tables in the background; open the report once they are in.
      setUploading(false);
      setPreparing(true);
      setNotice(`${counts}. Adding the answers to the report…`);
      const status = result.latestImport?.id
        ? await waitForImport(clientId, result.latestImport.id, { isCancelled: () => activeClient.current !== clientId })
        : { status: "loaded" };
      if (!status || activeClient.current !== clientId) return;
      setPreparing(false);
      if (status.status === "failed") {
        setError(`The records were saved, but they could not be added to the report: ${status.followUp?.reason || "unknown error"}.`);
        return;
      }
      setNotice(
        status.status === "timeout"
          ? `${counts}. The report is still being updated; it will show the new answers shortly.`
          : `${counts}. Upload complete. All records are saved in the GEO database.`,
      );
      onOpenDashboard?.(result);
    } catch (failure) {
      if (activeClient.current === clientId) setError(failure.message || "This file could not be read.");
    } finally {
      inFlight.current = false;
      if (activeClient.current === clientId) {
        setUploading(false);
        setPreparing(false);
      }
    }
  }

  const busy = uploading || preparing;
  const importedRows = history.summary?.rowCount || history.rows.length || 0;
  return (
    <div className="guided-shell rankscale-flow">
      <main className="guided-container guided-main">
        <div className="guided-page-heading">
          <div>
            <h1>Upload Rankscale data</h1>
            <p>
              {isCoogee(client)
                ? "Import a monthly Rankscale file. New months appear automatically in the monthly report."
                : "Import your Rankscale file to create a report. Choose your reporting dates in the report."}
            </p>
          </div>
        </div>
        <RankscaleIntake
          clientName={client?.name}
          onFileChange={upload}
          busy={busy}
          uploading={uploading}
          error={error}
          importNotice={notice}
          sourceName={lastFile?.name || ""}
        />
      </main>
      <footer className="guided-footer">
        <div className="guided-container guided-footer-inner">
          <div className="guided-footer-next">
            <span role="status">
              {uploading
                ? "Reading and saving all records…"
                : preparing
                  ? "Adding the answers to the report…"
                  : importedRows
                    ? `${fmtNumber(importedRows)} records imported`
                    : "Import a file to create your report"}
            </span>
            <button className="guided-primary" disabled={busy || !importedRows} onClick={() => onOpenDashboard?.(history)}>
              View report<span aria-hidden="true">{" →"}</span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
export { RankscaleUpload };
