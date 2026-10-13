export const f = (v, d = 1) => (v == null || Number.isNaN(Number(v)) ? "n/a" : Number(v).toFixed(d));
export const pct = (v, d = 1) => (v == null || Number.isNaN(Number(v)) ? "n/a" : `${Number(v).toFixed(d)}%`);
export const signed = (v, d = 1) => (v == null || Number.isNaN(Number(v)) ? "n/a" : `${Number(v) > 0 ? "+" : ""}${Number(v).toFixed(d)}`);

export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export const monthName = (label = "") => label.split(" ")[0];

export function shortName(name = "") {
  return name
    .replace(/\s*\(.*?\)/, "")
    .replace(/^The /, "")
    .replace("InterContinental Sydney ", "IC ")
    .replace(" Sydney Harbour", "")
    .replace(", Sydney", "");
}

export function intentAnchorId(intent = "") {
  const slug = intent.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `intent-${slug}`;
}

export function fmtDay(iso) {
  if (!iso) return "";
  return new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
}

export const stripTags = (text = "") => text.replace(/\[(?:CHECKS|EVIDENCE)[^\]]*\]/g, "").replace(/^\s*Evidence:\s*[0-9a-f-]{36}\s*$/gim, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

/** Rank of `mine` among `others` (higher is better). `tie` is true when another value equals it. */
export function rankOf(mine, others) {
  if (mine == null) return null;
  const valid = others.filter((v) => v != null);
  return { rank: 1 + valid.filter((v) => v > mine).length, tie: valid.some((v) => v === mine), total: valid.length + 1 };
}

/** The hotel and tracked competitors on the neutral prompt set, best first. */
export function neutralRanking(data) {
  const hotel = data?.hotel_neutral;
  if (!hotel) return null;
  const rows = [{ name: data.property.name, short: shortName(data.property.name), detection: hotel.detection, visibility: hotel.visibility, self: true },
    ...data.competitors.map((c) => ({ name: c.display_name || c.name, short: shortName(c.display_name || c.name), detection: c.detection, visibility: c.visibility, self: false }))];
  return rows.sort((a, b) => (b.visibility ?? 0) - (a.visibility ?? 0));
}

export const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
export const VALIDATED = "Commercially validated";
