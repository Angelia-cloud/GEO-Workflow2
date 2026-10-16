import { apiFetch } from "../../api/client";
import { summariseRecords } from "./parseRankscale";

/**
 * Rankscale answer history per client, stored by the backend. Uploads are parsed, validated and
 * de-duplicated server-side; full Rankscale exports are also loaded into the Workflow 2 measurement
 * tables (auto alerts, insights and diagnosis use them).
 */
export const STORAGE_WARNING = "";

export async function loadRankscaleHistory(clientId) {
  if (!clientId) return { clientId, rows: [], sources: [], imports: [], summary: summariseRecords([]) };
  return apiFetch(`/api/clients/${encodeURIComponent(clientId)}/rankscale`);
}

export async function importRankscaleFile(clientId, file, importedBy) {
  if (!clientId) throw new Error("Choose a client before uploading Rankscale data.");
  const form = new FormData();
  form.append("file", file, file.name);
  if (importedBy) form.append("imported_by", importedBy);
  return apiFetch(`/api/clients/${encodeURIComponent(clientId)}/rankscale/imports`, { method: "POST", body: form });
}

/** Progress of the background measurement load after an upload: pending → loaded (report ready) or failed. */
export async function importStatus(clientId, importId) {
  return apiFetch(`/api/clients/${encodeURIComponent(clientId)}/rankscale/imports/${encodeURIComponent(importId)}`);
}

/** Wait until the uploaded answers are in the report tables (polls every 1.5 s, gives up after `timeoutMs`). */
export async function waitForImport(clientId, importId, { timeoutMs = 10 * 60 * 1000, isCancelled = () => false } = {}) {
  const started = Date.now();
  for (;;) {
    if (isCancelled()) return null;
    let status = null;
    try {
      status = await importStatus(clientId, importId);
    } catch {
      status = null; // a transient network error: keep waiting
    }
    if (status && status.status !== "pending") return status;
    if (Date.now() - started > timeoutMs) return { status: "timeout" };
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}
