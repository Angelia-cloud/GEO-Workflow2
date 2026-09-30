export const number = (value, digits = 0) => value == null
  ? "–"
  : Number(value).toLocaleString("en-AU", { maximumFractionDigits: digits, minimumFractionDigits: digits });

export const percent = (value, digits = 0) => value == null ? "–" : `${(Number(value) * 100).toFixed(digits)}%`;

export const date = (value) => value
  ? new Date(value).toLocaleDateString("en-AU", { day: "numeric", month: "short" })
  : "–";

export const dateTime = (value) => value
  ? new Date(value).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
  : "–";

export const shortName = (name) => name?.includes("Coogee") ? "Coogee" : name || "your property";

export function savedValue(key, fallback = "") {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

export function saveValue(key, value) {
  try { localStorage.setItem(key, value); } catch { /* Storage can be disabled by the browser. */ }
}