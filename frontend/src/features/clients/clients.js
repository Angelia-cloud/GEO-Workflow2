import { apiFetch, jsonBody } from "../../api/client";

/**
 * Client directory. Clients live in the backend (`/api/clients`, one per property); this module keeps
 * the loaded list in memory so components can resolve saved entries to clients synchronously.
 */
export const COOGEE_NAME = "InterContinental Sydney Coogee Beach";

let registry = [];

export const normaliseKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "")
    .replace(/\s+/g, " ");
const nameOf = (value) => (typeof value == "object" && value ? value.name || value.property || "" : value || "");
const clientKeys = (client) =>
  [client?.id, client?.name, client?.property, client?.team, ...(client?.aliases || [])].map(normaliseKey).filter(Boolean);

/** The pilot client. */
export function coogeeClient() {
  return registry.find((client) => normaliseKey(client.property) === normaliseKey(COOGEE_NAME)) || { id: "", name: COOGEE_NAME, property: COOGEE_NAME };
}

export function isCoogee(client) {
  if (!client) return false;
  const keys = clientKeys(client);
  return keys.includes(normaliseKey(COOGEE_NAME)) || (coogeeClient().id && keys.includes(normaliseKey(coogeeClient().id)));
}

export function listClients() {
  return registry;
}

export async function loadClients() {
  registry = await apiFetch("/api/clients");
  return registry;
}

function findClient(value) {
  const key = normaliseKey(nameOf(value));
  return key ? registry.find((client) => clientKeys(client).includes(key)) : undefined;
}

/** The client a saved entry (library record, report, upload) belongs to. */
export function resolveClient(entry) {
  if (!entry) return null;
  const nested = typeof entry.client == "object" && entry.client ? entry.client : null;
  const candidates = [entry.clientId, entry.client_id, nested?.id, entry.propertyName, nameOf(entry.property), nameOf(entry.client), entry.report?.property?.name];
  for (const candidate of candidates.filter(Boolean)) {
    const found = findClient(candidate);
    if (found) return found;
  }
  const name = nested?.name || nameOf(entry.client) || entry.propertyName || nameOf(entry.property) || "";
  if (!name && !entry.clientId) return null;
  return { id: String(entry.clientId || entry.client_id || nested?.id || ""), name: name || String(entry.clientId), property: entry.propertyName || nameOf(entry.property) || name };
}

export function sameClient(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id) return String(a.id) === String(b.id);
  const keys = new Set(clientKeys(b));
  return clientKeys(a).some((key) => keys.has(key));
}

export function belongsToClient(entry, client) {
  const owner = resolveClient(entry);
  return !!(owner && sameClient(owner, client));
}

export async function createClient(values) {
  const created = await apiFetch("/api/clients", jsonBody(values));
  registry = [...registry.filter((client) => client.id !== created.id), created].sort((a, b) => a.name.localeCompare(b.name));
  return created;
}

/** Save the Phase 1 brief (target audience, goals, property) back to the client record. */
export async function updateClient(id, changes) {
  const current = registry.find((client) => client.id === id);
  if (!current) return null;
  const patch = {};
  for (const field of ["property", "targetAudience", "goals"]) {
    if (typeof changes[field] == "string" && changes[field] !== current[field]) patch[field] = changes[field];
  }
  if (!Object.keys(patch).length) return null;
  registry = registry.map((client) => (client.id === id ? { ...client, ...patch } : client));
  const saved = await apiFetch(`/api/clients/${id}`, jsonBody(patch, "PATCH"));
  registry = registry.map((client) => (client.id === id ? saved : client));
  return saved;
}
