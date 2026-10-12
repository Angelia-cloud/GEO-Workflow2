import { useEffect, useId, useRef, useState } from "react";
import { assistantAvatar } from "../../../assets/index";
import { apiFetch, jsonBody } from "../../../api/client";
import { answerQuestion } from "./answerQuestion";
import { ReportCitations } from "./ReportCitations";
function AssistantMark({ variant = "header", thinking = false }) {
  return (
    <span className={`report-chat-brand is-${variant}${thinking ? " is-thinking" : ""}`} aria-hidden="true">
      <img src={assistantAvatar} alt="" draggable="false" />
    </span>
  );
}
function safeAnswer(A, e) {
  try {
    return answerQuestion(A, e);
  } catch {
    return {
      text: "I couldn\u2019t find an answer in this report. Try asking about a metric, finding or recommendation shown here.",
      confidence: null,
      confidenceReason: "No matching report evidence is available for this answer.",
      sources: [],
      supported: false,
    };
  }
}
/**
 * Ask the report assistant (POST /api/report-assistant/{property}/ask). Only the question and the report dates
 * are sent: the server builds the facts from verified Supabase measurements. Without an LLM the server returns
 * that same server-built context and the keyword matcher answers from it. The browser never supplies facts.
 */
async function askReport(context, question) {
  if (!context?.propertyId) return safeAnswer(context, question);
  try {
    const reply = await apiFetch(`/api/report-assistant/${encodeURIComponent(context.propertyId)}/ask`, {
      method: "POST",
      ...jsonBody({ question, date_from: context.period?.from, date_to: context.period?.to }),
    });
    if (reply?.fallback && reply.context) return safeAnswer(reply.context, question);
    return reply;
  } catch {
    return {
      text: "The report assistant is unavailable right now, so I cannot answer from verified data. Please try again shortly.",
      confidence: null,
      confidenceReason: "The server could not build or answer from verified report data.",
      sources: [],
      supported: false,
    };
  }
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function initialMessages(A) {
  const e = A.suggestions?.[0] || "Summarise this report";
  if (A.propertyId) {
    return [
      {
        id: 0,
        role: "answer",
        text: "Ask about visibility, search intents, competitors, findings or recommendations. Answers come from verified RankScale measurements held in Supabase, state the reporting period and metric definition, and say so when something is not available.",
        confidence: null,
        confidenceReason: "Welcome message. Answers are generated from server-side verified data.",
        sources: [],
        supported: false,
      },
    ];
  }
  return [
    {
      id: 0,
      role: "answer",
      ...safeAnswer(A, e),
    },
  ];
}
function ConfidenceNote({ answer }) {
  const e =
    typeof answer.confidence == "number" && Number.isFinite(answer.confidence)
      ? Math.max(0, Math.min(100, Math.round(answer.confidence)))
      : null;
  return (
    <details
      className={`report-chat-confidence${e === null ? " is-unavailable" : e < 75 ? " is-limited" : ""}`}
    >
      <summary>
        <span className="report-chat-confidence-dot" aria-hidden="true" />
        {e === null ? "Not enough evidence" : `Confidence ${e}% \xB7 match`}
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </summary>
      <p>
        {answer.confidenceReason ||
          "Confidence reflects how closely the answer matches the report\u2019s evidence, not guaranteed accuracy."}
      </p>
    </details>
  );
}
function ThinkingState({ stage }) {
  return (
    <article className="report-chat-thinking" aria-label="Preparing report answer">
      <div className="report-chat-thinking-title">
        <AssistantMark variant="thinking" thinking />
        <strong>{stage === "sources" ? "Finding supporting sources\u2026" : "Thinking\u2026"}</strong>
        <span className="report-chat-thinking-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
      <p>Preparing an answer from this report</p>
      <div className="report-chat-loading-lines" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </article>
  );
}
function ReportChat({ context, onSource, onClose, focusInput, open }) {
  const o = useId(),
    a = useRef(null),
    r = useRef(null),
    l = useRef(1),
    s = useRef([]),
    c = useRef(null),
    [d, B] = useState(() => initialMessages(context)),
    [g, M] = useState(null),
    [h, U] = useState(""),
    [I, Q] = useState("");
  useEffect(
    () => () => {
      s.current.forEach(clearTimeout);
      c.current = null;
    },
    [],
  );
  useEffect(() => {
    open &&
      focusInput &&
      a.current?.focus({
        preventScroll: true,
      });
  }, [focusInput, open]);
  useEffect(() => {
    const E = r.current;
    if (E) {
      const u = E.lastElementChild;
      if (d.length === 1) {
        E.scrollTop = 0;
      } else if (u) {
        E.scrollTop += u.getBoundingClientRect().top - E.getBoundingClientRect().top - 16;
      }
    }
  }, [d, g]);
  function p(E) {
    const u = E.trim().slice(0, 500);
    if (!u || c.current !== null) {
      return;
    }
    const F = l.current++;
    c.current = F;
    B((m) => [
      ...m,
      {
        id: `question-${F}`,
        role: "question",
        text: u,
      },
    ]);
    M("thinking");
    U("");
    Q("Preparing an answer from this report.");
    s.current = [
      setTimeout(() => {
        if (c.current === F) {
          M("sources");
        }
      }, 600),
    ];
    Promise.all([askReport(context, u), wait(1400)]).then(([m]) => {
      if (c.current !== F) {
        return;
      }
      c.current = null;
      s.current = [];
      M(null);
      B((j) => [
        ...j,
        {
          id: `answer-${F}`,
          role: "answer",
          ...m,
        },
      ]);
      Q(
        `Answer ready. ${typeof m.confidence == "number" ? `Confidence ${Math.round(m.confidence)} percent.` : "Not enough report evidence."}`,
      );
    });
    a.current?.focus({
      preventScroll: true,
    });
  }
  function Y() {
    s.current.forEach(clearTimeout);
    s.current = [];
    c.current = null;
    M(null);
    B(initialMessages(context));
    U("");
    Q("Conversation cleared. Report summary restored.");
    a.current?.focus({
      preventScroll: true,
    });
  }
  return (
    <aside className="report-chat" hidden={!open} aria-labelledby={`${o}-title`}>
      <header className="report-chat-header">
        <AssistantMark />
        <div className="report-chat-heading">
          <h2 id={`${o}-title`}>Ask this report</h2>
          <p>{context.propertyId ? "Verified Supabase data" : "Local answers · report evidence"}</p>
        </div>
        <button
          type="button"
          className="report-chat-icon-button"
          aria-label="Collapse report chat"
          title="Collapse chat"
          onClick={onClose}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path d="M4 10h12" />
          </svg>
        </button>
      </header>
      <div className="report-chat-context" title={context.client?.name || "Current report"}>
        <span>{context.periodLabel}</span>
      </div>
      <div className="report-chat-tools">
        <details className="report-chat-about">
          <summary>
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="6.2" />
              <path d="M8 7v4M8 4.3v.5" />
            </svg>
            About confidence
          </summary>
          <p>
            Confidence reflects report-evidence matching, not guaranteed accuracy. Answers use this report’s
            saved findings and figures.
          </p>
        </details>
        <button
          type="button"
          className="report-chat-clear"
          onClick={Y}
          aria-label="Clear report conversation"
        >
          Clear
        </button>
      </div>
      <div
        ref={r}
        className="report-chat-messages"
        role="log"
        aria-label="Report conversation"
        aria-live="polite"
        aria-relevant="additions"
        aria-busy={!!g}
        tabIndex={0}
      >
        {d.map((E) => (
          <article
            key={E.id}
            className={`report-chat-message report-chat-${E.role}`}
            aria-label={E.role === "question" ? "Your question" : "Report answer"}
          >
            <span className="report-chat-message-label">
              {E.role === "question" ? (
                "You"
              ) : (
                <>
                  <AssistantMark variant="answer" />
                  {" Report answer"}
                </>
              )}
            </span>
            {E.role === "answer" && <ConfidenceNote answer={E} />}
            <div className="report-chat-message-text">
              {E.text}
              {E.role === "answer" && (
                <ReportCitations sources={E.sources} context={context} onSource={onSource} />
              )}
            </div>
          </article>
        ))}
        {g && <ThinkingState stage={g} />}
      </div>
      <div className="report-chat-suggestions" aria-label="Suggested report questions">
        {(context.suggestions || []).slice(1, 3).map((E) => (
          <button type="button" key={E} disabled={!!g} onClick={() => p(E)}>
            {E}
          </button>
        ))}
      </div>
      <form
        className="report-chat-composer"
        onSubmit={(E) => {
          E.preventDefault();
          p(h);
        }}
      >
        <label className="report-chat-sr-only" htmlFor={`${o}-question`}>
          Ask a question about this report
        </label>
        <div className="report-chat-input-wrap">
          <textarea
            ref={a}
            id={`${o}-question`}
            value={h}
            rows={2}
            maxLength={500}
            placeholder="What should we focus on next?"
            onChange={(E) => U(E.target.value)}
            onKeyDown={(E) => {
              if (E.key === "Enter" && !E.shiftKey && !E.nativeEvent.isComposing) {
                E.preventDefault();
                p(h);
              }
            }}
            aria-describedby={`${o}-hint`}
          />
          <button
            type="submit"
            className="report-chat-send"
            disabled={!h.trim() || !!g}
            aria-label={g ? "Preparing answer" : "Send question"}
            title={g ? "Preparing answer" : "Send question"}
          >
            {g ? (
              <span className="report-chat-send-spinner" aria-hidden="true" />
            ) : (
              <svg
                width="18"
                height="18"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M10 16V4m-5 5 5-5 5 5" />
              </svg>
            )}
          </button>
        </div>
        <p id={`${o}-hint`} className="report-chat-input-hint">
          Enter to send · Shift + Enter for a new line
        </p>
      </form>
      <span className="report-chat-sr-only" role="status">
        {I}
      </span>
    </aside>
  );
}
function ReportReader({ context, onSource, children }) {
  const [i, n] = useState(
      () => !!context && (typeof window > "u" || window.matchMedia("(min-width:1001px)").matches),
    ),
    [o, a] = useState(false),
    r = useRef(null),
    l = useRef(false);
  useEffect(() => {
    n(!!context && window.matchMedia("(min-width:1001px)").matches);
    a(false);
  }, [context?.key]);
  useEffect(() => {
    if (!i && l.current) {
      r.current?.focus({
        preventScroll: true,
      });
      l.current = false;
    }
  }, [i]);
  return (
    <div className={`report-reading-layout${context && i ? " has-report-chat" : ""}`}>
      {context && !i && (
        <button
          ref={r}
          type="button"
          className="report-chat-launcher"
          aria-expanded="false"
          onClick={() => {
            a(true);
            n(true);
          }}
        >
          <AssistantMark variant="launcher" />
          <span>Ask this report</span>
          <span className="report-chat-launcher-note">Answers with confidence scores</span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="m7 4 6 6-6 6" />
          </svg>
        </button>
      )}
      <div className="report-reading-content">{children}</div>
      {context && (
        <ReportChat
          key={context.key}
          context={context}
          onSource={onSource}
          focusInput={o}
          open={i}
          onClose={() => {
            l.current = true;
            n(false);
          }}
        />
      )}
    </div>
  );
}
export { ReportReader };
