function reportTitle(A) {
  if (!A?.from || !A?.to) {
    return "Report";
  }
  const e = new Date(`${A.from}T00:00:00Z`),
    t = new Date(`${A.to}T00:00:00Z`),
    i = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, 0)).getUTCDate();
  return e.getUTCDate() === 1 &&
    e.getUTCFullYear() === t.getUTCFullYear() &&
    e.getUTCMonth() === t.getUTCMonth() &&
    t.getUTCDate() === i
    ? `${e.toLocaleDateString("en-AU", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })} report`
    : "AI visibility report";
}
export { reportTitle };
