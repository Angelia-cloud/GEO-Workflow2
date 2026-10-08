import { apiFetch, jsonBody, queryString } from "../../api/client";
const DECIDED_STATUSES = new Set(["approved", "confirmed", "rejected", "in_progress", "done"]),
  reviewHistory = new Map(),
  STATUS_LABELS = {
    approved: "Approved",
    confirmed: "Approved",
    rejected: "Rejected",
    in_progress: "In progress",
    done: "Completed",
    draft: "Pending review",
    proposed: "Pending review",
  },
  DIAGNOSIS_LABELS = {
    content_gap: "Content gap",
    entity_confusion: "Entity confusion",
    citation_gap: "Citation gap",
    competitor_dominance: "Competitor visibility",
    negative_sentiment: "Negative sentiment",
    other: "Unclear cause",
  },
  pluralKind = (A) => (A === "diagnosis" ? "diagnoses" : `${A}s`);
/** Intent label shown above a finding. */
const insightIntent = (insight) => insight.intent_name || (insight.insight_type === "alert" ? "Auto alert" : "Monthly finding");
export { reviewHistory, STATUS_LABELS, insightIntent, DIAGNOSIS_LABELS, pluralKind };
/**
 * Rows for one review step.
 *   finding   – insights and auto alerts (prepared for the latest 30 days when none exist yet)
 *   diagnosis – possible causes for the answers behind the approved findings (diagnosed on demand)
 *   action    – recommendations linked to the approved diagnoses
 */
async function loadReviewRows(kind, propertyId, approvedFindingIds, approvedDiagnosisIds) {
  if (kind === "finding") {
    await apiFetch(`/api/review/${propertyId}/prepare`, jsonBody({})).catch(() => null);
    return (await apiFetch(`/api/insights/${propertyId}`))
      .filter((insight) => insight.insight_type !== "visibility_summary")
      .map((insight) => ({ ...insight, summary: insight.review_observation || insight.summary }));
  }
  if (kind === "diagnosis") {
    if (approvedFindingIds !== undefined && !approvedFindingIds.length) return [];
    return apiFetch(`/api/review/${propertyId}/diagnoses`, jsonBody({ insight_ids: approvedFindingIds || [] }));
  }
  if (approvedDiagnosisIds?.length === 0) return [];
  const recommendations = await apiFetch(`/api/recommendations?${queryString({ property_id: propertyId })}`);
  const measurementIds = [...new Set(recommendations.map((row) => row.measurement_id))];
  const measurements = await Promise.all(measurementIds.map((id) => apiFetch(`/api/measurements/${id}`)));
  const diagnosesByMeasurement = new Map(
    measurements.map((m) => [m.measurement_id, m.diagnoses.filter((d) => approvedDiagnosisIds === undefined || approvedDiagnosisIds.includes(d.id))]),
  );
  return recommendations
    .filter((row) => approvedDiagnosisIds === undefined || diagnosesByMeasurement.get(row.measurement_id)?.length)
    .map((row) => ({ ...row, review_diagnoses: diagnosesByMeasurement.get(row.measurement_id) || [] }));
}
export { loadReviewRows };
const stripEvidence = (A = "") => A.replace(/\n*\s*Evidence:\s*[0-9a-f-,\s]+$/i, "").trim(),
  rowId = (A) => A.recommendation_id || A.id,
  isDecided = (A) => DECIDED_STATUSES.has(A.status),
  ownerName = (A) => (typeof A == "string" ? A.trim() : A?.name?.trim() || ""),
  suggestedReason = (A) =>
    A.suggested_reason ||
    "Review the cited answers and verify the underlying hotel information before accepting a possible cause.",
  decisionLabel = (A) =>
    isDecided(A)
      ? A.status === "rejected"
        ? "Rejected by a human reviewer"
        : ["in_progress", "done"].includes(A.status)
          ? "Previously approved action"
          : "Approved by a human reviewer"
      : "AI suggestion \u2014 awaiting your decision",
  isHistorical = (A) => ["in_progress", "done"].includes(A.status),
  historyFor = (A) => {
    const e = reviewHistory.get(A);
    return Array.isArray(e) ? e : e ? [e] : [];
  },
  lastDecision = (A) => [...A].reverse().find((e) => e.decision !== "comment"),
  historyKey = (A) => {
    const e = historyFor(A).filter((t) => t.decision !== "comment");
    return `${e.length}:${e.at(-1)?.at || ""}`;
  },
  isAlert = (A) => ["alert", "competitor_threat"].includes(A.insight_type),
  matchesTab = (A, e) =>
    e === "all" ||
    (e === "pending"
      ? !isDecided(A)
      : e === "approved"
        ? ["approved", "confirmed"].includes(A.status)
        : A.status === "rejected");
export {
  stripEvidence,
  rowId,
  isDecided,
  ownerName,
  suggestedReason,
  decisionLabel,
  isHistorical,
  historyFor,
  lastDecision,
  historyKey,
  isAlert,
  matchesTab,
};
function isValidDueDate(A) {
  if (typeof A != "string" || !/^\d{4}-\d{2}-\d{2}$/.test(A)) {
    return false;
  }
  const e = Date.parse(`${A}T00:00:00Z`);
  return Number.isFinite(e) && new Date(e).toISOString().slice(0, 10) === A;
}
export { isValidDueDate };
function resetReviewHistory(A) {
  if (A === undefined) {
    reviewHistory.clear();
    return;
  }
  const e = new Set(Array.isArray(A) ? A : [A]);
  for (const t of reviewHistory.keys()) {
    if (e.has(t.split(":")[1])) {
      reviewHistory.delete(t);
    }
  }
}
export { resetReviewHistory };
