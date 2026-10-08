import { useCallback, useEffect, useId, useRef, useState } from "react";
import { apiFetch, jsonBody } from "../../api/client";
import { fmtDateTime, fmtDay } from "../../lib/workspaceSettings";
import { EvidenceDrawer } from "./EvidenceDrawer";
import {
  DIAGNOSIS_LABELS,
  insightIntent,
  STATUS_LABELS,
  decisionLabel,
  historyFor,
  historyKey,
  isAlert,
  isDecided,
  isHistorical,
  isValidDueDate,
  lastDecision,
  loadReviewRows,
  matchesTab,
  ownerName,
  pluralKind,
  reviewHistory,
  rowId,
  stripEvidence,
  suggestedReason,
} from "./reviewData";
function DueDateField({ value, onChange, disabled = false, required = false }) {
  const n = useId(),
    [o, a] = useState(false),
    r = o && !!value && !isValidDueDate(value);
  return (
    <label>
      {"Due date "}
      {required && <span>Required</span>}
      <input
        type="text"
        maxLength={10}
        placeholder="YYYY-MM-DD"
        value={value}
        onChange={(l) => onChange(l.target.value)}
        onBlur={() => a(true)}
        disabled={disabled}
        aria-label="Due date"
        aria-required={required || undefined}
        aria-describedby={`${n}-help${r ? ` ${n}-error` : ""}`}
        aria-invalid={r || undefined}
      />
      <small id={`${n}-help`} className="hitl-date-help">
        Use YYYY-MM-DD, for example 2026-10-15.
      </small>
      {r && (
        <small id={`${n}-error`} className="hitl-date-error" role="alert">
          Enter a valid date in YYYY-MM-DD format.
        </small>
      )}
    </label>
  );
}
function ReviewCriteria() {
  return (
    <details className="hitl-criteria">
      <summary>Review lenses · Relevance, Clarity, Credibility</summary>
      <p className="hitl-criteria-note">
        Use these lenses to assess the evidence. The diagnosis explains the cause; the recommendation
        describes the next action.
      </p>
      <div className="hitl-criteria-grid">
        <article>
          <h3>Relevance</h3>
          <ul>
            <li>Does the hotel match the guest intent?</li>
            <li>Are pages written around traveller needs, not just hotel features?</li>
            <li>Do we cover specific occasions and use cases?</li>
          </ul>
        </article>
        <article>
          <h3>Clarity</h3>
          <ul>
            <li>Can AI understand the hotel as one entity?</li>
            <li>Are rooms, dining, venues, offers and location signals connected?</li>
            <li>Is schema aligned with live content?</li>
          </ul>
        </article>
        <article>
          <h3>Credibility</h3>
          <ul>
            <li>Which sources does AI cite?</li>
            <li>Are owned, IHG, editorial and review sources consistent?</li>
            <li>Do competitors have stronger third-party corroboration?</li>
          </ul>
        </article>
      </div>
    </details>
  );
}
export { ReviewCriteria };
function DiagnosisRoutes() {
  return (
    <details className="hitl-diagnosis-routes">
      <summary>Diagnosis routes · Content gap, Competitor, Unclear</summary>
      <p>Use the evidence to review the explanation before choosing the response.</p>
      <div className="hitl-route-grid">
        <article>
          <h4>
            {"Content gap "}
            <span aria-hidden="true">→</span>
            {" Content brief"}
          </h4>
          <p>The relevant offer is missing or hard to find. Plan the content to clarify it.</p>
        </article>
        <article>
          <h4>
            {"Competitor "}
            <span aria-hidden="true">→</span>
            {" Competitor plan"}
          </h4>
          <p>
            Competing venues have stronger supporting pages or sources. Review what creates their advantage.
          </p>
        </article>
        <article>
          <h4>
            {"Unclear "}
            <span aria-hidden="true">→</span>
            {" Deep dive"}
          </h4>
          <p>The evidence does not explain the change yet. Investigate before committing to a fix.</p>
        </article>
      </div>
    </details>
  );
}
function CauseAction({ row }) {
  const e = row.review_diagnoses || [];
  return e.length ? (
    <details className="hitl-cause-action">
      <summary>
        <span>Linked diagnosis</span>{" "}
        {e.map((t) => DIAGNOSIS_LABELS[t.diagnosis_type] || "Suggested cause").join(", ")}{" "}
        <span aria-hidden="true">→</span> {row.action_type?.replaceAll("_", " ") || "proposed"}
        {" action"}
      </summary>
      <div>
        {e.map((t) => (
          <p key={t.id}>
            <strong>
              {DIAGNOSIS_LABELS[t.diagnosis_type] || "Suggested cause"}
              {" \xB7 "}
              {STATUS_LABELS[t.status] || "Pending review"}
            </strong>
            {t.root_cause}
          </p>
        ))}
        <p className="hitl-cause-action-lens">
          {"Review lens for this action: "}
          <strong>{row.lens}</strong>
        </p>
      </div>
    </details>
  ) : null;
}
function AuditHistory({ events }) {
  const e = lastDecision(events),
    t = (i) =>
      ({
        approve: "Approved",
        reject: "Rejected",
        edit: "Edited \xB7 approval needed",
        comment: "Commented",
      })[i] || i;
  return (
    <>
      {e && (
        <div className="guided-audit">
          <strong>
            {t(e.decision)}
            {" by "}
            {e.reviewer}
          </strong>
          {e.reason && <p>{e.reason}</p>}
          <small>{fmtDateTime(e.at)}</small>
        </div>
      )}
      {events.length > 0 && (
        <details className="hitl-audit-history">
          <summary>
            {"Review history \xB7 "}
            {events.length} {events.length === 1 ? "entry" : "entries"}
          </summary>
          <ol>
            {events.map((i, n) => (
              <li key={`${i.at}-${n}`}>
                <strong>
                  {t(i.decision)}
                  {" by "}
                  {i.reviewer}
                </strong>
                {i.reason && <p>{i.reason}</p>}
                <small>{fmtDateTime(i.at)}</small>
              </li>
            ))}
          </ol>
        </details>
      )}
    </>
  );
}
function StatusBadge({ status }) {
  return (
    <span className={`guided-status guided-status-${status || "draft"}`}>
      {STATUS_LABELS[status] || "Pending review"}
    </span>
  );
}
function ReviewProgress({ rows, kind }) {
  rows = rows.filter((i) => !isHistorical(i));
  const t = rows.filter(isDecided).length;
  return (
    <div className="guided-progress">
      <div className="guided-progress-copy">
        <strong>
          {t}
          {" of "}
          {rows.length} {pluralKind(kind)}
          {" reviewed"}
        </strong>
        <span>
          {rows.length - t
            ? `${rows.length - t} awaiting your decision`
            : rows.length
              ? "Every item has a review decision"
              : "No items require review in this step"}
        </span>
      </div>
      <progress max={Math.max(rows.length, 1)} value={t} aria-label={`${kind} review progress`} />
    </div>
  );
}
function ReviewQueue({ rows, kind, tab, setTab, selectedId, select, busy }) {
  const r = rows.filter((c) => !isDecided(c)),
    l = rows.filter(isDecided),
    s = tab === "pending" ? r : l;
  return (
    <aside className="guided-queue" aria-label={`${kind} review queue`}>
      <div className="guided-tabs" aria-label="Review status">
        <button
          type="button"
          aria-pressed={tab === "pending"}
          className={tab === "pending" ? "is-selected" : ""}
          disabled={busy}
          onClick={() => setTab("pending")}
        >
          {"Pending "}
          <span>{r.length}</span>
        </button>
        <button
          type="button"
          aria-pressed={tab === "reviewed"}
          className={tab === "reviewed" ? "is-selected" : ""}
          disabled={busy}
          onClick={() => setTab("reviewed")}
        >
          {"Reviewed "}
          <span>{l.length}</span>
        </button>
      </div>
      <div className="guided-queue-items">
        {s.map((c) => (
          <button
            type="button"
            key={rowId(c)}
            className={`guided-queue-item ${selectedId === rowId(c) ? "is-selected" : ""}`}
            aria-current={selectedId === rowId(c) ? "true" : undefined}
            disabled={busy}
            onClick={() => select(rowId(c))}
          >
            <span className="guided-queue-meta">
              <span>
                {kind === "action"
                  ? c.lens
                  : kind === "diagnosis"
                    ? c.intent
                    : insightIntent(c)}
              </span>
              <span
                className={`guided-priority guided-priority-${c.priority || c.severity || c.metrics?.severity || "normal"}`}
              >
                {c.priority ||
                  c.severity ||
                  c.metrics?.severity ||
                  (c.insight_type === "trend" ? "Trend" : "Finding")}
              </span>
            </span>
            <strong>{c.title}</strong>
            <span className="guided-queue-foot">
              {kind === "action" ? (
                <span>{c.owner || "Owner to assign"}</span>
              ) : kind === "diagnosis" ? (
                <span>
                  {c.engine}
                  {" \xB7 "}
                  {c.source_count}
                  {" sources"}
                </span>
              ) : (
                <span>
                  {c.measurement_count || 0}
                  {" sampled answers"}
                </span>
              )}
              {isDecided(c) && <StatusBadge status={c.status} />}
            </span>
          </button>
        ))}
        {!s.length && (
          <div className="guided-queue-empty">
            {tab === "pending" ? "All items reviewed." : "Your reviewed items will appear here."}
          </div>
        )}
      </div>
    </aside>
  );
}
function ReviewEditor({
  row,
  kind,
  reviewer,
  busy,
  onDecision,
  history = [],
  onEditingChange,
  compact = false,
}) {
  const [l, s] = useState(""),
    [c, d] = useState(""),
    [B, g] = useState(row.owner || ""),
    [M, h] = useState(row.due_date || ""),
    [U, I] = useState({
      title: row.title,
      summary: row.summary || "",
      suggested_reason: kind === "diagnosis" ? row.root_cause : suggestedReason(row),
      detail: stripEvidence(row.detail),
      priority: row.priority || "medium",
      owner: row.owner || "",
      due_date: row.due_date || "",
    }),
    [Q, p] = useState(""),
    Y = ownerName(reviewer),
    E = kind === "action",
    u = E && ["in_progress", "done"].includes(row.status),
    F = ["approved", "confirmed", "in_progress", "done"].includes(row.status),
    m = (z, C) =>
      I((R) => ({
        ...R,
        [z]: C,
      })),
    j = rowId(row);
  useEffect(() => {
    onEditingChange(j, !!l);
    return () => onEditingChange(j, false);
  }, [l, j, onEditingChange]);
  async function w(z) {
    if ((p(""), !Y)) {
      p("Sign in before recording a review decision.");
      return;
    }
    if (["edit", "reject", "comment"].includes(z) && !c.trim()) {
      p(
        z === "comment"
          ? "Write a comment before saving."
          : "Add a reason so the next review can use your correction.",
      );
      return;
    }
    let C;
    if (z === "edit") {
      if (E && U.due_date && !isValidDueDate(U.due_date)) {
        p("Enter a valid due date in YYYY-MM-DD format.");
        return;
      }
      const R = E
          ? ["title", "detail", "priority", "owner", "due_date"]
          : kind === "diagnosis"
            ? ["title", "summary", "suggested_reason"]
            : ["title", "summary"],
        N = E
          ? {
              ...row,
              detail: stripEvidence(row.detail),
              owner: row.owner || "",
              due_date: row.due_date || "",
            }
          : {
              ...row,
              suggested_reason: kind === "diagnosis" ? row.root_cause : suggestedReason(row),
            };
      if (
        ((C = Object.fromEntries(
          R.filter((D) => U[D].trim() !== String(N[D] || "").trim()).map((D) => [D, U[D].trim()]),
        )),
        !Object.keys(C).length)
      ) {
        p("Change at least one field before saving.");
        return;
      }
      if (
        !U.title.trim() ||
        !(E ? U.detail.trim() : U.summary.trim() && (kind !== "diagnosis" || U.suggested_reason.trim()))
      ) {
        p("Keep the title and review details filled in.");
        return;
      }
    }
    if (E && z === "approve" && (!B.trim() || !isValidDueDate(M))) {
      p("Assign an owner and a valid due date in YYYY-MM-DD format before approving this action.");
      return;
    }
    try {
      await onDecision(z, {
        changes: C,
        reason: c.trim(),
        owner: B.trim(),
        due_date: M,
      });
      s("");
      d("");
    } catch (R) {
      p(R.message);
    }
  }
  return (
    <section
      className={`guided-decision${compact ? " hitl-compact-decision" : ""}`}
      aria-label={`Review this ${kind}`}
    >
      <AuditHistory events={history} />
      {u && (
        <div className="guided-historical">
          <strong>
            {row.status === "done"
              ? "Completed action from the previous cycle"
              : "Previously approved \xB7 work in progress"}
          </strong>
          <p>
            {row.owner}
            {row.due_date
              ? ` \xB7 Due ${fmtDay(row.due_date)}`
              : row.done_on
                ? ` \xB7 Completed ${fmtDay(row.done_on)}`
                : ""}
          </p>
        </div>
      )}
      <>
        {E && !l && !F && (
          <div className="guided-assignment">
            <label>
              {"Action owner "}
              <span>Required</span>
              <input
                value={B}
                onChange={(z) => g(z.target.value)}
                placeholder="e.g. Content team"
                disabled={busy}
              />
            </label>
            <DueDateField value={M} onChange={h} disabled={busy} required />
          </div>
        )}
        {l === "edit" && (
          <div className="guided-editor">
            <h3>
              {"Edit this "}
              {kind}
            </h3>
            <p className="guided-muted">
              Saving your changes returns this item to Pending. Review and approve the revised version next.
            </p>
            <label>
              Title
              <input value={U.title} onChange={(z) => m("title", z.target.value)} />
            </label>
            {E ? (
              <>
                <label>
                  Proposed action
                  <textarea rows="4" value={U.detail} onChange={(z) => m("detail", z.target.value)} />
                </label>
                <div className="guided-assignment">
                  <label>
                    Priority
                    <select value={U.priority} onChange={(z) => m("priority", z.target.value)}>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </label>
                  <label>
                    Action owner
                    <input value={U.owner} onChange={(z) => m("owner", z.target.value)} />
                  </label>
                  <DueDateField value={U.due_date} onChange={(z) => m("due_date", z)} disabled={busy} />
                </div>
              </>
            ) : (
              <>
                <label>
                  Observation
                  <textarea rows="3" value={U.summary} onChange={(z) => m("summary", z.target.value)} />
                </label>
                {kind === "diagnosis" && (
                  <label>
                    Suggested explanation
                    <textarea
                      rows="3"
                      value={U.suggested_reason}
                      onChange={(z) => m("suggested_reason", z.target.value)}
                    />
                  </label>
                )}
              </>
            )}
          </div>
        )}
        {l && (
          <div className={`guided-reason${l === "comment" ? " hitl-comment-editor" : ""}`}>
            <label>
              {l === "comment"
                ? `Comment on this ${kind}`
                : l === "reject"
                  ? `Why are you rejecting this ${kind}?`
                  : "Why did you change it?"}{" "}
              <span>Required</span>
              <textarea
                autoFocus
                rows="3"
                placeholder={
                  l === "comment"
                    ? "Add context, a question or a note for the team\u2026"
                    : l === "reject"
                      ? "Explain what is unsupported, inaccurate or not useful\u2026"
                      : "Explain your correction for the next review\u2026"
                }
                value={c}
                onChange={(z) => d(z.target.value)}
              />
            </label>
            <p className="guided-muted">
              {l === "comment"
                ? "Comments are saved in the review history. They do not approve, reject or change this item."
                : "Your reason is saved with this decision in the review history."}
            </p>
          </div>
        )}
        {Q && (
          <p className="guided-error" role="alert">
            {Q}
          </p>
        )}
        {!Y && <p className="guided-error">Sign in to record a decision under your account.</p>}
        {Y && !l && !isDecided(row) && (
          <p className="reviewv2-reviewer">
            {"Your decision will be recorded as "}
            <strong>{Y}</strong>.
          </p>
        )}
        <div className="guided-decision-footer">
          <span className="guided-muted">
            {l === "comment"
              ? "Your comment will not change the decision."
              : l
                ? "A reason is required to save."
                : u
                  ? "Previous-cycle action. You can add a comment."
                  : F
                    ? "This item has been approved."
                    : row.status === "rejected"
                      ? "Rejected items are excluded from the plan."
                      : E
                        ? "Approve the evidence, action, owner and due date."
                        : kind === "diagnosis"
                          ? "Decide whether the evidence supports this explanation."
                          : "Approve this observation to explore its possible cause."}
          </span>
          <div className="guided-decision-buttons">
            {l ? (
              <>
                <button
                  type="button"
                  className="guided-secondary"
                  disabled={busy}
                  onClick={() => {
                    s("");
                    d("");
                    p("");
                    I({
                      title: row.title,
                      summary: row.summary || "",
                      suggested_reason: kind === "diagnosis" ? row.root_cause : suggestedReason(row),
                      detail: stripEvidence(row.detail),
                      priority: row.priority || "medium",
                      owner: row.owner || "",
                      due_date: row.due_date || "",
                    });
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={l === "reject" ? "guided-reject" : "guided-primary"}
                  disabled={busy || !Y || !c.trim()}
                  onClick={() => w(l)}
                >
                  {busy
                    ? "Saving\u2026"
                    : l === "edit"
                      ? "Save changes"
                      : l === "comment"
                        ? "Save comment"
                        : "Confirm rejection"}
                </button>
              </>
            ) : (
              <>
                {compact && (
                  <button
                    type="button"
                    className="guided-primary"
                    disabled={busy || !Y || F || (E && (!B.trim() || !isValidDueDate(M)))}
                    onClick={() => w("approve")}
                  >
                    {busy ? "Saving\u2026" : u ? "Previously approved" : F ? "Approved" : "Approve"}
                  </button>
                )}
                <button
                  type="button"
                  className="guided-secondary"
                  disabled={busy || !Y || u || row.status === "rejected"}
                  onClick={() => {
                    s("reject");
                    p("");
                  }}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="guided-secondary"
                  disabled={busy || !Y || u}
                  onClick={() => {
                    s("edit");
                    p("");
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={`guided-secondary${compact ? " hitl-comment-action" : ""}`}
                  disabled={busy || !Y}
                  onClick={() => {
                    s("comment");
                    p("");
                  }}
                >
                  Comment
                </button>
                {!compact && (
                  <button
                    type="button"
                    className="guided-primary"
                    disabled={busy || !Y || F || (E && (!B.trim() || !isValidDueDate(M)))}
                    onClick={() => w("approve")}
                  >
                    {busy ? "Saving\u2026" : u ? "Previously approved" : F ? "Approved" : `Approve ${kind}`}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </>
    </section>
  );
}
function FindingCard({ row, open }) {
  const t = row.metrics || {},
    i = t.baseline != null && t.current != null;
  return (
    <>
      <div className="guided-item-heading">
        <div className="guided-eyebrow">{insightIntent(row)}</div>
        <h2>{row.title}</h2>
        <div className="guided-item-meta">
          <StatusBadge status={row.status} />
          <span>
            {fmtDay(row.period_start)}
            {" \u2013 "}
            {fmtDay(row.period_end)}
          </span>
          <span>
            {row.measurement_count}
            {" sampled answers"}
          </span>
        </div>
        <p className="reviewv2-decision-state">{decisionLabel(row)}</p>
      </div>
      {i && (
        <div className="guided-metric-comparison">
          <div>
            <span>Previous period</span>
            <strong>{t.baseline.toFixed(1)}</strong>
          </div>
          <span className="guided-comparison-arrow" aria-hidden="true">
            →
          </span>
          <div>
            <span>Current period</span>
            <strong>{t.current.toFixed(1)}</strong>
          </div>
          <p>
            <strong>
              {t.current - t.baseline > 0 ? "+" : ""}
              {(t.current - t.baseline).toFixed(1)}
              {" pts"}
            </strong>
            <span>
              {row.insight_type === "competitor_threat" ? "Competitor visibility" : "Hotel visibility"}
            </span>
          </p>
        </div>
      )}
      <section className="guided-observation">
        <div className="guided-section-heading">
          <h3>What we observed</h3>
          <span>From the measured answers</span>
        </div>
        <p>{row.summary}</p>
        <button
          type="button"
          className="guided-evidence-link"
          onClick={() =>
            open({
              type: "insight",
              value: row.id,
            })
          }
        >
          {"View supporting answers & sources "}
          <span aria-hidden="true">↗</span>
        </button>
      </section>
      <p className="guided-next-step-note">
        Approved findings continue to diagnosis, where you will review the suggested explanation separately.
      </p>
    </>
  );
}
function ReferenceCard({ row, kind, open }) {
  const i = kind === "action",
    n = i
      ? `${row.lens} lens`
      : row.insight_type === "alert"
        ? "Auto alert"
        : row.insight_type === "competitor_threat"
          ? "Neutral-set alert"
          : "Insight",
    o = row.priority || row.severity || row.metrics?.severity,
    r = i ? stripEvidence(row.detail) : row.review_observation || row.summary;
  return (
    <>
      <div className="hitl-reference-meta">
        <span className="hitl-type-badge">{n}</span>
        {o && <span className={`hitl-severity-${o}`}>{o}</span>}
        <span className="hitl-draft-badge">
          {isDecided(row) ? STATUS_LABELS[row.status] : i ? "proposed" : "draft"}
        </span>
        {i ? (
          <span>{row.intent}</span>
        ) : (
          <span>
            {fmtDay(row.period_start)}
            {" \u2013 "}
            {fmtDay(row.period_end)}
            {" \xB7 "}
            {row.measurement_count}
            {" answers"}
          </span>
        )}
      </div>
      <div className="hitl-reference-title">
        <h2>{row.title}</h2>
        <button
          type="button"
          className="guided-secondary"
          onClick={() =>
            open(
              i
                ? {
                    type: "measurement",
                    value: row.measurement_id,
                  }
                : {
                    type: "insight",
                    value: row.id,
                  },
            )
          }
        >
          See evidence
        </button>
      </div>
      <p className="hitl-reference-summary">{r}</p>
      {i && <CauseAction row={row} />}
      {i && (
        <details className="hitl-reference-details">
          <summary>{"Expected outcome & supporting prompt"}</summary>
          <p>{row.expected_impact}</p>
          <p>{row.prompt_text}</p>
        </details>
      )}
      {i && isDecided(row) && row.owner && (
        <div className="guided-assigned-summary">
          <span>
            <strong>Owner</strong> {row.owner}
          </span>
          {row.due_date && (
            <span>
              <strong>Due</strong> {fmtDay(row.due_date)}
            </span>
          )}
        </div>
      )}
    </>
  );
}
function ActionCard({ row, open }) {
  return (
    <>
      <div className="guided-item-heading">
        <div className="guided-eyebrow">
          {row.intent}
          {" \xB7 "}
          {row.lens}
          {" lens"}
        </div>
        <h2>{row.title}</h2>
        <div className="guided-item-meta">
          <StatusBadge status={row.status} />
          <span>
            {row.priority.charAt(0).toUpperCase() + row.priority.slice(1)}
            {" priority"}
          </span>
          <span>{row.action_type.replaceAll("_", " ")}</span>
        </div>
        <p className="reviewv2-decision-state">{decisionLabel(row)}</p>
      </div>
      <CauseAction row={row} />
      <section className="guided-observation">
        <div className="guided-section-heading">
          <h3>Proposed action</h3>
        </div>
        <p>{stripEvidence(row.detail)}</p>
      </section>
      <section className="guided-hypothesis">
        <div className="guided-section-heading">
          <h3>Expected outcome</h3>
          <span>To measure next cycle</span>
        </div>
        <p>{row.expected_impact}</p>
      </section>
      <div className="guided-action-context">
        <span className="guided-eyebrow">Supporting context</span>
        <p>{row.prompt_text}</p>
        <button
          type="button"
          className="guided-evidence-link"
          onClick={() =>
            open({
              type: "measurement",
              value: row.measurement_id,
            })
          }
        >
          {"View answer & cited sources "}
          <span aria-hidden="true">↗</span>
        </button>
      </div>
      {isDecided(row) && row.owner && (
        <div className="guided-assigned-summary">
          <span>
            <strong>Owner</strong> {row.owner}
          </span>
          {row.due_date && (
            <span>
              <strong>Due</strong> {fmtDay(row.due_date)}
            </span>
          )}
        </div>
      )}
    </>
  );
}
function DiagnosisCard({ row, open }) {
  return (
    <>
      <div className="guided-item-heading">
        <div className="guided-eyebrow">
          {row.intent}
          {" \xB7 "}
          {DIAGNOSIS_LABELS[row.diagnosis_type] || "Suggested explanation"}
        </div>
        <h2>{row.title}</h2>
        <div className="guided-item-meta">
          <StatusBadge status={row.status} />
          <span>
            {row.engine}
            {" \xB7 "}
            {fmtDay(row.measured_at)}
          </span>
          <span>{Math.round((row.confidence_score || 0) * 100)}% model confidence</span>
        </div>
        <p className="reviewv2-decision-state">{decisionLabel(row)}</p>
      </div>
      <section className="guided-observation">
        <div className="guided-section-heading">
          <h3>What the answer shows</h3>
          <span>Observation</span>
        </div>
        <p>{row.summary}</p>
        <blockquote className="guided-prompt">{row.prompt_text}</blockquote>
        <button
          type="button"
          className="guided-evidence-link"
          onClick={() =>
            open({
              type: "measurement",
              value: row.measurement_id,
            })
          }
        >
          {"Inspect answer & "}
          {row.source_count}
          {" cited sources "}
          <span aria-hidden="true">↗</span>
        </button>
      </section>
      <section className="guided-hypothesis">
        <div className="guided-section-heading">
          <h3>Suggested explanation</h3>
          <span>
            {isDecided(row)
              ? row.status === "rejected"
                ? "Rejected"
                : "Human approved"
              : "Human decision required"}
          </span>
        </div>
        <p>{row.root_cause}</p>
        <p className="guided-muted">
          Model confidence is not verification. Check the offering and source pages before approving this
          diagnosis.
        </p>
      </section>
    </>
  );
}
function PromptEvidence({ propertyId, open }) {
  const [t, i] = useState(null),
    [n, o] = useState("");
  useEffect(() => {
    let a = true;
    i(null);
    o("");
    apiFetch(`/api/dashboard/${propertyId}/prompts`)
      .then(async (r) =>
        Promise.all(
          r.map(async (l) => ({
            ...l,
            sampleAnswers: await apiFetch(`/api/prompts/${l.prompt_id}/answers`),
          })),
        ),
      )
      .then((r) => {
        if (a) {
          i(r);
        }
      })
      .catch((r) => {
        if (a) {
          o(r.message);
        }
      });
    return () => {
      a = false;
    };
  }, [propertyId]);
  return n ? (
    <p className="guided-error" role="alert">
      {n}
    </p>
  ) : t ? (
    <div className="hitl-prompts">
      <p className="guided-muted">
        Read-only supporting evidence. Inspect the AI answers and cited sources, then return to the related
        finding or diagnosis to make your decision.
      </p>
      {t.map((a) => (
        <article className="hitl-prompt-card" key={a.prompt_id}>
          <div className="hitl-card-top">
            <span className="guided-eyebrow">{a.intent}</span>
            <span className="guided-status">Evidence · read only</span>
          </div>
          <h3>{a.prompt_text}</h3>
          <p className="hitl-prompt-meta">
            {a.answers}
            {" sampled answers \xB7 "}
            {Math.round(a.found_rate * 100)}% mention the hotel
          </p>
          <div className="hitl-answer-buttons">
            {a.sampleAnswers.map((r) => (
              <button
                key={r.measurement_id}
                type="button"
                className="guided-secondary"
                onClick={() =>
                  open({
                    type: "measurement",
                    value: r.measurement_id,
                  })
                }
              >
                {r.engine}
                {" \xB7 View answer"}
              </button>
            ))}
          </div>
        </article>
      ))}
    </div>
  ) : (
    <p className="guided-loading" role="status">
      Loading prompts and answers…
    </p>
  );
}
function ReviewStep({
  kind,
  propertyId,
  reviewer,
  onGateChange,
  onOpenDetail,
  approvedFindingIds,
  approvedDiagnosisIds,
  presentation = "queue",
}) {
  const [l, s] = useState(null),
    [c, d] = useState("pending"),
    [B, g] = useState("pending"),
    [M, h] = useState("alerts"),
    [U, I] = useState(null),
    [Q, p] = useState(false),
    [Y, E] = useState([]),
    u = Y.length > 0,
    F = useCallback(
      (gA, uA) =>
        E((y) => (uA ? (y.includes(gA) ? y : [...y, gA]) : y.includes(gA) ? y.filter((nA) => nA !== gA) : y)),
      [],
    ),
    [m, j] = useState(""),
    [w, z] = useState(""),
    [C, R] = useState(null),
    [promptCount, setPromptCount] = useState(null),
    N = useRef(onGateChange);
  useEffect(() => {
    let live = true;
    setPromptCount(null);
    if (kind === "finding" && propertyId) {
      apiFetch(`/api/dashboard/${propertyId}/prompts`)
        .then((prompts) => live && setPromptCount(Array.isArray(prompts) ? prompts.length : null))
        .catch(() => null);
    }
    return () => {
      live = false;
    };
  }, [kind, propertyId]);
  N.current = onGateChange;
  const D = JSON.stringify(
      kind === "diagnosis" ? approvedFindingIds : kind === "action" ? approvedDiagnosisIds : null,
    ),
    L = (gA) => `${propertyId}:${kind}:${rowId(gA)}`;
  async function H() {
    const gA = await loadReviewRows(kind, propertyId, approvedFindingIds, approvedDiagnosisIds);
    s(gA);
    j("");
  }
  useEffect(() => {
    let gA = true;
    s(null);
    I(null);
    d("pending");
    g("pending");
    h("alerts");
    E([]);
    z("");
    j("");
    loadReviewRows(kind, propertyId, approvedFindingIds, approvedDiagnosisIds)
      .then((uA) => {
        if (gA) {
          s(uA);
          // Open on auto alerts when there are any, otherwise on the insights.
          if (kind === "finding" && !uA.some(isAlert)) h("insights");
        }
      })
      .catch((uA) => {
        if (gA) {
          j(uA.message);
        }
      });
    return () => {
      gA = false;
    };
  }, [propertyId, kind, D]);
  useEffect(() => {
    if (!l) {
      N.current?.({
        ready: false,
        summary: "Loading review items\u2026",
        total: 0,
        reviewed: 0,
        pending: 0,
        approvedIds: [],
        approvedItems: [],
        rejectedIds: [],
        rejectedItems: [],
        reviewedItems: [],
        allItems: [],
      });
      return;
    }
    const gA = l.filter((eA) => !isHistorical(eA)),
      uA = gA.filter((eA) => !isDecided(eA)).length,
      y = (eA) => {
        const cA = historyFor(`${propertyId}:${kind}:${rowId(eA)}`),
          X = lastDecision(cA);
        return {
          ...eA,
          ...(X
            ? {
                review_decision: X.decision,
                review_reason: X.reason || "",
                reviewed_by: X.reviewer,
                reviewed_at: X.at,
                evidence_reviewed: X.evidence_reviewed,
              }
            : {}),
          review_history: cA.map((IA) => ({
            ...IA,
          })),
        };
      },
      nA = gA.filter((eA) => ["approved", "confirmed"].includes(eA.status)).map(y),
      _ = gA.filter((eA) => eA.status === "rejected").map(y),
      k = nA.length,
      S = _.length,
      P = l
        .map((eA) => `${rowId(eA)}:${eA.status}:${historyKey(`${propertyId}:${kind}:${rowId(eA)}`)}`)
        .join("|");
    N.current?.({
      ready: uA === 0 && !Q && !u,
      summary: u
        ? "Save or cancel the current review decision"
        : uA
          ? `${uA} ${uA === 1 ? kind : pluralKind(kind)} still ${uA === 1 ? "needs" : "need"} a decision`
          : gA.length
            ? `${k} approved \xB7 ${S} rejected`
            : `No ${pluralKind(kind)} in the approved scope`,
      total: gA.length,
      reviewed: k + S,
      pending: uA,
      approved: k,
      rejected: S,
      historical: l.length - gA.length,
      approvedIds: nA.map(rowId),
      approvedItems: nA,
      rejectedIds: _.map(rowId),
      rejectedItems: _,
      reviewedItems: [...nA, ..._],
      allItems: l.map(y),
      history: l.flatMap((eA) =>
        historyFor(`${propertyId}:${kind}:${rowId(eA)}`).map((cA) => ({
          ...cA,
          item_id: rowId(eA),
          kind: kind,
        })),
      ),
      revisionKey: P,
    });
  }, [l, Q, u, kind, propertyId]);
  const pA = (l || []).filter((gA) => (c === "pending" ? !isDecided(gA) : isDecided(gA))),
    O = pA.find((gA) => rowId(gA) === U) || pA[0];
  async function EA(gA, uA, y) {
    const nA = rowId(gA),
      _ = ownerName(reviewer);
    p(true);
    z("");
    try {
      if (kind === "action" && uA === "approve") {
        await apiFetch(
          `/api/recommendations/${nA}`,
          jsonBody(
            {
              owner: y.owner,
              due_date: y.due_date,
            },
            "PUT",
          ),
        );
      }
      let k = y.changes;
      if (kind === "diagnosis" && k) {
        k = Object.fromEntries(
          Object.entries(k).map(([eA, cA]) => [
            {
              title: "review_title",
              summary: "review_observation",
              suggested_reason: "root_cause",
            }[eA] || eA,
            cA,
          ]),
        );
      }
      if (kind === "finding" && k?.summary) {
        k = {
          ...k,
          review_observation: k.summary,
        };
      }
      await apiFetch(
        "/api/feedback",
        jsonBody({
          target: kind === "finding" ? "intelligence" : kind === "diagnosis" ? "diagnosis" : "recommendation",
          target_id: nA,
          reviewer: _,
          decision: uA,
          comment: y.reason || `Approved ${kind} after reviewing the supporting context.`,
          ...(uA === "edit"
            ? {
                changes: {
                  ...k,
                  status: kind === "action" ? "proposed" : "draft",
                },
              }
            : {}),
        }),
      );
      const S = L(gA),
        P = {
          decision: uA,
          reviewer: _,
          reason: y.reason,
          at: new Date().toISOString(),
          ...(uA === "edit"
            ? {
                changes: {
                  ...y.changes,
                },
              }
            : {}),
        };
      reviewHistory.set(S, [...historyFor(S), P]);
      await H();
      if (uA === "comment") {
        z("Comment saved. The review decision is unchanged.");
      } else if (uA === "edit") {
        d("pending");
        g("pending");
        I(nA);
        z("Changes saved. Review the evidence again and approve the revised item when ready.");
      } else {
        I(null);
        z(
          `${kind.charAt(0).toUpperCase() + kind.slice(1)} ${uA === "approve" ? "approved" : "rejected"}. Your decision and reviewer details were saved.`,
        );
      }
    } finally {
      p(false);
    }
  }
  const v = onOpenDetail || R,
    V = (gA) =>
      kind === "finding" ? (
        <FindingCard row={gA} open={v} />
      ) : kind === "diagnosis" ? (
        <DiagnosisCard row={gA} open={v} />
      ) : (
        <ActionCard row={gA} open={v} />
      ),
    q = presentation === "cards" && kind !== "diagnosis",
    iA = (gA) => (
      <ReviewEditor
        key={`${rowId(gA)}:${gA.status}:${historyKey(L(gA))}`}
        row={gA}
        kind={kind}
        reviewer={reviewer}
        busy={Q}
        onDecision={(uA, y) => EA(gA, uA, y)}
        history={historyFor(L(gA))}
        onEditingChange={F}
        compact={q}
      />
    );
  if (m) {
    return (
      <div className="guided-error" role="alert">
        <p>{m}</p>
        <button type="button" className="guided-secondary" onClick={() => H().catch((gA) => j(gA.message))}>
          Try again
        </button>
      </div>
    );
  }
  if (!l) {
    return (
      <div className="guided-loading" role="status">
        {"Preparing your "}
        {pluralKind(kind)}
        {" for review\u2026"}
      </div>
    );
  }
  const rA = l.filter((gA) => !isDecided(gA)).length,
    jA = l.filter((gA) => !isHistorical(gA)),
    RA = rA > 0 || u,
    kA = presentation === "cards",
    G = kind === "finding" ? l.filter((gA) => (M === "alerts" ? isAlert(gA) : !isAlert(gA))) : l,
    wA = G.filter((gA) => matchesTab(gA, B)),
    BA = kA && kind === "finding" && M === "prompts";
  return (
    <div className={`guided-review guided-review-${kind}${kA ? " guided-review-cards" : ""}`}>
      <section
        className={`reviewv2-required-banner${RA ? "" : " reviewv2-required-banner-complete"}`}
        aria-label="Human review requirement"
      >
        <div>
          <strong>
            {RA
              ? "Human approval required"
              : jA.length
                ? "Human review complete"
                : "No items need a decision"}
          </strong>
          <p>
            {RA
              ? kind === "finding"
                ? "Check the supporting answers, then approve or reject each finding. Only approved findings continue to diagnosis."
                : kind === "diagnosis"
                  ? "Check whether the evidence supports each explanation, then approve or reject it. Only approved diagnoses create actions."
                  : "Review each proposed action, assign an owner and due date, then approve or reject it. Only approved actions enter the plan."
              : jA.length
                ? "Every current-cycle item has a human decision. Approved items continue; rejected items stay in the review record."
                : "Nothing new was carried forward from the approved scope. Previous-cycle actions are shown separately."}
          </p>
        </div>
        <span className="reviewv2-reviewer">
          {ownerName(reviewer) ? `Reviewing as ${ownerName(reviewer)}` : "Sign in to review"}
        </span>
      </section>
      {kind === "diagnosis" && <DiagnosisRoutes />}
      <ReviewCriteria />
      <ReviewProgress rows={l} kind={kind} />
      {w && (
        <p className="guided-notice" role="status">
          {w}
        </p>
      )}
      {kA ? (
        <>
          {kind === "finding" && (
            <nav className="hitl-categories" aria-label="Review categories">
              {[
                ["alerts", "Auto alerts", l.filter(isAlert).length],
                ["insights", "Insights", l.filter((gA) => !isAlert(gA)).length],
                ["prompts", "Prompts & answers", promptCount ?? "\u2026"],
              ].map(([gA, uA, y]) => (
                <button
                  type="button"
                  key={gA}
                  aria-pressed={M === gA}
                  disabled={Q || u}
                  onClick={() => h(gA)}
                >
                  {uA}
                  <span>{y}</span>
                </button>
              ))}
            </nav>
          )}
          {BA ? (
            <PromptEvidence propertyId={propertyId} open={v} />
          ) : (
            <>
              <nav className="hitl-filters" aria-label="Review status">
                {[
                  ["pending", "Awaiting review"],
                  ["approved", "Approved"],
                  ["rejected", "Rejected"],
                  ["all", "All"],
                ].map(([gA, uA]) => (
                  <button
                    type="button"
                    key={gA}
                    aria-pressed={B === gA}
                    disabled={Q || u}
                    onClick={() => g(gA)}
                  >
                    {uA}
                    <span>{G.filter((y) => matchesTab(y, gA)).length}</span>
                  </button>
                ))}
              </nav>
              {wA.length > 0 && (
                <section
                  className={q ? "hitl-reference-panel" : ""}
                  aria-label={
                    kind === "action"
                      ? "Recommendations"
                      : kind === "diagnosis"
                        ? "Diagnoses"
                        : M === "alerts"
                          ? "Auto alerts"
                          : "Insights"
                  }
                >
                  {q && (
                    <header>
                      <h2>
                        {kind === "action" ? "Recommendations" : M === "alerts" ? "Auto alerts" : "Insights"}
                      </h2>
                      <p>
                        {kind === "action"
                          ? "Review the proposed actions and their evidence. Approve the ones to include in the plan; assign an owner and due date."
                          : M === "alerts"
                            ? "Sharp score drops against the recent baseline. Approve the ones worth acting on; reject noise."
                            : "Review what changed in the AI answers. Approve useful observations; reject unsupported findings."}
                      </p>
                    </header>
                  )}
                  <div className="hitl-card-list">
                    {wA.map((gA) => (
                      <article
                        className={`hitl-card${q ? " hitl-reference-card" : ""}`}
                        key={rowId(gA)}
                        aria-label={gA.title}
                      >
                        {q ? <ReferenceCard row={gA} kind={kind} open={v} /> : V(gA)}
                        {iA(gA)}
                      </article>
                    ))}
                  </div>
                </section>
              )}
              {!wA.length && (
                <div className="hitl-empty">
                  <h2>
                    {G.length
                      ? B === "pending"
                        ? "No items awaiting review"
                        : `No ${B === "all" ? "matching" : B} items`
                      : `No ${pluralKind(kind)} in this category`}
                  </h2>
                  <p>
                    {G.length
                      ? B === "pending"
                        ? "Every item in this category has a decision. You can check approved and rejected items using the filters."
                        : "Choose another status to view the review history."
                      : "Items appear here when they are in the approved review scope."}
                  </p>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <div className="guided-workspace">
          <ReviewQueue
            rows={l}
            kind={kind}
            tab={c}
            setTab={(gA) => {
              d(gA);
              I(null);
            }}
            selectedId={O && rowId(O)}
            select={I}
            busy={Q || u}
          />
          <article className="guided-detail">
            {O ? (
              <>
                {V(O)}
                {iA(O)}
              </>
            ) : (
              <div className="guided-complete">
                <span className="guided-complete-mark" aria-hidden="true">
                  ✓
                </span>
                <h2>
                  {l.length
                    ? c === "pending"
                      ? `All ${pluralKind(kind)} reviewed`
                      : "No reviewed items yet"
                    : `No ${pluralKind(kind)} to review`}
                </h2>
                <p>
                  {l.length
                    ? c === "pending"
                      ? "You can continue to the next step, or revisit a decision in Reviewed."
                      : `Select Pending to review your first ${kind}.`
                    : "No items were carried forward from the approved scope. You can continue without adding actions."}
                </p>
                {l.length > 0 && (
                  <button
                    type="button"
                    className="guided-secondary"
                    onClick={() => d(c === "pending" ? "reviewed" : "pending")}
                  >
                    {c === "pending" ? "View reviewed items" : "Start reviewing"}
                  </button>
                )}
              </div>
            )}
          </article>
        </div>
      )}
      {C && <EvidenceDrawer item={C} onClose={() => R(null)} />}
    </div>
  );
}
function FindingsReview(A) {
  return <ReviewStep {...A} kind="finding" />;
}
export { FindingsReview };
function DiagnosisReview(A) {
  return <ReviewStep {...A} kind="diagnosis" />;
}
export { DiagnosisReview };
function ActionsReview(A) {
  return <ReviewStep {...A} kind="action" />;
}
export { ActionsReview };
