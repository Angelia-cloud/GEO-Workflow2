/** Date and summary helpers for normalised Rankscale records (parsing happens on the server). */
function isValidIsoDate(A) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(A)) {
    return false;
  }
  const e = new Date(`${A}T00:00:00.000Z`);
  return Number.isFinite(e.getTime()) && e.toISOString().slice(0, 10) === A;
}
export { isValidIsoDate };
function parseTimestamp(A) {
  const e = String(A ?? "").trim();
  if (isValidIsoDate(e)) {
    return {
      timestamp: `${e}T00:00:00.000Z`,
      date: e,
    };
  }
  const t = e.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/);
  if (!t || !isValidIsoDate(t[1]) || +t[2] > 23 || +t[3] > 59 || +t[4] > 59) {
    throw new Error(
      `Unsupported date \u201C${e}\u201D. Use an ISO date or timestamp with a timezone, for example 2026-09-01T10:00:00Z.`,
    );
  }
  if (t[6] !== "Z") {
    const [o, a] = t[6].slice(1).split(":").map(Number);
    if (o > 14 || a > 59 || (o === 14 && a !== 0)) {
      throw new Error(`Invalid timezone in date \u201C${e}\u201D.`);
    }
  }
  const i = new Date(e);
  if (!Number.isFinite(i.getTime())) {
    throw new Error(`Invalid date \u201C${e}\u201D.`);
  }
  const n = i.toISOString();
  return {
    timestamp: n,
    date: n.slice(0, 10),
  };
}
export { parseTimestamp };
function recordsInPeriod(A, { clientId, from, to } = {}) {
  if (!String(clientId ?? "").trim()) {
    throw new Error("Select a client to choose the review period.");
  }
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
    throw new Error("Choose valid From and To dates.");
  }
  if (from > to) {
    throw new Error("The From date must be on or before the To date.");
  }
  return A.filter((n) => n.clientId === String(clientId) && n.date >= from && n.date <= to);
}
export { recordsInPeriod };
function summariseRecords(A) {
  const e = [...new Set(A.map((o) => o.date))].sort(),
    t = [...new Set(A.map((o) => o.engine))].sort(),
    i = new Set(A.map((o) => o.answerId)),
    n = new Set(A.filter((o) => o.brandFound === true).map((o) => o.answerId));
  return {
    rowCount: A.length,
    answerCount: i.size,
    dateFrom: e[0] || null,
    dateTo: e[e.length - 1] || null,
    promptCount: new Set(A.map((o) => o.prompt)).size,
    engines: t,
    engineCount: t.length,
    clientMentionCount: n.size,
    brandReferences: [...new Set(A.map((o) => o.brandReference))].sort(),
    dates: e,
  };
}
export { summariseRecords };
