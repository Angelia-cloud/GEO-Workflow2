const PHASE_TWO_STAGES = [
  {
    title: "Measurements & checks",
    role: "Automated",
    kind: "automated",
    description: "Validate the data and compare scores with the previous period.",
    output: "Auto alerts flag sharp score drops for review.",
  },
  {
    title: "Insights",
    role: "AI draft + human review",
    kind: "agent",
    description: "Check that there is enough supporting evidence, then turn score changes into findings.",
    output: "You approve, reject or edit each finding.",
  },
  {
    title: "Diagnosis",
    role: "AI draft + human review",
    kind: "agent",
    description: "Consider a content gap, competitor advantage or an unclear cause.",
    output: "You check the explanation before it becomes an action.",
  },
  {
    title: "Recommendations",
    role: "AI draft + human review",
    kind: "agent",
    description: "Match the reviewed cause to a content brief, competitor plan or deeper investigation.",
    output: "You approve or edit the action, owner and due date.",
  },
  {
    title: "Report & outcomes",
    role: "Human-led",
    kind: "human",
    description: "Save the reviewed findings, decisions and next actions.",
    output: "Compare before and after scores when the next measurements arrive.",
  },
];
function StageRole({ step }) {
  const e =
    step === 1
      ? "You upload the measurements"
      : step === 2
        ? "Automated checks \xB7 You confirm the data"
        : step === 6
          ? "Human-led reporting & follow-up"
          : "AI proposes \xB7 You review and approve";
  return (
    <p
      className={`phase-two-role ${step >= 3 && step <= 5 ? "is-agent" : step === 2 ? "is-automated" : "is-human"}`}
    >
      {e}
    </p>
  );
}
export { StageRole };
function PhaseTwoGuide() {
  return (
    <details className="phase-two-guide">
      <summary>
        {"How Phase 2 works "}
        <span>From measurements to reviewed actions</span>
      </summary>
      <div className="phase-two-guide-body">
        <ol aria-label="Phase 2 responsibilities">
          {PHASE_TWO_STAGES.map((A, e) => (
            <li key={A.title} className={`phase-two-stage is-${A.kind}`}>
              <span className="phase-two-stage-role">{A.role}</span>
              <h3>
                <span>{String(e + 1).padStart(2, "0")}</span>
                {A.title}
              </h3>
              <p>{A.description}</p>
              <p className={e === 0 ? "phase-two-alert-note" : "phase-two-human-note"}>{A.output}</p>
            </li>
          ))}
        </ol>
        <p className="phase-two-feedback">
          <strong>Your corrections stay in the review history.</strong>
          {
            " Edits, rejections and reasons give the next review context. Approve records your decision directly."
          }
        </p>
        <p className="phase-two-preview">
          Findings come from the auto alerts on the loaded measurements; explanations and actions are drafted by
          the diagnosis and recommendation agents and saved only after your decision.
        </p>
      </div>
    </details>
  );
}
export { PhaseTwoGuide };
