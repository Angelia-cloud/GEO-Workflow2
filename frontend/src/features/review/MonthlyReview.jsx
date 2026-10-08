const reviewerName = (reviewer, account) => account?.name || (typeof reviewer == "string" ? reviewer : reviewer?.name) || "";
const firstNumber = (values, ...keys) => {
  for (const key of keys) if (typeof values[key] == "number") return values[key];
  return null;
};

/**
 * Team review area (Workflow 2): insights & alerts, possible explanations (diagnoses) and recommendations
 * for the selected client. Available once the client's Rankscale export has been loaded as measurements.
 */
function MonthlyReview({
  section = "alerts",
  selectedClient,
  reviewer,
  account,
  datasetReady = false,
  findingsReady = false,
  recommendationsReady = false,
  onUpload,
  onNavigate,
  reviewContent,
  pendingCounts = {},
  reviewTab = "findings",
  onReviewTabChange,
}) {
  const client = selectedClient || { name: "Select a client" };
  const view = section === "recommendations" ? "recommendations" : "alerts";
  const tab = ["diagnosis", "diagnoses"].includes(reviewTab) ? "diagnosis" : "findings";
  const name = reviewerName(reviewer, account);
  const pendingFindings = firstNumber(pendingCounts, "findings", "finding", "alerts");
  const pendingDiagnoses = firstNumber(pendingCounts, "diagnoses", "diagnosis");
  const recommendationsLocked = datasetReady && view === "recommendations" && !recommendationsReady;

  function reviewDiagnosis() {
    onNavigate?.("alerts");
    onReviewTabChange?.("diagnosis");
  }

  return (
    <section className={`monthly-workflow${datasetReady ? " is-ready" : ""}`} aria-label="Human-in-the-loop monthly review">
      <header className="mw-page-heading">
        <span className="mw-eyebrow">Monthly workflow · Human-in-the-loop review</span>
        <h1>{view === "alerts" ? "Alerts & Diagnosis" : "Recommendations"}</h1>
        <p>
          {datasetReady ? (
            <>
              {view === "alerts" ? "Check the finding, then its explanation." : "Review each action and assign an owner and due date."}
              <span className="mw-data-label">{client.name}</span>
            </>
          ) : (
            client.name
          )}
        </p>
      </header>
      {datasetReady ? (
        <>
          {view === "alerts" && onReviewTabChange && (
            <div className="mw-review-tabs" aria-label="Alert and diagnosis review">
              <button type="button" className={tab === "findings" ? "is-active" : ""} aria-pressed={tab === "findings"} onClick={() => onReviewTabChange("findings")}>
                {"Insights & alerts"}
                {pendingFindings !== null && (
                  <span>
                    {pendingFindings}
                    {" pending"}
                  </span>
                )}
              </button>
              <button
                type="button"
                className={tab === "diagnosis" ? "is-active" : ""}
                aria-pressed={tab === "diagnosis"}
                disabled={!findingsReady}
                onClick={() => onReviewTabChange("diagnosis")}
              >
                Possible explanations
                {pendingDiagnoses !== null && (
                  <span>
                    {pendingDiagnoses}
                    {" pending"}
                  </span>
                )}
              </button>
            </div>
          )}
          {recommendationsLocked && (
            <div className="mw-locked-note">
              <div>
                <span className="mw-lock-state">Diagnosis review must be completed</span>
                <h2>Review the explanation before choosing an action</h2>
                <p>
                  {
                    "Review the explanations in Insights & explanations. Recommendations related to approved diagnoses will then be available; rejected diagnoses create no actions."
                  }
                </p>
              </div>
              <button className="mw-primary" type="button" onClick={reviewDiagnosis}>
                Review diagnosis
              </button>
            </div>
          )}
          <div className="mw-review-content" hidden={recommendationsLocked}>
            {reviewContent || (
              <p className="mw-loading" role="status">
                Preparing the shared review workspace…
              </p>
            )}
          </div>
        </>
      ) : (
        <div className="mw-empty">
          <span className="mw-eyebrow">No monthly workflow data</span>
          <h2>{client.name}</h2>
          <p>
            {name ? `${name}, there` : "There"} is no monthly review data for this client yet. Upload the client’s full Rankscale export: its
            answers are loaded as measurements, auto alerts run, and the insights appear here for review.
          </p>
          {onUpload && (
            <button className="mw-secondary" type="button" onClick={onUpload}>
              Upload Rankscale data
            </button>
          )}
        </div>
      )}
    </section>
  );
}
export { MonthlyReview };
