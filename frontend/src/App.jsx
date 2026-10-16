import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "./api/client";
import { komosionLogo } from "./assets/index";
import { initialsOf, rememberAccount, restoreAccount } from "./features/auth/account";
import { LoginPage } from "./features/auth/LoginPage";
import { ClientPicker } from "./features/clients/ClientPicker";
import { coogeeClient, createClient, isCoogee, listClients, loadClients, resolveClient, updateClient } from "./features/clients/clients";
import { LibraryPage } from "./features/library/LibraryPage";
import { listLibrary, saveLibraryEntry, saveSourceFile } from "./features/library/libraryStore";
import { PromptExports } from "./features/prompt/PromptExports";
import { REPORT_SECTIONS, ReportHub } from "./features/reports/ReportHub";
import { ReportSetupPage } from "./features/settings/ReportSetupPage";
import { SettingsButton, SettingsPage } from "./features/settings/SettingsPage";
import { WorkflowHost } from "./features/workflow/WorkflowHost";
import { RankscaleSteps, WorkflowSwitch } from "./features/workflow/WorkflowNav";
import { setWorkspaceSetting } from "./lib/workspaceSettings";

const uniqueId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PROMPT_SETUP_CLIENT_KEY = "geo.promptSetup.clientId";
const REVIEW_TABS = [
  ["alerts", "Insights & explanations"],
  ["recommendations", "Recommendations"],
];

/**
 * Workspace shell: header (client picker, Prompt / Rankscale switch, settings, account) and the areas
 *   workflow  – Phase 1 Prompt wizard or Phase 2 Rankscale upload
 *   reports   – client report for the selected client and dates
 *   monthly   – team review of insights, diagnoses and recommendations (Workflow 2)
 *   settings / library – Settings → Imports (saved files)
 *   exports   – Prompt CSV exports
 */
function App() {
  const [account, setAccount] = useState(restoreAccount);
  const [area, setArea] = useState("workflow");
  const [reportSection, setReportSection] = useState("client");
  const [overviewSource, setOverviewSource] = useState("rankscale");
  const [monthlySection, setMonthlySection] = useState("alerts");
  const [reviewCounts, setReviewCounts] = useState({ alerts: 0, recommendations: 0 });
  const [selectedClient, setSelectedClient] = useState(null);
  const [uploadedClientIds, setUploadedClientIds] = useState([]);
  const [clientCreateRequest, setClientCreateRequest] = useState(0);
  const [promptImportRequest, setPromptImportRequest] = useState(0);
  const [phase, setPhase] = useState(1);
  const [libraryEntries, setLibraryEntries] = useState([]);
  const [clients, setClients] = useState(listClients);
  const [toast, setToast] = useState("");
  const [libraryPhase, setLibraryPhase] = useState(1);
  const [libraryKey, setLibraryKey] = useState(0);
  const [reportRequest, setReportRequest] = useState(null);
  const [newMonthlyRun, setNewMonthlyRun] = useState(0);
  const savingSetup = useRef(false);
  const pendingBrief = useRef(null);
  const briefTimer = useRef(null);

  const refreshLibrary = useCallback(async () => {
    const entries = await listLibrary();
    setLibraryEntries(entries);
    return entries;
  }, []);

  useEffect(() => {
    if (!account) return;
    loadClients()
      .then(setClients)
      .catch((error) => setToast(`Clients could not be loaded. ${error.message}`));
    refreshLibrary().catch(() => setToast("Saved files could not be loaded. Please try again."));
  }, [account, refreshLibrary]);

  useEffect(() => {
    if (area === "workflow" && phase === 1 && selectedClient?.id) {
      window.localStorage.setItem(PROMPT_SETUP_CLIENT_KEY, String(selectedClient.id));
    }
  }, [area, phase, selectedClient?.id]);

  useEffect(() => {
    if (account) setWorkspaceSetting("geo.reviewer", account.name);
  }, [account]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [area, phase]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(""), 6500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onChange = () => refreshLibrary().catch(() => setToast("Unable to refresh saved files. Please try again."));
    window.addEventListener("komosion:library-change", onChange);
    return () => window.removeEventListener("komosion:library-change", onChange);
  }, [refreshLibrary]);

  function signIn(chosen) {
    rememberAccount(chosen);
    setAccount(chosen);
  }

  function signOut() {
    rememberAccount(null);
    window.localStorage.removeItem(PROMPT_SETUP_CLIENT_KEY);
    if (selectedClient?.id) window.localStorage.removeItem(`geo.promptSetup.run.${selectedClient.id}`);
    setAccount(null);
    setToast("");
    setArea("workflow");
    setPhase(1);
    setSelectedClient(null);
    setClientCreateRequest(0);
  }

  const defaultClient = () => listClients()[0] || null;

  // Phase 1 keeps the client's brief (audience, goals) in sync with the client record.
  const onContextChange = useCallback((context) => {
    if (context.clientId === "" && !context.client && !context.property) {
      setSelectedClient(null);
      return;
    }
    const client = resolveClient({ clientId: context.clientId, client: context.client, property: context.property });
    if (!client) return;
    const next = {
      ...client,
      ...(typeof context.targetAudience == "string" ? { targetAudience: context.targetAudience } : {}),
      ...(typeof context.goals == "string" ? { goals: context.goals } : {}),
    };
    pendingBrief.current = next;
    clearTimeout(briefTimer.current);
    briefTimer.current = setTimeout(() => {
      const brief = pendingBrief.current;
      if (brief?.id) updateClient(brief.id, brief).then((saved) => saved && setClients(listClients())).catch(() => null);
    }, 700);
    setSelectedClient((current) =>
      current?.id === next.id && current?.name === next.name && current?.property === next.property && current?.targetAudience === next.targetAudience && current?.goals === next.goals
        ? current
        : { ...(current?.id === next.id ? current : {}), ...next },
    );
  }, []);

  const openLibrary = useCallback((libraryPhaseToShow = 2) => {
    setLibraryPhase(libraryPhaseToShow === 1 ? 1 : 2);
    setLibraryKey((value) => value + 1);
    setArea("library");
  }, []);

  const saveReport = useCallback(
    async (report) => {
      const saved = await saveLibraryEntry({
        id: `rankscale-report-${report.client.id}-${report.period.from}-${report.period.to}`,
        type: "report",
        source: "rankscale",
        clientId: String(report.client.id),
        client: report.client.name,
        property: report.client.property || report.client.name,
        title: `${report.client.name} — ${report.period.from} to ${report.period.to}`,
        status: "generated",
        createdAt: new Date().toISOString(),
        createdBy: account?.name,
        period: report.period,
        summary: report.summary,
        generatedReport: report,
      });
      await refreshLibrary();
      return saved;
    },
    [account, refreshLibrary],
  );

  // After an upload (or "View report"): Coogee opens its prepared September report, other clients get
  // a report built from their saved records.
  const openRankscaleReport = useCallback(
    async (upload) => {
      let client = selectedClient || defaultClient();
      if (upload?.summary) {
        if (client?.id) setUploadedClientIds((ids) => (ids.includes(client.id) ? ids : [...ids, client.id]));
        // An upload loads the records as measurements; refresh so the team review becomes available.
        void refreshLibrary().catch(() => null); // the upload is now in the import history
        const clientId = client?.id;
        void loadClients()
          .then((fresh) => {
            setClients(fresh);
            const updated = fresh.find((item) => item.id === clientId);
            if (updated) setSelectedClient((current) => (current?.id === clientId ? updated : current));
          })
          .catch((error) =>
            setToast(`Upload saved, but client status could not be refreshed. ${error.message}`),
          );
      }
      if (client && isCoogee(client)) {
        setSelectedClient(client);
        setReportRequest(null);
        setReportSection("client");
        setOverviewSource("rankscale");
        setArea("reports");
        if (upload?.summary) setToast("Upload complete. The monthly report has been updated.");
        window.scrollTo(0, 0);
        return;
      }
      setReportRequest(null);
      if (upload?.summary) setToast("Upload complete. The report has been updated.");
      setReportSection("client");
      setOverviewSource("rankscale");
      setArea("reports");
      window.scrollTo(0, 0);
    },
    [selectedClient, refreshLibrary],
  );

  function openReportRequest(request) {
    setReportRequest(request);
    setOverviewSource(request.source === "prepared" && isCoogee(selectedClient) ? "prepared" : "rankscale");
    setReportSection("client");
    setArea("reports");
    window.scrollTo(0, 0);
  }

  const openReviewedReport = useCallback(() => {
    setOverviewSource("rankscale");
    setReportSection("client");
    setArea("reports");
  }, []);

  const onPhaseChange = useCallback((nextPhase) => {
    if (nextPhase === 2) setSelectedClient((current) => current || defaultClient());
    setPhase(nextPhase);
  }, []);

  const startWorkflow = useCallback((nextPhase = 2, fresh = true) => {
    if (nextPhase === 2) setSelectedClient((current) => current || defaultClient());
    setPhase(nextPhase);
    setArea("workflow");
    if (nextPhase === 2 && fresh) setNewMonthlyRun((value) => value + 1);
    if (nextPhase === 1 && fresh) setPromptImportRequest((value) => value + 1);
  }, []);

  const savePromptSource = useCallback(
    async ({ clientId, client, property, file, kind }) => {
      const saved = await saveSourceFile({ phase: 1, clientId, client, property, uploadedBy: account.name, file, kind });
      await refreshLibrary();
      return saved;
    },
    [account, refreshLibrary],
  );

  // Phase 1 finished: keep the prompt workbook with the client's CSV exports.
  const savePromptSetup = useCallback(
    async (setup) => {
      if (savingSetup.current) return undefined;
      savingSetup.current = true;
      try {
        const saved = await saveLibraryEntry({
          id: `setup-${setup.runId || uniqueId("run")}`,
          type: "sheet",
          title: `${setup.property} — Intents & prompts`,
          clientId: setup.clientId,
          client: setup.client,
          property: setup.property,
          sheetUrl: setup.sheetUrl,
          url: setup.sheetUrl,
          runId: setup.runId,
          status: "complete",
          createdAt: setup.completedAt,
          createdBy: account.name,
          generationMode: "automatic",
          summary: setup.summary,
          engines: setup.engines,
          intents: setup.intents,
          prompts: setup.prompts,
          sheetSynced: false,
        });
        await refreshLibrary();
        setToast("Prompt complete. CSV exports and the Google Sheets link are ready.");
        setArea("exports");
        return saved;
      } finally {
        savingSetup.current = false;
      }
    },
    [account, refreshLibrary],
  );

  // A reviewer approved a dataset (Settings → Imports, or the data review step).
  const saveDataset = useCallback(
    async ({ file, review, reviewer, existingId, rankscale }) => {
      const now = new Date().toISOString();
      if (rankscale) {
        const records = Array.isArray(rankscale.records) ? rankscale.records : [];
        const summary = { ...rankscale.summary, rowCount: records.length };
        const period = rankscale.period || {};
        const saved = await saveLibraryEntry(
          {
            id: existingId || uniqueId("rankscale"),
            type: "data",
            title: `Rankscale — ${period.from || "Selected data"}${period.to ? ` to ${period.to}` : ""}`,
            fileName: file?.name || null,
            clientId: rankscale.clientId,
            client: rankscale.client,
            property: rankscale.property,
            status: "approved",
            createdAt: now,
            createdBy: reviewer,
            approvedBy: reviewer,
            approvedAt: now,
            source: "rankscale",
            period,
            records,
            summary,
            historySummary: rankscale.historySummary,
            sourceNames: rankscale.sourceNames || [],
            rows: records.length,
            prompts: summary.promptCount,
            engines: summary.engines,
            notes: "Only rows within the approved date range are saved in this dataset. Your wider Rankscale history remains available for other date ranges.",
          },
          file || undefined,
        );
        await refreshLibrary();
        setToast(`${records.length.toLocaleString()} Rankscale rows approved by ${reviewer} and saved in Rankscale uploaded files.`);
        return saved;
      }
      const client = selectedClient || coogeeClient();
      const saved = await saveLibraryEntry(
        {
          id: existingId || uniqueId("data"),
          type: "data",
          title: file.name,
          fileName: file.name,
          clientId: client.id,
          property: client.property,
          client: client.name,
          status: "approved",
          createdAt: now,
          createdBy: reviewer,
          approvedBy: reviewer,
          approvedAt: now,
          summary: review.summary,
          validation: review.validation,
          mapping: review.mapping,
          rows: review.summary?.rows_ready ?? review.validation?.rows_valid,
          prompts: review.mapping?.counts?.prompts,
          engines: review.mapping?.counts?.engines,
          batchId: review.batch_id,
          period: { from: review.validation?.summary?.date_from, to: review.validation?.summary?.date_to },
          reviewSnapshot: review,
        },
        file,
      );
      await refreshLibrary();
      setToast(`Dataset approved by ${reviewer} and saved in Rankscale uploaded files.`);
      return saved;
    },
    [refreshLibrary, selectedClient],
  );

  // Team review finished: keep the decisions with the client's report.
  const completeReview = useCallback(
    async (review) => {
      const client = selectedClient || coogeeClient();
      const report = await apiFetch(`/api/report/${client.id}`).catch(() => null);
      const reviewId = uniqueId("review");
      const saved = await saveLibraryEntry({
        ...review,
        id: reviewId,
        dataId: review.dataEntryId,
        type: "review",
        title: `${client.name} — Monthly review`,
        clientId: client.id,
        property: client.property,
        propertyName: client.property,
        client: client.name,
        status: "complete",
        createdAt: review.completedAt,
        createdBy: account.name,
        reviewer: account.name,
        report,
        period: report?.period,
      });
      const dataEntry = (await listLibrary()).find((entry) => entry.id === review.dataEntryId);
      if (dataEntry) await saveLibraryEntry({ ...dataEntry, status: "complete", reviewId, reviewCompletedAt: review.completedAt });
      await refreshLibrary();
      setOverviewSource("rankscale");
      setReportSection("client");
      setToast("Review complete. Your decisions and full report are saved.");
      setArea("reports");
      return saved;
    },
    [account, refreshLibrary, selectedClient],
  );

  function openLibraryRecord(entry) {
    const client = resolveClient(entry) || selectedClient;
    if (entry.type === "report") {
      setSelectedClient(client);
      openReportRequest({ clientId: entry.clientId, period: entry.period, record: entry });
      return;
    }
    setOverviewSource("rankscale");
    setSelectedClient(client);
    setReportSection("client");
    setArea("reports");
  }

  function selectClient(client) {
    setSelectedClient(client);
    setReportRequest(null);
    if (reportSection === "client") setOverviewSource(isCoogee(client) ? "prepared" : "rankscale");
  }

  async function onCreateClient(values) {
    const created = await createClient(values);
    setClients(listClients());
    selectClient(created);
    setToast(`${created.name} created and selected.`);
    return created;
  }

  const requestCreateClient = useCallback(() => setClientCreateRequest((value) => value + 1), []);

  function openSettings() {
    setArea("settings");
  }

  function openReportSection(section) {
    const next = REPORT_SECTIONS.some(([id]) => id === section) ? section : "client";
    const client = selectedClient || defaultClient();
    if (!selectedClient) setSelectedClient(client);
    if (next === "client" && isCoogee(client)) setOverviewSource("rankscale");
    else if (overviewSource === "prepared") setOverviewSource("rankscale");
    setReportSection(next);
    setArea("reports");
    window.scrollTo(0, 0);
  }

  function openMonthly(section) {
    if (section === "client") {
      openReportSection("client");
      return;
    }
    if (!selectedClient) setSelectedClient(defaultClient());
    setMonthlySection(section);
    setArea("monthly");
    window.scrollTo(0, 0);
  }

  const activeGroup =
    area === "exports" || (area === "workflow" && phase === 1)
      ? "prompt"
      : area === "reports" || area === "monthly" || (area === "workflow" && phase === 2)
        ? "rankscale"
        : null;

  if (!account) return <LoginPage onSignIn={signIn} />;

  return (
    <div
      className={`workspace-app workspace-area-${area}${area === "workflow" && phase === 1 ? " workspace-setup-active" : ""}${activeGroup === "rankscale" ? " workspace-rankscale-active" : ""}`}
    >
      <header className="guided-brand-header">
        <div className="guided-container">
          <div className="guided-brand-identity">
            <img className="guided-brand-logo" src={komosionLogo} alt="Komosion" />
            <div className="guided-brand-context">
              <span>GEO · AI</span>
              <ClientPicker clients={clients} selectedClient={selectedClient} onSelectClient={selectClient} onCreateClient={onCreateClient} createRequest={clientCreateRequest} />
            </div>
          </div>
          <WorkflowSwitch activeGroup={activeGroup} onPromptUpload={() => startWorkflow(1, false)} onRankscaleUpload={() => startWorkflow(2, false)} />
          <div className="workspace-header-actions">
            <SettingsButton active={area === "settings" || area === "library" || area === "report-setup"} onClick={openSettings} />
            <details className="workspace-account">
              <summary aria-label={`Account: ${account.name}, ${account.role}`}>
                <span className="workspace-avatar">{initialsOf(account)}</span>
                <span>
                  <strong>{account.name}</strong>
                  <small>{account.role}</small>
                </span>
                <span aria-hidden="true">⌄</span>
              </summary>
              <div className="workspace-account-menu">
                <strong>
                  {"Signed in as "}
                  {account.name}
                </strong>
                <p>Team account · Files and reports use this name.</p>
                <button className="guided-secondary" onClick={signOut}>
                  Sign out
                </button>
              </div>
            </details>
          </div>
        </div>
      </header>
      <div className="workspace-content">
        {activeGroup === "rankscale" && (
          <RankscaleSteps
            activeStep={area === "reports" || area === "monthly" ? 2 : 1}
            reportReady={area === "reports" || area === "monthly" || uploadedClientIds.includes(selectedClient?.id)}
            onUpload={() => {
              if (area !== "workflow" || phase !== 2) startWorkflow(2, false);
            }}
            onReport={() => {
              if (area !== "reports") openReportSection("client");
            }}
          />
        )}
        {toast && (
          <div className="workspace-toast" role="status">
            {toast}
            <button onClick={() => setToast("")} aria-label="Dismiss notification">
              ×
            </button>
          </div>
        )}
        <div hidden={area !== "workflow" && area !== "monthly"} className="workspace-workflows">
          {area === "monthly" && (
            <header className="workspace-review-header">
              <button type="button" className="workspace-review-back" onClick={() => openReportSection("client")}>
                <span aria-hidden="true">←</span>
                {" Back to client report"}
              </button>
              <div className="workspace-review-title">
                <div>
                  <span className="guided-eyebrow">CLIENT REPORT · TEAM REVIEW</span>
                  <h1>Prepare the client story</h1>
                  <p>Review the insights and recommended actions before including them in the client report.</p>
                </div>
                <span className="workspace-review-account">
                  {"Reviewer: "}
                  <strong>{account.name}</strong>
                </span>
              </div>
              <nav className="workspace-review-tabs" aria-label="Client report review sections">
                {REVIEW_TABS.map(([id, label]) => {
                  const pending = selectedClient ? reviewCounts[id] : 0;
                  return (
                    <button key={id} type="button" aria-current={monthlySection === id ? "page" : undefined} onClick={() => openMonthly(id)}>
                      {label}
                      {pending > 0 && (
                        <span className="workspace-review-pending" title={`${pending} awaiting review`}>
                          {pending}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </header>
          )}
          <WorkflowHost
            workspaceArea={area}
            monthlySection={monthlySection}
            onNavigateMonthly={openMonthly}
            onOpenWorkflow={() => {
              setArea("workflow");
              setPhase(2);
            }}
            onReviewCounts={setReviewCounts}
            account={account}
            selectedClient={selectedClient}
            onSelectClient={selectClient}
            onCreateClient={requestCreateClient}
            clientCreateRequest={clientCreateRequest}
            promptImportRequest={promptImportRequest}
            phase={phase}
            newMonthlyRun={newMonthlyRun}
            onPhaseChange={onPhaseChange}
            onContextChange={onContextChange}
            onSetupComplete={savePromptSetup}
            onPromptSource={savePromptSource}
            onDatasetSaved={saveDataset}
            onReviewComplete={completeReview}
            onOpenReports={openReviewedReport}
            onOpenRankscaleDashboard={openRankscaleReport}
            onOpenLibrary={openLibrary}
          />
        </div>
        <div className="guided-container" hidden={area !== "settings"}>
          {area === "settings" && (
            <SettingsPage onOpenImports={() => openLibrary(1)} onOpenReportSetup={() => setArea("report-setup")} clientName={selectedClient?.name} />
          )}
        </div>
        <div className="guided-container settings-imports" hidden={area !== "report-setup"}>
          <nav className="settings-imports-breadcrumb" aria-label="Settings breadcrumb">
            <button type="button" className="settings-imports-back" onClick={openSettings}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <path d="m14 6-6 6 6 6" />
              </svg>
              Settings
            </button>
            <span aria-hidden="true">/</span>
            <span aria-current="page">Report setup</span>
          </nav>
          {area === "report-setup" && <ReportSetupPage client={selectedClient} />}
        </div>
        <div className="guided-container settings-imports" hidden={area !== "library"}>
          <nav className="settings-imports-breadcrumb" aria-label="Settings breadcrumb">
            <button type="button" className="settings-imports-back" onClick={openSettings}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <path d="m14 6-6 6 6 6" />
              </svg>
              Settings
            </button>
            <span aria-hidden="true">/</span>
            <span aria-current="page">Imports</span>
          </nav>
          <LibraryPage
            onOpenDashboard={openRankscaleReport}
            active={area === "library"}
            key={`${libraryKey}-${selectedClient?.id || "all"}`}
            selectedClient={selectedClient}
            initialPhase={libraryPhase}
            entries={libraryEntries}
            onOpenReview={openLibraryRecord}
            onStartWorkflow={startWorkflow}
            onEntriesChange={setLibraryEntries}
            onDatasetSaved={saveDataset}
            account={account}
          />
        </div>
        <div hidden={area !== "exports"}>
          {area === "exports" && (
            <div className="guided-container">
              <PromptExports entries={libraryEntries} selectedClient={selectedClient} onStartWorkflow={startWorkflow} />
            </div>
          )}
        </div>
        <div hidden={area !== "reports"}>
          {area === "reports" && (
            <ReportHub
              onPeriodChange={(request) =>
                setReportRequest((current) =>
                  current?.clientId === request.clientId && current?.period?.from === request.period.from && current?.period?.to === request.period.to ? current : request,
                )
              }
              reportRequest={reportRequest}
              onCreateReport={openReportRequest}
              onReportSaved={saveReport}
              overviewSource={overviewSource}
              onOverviewSourceChange={setOverviewSource}
              selectedClient={selectedClient || defaultClient()}
              section={reportSection}
              onSectionChange={openReportSection}
              onTeamReview={() => openMonthly("alerts")}
              onStartReview={() => startWorkflow(2)}
              account={account}
            />
          )}
        </div>
      </div>
    </div>
  );
}
export { App };
