/**
 * REST client for the FastAPI backend. In development Vite proxies /api to the backend
 * (see vite.config.js); set VITE_API_BASE to call a backend on another origin.
 */
const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function errorMessage(body, status) {
  const detail = body?.detail ?? body;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (detail?.message) return detail.message;
  if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg;
  if (status === 404) return "The requested item was not found.";
  if (status >= 500) return "The server could not complete this request. Please try again.";
  return `Request failed (${status}).`;
}

export async function apiFetch(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, options);
  } catch {
    throw new ApiError("The GEO server could not be reached. Check that the backend is running.", 0, null);
  }
  const type = response.headers.get("content-type") || "";
  const body = type.includes("application/json") ? await response.json().catch(() => null) : await response.text();
  if (!response.ok) throw new ApiError(errorMessage(body, response.status), response.status, body);
  return body;
}

export function apiUrl(path) {
  return `${API_BASE}${path}`;
}

export function jsonBody(body, method = "POST") {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function queryString(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") search.set(key, value);
  });
  return search.toString();
}
