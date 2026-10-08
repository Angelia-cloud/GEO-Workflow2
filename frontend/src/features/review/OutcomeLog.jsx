const toNumber = (A) => (A == null || A === "" || !Number.isFinite(Number(A)) ? null : Number(A)),
  fmtOutcome = (A) =>
    toNumber(A) == null
      ? "Not recorded"
      : toNumber(A).toLocaleString("en-AU", {
          maximumFractionDigits: 2,
        }),
  actionTitle = (A) => A.title || A.detail || "Approved action";
function OutcomeLog({ approvedActions = [], historicalOutcomes = [] }) {
  const t = approvedActions.filter((i) => i.status === "approved");
  return (
    <section className="outcome-log" aria-label="Outcome log">
      <header>
        <div>
          <h3>Outcome log</h3>
          <p>
            After an action is completed, compare its before and after scores using the same metric and prompt
            set.
          </p>
        </div>
        <span className="outcome-role">Human follow-up</span>
      </header>
      <div className="outcome-current">
        <h4>Next measurement</h4>
        {t.length ? (
          <div className="outcome-items">
            {t.map((i, n) => (
              <article key={i.recommendation_id || i.id || n}>
                <div className="outcome-action">
                  <strong>{actionTitle(i)}</strong>
                  <p>
                    {i.owner || "Owner not assigned"}
                    {i.due_date ? ` \xB7 Due ${i.due_date}` : ""}
                  </p>
                </div>
                <dl className="outcome-scores">
                  <div>
                    <dt>Before visibility</dt>
                    <dd>
                      {toNumber(i.before_visibility) == null
                        ? "To record at implementation"
                        : fmtOutcome(i.before_visibility)}
                    </dd>
                  </div>
                  <div>
                    <dt>After visibility</dt>
                    <dd className="outcome-pending">Awaiting next measurement</dd>
                  </div>
                </dl>
                <p className="outcome-status">Approved · Implementation and outcome not yet recorded</p>
              </article>
            ))}
          </div>
        ) : (
          <p className="outcome-empty">
            Approved actions will appear here for follow-up. No new action has been approved in this report.
          </p>
        )}
      </div>
      {historicalOutcomes.length > 0 && (
        <details className="outcome-history">
          <summary>Earlier outcomes · Before and after visibility</summary>
          <p className="outcome-history-note">
            Outcomes recorded for actions completed in earlier reviews. They do not measure the effect of the
            current review.
          </p>
          {historicalOutcomes.map((i, n) => {
            const o = toNumber(i.before_visibility),
              a = toNumber(i.after_visibility),
              r = o != null && a != null ? a - o : null;
            return (
              <article key={i.recommendation_id || i.id || n}>
                <div className="outcome-action">
                  <strong>{actionTitle(i).replace(/^Sample:\s*/, "")}</strong>
                  <p>
                    {i.intent}
                    {i.done_on ? ` \xB7 Completed ${i.done_on}` : ""}
                                      </p>
                </div>
                <dl className="outcome-scores">
                  <div>
                    <dt>Before visibility</dt>
                    <dd>{fmtOutcome(i.before_visibility)}</dd>
                  </div>
                  <div>
                    <dt>After visibility</dt>
                    <dd>{fmtOutcome(i.after_visibility)}</dd>
                  </div>
                  <div>
                    <dt>Observed change</dt>
                    <dd>
                      {r == null
                        ? "Awaiting measurement"
                        : `${r > 0 ? "+" : ""}${r.toLocaleString("en-AU", {
                            maximumFractionDigits: 2,
                          })} points`}
                    </dd>
                  </div>
                </dl>
              </article>
            );
          })}
          <p className="outcome-history-note">
            A score change alone does not establish that the action caused it.
          </p>
        </details>
      )}
    </section>
  );
}
export { OutcomeLog };
