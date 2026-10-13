import { apiFetch } from "../../api/client";

/**
 * Saved files (Settings → Imports, Prompt CSV exports, reports). Entries and their original files are
 * stored by the backend (`/api/library`).
 */
export const REFERENCE_SHEET_URL = "https://docs.google.com/spreadsheets/d/1EhRUo3rB9yT4x0Vu9sdQWGyUSa2-7VuTQuZqC4u7-AM/edit";
const TYPES = ["sheet", "data", "review", "upload", "report"];

function announce(id) {
  try {
    window.dispatchEvent(new CustomEvent("komosion:library-change", { detail: { id } }));
  } catch {
    /* no window during tests */
  }
}

export async function listLibrary() {
  const entries = await apiFetch("/api/library");
  return entries.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export async function saveLibraryEntry(entry, file) {
  if (!entry || !TYPES.includes(entry.type)) throw new Error("Choose a valid library record type.");
  const { file: _file, blob: _blob, ...data } = entry;
  const form = new FormData();
  form.append("entry", JSON.stringify(data));
  if (data.createdBy) form.append("created_by", data.createdBy);
  if (file && typeof file.arrayBuffer == "function") form.append("file", file, file.name || data.fileName || "upload");
  const saved = await apiFetch("/api/library", { method: "POST", body: form });
  announce(saved.id);
  return saved;
}

export async function getLibraryFile(id) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE || ""}/api/library/${encodeURIComponent(id)}/file`);
  return response.ok ? response.blob() : null;
}

/** Keep the original source file (kickoff transcript or Rankscale export) in the import history. */
export async function saveSourceFile({ phase, clientId, client, property, uploadedBy, file, kind = "upload", importId, summary }) {
  if (![1, 2].includes(phase) || !clientId || !file || typeof file.arrayBuffer != "function")
    throw new Error("Select a client and a valid source file before saving.");
  return saveLibraryEntry(
    {
      type: "upload",
      phase,
      clientId: String(clientId),
      client,
      property: property || client,
      title: file.name || "Transcript.txt",
      fileName: file.name || "Transcript.txt",
      kind,
      source: phase === 1 ? "prompt" : "rankscale",
      createdAt: new Date().toISOString(),
      createdBy: uploadedBy || "Not recorded",
      status: "stored",
      importId,
      summary,
    },
    file,
  );
}
