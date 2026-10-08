const WORKFLOW_GROUPS = [
  {
    id: "prompt",
    label: "Prompt",
  },
  {
    id: "rankscale",
    label: "Rankscale",
  },
];
function WorkflowIcon({ kind }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "prompt" ? (
        <path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6" />
      ) : (
        <>
          <rect x="4" y="4" width="16" height="16" rx="1" />
          <path d="M8 15v-4m4 4V8m4 7v-6" />
        </>
      )}
    </svg>
  );
}
function WorkflowSwitch({ activeGroup, onPromptUpload, onRankscaleUpload }) {
  return (
    <nav className="workspace-workflow-switch" aria-label="Choose workflow">
      {WORKFLOW_GROUPS.map((i) => (
        <button
          type="button"
          key={i.id}
          aria-current={activeGroup === i.id ? "page" : undefined}
          onClick={i.id === "prompt" ? onPromptUpload : onRankscaleUpload}
        >
          <WorkflowIcon kind={i.id} />
          <span>{i.label}</span>
        </button>
      ))}
    </nav>
  );
}
export { WorkflowSwitch };
function RankscaleSteps({ activeStep, onUpload, onReport }) {
  return (
    <nav className="rankscale-steps-band" aria-label="Rankscale steps">
      <ol className="rankscale-steps">
        {[
          {
            number: 1,
            label: "Upload",
            hint: "Import your data",
            action: onUpload,
          },
          {
            number: 2,
            label: "Report",
            hint: "View insights & recommendations",
            action: onReport,
          },
        ].map((n) => (
          <li key={n.number}>
            <button
              type="button"
              aria-current={activeStep === n.number ? "step" : undefined}
              onClick={n.action}
            >
              <span className="rankscale-step-number">{n.number}</span>
              <span className="rankscale-step-copy">
                <span className="rankscale-step-label">{n.label}</span>
                <span className="rankscale-step-hint">{n.hint}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
export { RankscaleSteps };
