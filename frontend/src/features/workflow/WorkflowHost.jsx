import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../../api/client";
import { PromptFrame } from "../prompt/PromptFrame";
import { promptSetupApi } from "../prompt/promptSetupApi";
import { RankscaleUpload } from "../rankscale/RankscaleUpload";
import { EvidenceDrawer } from "../review/EvidenceDrawer";
import { MonthlyReview } from "../review/MonthlyReview";
import { OutcomeLog } from "../review/OutcomeLog";
import { PhaseTwoGuide, StageRole } from "../review/PhaseTwoGuide";
import { resetReviewHistory } from "../review/reviewData";
import { ActionsReview, DiagnosisReview, FindingsReview } from "../review/ReviewStep";

// Workflow 2 review steps. 3–5 run in the team-review area; 6 saves the review.
const REVIEW_STEPS = [
  { title: "Upload data", hint: "Rankscale export", description: "Import the client's Rankscale file." },
  { title: "Confirm data", hint: "Review automated checks", description: "Check the matched data and resolve exceptions before reviewing the findings." },
  {
    title: "Review insights",
    hint: "Check what changed",
    description: "Auto alerts flag score drops. Review the AI-drafted findings and their supporting evidence, then approve, reject or edit.",
  },
  {
    title: "Review diagnosis",
    hint: "Check the possible cause",
    description: "Review the possible cause of each approved finding: content gap, competitor advantage or unclear. Approve, reject or edit the explanation.",
  },
  { title: "Approve actions", hint: "Match action to cause", description: "Review the recommendations linked to the approved explanation. Confirm the action, owner and due date." },
  {
    title: "Report & outcomes",
    hint: "Save & follow up",
    description: "Save the reviewed decisions and action plan. Follow up with before-and-after scores when new measurements are available.",
  },
];

function downloadReviewCsv(client, gates, reviewer, note) {
  const rows = [["Komosion GEO — monthly review"], ["Property", client?.property || client?.name || ""], ["Reviewer", reviewer], [], ["Type", "Title", "Decision", "Owner", "Due date", "Reviewer", "Reason", "Reviewed at"]];
  const kinds = [
    [3, "Finding"],
    [4, "Diagnosis"],
    [5, "Action"],
  ];
  for (const [step, label] of kinds) {
    for (const item of gates[step]?.approvedItems || []) rows.push([label, item.title, "Approved", item.owner || "", item.due_date || "", item.reviewed_by || "", item.review_reason || "", item.reviewed_at || ""]);
    for (const item of gates[step]?.rejectedItems || []) rows.push([label, item.title, "Rejected", "", "", item.reviewed_by || "", item.review_reason || "", item.reviewed_at || ""]);
  }
  rows.push([], ["Review history"], ["Type", "Item", "Event", "Reviewer", "Reason", "Recorded at"]);
  for (const [step, label] of kinds)
    for (const item of [...(gates[step]?.approvedItems || []), ...(gates[step]?.rejectedItems || [])])
      for (const event of item.review_history || []) rows.push([label, item.title, event.decision, event.reviewer, event.reason || "", event.at]);
  rows.push([], ["Check next month", note]);
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "Komosion-monthly-review.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ReviewSummary({ client, gates, reviewer, finished, note, setNote, onOpenReports, onOpenLibrary }) {
  const [report, setReport] = useState(null);
  useEffect(() => {
    if (client?.id) apiFetch(`/api/report/${client.id}`).then(setReport).catch(() => setReport(null));
  }, [client?.id]);
  const actions = (gates[5]?.approvedItems || []).filter((item) => item.status === "approved");
  const findings = gates[3]?.approvedItems || [];
  const diagnoses = gates[4]?.approvedItems || [];
  return (
    <div className="guided-report-summary">
      {finished && (
        <div className="guided-complete-banner" role="status">
          <strong>Monthly review complete</strong>
          <p>Your approved decisions are saved with your account name. Open Reports for the complete performance dashboard.</p>
          <div className="workspace-button-row">
            <button className="guided-primary" onClick={onOpenReports}>
              Open full report
            </button>
            <button className="guided-secondary" onClick={onOpenLibrary}>
              View saved data
            </button>
          </div>
        </div>
      )}
      <section className="guided-report-card">
        <div className="guided-section-heading">
          <div>
            <h2>Review summary</h2>
            <p>
              {"Reviewed by "}
              {reviewer || "you"}
              {` \xB7 ${client?.name || "Selected client"}`}
            </p>
          </div>
          <button className="guided-secondary guided-export" onClick={() => downloadReviewCsv(client, gates, reviewer, note)}>
            Download review
          </button>
        </div>
        <div className="guided-report-metrics">
          {[
            [findings.length, "Approved insights"],
            [diagnoses.length, "Approved diagnoses"],
            [actions.length, "Approved actions"],
          ].map(([value, label]) => (
            <div key={label}>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="guided-report-card">
        <div className="guided-section-heading">
          <h2>Your action plan</h2>
          <span>Approved actions only</span>
        </div>
        {actions.length ? (
          <div className="guided-report-actions">
            {actions.map((action) => (
              <article key={action.recommendation_id}>
                <div>
                  <span className="guided-eyebrow">
                    {action.priority}
                    {" priority \xB7 "}
                    {action.lens}
                  </span>
                  <h3>{action.title}</h3>
                  <p>{action.expected_impact}</p>
                </div>
                <div>
                  <strong>{action.owner}</strong>
                  <span>
                    {"Due "}
                    {action.due_date}
                  </span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="guided-muted">No new actions were approved in this review. Use your monitoring note to guide the next cycle.</p>
        )}
      </section>
      <OutcomeLog approvedActions={actions} historicalOutcomes={report?.outcomes || []} />
      <section className="guided-report-card">
        <label className="guided-field" htmlFor="next-month-note">
          <strong>What should we check next month?</strong>
          <textarea
            id="next-month-note"
            rows="3"
            placeholder={"For example: after publishing the approved celebrations page, compare Romance & Events visibility with this period and record the new score."}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </section>
      {report?.overall && (
        <details className="guided-details">
          <summary>View performance context</summary>
          <p className="guided-preview-note">Monthly metrics for this client from the saved measurements.</p>
          <div className="guided-report-metrics">
            {report.overall.slice(0, 3).map((metric) => (
              <div key={metric.metric}>
                <strong>
                  {metric.current}
                  {metric.metric === "detection" ? "%" : ""}
                </strong>
                <span>{{ visibility: "Visibility score", detection: "Detection rate", position: "Average position" }[metric.metric]}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * Phase 1 (Prompt wizard), Phase 2 (Rankscale upload) and the Workflow 2 team review:
 *   insights → diagnosis → actions in the "monthly" area, then the summary saves the review.
 * Each review step reports a gate ({ ready, pending, approvedIds, approvedItems, revisionKey, … });
 * a step unlocks once the previous one has a decision for every item.
 */
function WorkflowHost({
  account,
  selectedClient,
  onCreateClient,
  clientCreateRequest = 0,
  promptImportRequest = 0,
  phase,
  onPhaseChange,
  onContextChange,
  onSetupComplete,
  onPromptSource,
  onReviewComplete,
  onOpenReports,
  onOpenRankscaleDashboard,
  onOpenLibrary,
  newMonthlyRun,
  workspaceArea = "workflow",
  monthlySection = "alerts",
  onNavigateMonthly,
  onOpenWorkflow,
  onReviewCounts,
}) {
  const [step, setStep] = useState(3);
  const [mode, setMode] = useState("rankscale"); // rankscale upload | review summary
  const [unlocked, setUnlocked] = useState(3);
  const [gates, setGates] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [runKeys, setRunKeys] = useState({ run: 0, diagnosis: 0, action: 0 });
  const [detail, setDetail] = useState(null);
  const [reviewTab, setReviewTab] = useState("findings");
  const [finished, setFinished] = useState(false);
  const [note, setNote] = useState("");
  const revisionKeys = useRef({});
  const histories = useRef({});
  const headingRef = useRef(null);
  const reviewer = account?.name || "";
  const inMonthly = workspaceArea === "monthly" && monthlySection !== "client";
  const inWorkflow = workspaceArea === "workflow";
  const propertyId = selectedClient?.id || "";
  const datasetReady = !!(propertyId && selectedClient?.hasMeasurements);
  const findingsReady = datasetReady && !!gates[3]?.ready;
  const diagnosesReady = findingsReady && !!gates[4]?.ready;

  useEffect(() => {
    if (inWorkflow && phase === 2) {
      window.scrollTo(0, 0);
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [phase, step, inWorkflow]);

  // a new client or a fresh upload starts a fresh review
  useEffect(() => {
    resetReviewHistory();
    revisionKeys.current = {};
    histories.current = {};
    setGates({});
    setUnlocked(3);
    setStep(3);
    setReviewTab("findings");
    setFinished(false);
    setNote("");
    setError("");
    setRunKeys((keys) => ({ run: keys.run + 1, diagnosis: 0, action: 0 }));
  }, [propertyId, newMonthlyRun]);

  useEffect(() => {
    if (newMonthlyRun) setMode("rankscale");
  }, [newMonthlyRun]);

  const updateGate = useCallback((stage, gate) => {
    if (stage >= 3 && gate.revisionKey === undefined) {
      setGates((all) => ({ ...all, [stage]: all[stage] ? { ...all[stage], ready: false, summary: gate.summary } : gate }));
      return;
    }
    if (gate.revisionKey !== undefined) {
      const history = JSON.stringify(gate.history || []);
      if (histories.current[stage] !== undefined && histories.current[stage] !== history) setFinished(false);
      histories.current[stage] = history;
      const previous = revisionKeys.current[stage];
      revisionKeys.current[stage] = gate.revisionKey;
      if (previous !== undefined && previous !== gate.revisionKey) {
        // an earlier decision changed: later steps must be reviewed again
        setFinished(false);
        setStep((current) => Math.min(current, stage));
        setUnlocked((current) => Math.min(current, stage));
        if (stage === 3) {
          setReviewTab("findings");
          resetReviewHistory(["diagnosis", "action"]);
          delete revisionKeys.current[4];
          delete revisionKeys.current[5];
          setRunKeys((keys) => ({ ...keys, diagnosis: keys.diagnosis + 1, action: keys.action + 1 }));
        } else if (stage === 4) {
          resetReviewHistory("action");
          delete revisionKeys.current[5];
          setRunKeys((keys) => ({ ...keys, action: keys.action + 1 }));
        }
        setGates((all) => Object.fromEntries(Object.entries(all).filter(([key]) => Number(key) <= stage)));
      }
    }
    setGates((all) => ({ ...all, [stage]: gate }));
  }, []);
  const onFindingsGate = useCallback((gate) => updateGate(3, gate), [updateGate]);
  const onDiagnosisGate = useCallback((gate) => updateGate(4, gate), [updateGate]);
  const onActionsGate = useCallback((gate) => updateGate(5, gate), [updateGate]);

  useEffect(() => {
    onReviewCounts?.({
      alerts: datasetReady ? (gates[3]?.pending || 0) + (gates[4]?.pending || 0) : 0,
      recommendations: (diagnosesReady && gates[5]?.pending) || 0,
    });
  }, [datasetReady, diagnosesReady, gates[3]?.pending, gates[4]?.pending, gates[5]?.pending, onReviewCounts]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!inMonthly) return;
    if (monthlySection === "recommendations" && diagnosesReady) setUnlocked((value) => Math.max(value, 5));
    if (reviewTab === "diagnosis" && findingsReady) setUnlocked((value) => Math.max(value, 4));
  }, [inMonthly, monthlySection, reviewTab, findingsReady, diagnosesReady]);

  function changeReviewTab(tab) {
    setReviewTab(tab === "diagnosis" && !findingsReady ? "findings" : tab);
    if (tab === "diagnosis" && findingsReady) setUnlocked((value) => Math.max(value, 4));
  }

  function openSummary() {
    setMode("review");
    onOpenWorkflow?.();
    onPhaseChange(2);
  }

  function advanceMonthly() {
    if (monthlySection === "recommendations") {
      if (!diagnosesReady || !gates[5]?.ready) return;
      setUnlocked((value) => Math.max(value, 6));
      setStep(6);
      openSummary();
    } else if (reviewTab === "diagnosis") {
      if (!diagnosesReady) return;
      setUnlocked((value) => Math.max(value, 5));
      onNavigateMonthly?.("recommendations");
    } else if (findingsReady) {
      changeReviewTab("diagnosis");
    }
    window.scrollTo(0, 0);
  }

  async function completeReview() {
    if (busy) return;
    const allReady = [3, 4, 5].every((stage) => gates[stage]?.ready);
    if (!reviewer || !allReady || finished) {
      setError("Complete the required human review before continuing.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onReviewComplete?.({ gates: structuredClone(gates), reviewer, note, clientId: propertyId, completedAt: new Date().toISOString() });
      setFinished(true);
    } catch (failure) {
      setError(failure.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const summaryReady = !!reviewer && [3, 4, 5].every((stage) => gates[stage]?.ready);
  const currentStage = inMonthly ? (monthlySection === "recommendations" ? 5 : reviewTab === "diagnosis" ? 4 : 3) : step;
  const reviewSteps = (
    <>
      {unlocked >= 3 && datasetReady && (
        <section hidden={currentStage !== 3}>
          <FindingsReview key={`findings-${propertyId}-${runKeys.run}`} presentation={inMonthly ? "cards" : "queue"} propertyId={propertyId} reviewer={reviewer} onGateChange={onFindingsGate} onOpenDetail={setDetail} />
        </section>
      )}
      {unlocked >= 4 && datasetReady && (
        <section hidden={currentStage !== 4}>
          <DiagnosisReview
            key={`diagnoses-${propertyId}-${runKeys.run}-${runKeys.diagnosis}`}
            presentation={inMonthly ? "cards" : "queue"}
            propertyId={propertyId}
            reviewer={reviewer}
            approvedFindingIds={gates[3]?.approvedIds || []}
            onGateChange={onDiagnosisGate}
            onOpenDetail={setDetail}
          />
        </section>
      )}
      {unlocked >= 5 && datasetReady && (
        <section hidden={currentStage !== 5}>
          <ActionsReview
            key={`actions-${propertyId}-${runKeys.run}-${runKeys.action}`}
            presentation={inMonthly ? "cards" : "queue"}
            propertyId={propertyId}
            reviewer={reviewer}
            approvedDiagnosisIds={gates[4]?.approvedIds || []}
            onGateChange={onActionsGate}
            onOpenDetail={setDetail}
          />
        </section>
      )}
    </>
  );
  const monthlyStage = monthlySection === "recommendations" ? 5 : reviewTab === "diagnosis" ? 4 : 3;
  const monthlyCanAdvance = monthlyStage === 3 ? findingsReady : monthlyStage === 4 ? diagnosesReady : diagnosesReady && gates[5]?.ready;

  return (
    <>
      <PromptFrame
        hidden={!inWorkflow || phase !== 1}
        api={promptSetupApi}
        client={selectedClient}
        account={account}
        openTranscriptRequest={promptImportRequest}
        createClientRequest={clientCreateRequest}
        onCreateClient={onCreateClient}
        onContextChange={onContextChange}
        onSourceFile={onPromptSource}
        onComplete={onSetupComplete}
      />
      {inWorkflow && phase === 2 && mode === "rankscale" && (
        <RankscaleUpload key={`${propertyId || "none"}-${newMonthlyRun}`} client={selectedClient} reviewer={reviewer} onOpenDashboard={onOpenRankscaleDashboard} />
      )}
      <div className="guided-shell" hidden={!inWorkflow || phase !== 2 || mode !== "review"}>
        <main className="guided-container guided-main">
          <div className="guided-page-heading">
            <div>
              <span className="guided-eyebrow">02 Rankscale · Team review</span>
              <h1 ref={headingRef} tabIndex="-1">
                {REVIEW_STEPS[step - 1].title}
              </h1>
              {step > 1 && <StageRole step={step} />}
              <p>{REVIEW_STEPS[step - 1].description}</p>
            </div>
          </div>
          <PhaseTwoGuide />
          {error && (
            <p role="alert" className="guided-alert">
              {error}
            </p>
          )}
          {!inMonthly && step < 6 && reviewSteps}
          {step === 6 && (
            <ReviewSummary
              client={selectedClient}
              onOpenReports={onOpenReports}
              onOpenLibrary={onOpenLibrary}
              gates={gates}
              reviewer={reviewer}
              finished={finished}
              note={note}
              setNote={(value) => {
                setNote(value);
                setFinished(false);
              }}
            />
          )}
        </main>
        <footer className="guided-footer">
          <div className="guided-container guided-footer-inner">
            <button className="guided-secondary" onClick={() => onNavigateMonthly?.("recommendations")}>
              Back
            </button>
            <div className="guided-footer-next">
              <span role="status">{finished ? "Review complete" : summaryReady ? "Your approved decisions are ready" : "Complete all required review decisions"}</span>
              <button className="guided-primary" disabled={!summaryReady || busy || finished} onClick={completeReview}>
                {busy ? "Working…" : finished ? "Review completed" : "Complete review & open report"}
                {!finished && <span aria-hidden="true">{" →"}</span>}
              </button>
            </div>
          </div>
        </footer>
      </div>
      {inMonthly && (
        <MonthlyReview
          section={monthlySection}
          selectedClient={selectedClient}
          reviewer={reviewer}
          account={account}
          datasetReady={datasetReady}
          findingsReady={findingsReady}
          recommendationsReady={diagnosesReady}
          onUpload={() => {
            onOpenWorkflow?.();
            onPhaseChange(2);
            setMode("rankscale");
          }}
          onNavigate={onNavigateMonthly}
          reviewTab={reviewTab}
          onReviewTabChange={changeReviewTab}
          approvedFindingCount={gates[3]?.approvedIds?.length || 0}
          approvedDiagnosisCount={gates[4]?.approvedIds?.length || 0}
          pendingCounts={{ findings: gates[3]?.pending || 0, diagnoses: gates[4]?.pending || 0, actions: gates[5]?.pending || 0 }}
          reviewContent={
            <>
              {reviewSteps}
              <div className="mw-stage-footer">
                <p role="status">{gates[monthlyStage]?.summary || "Preparing review items…"}</p>
                <button type="button" className="guided-primary" disabled={!monthlyCanAdvance || busy} onClick={advanceMonthly}>
                  {monthlyStage === 3 ? "Review diagnosis" : monthlyStage === 4 ? "Review recommendations" : "Review summary & finish"} <span aria-hidden="true">→</span>
                </button>
              </div>
            </>
          }
        />
      )}
      {detail && <EvidenceDrawer item={detail} onClose={() => setDetail(null)} />}
    </>
  );
}
export { WorkflowHost };
