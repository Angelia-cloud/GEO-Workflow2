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
