import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import sheetIcon from "../../assets/google-sheets-icon.png";
import { GeoSelect } from "./GeoSelect";

/*
 * Phase 1 · Prompt — client & goals → kickoff transcript → engines + shared intents →
 * prompts per engine → Google Sheets / CSV export.
 *
 * The wizard is rendered inside <PromptFrame>, an isolated document, so its stylesheet
 * (prompt-flow.css) and scroll behaviour match the original standalone flow exactly.
 * All data comes from the prompt-setup agents through the `api` prop.
 */

const STEP_LABELS = ["Client & goals", "Transcript", "Intents", "Prompts", "Google Sheets"];
const STEP_CAPTIONS = [
  "Define client and goals",
  "Upload kickoff transcript",
  "Explore shared intents",
  "Generate prompts",
  "Save and export",
];
const MAX_TRANSCRIPT = 100000;
const rowKey = (engineId, itemId) => `${engineId}::${itemId}`;
const band = (score) => (score === null || score === undefined ? "unscored" : score >= 85 ? "high" : score >= 60 ? "medium" : "low");
// Optional edits change the content status; they never manufacture a human approval.
const contentStatus = (value) =>
  value?.status === "Approved" ? "Approved" : value?.revision || value?.status === "Edited" ? "Edited" : "Generated";

function ConfidenceBadge({ score, scoreLabel }) {
  const missing = score === null || score === undefined;
  return (
    <span className={`confidence-badge ${band(score)}`} title={missing ? "Needs assessment after changes" : scoreLabel}>
      {missing ? "Not scored" : `${score}%`}
    </span>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z" />
      <path d="M13 20h7" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="update-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

/** <dialog> that follows the `open` prop and closes on backdrop click / Escape. */
function Dialog({ id, labelledBy, open, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      id={id}
      aria-labelledby={labelledBy}
      ref={ref}
      onClose={() => open && onClose()}
      onClick={(event) => {
        const dialog = ref.current;
        const box = dialog.getBoundingClientRect();
        if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) onClose();
      }}
    >
      {children}
    </dialog>
  );
}

export function PromptFlow({ api, client, account, openTranscriptRequest = 0, createClientRequest = 0, onCreateClient, onContextChange, onSourceFile, onDownloadSample, onComplete }) {
  const doc = useRef(null);
  const rootRef = useRef(null);
  const win = () => rootRef.current?.ownerDocument?.defaultView || window;
  const byId = (id) => rootRef.current?.ownerDocument?.getElementById(id);
  const focus = (id) => byId(id)?.focus({ preventScroll: true });
  const scrollTop = (smooth = true) => win().scrollTo({ top: 0, behavior: smooth ? "smooth" : "instant" });

  // ---- engines & capabilities ------------------------------------------------------------
  const [engines, setEngines] = useState([]);
  const [agentInfo, setAgentInfo] = useState({ mode: "rules", label: "Rule-based scores" });
  useEffect(() => {
    let live = true;
    api.engines().then((result) => live && setEngines(result.engines || [])).catch(() => {});
    api.agentInfo?.().then((info) => live && info && setAgentInfo(info)).catch(() => {});
    return () => {
      live = false;
    };
  }, [api]);

  // ---- step 1: client & goals ------------------------------------------------------------
  const [propertyMode, setPropertyMode] = useState("existing");
  const [propertyName, setPropertyName] = useState("");
  const [market, setMarket] = useState("");
  const [goals, setGoals] = useState("");
  const [setupError, setSetupError] = useState("");
  const [briefApproved, setBriefApproved] = useState(false);
  const hasClient = Boolean(client?.id);
  const clientTeam = client?.team || client?.name || "";
  const property = propertyMode === "create" ? propertyName : client?.property || client?.name || "";

  // ---- step 2: transcript ----------------------------------------------------------------
  const [mode, setMode] = useState("upload");
  const [transcript, setTranscript] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileEdited, setFileEdited] = useState(false);
  const [sampleTranscript, setSampleTranscript] = useState(false);
  const [reading, setReading] = useState(false);
  const [transcriptError, setTranscriptError] = useState("");
  const [transcriptConfirmed, setTranscriptConfirmed] = useState(false);
  const [sourceStatus, setSourceStatus] = useState("");
  const [dragging, setDragging] = useState(false);
  const readVersion = useRef(0);
  const savedSourceKey = useRef("");

  // ---- step 3: engines + intents ---------------------------------------------------------
  const [draftEngineIds, setDraftEngineIds] = useState(() => new Set());
  const [selectedEngineIds, setSelectedEngineIds] = useState([]);
  const [engineConfirmed, setEngineConfirmed] = useState(false);
  const [engineError, setEngineError] = useState("");
  const [run, setRun] = useState(null); // { id, transcriptKey }
  const [items, setItems] = useState([]); // [{ id, intent, audience, prompt? }]
  const [intents, setIntents] = useState({}); // id -> { intent, audience, status, revision }
  const [intentsLoading, setIntentsLoading] = useState(false);
  const [intentError, setIntentError] = useState("");
  const [activeIntent, setActiveIntent] = useState(null); // { id, intent, audience, error }

  // ---- step 4: prompts ------------------------------------------------------------------
  const [prompts, setPrompts] = useState({}); // engine::item -> { text, feedback, status, confidence, revision }
  const [generated, setGenerated] = useState(() => new Set());
  const [generating, setGenerating] = useState(false);
  const [promptEngine, setPromptEngine] = useState(null);
  const [confidenceFilter, setConfidenceFilter] = useState("all");
  const [promptError, setPromptError] = useState("");
  const [activePrompt, setActivePrompt] = useState(null);
  const feedbackLog = useRef([]);

  // ---- step 5: sheets -------------------------------------------------------------------
  const [sheet, setSheet] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [frameNonce, setFrameNonce] = useState(0);
  const [saveMessage, setSaveMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const [stage, setStage] = useState(1);
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const showToast = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4200);
  }, []);

  // ---- derived ---------------------------------------------------------------------------
  const selectedEngines = useMemo(() => engines.filter((engine) => selectedEngineIds.includes(engine.id)), [engines, selectedEngineIds]);
  const intentValue = (item) => ({ intent: intents[item.id]?.intent ?? item.intent, audience: intents[item.id]?.audience ?? item.audience });
  const promptText = (engineId, item) => prompts[rowKey(engineId, item.id)]?.text ?? item.prompt ?? "";
  const allIntentsReady =
    engineConfirmed && selectedEngineIds.length > 0 && items.length > 0 && items.every((item) => intentValue(item).intent.trim() && intentValue(item).audience.trim());
  const allPromptsReady =
    allIntentsReady && selectedEngineIds.every((id) => generated.has(id) && items.every((item) => String(promptText(id, item)).trim()));
  const allowed = (target) => {
    if (target === 1) return true;
    if (!briefApproved) return false;
    if (target === 2) return true;
    if (reading || !transcriptConfirmed) return false;
    if (target === 3) return true;
    if (!allIntentsReady) return false;
    if (target === 4) return true;
    return target === 5 && allPromptsReady;
  };
  const highest = !briefApproved ? 1 : !transcriptConfirmed ? 2 : !allIntentsReady ? 3 : !allPromptsReady ? 4 : 5;
  const current = allowed(stage) ? stage : highest;
  const done = [briefApproved, transcriptConfirmed, allIntentsReady, allPromptsReady, allPromptsReady];

  const confidenceOf = (engineId, item) => {
    if (!generated.has(engineId)) return null;
    const value = prompts[rowKey(engineId, item.id)];
    return typeof value?.confidence === "number" && Number.isFinite(value.confidence) ? value.confidence : null;
  };
  const visiblePrompts = generated.has(promptEngine)
    ? items.filter((item) => confidenceFilter === "all" || band(confidenceOf(promptEngine, item)) === confidenceFilter)
    : [];
  const approvedCount = (engineId) => items.filter((item) => prompts[rowKey(engineId, item.id)]?.status === "Approved").length;
  const approvedIntents = items.filter((item) => intents[item.id]?.status === "Approved").length;
  const pendingEngines = selectedEngines.filter((engine) => !generated.has(engine.id));
  const totalPrompts = selectedEngineIds.length * items.length;
  const exportSummary = `${items.length} shared intents · ${totalPrompts} prompts · ${selectedEngines.length} engines · Generated`;

  // ---- invalidation ----------------------------------------------------------------------
  const invalidatePrompts = useCallback((itemId) => {
    setPrompts((all) => {
      const next = {};
      for (const [key, value] of Object.entries(all)) {
        const stored = key.split("::")[1];
        next[key] = !itemId || stored === itemId ? { ...value, status: contentStatus({ ...value, status: "Needs review" }), confidence: null } : value;
      }
      return next;
    });
  }, []);
  const resetIntents = useCallback(() => {
    setRun(null);
    setItems([]);
    setIntents({});
    setPrompts({});
    setGenerated(new Set());
    setSheet(null);
  }, []);
  const invalidateTranscript = useCallback(() => {
    setTranscriptConfirmed(false);
    resetIntents();
  }, [resetIntents]);
  const invalidateBrief = useCallback(() => {
    setBriefApproved(false);
    invalidateTranscript();
  }, [invalidateTranscript]);

  // ---- client selection from the workspace header -----------------------------------------
  const appliedClient = useRef(null);
  useEffect(() => {
    if (!client?.id || appliedClient.current === client.id) return;
    appliedClient.current = client.id;
    setPropertyMode("existing");
    setPropertyName("");
    setMarket(client.targetAudience || "");
    setGoals(client.goals || "");
    setSetupError("");
    invalidateBrief();
  }, [client, invalidateBrief]);

  // keep the workspace informed so the client record keeps the audience and goals
  const contextKey = JSON.stringify([client?.id, property, market, goals, current]);
  const lastContext = useRef("");
  useEffect(() => {
    if (!client?.id || lastContext.current === contextKey) return;
    lastContext.current = contextKey;
    onContextChange?.({ clientId: client.id, client: client.name, property, targetAudience: market, goals, setupStep: current });
  }, [contextKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!openTranscriptRequest) return;
    setMode("upload");
    setStage(allowed(2) ? 2 : 1);
    scrollTop(false);
  }, [openTranscriptRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!createClientRequest) return;
    setStage(1);
    scrollTop(false);
  }, [createClientRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  function goStage(target, withFocus = true) {
    if (!allowed(target)) {
      showToast("Complete and confirm the current step before continuing.");
      return false;
    }
    setStage(target);
    if (withFocus) {
      scrollTop();
      requestAnimationFrame(() =>
        target === 3
          ? focus(engineConfirmed ? "intentStageTitle" : "enginePickerTitle")
          : byId(`wizardStage${target}`)?.querySelector("h2")?.focus({ preventScroll: true }),
      );
    }
    return true;
  }

  // ---- step 1 handlers -------------------------------------------------------------------
  function submitClient(event) {
    event.preventDefault();
    const missing = [
      ["client", "client / team", clientTeam],
      ["property", "property name", property],
      ["market", "target market", market],
      ["goals", "client goals", goals],
    ].filter(([, , value]) => !String(value || "").trim());
    if (!hasClient || missing.length) {
      setSetupError(`Complete ${(hasClient ? missing : [["client", "client / team"], ...missing]).map(([, label]) => label).join(", ")} before continuing.`);
      return;
    }
    setBriefApproved(true);
    setSetupError("");
    setStage(2);
    scrollTop();
    requestAnimationFrame(() => focus("transcriptStageTitle"));
  }

  // ---- step 2 handlers -------------------------------------------------------------------
  function sendSource(file, kind, sample = false, text = transcript) {
    if (!client?.id || !onSourceFile) return;
    const key = `${client.id}|${file.name}|${text}`;
    if (savedSourceKey.current === key) return;
    savedSourceKey.current = key;
    setSourceStatus("Saving in Prompt import history…");
    onSourceFile({ clientId: client.id, client: client.name, property, file, kind, sample })
      .then((saved) =>
        setSourceStatus(saved?.fileStorageMode === "session" ? "Saved for this session only. Download a copy from Prompt import history." : "Saved in Prompt import history."),
      )
      .catch((error) => {
        savedSourceKey.current = "";
        setSourceStatus(error.message || "The source file could not be saved. Try again.");
      });
  }

  async function loadTranscriptFile(file) {
    if (!file) return;
    const version = ++readVersion.current;
    setReading(true);
    setTranscriptError("");
    try {
      if (!/\.(txt|md)$/i.test(file.name)) throw Error("Choose a TXT or Markdown file.");
      if (file.size > 1024 * 1024) throw Error("Choose a file smaller than 1 MB.");
      const text = (await file.text()).replace(/^﻿/, "");
      if (version !== readVersion.current) return;
      if (!text.trim()) throw Error("This file is empty. Choose a transcript with text.");
      if (text.length > MAX_TRANSCRIPT) throw Error("Use 100,000 characters or fewer.");
      if (text.includes("\u0000")) throw Error("Save your transcript as a UTF-8 text file.");
      setFileName(file.name);
      setFileEdited(false);
      setSampleTranscript(false);
      setTranscript(text);
      setMode("upload");
      invalidateTranscript();
      sendSource(file, "upload", false, text);
    } catch (error) {
      if (version === readVersion.current) setTranscriptError(error.message);
    } finally {
      if (version === readVersion.current) setReading(false);
    }
  }

  function clearTranscript() {
    readVersion.current++;
    setReading(false);
    setFileName("");
    setFileEdited(false);
    setSampleTranscript(false);
    setTranscript("");
    setTranscriptError("");
    invalidateTranscript();
  }

  function useSample() {
    clearTranscript();
    setTranscript(
      "ILLUSTRATIVE KICKOFF TRANSCRIPT — created for this prototype.\nClient: We want to understand how AI answers recommend our hotel for leisure, family, wellness, business, dining and special occasions.\nTeam: We will review the audience and goals, then create an intent table and a prompt set for export.\nClient: Compare neutral discovery separately from branded questions. Review performance monthly and gather evidence before deciding on content changes.",
    );
    setSampleTranscript(true);
    setMode("paste");
  }

  function submitTranscript(event) {
    event.preventDefault();
    if (!briefApproved) {
      setTranscriptError("Confirm the client and goals in Step 1 first.");
      goStage(1);
      return;
    }
    if (reading) {
      setTranscriptError("Wait for the selected file to finish reading.");
      return;
    }
    if (!transcript.trim()) {
      setTranscriptError("Upload a .txt or .md file, or paste the kickoff transcript, before continuing.");
      setMode("paste");
      requestAnimationFrame(() => focus("kickoffText"));
      return;
    }
    if (transcript.length > MAX_TRANSCRIPT) {
      setTranscriptError("Shorten the transcript to 100,000 characters or fewer.");
      return;
    }
    if (!fileName || fileEdited) {
      const name = sampleTranscript ? "Sample-kickoff-transcript.txt" : "Kickoff-transcript.txt";
      sendSource(new File([transcript], name, { type: "text/plain" }), "paste", sampleTranscript);
    }
    setTranscriptConfirmed(true);
    setTranscriptError("");
    setStage(3);
    scrollTop();
    requestAnimationFrame(() => focus(engineConfirmed ? "intentStageTitle" : "enginePickerTitle"));
  }

  // ---- step 3 handlers -------------------------------------------------------------------
  async function ensureIntents() {
    if (items.length || intentsLoading) return;
    setIntentsLoading(true);
    setIntentError("");
    try {
      let current = run;
      if (!current) {
        current = await api.startRun({
          clientId: client.id,
          client: client.name,
          property,
          targetAudience: market,
          goals,
          transcript,
          transcriptName: fileName || (sampleTranscript ? "Sample transcript" : "Pasted transcript"),
          createdBy: account?.name,
        });
        setRun(current);
      }
      const result = await api.generateIntents(current.id);
      setItems(result.items);
      setIntents(Object.fromEntries(result.items.map((item) => [item.id, { intent: item.intent, audience: item.audience, status: "Generated" }])));
    } catch (error) {
      setIntentError(error.message || "Intents could not be generated. Try again.");
    } finally {
      setIntentsLoading(false);
    }
  }

  function commitEngines() {
    if (!draftEngineIds.size) {
      setEngineError("Select at least one engine before continuing.");
      return;
    }
    const removed = selectedEngineIds.filter((id) => !draftEngineIds.has(id));
    if (removed.length)
      setPrompts((all) =>
        Object.fromEntries(Object.entries(all).map(([key, value]) => [key, removed.includes(key.split("::")[0]) ? { ...value, status: contentStatus({ ...value, status: "Needs review" }) } : value])),
      );
    const ordered = engines.filter((engine) => draftEngineIds.has(engine.id)).map((engine) => engine.id);
    setSelectedEngineIds(ordered);
    setPromptEngine(ordered.find((id) => approvedCount(id) < items.length) || ordered[0]);
    setEngineConfirmed(true);
    setEngineError("");
    scrollTop();
    requestAnimationFrame(() => focus("intentStageTitle"));
    ensureIntents();
  }

  function openEnginePicker() {
    setDraftEngineIds(new Set(selectedEngineIds));
    setEngineConfirmed(false);
    setStage(3);
    scrollTop();
    requestAnimationFrame(() => focus("enginePickerTitle"));
  }

  function setIntentApproval(ids, approved) {
    if (!allowed(3) || !engineConfirmed) return;
    for (const id of ids) {
      const item = items.find((entry) => entry.id === id);
      const value = item && intentValue(item);
      if (approved && value && (!value.intent.trim() || !value.audience.trim())) {
        setIntentError("Complete this row before approving.");
        return;
      }
    }
    setIntents((all) => {
      const next = { ...all };
      for (const id of ids) next[id] = { ...next[id], status: approved ? "Approved" : contentStatus({ ...next[id], status: "Needs review" }) };
      return next;
    });
    if (!approved) ids.forEach((id) => invalidatePrompts(id));
    setIntentError("");
    if (run) api.saveIntents?.(run.id, ids.map((id) => ({ id, status: approved ? "Approved" : "Generated" })), account?.name).catch(() => {});
  }

  function openIntentReview(id) {
    if (!allowed(3) || !engineConfirmed) return;
    const item = items.find((entry) => entry.id === id);
    if (!item) return;
    setActiveIntent({ id, ...intentValue(item), error: "" });
  }

  function saveIntent() {
    if (!activeIntent) return;
    const item = items.find((entry) => entry.id === activeIntent.id);
    const intent = activeIntent.intent.trim();
    const audience = activeIntent.audience.trim();
    if (!intent || !audience) {
      setActiveIntent({ ...activeIntent, error: "Complete the intent and audience before saving." });
      focus(!intent ? "intentNeed" : "intentAudience");
      return;
    }
    const prior = intentValue(item);
    const changed = prior.intent !== intent || prior.audience !== audience;
    if (changed) {
      setIntents((all) => {
        const previous = all[item.id] || {};
        return { ...all, [item.id]: { ...previous, intent, audience, status: "Edited", revision: (previous.revision || 0) + 1 } };
      });
      invalidatePrompts(item.id);
      if (run) api.saveIntents?.(run.id, [{ id: item.id, intent, audience, status: "Edited" }], account?.name).catch(() => {});
    }
    setActiveIntent(null);
    requestAnimationFrame(() => focus(`intent-edit-shared-${item.id}`));
    showToast(changed ? "Intent updated." : "No changes to save.");
  }

  // ---- step 4 handlers -------------------------------------------------------------------
  async function generatePrompts() {
    if (!allIntentsReady || generating) return;
    setGenerating(true);
    setPromptError("");
    try {
      const pending = selectedEngines.filter((engine) => !generated.has(engine.id)).map((engine) => engine.id);
      const result = await api.generatePrompts(run.id, {
        engineIds: pending,
        intents: items.map((item) => ({ id: item.id, ...intentValue(item) })),
      });
      setPrompts((all) => {
        const next = { ...all };
        for (const row of result.prompts) next[rowKey(row.engineId, row.itemId)] = { text: row.text, feedback: "", status: "Generated", confidence: row.confidence ?? null };
        return next;
      });
      setGenerated((set) => new Set([...set, ...pending]));
      setConfidenceFilter("all");
      showToast(result.message || "Prompts generated. You can edit or export them.");
      requestAnimationFrame(() => byId("promptConfidenceFilters")?.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true }));
    } catch (error) {
      setPromptError(error.message || "Prompts could not be generated. Try again.");
    } finally {
      setGenerating(false);
    }
  }

  function setPromptApproval(ids, approved) {
    const engineId = promptEngine;
    if (!allowed(4) || !engineConfirmed || !selectedEngineIds.includes(engineId) || !generated.has(engineId)) return;
    for (const id of ids) {
      const item = items.find((entry) => entry.id === id);
      if (approved && !String(promptText(engineId, item)).trim()) {
        setPromptError("Complete this row before approving.");
        return;
      }
    }
    setPrompts((all) => {
      const next = { ...all };
      for (const id of ids) {
        const key = rowKey(engineId, id);
        const saved = next[key] || {};
        next[key] = { ...saved, status: approved ? "Approved" : contentStatus({ ...saved, status: "Needs review" }) };
      }
      return next;
    });
    setPromptError("");
    api.savePrompts?.(run.id, ids.map((id) => ({ engineId, itemId: id, status: approved ? "Approved" : "Generated" })), account?.name).catch(() => {});
  }

  function openPromptReview(id) {
    if (!allowed(4) || !generated.has(promptEngine)) return;
    const item = items.find((entry) => entry.id === id);
    if (!item) return;
    const saved = prompts[rowKey(promptEngine, id)];
    setActivePrompt({
      item,
      engineId: promptEngine,
      originalText: saved?.text ?? item.prompt ?? "",
      originalFeedback: saved?.feedback ?? "",
      text: saved?.text ?? item.prompt ?? "",
      feedback: saved?.feedback ?? "",
      previous: null,
      generatedText: null,
      generatedConfidence: undefined,
      status: "",
      error: "",
      busy: false,
    });
  }

  async function regenerate() {
    if (!activePrompt || activePrompt.busy) return;
    const feedback = activePrompt.feedback.trim();
    const text = activePrompt.text.trim();
    if (!feedback) {
      setActivePrompt({ ...activePrompt, error: "Add feedback before regenerating." });
      focus("promptFeedback");
      return;
    }
    if (!text) {
      setActivePrompt({ ...activePrompt, error: "Add prompt wording first." });
      focus("promptText");
      return;
    }
    setActivePrompt({ ...activePrompt, busy: true, error: "", status: "Regenerating with your feedback…" });
    try {
      const result = await api.regeneratePrompt(run.id, {
        engineId: activePrompt.engineId,
        itemId: activePrompt.item.id,
        text,
        feedback,
        intent: intentValue(activePrompt.item),
      });
      setActivePrompt((currentPrompt) => ({
        ...currentPrompt,
        busy: false,
        previous: text,
        text: result.text,
        generatedText: result.text,
        generatedConfidence: result.confidence ?? null,
        generationFeedback: feedback,
        status: result.message || "New draft ready. Review it, then Save.",
      }));
    } catch (error) {
      setActivePrompt((currentPrompt) => ({ ...currentPrompt, busy: false, status: "", error: error.message || "The draft could not be regenerated." }));
    }
  }

  function savePrompt() {
    if (!activePrompt) return;
    const { engineId, item } = activePrompt;
    const key = rowKey(engineId, item.id);
    const text = activePrompt.text.trim();
    const feedback = activePrompt.feedback.trim();
    if (!text) {
      setActivePrompt({ ...activePrompt, error: "Add prompt wording before saving." });
      focus("promptText");
      return;
    }
    if (text.length > 3000 || feedback.length > 1000) {
      setActivePrompt({ ...activePrompt, error: "Use at most 3,000 characters for the prompt and 1,000 for feedback." });
      return;
    }
    const prior = prompts[key];
    const changed = (prior?.text ?? item.prompt) !== text || (prior?.feedback ?? "") !== feedback;
    if (changed) {
      const accepted = activePrompt.generatedText === text;
      const confidence = accepted ? activePrompt.generatedConfidence ?? null : null;
      setPrompts((all) => ({
        ...all,
        [key]: { ...prior, text, feedback, status: "Edited", confidence, revision: (prior?.revision || 0) + 1 },
      }));
      if (feedback) feedbackLog.current.push({ engineId, itemId: item.id, revision: (prior?.revision || 0) + 1, outcome: accepted ? "accepted" : "edited", feedback });
      api.savePrompts?.(run.id, [{ engineId, itemId: item.id, text, feedback, status: "Edited", confidence }], account?.name).catch(() => {});
    }
    setActivePrompt(null);
    requestAnimationFrame(() => focus(`prompt-edit-${engineId}-${item.id}`));
    showToast(changed ? "Prompt saved. Ready to export." : "No changes to save.");
  }

  function selectPromptEngine(engineId, withFocus = false) {
    if (!selectedEngineIds.includes(engineId)) return;
    setPromptEngine(engineId);
    requestAnimationFrame(() => {
      byId(`prompt-engine-${engineId}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
      if (withFocus) focus(`prompt-engine-${engineId}`);
    });
  }

  function onTabsKey(event) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = selectedEngines.findIndex((engine) => engine.id === promptEngine);
    if (!selectedEngines.length) return;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? selectedEngines.length - 1
          : (index + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) + selectedEngines.length) % selectedEngines.length;
    selectPromptEngine(selectedEngines[next].id, true);
  }

  // ---- step 5 ---------------------------------------------------------------------------
  useEffect(() => {
    if (current !== 5 || !run || sheet?.runKey === run.id) return;
    let live = true;
    api
      .prepareSheet(run.id, { engineIds: selectedEngineIds })
      .then((result) => live && setSheet({ ...result, runKey: run.id }))
      .catch((error) => live && setSheet({ runKey: run.id, error: error.message }));
    return () => {
      live = false;
    };
  }, [current, run, sheet, api, selectedEngineIds]);

  useEffect(() => {
    if (!expanded) return undefined;
    const onKey = (event) => event.key === "Escape" && setExpanded(false);
    const doc = rootRef.current.ownerDocument;
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
  }, [expanded]);

  const firstEngine = selectedEngines[0];
  const sheetUrl = sheet?.engines?.[firstEngine?.id] || firstEngine?.sheetUrl || sheet?.sheetUrl || "";
  const previewUrl = (() => {
    try {
      const url = new URL(sheetUrl);
      if (url.origin !== "https://docs.google.com") return "";
      const gid = new URLSearchParams(url.hash.slice(1)).get("gid");
      url.pathname = url.pathname.replace(/\/edit\/?$/, "/preview");
      url.search = "";
      url.hash = "";
      if (gid) url.searchParams.set("gid", gid);
      return url.href;
    } catch {
      return "";
    }
  })();

  async function savePhaseOne() {
    if (!account?.name || current !== 5 || !allowed(5) || saving) return;
    if (!clientTeam || !property) return;
    setSaving(true);
    try {
      const intentRows = items.map((item) => {
        const value = intents[item.id] || {};
        return { id: item.id, ...intentValue(item), status: contentStatus(value), ...(value.status === "Approved" ? { reviewer: account.name } : {}) };
      });
      const promptRows = selectedEngines.flatMap((engine) =>
        items.map((item) => {
          const value = prompts[rowKey(engine.id, item.id)] || {};
          const intent = intentValue(item);
          return {
            text: value.text ?? item.prompt,
            feedback: value.feedback || "",
            confidence: value.confidence ?? null,
            status: contentStatus(value),
            ...(value.status === "Approved" ? { reviewer: account.name } : {}),
            engineId: engine.id,
            itemId: item.id,
            engine: engine.name,
            intent: intent.intent,
            audience: intent.audience,
          };
        }),
      );
      const completed = await api.complete(run.id, { reviewer: account.name, intents: intentRows, prompts: promptRows, engineIds: selectedEngineIds });
      await onComplete?.({
        phase: 1,
        runId: run.id,
        clientId: client.id,
        client: client.name,
        property,
        targetAudience: market,
        goals,
        createdBy: account.name,
        sheetUrl: completed?.sheetUrl || sheetUrl,
        summary: exportSummary,
        engines: selectedEngines.map((engine) => engine.name),
        intents: intentRows,
        prompts: promptRows,
        completedAt: new Date().toISOString(),
      });
      setSaveMessage("Prompt complete. Your generated prompts and Google Sheets link are saved with CSV exports.");
    } catch (error) {
      setSaveMessage(error.message || "The prompts could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  // ---- render ----------------------------------------------------------------------------
  const transcriptLabel = reading
    ? "Reading selected file…"
    : fileName
      ? fileName + (fileEdited ? " · edited" : "")
      : transcript.trim()
        ? sampleTranscript
          ? "Sample transcript"
          : "Pasted transcript"
        : "No file selected";
  const promptGenerated = generated.has(promptEngine);
  const visibleIntentCount = items.length;
  const intentApproveDisabled = !allowed(3) || !engineConfirmed || !visibleIntentCount || approvedIntents === visibleIntentCount;
  const promptApprovedVisible = visiblePrompts.filter((item) => prompts[rowKey(promptEngine, item.id)]?.status === "Approved").length;
  const promptApproveDisabled = !allowed(4) || !engineConfirmed || !visiblePrompts.length || promptApprovedVisible === visiblePrompts.length;
  const confidenceTitle = agentInfo.mode === "ai" ? "QA agent score" : "Rule-based score · no AI key configured";
  const propertyOptions = [
    ...(hasClient ? [{ value: "existing", label: client.property || client.name, detail: client.detail || client.property || client.name }] : []),
    { value: "create", label: "+ Create a new property" },
  ];

  return (
    <div className="prompt-flow-root" ref={rootRef}>
      <div className="geo-stage-band" id="geoStageBand">
        <nav className="panel stepper wizard-stepper" id="geoStages" aria-label="Prompt steps">
          {STEP_LABELS.map((label, index) => {
            const step = index + 1;
            const isCurrent = step === current;
            return (
              <button
                key={step}
                className={`step${isCurrent ? " active" : ""}${done[index] ? " completed" : ""}`}
                data-wizard-step={step}
                disabled={!allowed(step)}
                aria-current={isCurrent ? "step" : undefined}
                aria-label={`${label}, step ${step} of 5${isCurrent ? ", current step" : done[index] ? ", completed" : !allowed(step) ? ", locked" : ""}`}
                onClick={() => goStage(step)}
              >
                <span className="step-count">{step}</span>
                <span>
                  <span className="step-title">{label}</span>
                  <span className="step-caption" id={`wizardStatus${step}`}>
                    {STEP_CAPTIONS[index]}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>
      </div>
      <div className="workarea">
        <main>
          <div className="print-brand">KOMOSION / GEO Intelligence</div>
          <section id="setup" className="screen" role="region" aria-labelledby="tab-setup">
            <div className="page-top sr-only">
              <div className="page-meta">
                <span className="eyebrow">Workflow 01</span>
                <span className="tag">One-time setup</span>
              </div>
              <h1 tabIndex="-1">Prompt</h1>
              <p>Prepare and review your tracking prompts.</p>
            </div>
            <div className="wizard-progress" id="wizardProgress" role="status">
              Step {current} of 5 · {STEP_LABELS[current - 1]}
            </div>

            {/* ---- Step 1 ---- */}
            <section className="wizard-stage" id="wizardStage1" data-wizard-stage="1" aria-labelledby="clientStageTitle" hidden={current !== 1}>
              <div className="panel input-panel" id="inputsPanel">
                <div className="panel-heading">
                  <div>
                    <div className="eyebrow">Step 01 / Client &amp; goals</div>
                    <h2 id="clientStageTitle" tabIndex="-1">
                      Client &amp; goals
                    </h2>
                  </div>
                  <button className="client-create-button" type="button" id="createDirectoryClient" onClick={() => onCreateClient?.()}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    <span>Create new client</span>
                  </button>
                </div>
                <div className="client-directory-layout">
                  <section className="client-details" aria-labelledby="clientInfoTitle">
                    <div className="client-pane-heading">
                      <h3 id="clientInfoTitle" tabIndex="-1">
                        Client information
                      </h3>
                      <span className="tag soft" id="inputKind" hidden={!hasClient}>
                        Client
                      </span>
                    </div>
                    <p id="clientSelectionHint" className="client-selection-hint" hidden={hasClient}>
                      Choose a client in the top bar, or create a new client.
                    </p>
                    <form id="setupInputForm" noValidate onSubmit={submitClient}>
                      <div className="wizard-fields" id="clientInformation" hidden={!hasClient}>
                        <div className="field wizard-full client-team-summary" id="clientTeamSummary">
                          <span>Client / team</span>
                          <p id="clientTeamValue">{clientTeam}</p>
                        </div>
                        <GeoSelect
                          id="propertyChoice"
                          className="field wizard-full"
                          label="Property"
                          value={hasClient ? propertyMode : ""}
                          disabled={!hasClient}
                          options={propertyOptions}
                          onChange={(value) => {
                            setPropertyMode(value === "create" ? "create" : "existing");
                            setPropertyName("");
                            setSetupError("");
                            invalidateBrief();
                            if (value === "create") requestAnimationFrame(() => focus("setupProperty"));
                          }}
                        />
                        <label className="field wizard-full" id="setupPropertyField" hidden={propertyMode !== "create"}>
                          <span className="client-field-label">Property name</span>
                          <input
                            id="setupProperty"
                            value={property}
                            maxLength="180"
                            readOnly={propertyMode !== "create"}
                            required
                            onChange={(event) => {
                              setPropertyName(event.target.value);
                              setSetupError("");
                              invalidateBrief();
                            }}
                          />
                        </label>
                        <label className="field wizard-full">
                          <span className="client-field-label">Target audience</span>
                          <textarea
                            id="setupMarket"
                            rows="2"
                            placeholder="e.g. Sydney families planning a beach stay"
                            maxLength="500"
                            required
                            value={market}
                            onChange={(event) => {
                              setMarket(event.target.value);
                              setSetupError("");
                              invalidateBrief();
                            }}
                          />
                        </label>
                        <label className="field wizard-full">
                          <span className="client-field-label">Goals</span>
                          <textarea
                            id="setupGoals"
                            rows="3"
                            placeholder="What does the client want to achieve?"
                            maxLength="10000"
                            required
                            value={goals}
                            onChange={(event) => {
                              setGoals(event.target.value);
                              setSetupError("");
                              invalidateBrief();
                            }}
                          />
                        </label>
                      </div>
                      <p id="setupInputError" className="input-error" role="alert">
                        {setupError}
                      </p>
                      <div className="wizard-footer client-footer">
                        <button className="button primary" id="continueClient" type="submit" disabled={!hasClient}>
                          Next <span aria-hidden="true">→</span>
                        </button>
                      </div>
                    </form>
                  </section>
                </div>
              </div>
            </section>

            {/* ---- Step 2 ---- */}
            <section className="wizard-stage" id="wizardStage2" data-wizard-stage="2" aria-labelledby="transcriptStageTitle" hidden={current !== 2}>
              <div className="panel input-panel">
                <div className="panel-heading">
                  <div>
                    <div className="eyebrow">Step 02 / Kickoff transcript</div>
                    <h2 id="transcriptStageTitle" tabIndex="-1">
                      Transcript
                    </h2>
                  </div>
                </div>
                <form id="transcriptForm" noValidate onSubmit={submitTranscript}>
                  <div className="input-methods" role="group" aria-label="Transcript input method">
                    <button type="button" id="transcriptUploadTab" data-transcript-mode="upload" aria-pressed={String(mode === "upload")} onClick={() => setMode("upload")}>
                      Import file
                    </button>
                    <button type="button" id="transcriptPasteTab" data-transcript-mode="paste" aria-pressed={String(mode === "paste")} onClick={() => setMode("paste")}>
                      Paste text
                    </button>
                  </div>
                  <div id="transcriptUploadPanel" hidden={mode !== "upload"}>
                    <div
                      className={`transcript-dropzone${dragging ? " is-dragging" : ""}`}
                      id="transcriptDropzone"
                      onDragOver={(event) => {
                        event.preventDefault();
                        setDragging(true);
                      }}
                      onDragLeave={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        setDragging(false);
                        if (event.dataTransfer.files.length !== 1) {
                          setTranscriptError("Choose one transcript at a time.");
                          return;
                        }
                        loadTranscriptFile(event.dataTransfer.files[0]);
                      }}
                    >
                      <div className="upload-icon-tile" aria-hidden="true">
                        <svg viewBox="0 0 32 36" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M7 2h12l8 8v23H7zM19 2v9h8M17 27V16m-5 5 5-5 5 5" />
                        </svg>
                      </div>
                      <div className="upload-content">
                        <h3>Drop your transcript here</h3>
                        <span className="upload-limits">TXT or Markdown · up to 1 MB · one transcript</span>
                        <label className="file-choice prompt-import-button">
                          Import transcript
                          <input
                            id="kickoffFile"
                            type="file"
                            accept=".txt,.md,text/plain,text/markdown"
                            aria-label="Import transcript file"
                            onChange={(event) => {
                              const file = event.target.files[0];
                              event.target.value = "";
                              loadTranscriptFile(file);
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                  <div className="transcript-file-row" id="transcriptFileRow" role="status" hidden={!transcript.trim() && !reading}>
                    <div className="transcript-file-info">
                      <span className="file-ready-dot" aria-hidden="true" />
                      <span id="kickoffFileName">{transcriptLabel}</span>
                    </div>
                    <div className="button-row">
                      <button
                        className="button link small-button"
                        type="button"
                        id="previewTranscript"
                        hidden={!transcript.trim() || mode === "paste"}
                        onClick={() => {
                          setMode("paste");
                          requestAnimationFrame(() => focus("kickoffText"));
                        }}
                      >
                        View text
                      </button>
                      <button className="button link small-button" type="button" id="removeTranscript" hidden={!transcript.trim() && !fileName && !reading} onClick={clearTranscript}>
                        Remove
                      </button>
                    </div>
                  </div>
                  <div id="transcriptTextPanel" hidden={mode !== "paste"}>
                    <label className="field transcript-field">
                      Transcript text
                      <textarea
                        id="kickoffText"
                        rows="7"
                        placeholder="Paste your kickoff conversation here."
                        maxLength="100000"
                        value={transcript}
                        onChange={(event) => {
                          readVersion.current++;
                          setReading(false);
                          setFileEdited(Boolean(fileName));
                          setSampleTranscript(false);
                          setTranscriptError("");
                          setTranscript(event.target.value);
                          invalidateTranscript();
                        }}
                      />
                      <span className="field-hint" id="transcriptCount">
                        {transcript.length.toLocaleString()} / 100,000 characters
                      </span>
                    </label>
                  </div>
                  <div className="transcript-help">
                    <button className="button link small-button" type="button" id="downloadPromptSample" onClick={() => onDownloadSample?.()}>
                      Download sample transcript
                    </button>
                    <button className="button link small-button" type="button" id="useSetupSample" onClick={useSample}>
                      Use sample
                    </button>
                  </div>
                  <p id="transcriptError" className="input-error" role="alert">
                    {transcriptError}
                  </p>
                  <p className="local-input-note">Transcripts are saved with this client and used by the intent agent.</p>
                  {sourceStatus && (
                    <p id="phaseOneSourceStatus" className="local-input-note" role="status">
                      {sourceStatus}
                    </p>
                  )}
                  <div className="wizard-footer">
                    <button className="button secondary" type="button" data-wizard-back="1" onClick={() => goStage(1)}>
                      ← Back
                    </button>
                    <button className="button primary" id="continueTranscript" type="submit" disabled={reading || !transcript.trim()}>
                      Next <span aria-hidden="true">→</span>
                    </button>
                  </div>
                </form>
              </div>
            </section>

            {/* ---- Step 3 ---- */}
            <section
              className="wizard-stage"
              id="wizardStage3"
              data-wizard-stage="3"
              aria-labelledby={engineConfirmed ? "intentStageTitle" : "enginePickerTitle"}
              hidden={current !== 3}
            >
              <div className="phase-one-note">
                <div>
                  <strong>Edit when needed</strong>
                  <p>You can adjust the wording before continuing. Generated prompts are ready to export.</p>
                </div>
              </div>
              <div className="panel engine-selection-panel" id="engineSelectionPanel" hidden={engineConfirmed}>
                <div className="panel-heading">
                  <div>
                    <div className="eyebrow">Step 03 / Choose engines</div>
                    <h2 id="enginePickerTitle" tabIndex="-1">
                      Select engines
                    </h2>
                  </div>
                  <span className="tag soft">{engines.length} engines</span>
                </div>
                <div className="engine-selection-toolbar">
                  <span id="engineSelectionCount" role="status">
                    {draftEngineIds.size} selected
                  </span>
                  <button className="button link small-button" id="selectAllEngines" onClick={() => setDraftEngineIds(new Set(engines.map((engine) => engine.id)))}>
                    Select all
                  </button>
                  <button className="button link small-button" id="clearEngineSelection" onClick={() => setDraftEngineIds(new Set())}>
                    Clear
                  </button>
                </div>
                <div id="enginePickerOptions">
                  {["GUI", "API"].map((type) => {
                    const group = engines.filter((engine) => engine.type === type);
                    return (
                      <fieldset className="engine-option-group" key={type}>
                        <legend>
                          {type} engines · {group.length}
                        </legend>
                        <div className="engine-option-grid">
                          {group.map((engine) => (
                            <label className="engine-option" key={engine.id}>
                              <input
                                type="checkbox"
                                id={`choose-engine-${engine.id}`}
                                data-engine-choice={engine.id}
                                checked={draftEngineIds.has(engine.id)}
                                onChange={(event) => {
                                  const next = new Set(draftEngineIds);
                                  if (event.target.checked) next.add(engine.id);
                                  else next.delete(engine.id);
                                  setDraftEngineIds(next);
                                  setEngineError("");
                                }}
                              />
                              <span className="engine-option-text">
                                <strong>{engine.name}</strong>
                              </span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    );
                  })}
                </div>
                <p className="input-error" id="engineSelectionError" role="alert">
                  {engineError}
                </p>
                <div className="wizard-footer">
                  <button className="button secondary" data-wizard-back="2" onClick={() => goStage(2)}>
                    ← Back
                  </button>
                  <button className="button primary" id="continueEngines" disabled={!draftEngineIds.size} onClick={commitEngines}>
                    Next →
                  </button>
                </div>
              </div>
              <div id="intentWorkspace" hidden={!engineConfirmed}>
                <div className="panel table-panel formal-review" id="intentsPanel">
                  <div className="panel-heading">
                    <h2 id="intentStageTitle" tabIndex="-1">
                      Intents
                    </h2>
                    <span className="tag soft" id="intentSelectionTag">
                      {items.length} shared intents
                    </span>
                  </div>
                  <div id="intentEnginePanel" role="region" aria-labelledby="intentEngineName" tabIndex="0">
                    <div className="engine-review-heading">
                      <h3 id="intentEngineName">Shared across all selected engines</h3>
                      <span id="intentEngineProgress" role="status">
                        {intentsLoading ? "Generating intents…" : `${items.length} intents ready`}
                      </span>
                    </div>
                    <div className="approval-toolbar">
                      <div className="approval-actions">
                        <button
                          className="button secondary small-button"
                          id="clearIntentApprovals"
                          type="button"
                          disabled={!allowed(3) || !engineConfirmed || !approvedIntents}
                          aria-label="Clear all shared intent approvals"
                          title="Clear approvals for shown rows only"
                          onClick={() => setIntentApproval(items.map((item) => item.id), false)}
                        >
                          Clear
                        </button>
                        <button
                          className="button primary small-button"
                          id="approveAllIntents"
                          type="button"
                          disabled={intentApproveDisabled}
                          aria-label="Approve all shared intents"
                          title={`Approve the ${items.length} shown rows`}
                          onClick={() => setIntentApproval(items.map((item) => item.id), true)}
                        >
                          {items.length && approvedIntents === items.length ? "Approved" : "Approve all"}
                        </button>
                      </div>
                    </div>
                    <p className="sheet-scroll-hint intent-scroll-hint">Scroll to view columns →</p>
                    <div className="table-scroll sheet-review-scroll" tabIndex="0" role="region" aria-label="Intents spreadsheet">
                      <table className="sheet-review-table intent-sheet-table" aria-label="Shared intents">
                        <thead>
                          <tr>
                            <th scope="col">#</th>
                            <th scope="col" className="sheet-intent">
                              Intent to track
                            </th>
                            <th scope="col" className="sheet-audience">
                              Persona / audience
                            </th>
                            <th scope="col" className="sheet-edit">
                              Edit
                            </th>
                            <th scope="col" className="sheet-approval">
                              Approval
                            </th>
                          </tr>
                        </thead>
                        <tbody id="intentRows">
                          {engineConfirmed && intentsLoading && (
                            <tr>
                              <td className="filter-empty" colSpan="5">
                                The intent agent is reading the transcript and brief…
                              </td>
                            </tr>
                          )}
                          {engineConfirmed &&
                            items.map((item, index) => {
                              const value = intentValue(item);
                              const approved = intents[item.id]?.status === "Approved";
                              return (
                                <tr className={approved ? "is-approved" : ""} key={item.id}>
                                  <td className="sheet-row-number">{index + 1}</td>
                                  <td>
                                    <div className="engine-intent-name">{value.intent}</div>
                                  </td>
                                  <td>
                                    <div className="engine-audience">{value.audience}</div>
                                  </td>
                                  <td className="sheet-edit">
                                    <button
                                      type="button"
                                      className="sheet-edit-button"
                                      id={`intent-edit-shared-${item.id}`}
                                      data-row-edit={item.id}
                                      aria-label={`Edit intent ${item.id}`}
                                      title="Edit / update intent"
                                      onClick={() => openIntentReview(item.id)}
                                    >
                                      <EditIcon />
                                    </button>
                                  </td>
                                  <td className="sheet-approval">
                                    <label className="sheet-approval-control">
                                      <input
                                        type="checkbox"
                                        id={`intent-approve-shared-${item.id}`}
                                        data-row-approval={item.id}
                                        checked={approved}
                                        aria-label={`Approve intent ${item.id}`}
                                        onChange={(event) => setIntentApproval([item.id], event.target.checked)}
                                      />
                                      <span className="sr-only">Approve row {index + 1}</span>
                                    </label>
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="summary-strip sr-only">
                    <span>
                      <strong id="approvedIntentCount">{approvedIntents}</strong> / <span id="intentReviewTotal">{items.length}</span> approved
                    </span>
                  </div>
                </div>
                <p id="intentStageError" className="input-error" role="alert">
                  {intentError}
                </p>
                {intentError && !items.length && (
                  <div className="wizard-footer">
                    <button className="button secondary" type="button" onClick={ensureIntents}>
                      Try again
                    </button>
                  </div>
                )}
                <div className="wizard-footer review-footer">
                  <button className="button secondary" id="editEngineSelection" onClick={openEnginePicker}>
                    Back
                  </button>
                  <div className="wizard-next">
                    <span className="small muted" id="intentContinueHint">
                      Editing is optional
                    </span>
                    <button className="button primary" id="continueIntents" disabled={!allIntentsReady} onClick={() => (allIntentsReady ? goStage(4) : setIntentError("Complete the intent and audience before continuing."))}>
                      Next <span aria-hidden="true">→</span>
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* ---- Step 4 ---- */}
            <section className="wizard-stage" id="wizardStage4" data-wizard-stage="4" aria-labelledby="promptStageTitle" hidden={current !== 4}>
              <div className="phase-one-note">
                <div>
                  <strong>Edit when needed</strong>
                  <p>You can adjust the wording before continuing. Generated prompts are ready to export.</p>
                </div>
              </div>
              <div className="panel table-panel formal-review">
                <div className="panel-heading">
                  <h2 id="promptStageTitle" tabIndex="-1">
                    Prompts
                  </h2>
                  <span className="tag soft" id="promptSelectionTag">
                    {selectedEngines.length} engines · {items.length} rows
                  </span>
                </div>
                <div className="engine-tabs" id="promptEngineTabs" role="tablist" aria-label="Prompts engines" onKeyDown={onTabsKey}>
                  {selectedEngines.map((engine) => (
                    <button
                      className="engine-tab"
                      key={engine.id}
                      id={`prompt-engine-${engine.id}`}
                      role="tab"
                      type="button"
                      data-review-engine={engine.id}
                      data-review-kind="prompt"
                      aria-controls="promptEnginePanel"
                      aria-selected={String(promptEngine === engine.id)}
                      tabIndex={promptEngine === engine.id ? 0 : -1}
                      onClick={() => selectPromptEngine(engine.id, true)}
                    >
                      <strong>{engine.name}</strong>
                      <span>{generated.has(engine.id) ? String(items.length) : "—"}</span>
                    </button>
                  ))}
                </div>
                <div id="promptEnginePanel" role="region" tabIndex="0" aria-labelledby={promptEngine ? `prompt-engine-${promptEngine}` : undefined}>
                  <div className="prompt-generation" id="promptGenerationPanel" hidden={promptGenerated}>
                    <div className="generation-symbol" aria-hidden="true">
                      04
                    </div>
                    <h3>Generate prompt drafts</h3>
                    <p id="promptGenerationSummary">
                      {items.length} intents · {pendingEngines.length} engines to generate
                    </p>
                    <button className="button primary" id="generatePrompts" type="button" disabled={!allIntentsReady || !pendingEngines.length || generating} onClick={generatePrompts}>
                      {generating ? "Generating…" : "Generate"}
                    </button>
                    <span className="generation-note">{agentInfo.mode === "ai" ? "Prompt Writer + QA agents" : "Rule-based drafts · add an LLM key for AI agents"}</span>
                  </div>
                  <div id="promptReviewWorkspace" hidden={!promptGenerated}>
                    <div className="prompt-filter-toolbar">
                      <div className="prompt-review-controls">
                        <div className="filter-heading">
                          <strong>Confidence</strong>
                          <span className="sample-label">{agentInfo.mode === "ai" ? "QA scores" : "Rule-based scores"}</span>
                        </div>
                        <div className="approval-actions">
                          <button
                            className="button secondary small-button"
                            id="clearPromptApprovals"
                            type="button"
                            disabled={!allowed(4) || !engineConfirmed || !promptApprovedVisible}
                            aria-label="Clear shown prompt approvals"
                            title="Clear approvals for shown rows only"
                            onClick={() => setPromptApproval(visiblePrompts.map((item) => item.id), false)}
                          >
                            Clear
                          </button>
                          <button
                            className="button primary small-button"
                            id="approveAllPrompts"
                            type="button"
                            disabled={promptApproveDisabled}
                            aria-label="Approve shown prompts"
                            title={`Approve the ${visiblePrompts.length} shown rows`}
                            onClick={() => setPromptApproval(visiblePrompts.map((item) => item.id), true)}
                          >
                            {visiblePrompts.length && promptApprovedVisible === visiblePrompts.length ? "Approved" : confidenceFilter !== "all" ? "Approve shown" : "Approve all"}
                          </button>
                        </div>
                      </div>
                      <div className="prompt-filter-row">
                        <div className="confidence-filters" id="promptConfidenceFilters" role="group" aria-label="Prompt confidence filter">
                          {[
                            ["all", "All", null],
                            ["high", "High", "85–100%"],
                            ["medium", "Medium", "60–84%"],
                            ["low", "Low", "<60%"],
                            ["unscored", "Not scored", null],
                          ].map(([value, label, range]) => (
                            <button key={value} type="button" data-confidence={value} aria-pressed={String(confidenceFilter === value)} onClick={() => setConfidenceFilter(value)}>
                              {label}
                              {range && (
                                <>
                                  {" "}
                                  <span>{range}</span>
                                </>
                              )}
                            </button>
                          ))}
                        </div>
                        <div className="prompt-review-counts">
                          <span id="promptFilterCount" role="status">
                            {visiblePrompts.length} of {items.length} shown
                          </span>
                          <span id="promptEngineProgress" role="status">
                            {promptGenerated ? `${items.length} prompts ready` : "Ready to generate"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <p className="sheet-scroll-hint prompt-scroll-hint">Scroll to view columns →</p>
                    <div className="table-scroll sheet-review-scroll" tabIndex="0" role="region" aria-label="Prompts spreadsheet">
                      <table className="sheet-review-table" aria-label="Prompts for selected engine">
                        <thead>
                          <tr>
                            <th scope="col">#</th>
                            <th scope="col" className="sheet-intent">
                              Intent / audience
                            </th>
                            <th scope="col" className="sheet-prompt">
                              Prompt
                            </th>
                            <th scope="col" className="sheet-confidence">
                              Confidence
                            </th>
                            <th scope="col" className="sheet-edit">
                              Edit
                            </th>
                            <th scope="col" className="sheet-approval">
                              Approval
                            </th>
                          </tr>
                        </thead>
                        <tbody id="promptRows">
                          {promptGenerated &&
                            (visiblePrompts.length ? (
                              visiblePrompts.map((item) => {
                                const index = items.indexOf(item);
                                const value = intentValue(item);
                                const engine = engines.find((entry) => entry.id === promptEngine);
                                const approved = prompts[rowKey(promptEngine, item.id)]?.status === "Approved";
                                return (
                                  <tr className={approved ? "is-approved" : ""} key={item.id}>
                                    <td className="sheet-row-number">{index + 1}</td>
                                    <td>
                                      <div className="engine-intent-name">{value.intent}</div>
                                      <div className="prompt-audience">{value.audience}</div>
                                    </td>
                                    <td>
                                      <div className="prompt-question">{promptText(promptEngine, item)}</div>
                                    </td>
                                    <td className="sheet-confidence">
                                      <ConfidenceBadge score={confidenceOf(promptEngine, item)} scoreLabel={confidenceTitle} />
                                    </td>
                                    <td className="sheet-edit">
                                      <button
                                        type="button"
                                        className="sheet-edit-button"
                                        id={`prompt-edit-${promptEngine}-${item.id}`}
                                        data-row-edit={item.id}
                                        aria-label={`Edit prompt ${item.id} for ${engine?.name}`}
                                        title="Edit / update prompt"
                                        onClick={() => openPromptReview(item.id)}
                                      >
                                        <EditIcon />
                                      </button>
                                    </td>
                                    <td className="sheet-approval">
                                      <label className="sheet-approval-control">
                                        <input
                                          type="checkbox"
                                          id={`prompt-approve-${promptEngine}-${item.id}`}
                                          data-row-approval={item.id}
                                          checked={approved}
                                          aria-label={`Approve prompt ${item.id} for ${engine?.name}`}
                                          onChange={(event) => setPromptApproval([item.id], event.target.checked)}
                                        />
                                        <span className="sr-only">Approve row {index + 1}</span>
                                      </label>
                                    </td>
                                  </tr>
                                );
                              })
                            ) : (
                              <tr>
                                <td className="filter-empty" colSpan="6">
                                  No suggestions in this range.
                                  <button className="button secondary" data-clear-confidence="prompt" onClick={() => setConfidenceFilter("all")}>
                                    Show all
                                  </button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
                <div className="summary-strip sr-only">
                  <span>
                    <strong id="approvedCount">{selectedEngines.reduce((total, engine) => total + approvedCount(engine.id), 0)}</strong> /{" "}
                    <span id="promptReviewTotal">{totalPrompts}</span> approved
                  </span>
                  <span id="promptEnginesComplete">
                    {selectedEngines.filter((engine) => approvedCount(engine.id) === items.length).length} / {selectedEngines.length} engines complete
                  </span>
                </div>
              </div>
              <p id="promptStageError" className="input-error" role="alert">
                {promptError}
              </p>
              <div className="wizard-footer review-footer">
                <button className="button secondary" data-wizard-back="3" onClick={() => goStage(3)}>
                  Back
                </button>
                <div className="wizard-next">
                  <span className="small muted" id="promptContinueHint">
                    {allPromptsReady ? "Ready to export" : "Generate your prompts to continue"}
                  </span>
                  <button className="button primary" id="nextPromptEngine" disabled hidden>
                    Next engine <span aria-hidden="true">→</span>
                  </button>
                  <button
                    className="button primary"
                    id="continuePrompts"
                    disabled={!allPromptsReady}
                    onClick={() => (allPromptsReady ? goStage(5) : setPromptError("Generate prompts for your selected engines before continuing."))}
                  >
                    Next <span aria-hidden="true">→</span>
                  </button>
                </div>
              </div>
            </section>

            {/* ---- Step 5 ---- */}
            <section className={`wizard-stage${expanded ? " is-expanded" : ""}`} id="wizardStage5" data-wizard-stage="5" aria-labelledby="exportStageTitle" hidden={current !== 5}>
              <div className="panel export-intro">
                <div className="eyebrow">Step 05 / Google Sheets</div>
                <h2 id="exportStageTitle" tabIndex="-1">
                  Google Sheets
                </h2>
                <p id="exportReviewSummary">{exportSummary}</p>
                <div className="wizard-context">
                  <div>
                    <span>Client</span>
                    <strong id="exportClient">{clientTeam || "—"}</strong>
                  </div>
                  <div>
                    <span>Property</span>
                    <strong id="exportProperty">{property || "—"}</strong>
                  </div>
                </div>
              </div>
              <div className="panel export-panel section-gap" id="exportPanel">
                <div className="workbook-preview-heading">
                  <div className="file-heading">
                    <img className="workbook-sheet-icon" src={sheetIcon} alt="" />
                    <h2 id="workbookPreviewTitle">{sheet?.title || "Komosion GEO — Engine Intent & Prompt Review"}</h2>
                  </div>
                  <div className="workbook-heading-actions">
                    <button className="button secondary" id="reloadWorkbookPreview" type="button" onClick={() => setFrameNonce((value) => value + 1)}>
                      Reload preview
                    </button>
                    <button
                      className="button secondary"
                      id="expandWorkbookPreview"
                      type="button"
                      aria-pressed={String(expanded)}
                      onClick={() => {
                        setExpanded(!expanded);
                        scrollTop(false);
                      }}
                    >
                      {expanded ? "Exit full screen" : "Full screen"}
                    </button>
                    <a className="button primary" id="openGoogleSheet" href={sheetUrl || undefined} target="_blank" rel="noopener">
                      Open Google Sheets <span aria-hidden="true">↗</span>
                    </a>
                  </div>
                </div>
                <p className="workbook-access-note" id="workbookPreviewNote">
                  {sheet?.synced
                    ? "Requires access to this Google Sheet. If asked to sign in, use Open Google Sheets, then Reload preview. Your reviewed prompts were written to the workbook."
                    : sheet?.error
                      ? `The workbook could not be prepared: ${sheet.error}`
                      : "Requires access to this Google Sheet. If asked to sign in, use Open Google Sheets, then Reload preview. Prompt edits are saved with the client and exported as CSV."}
                </p>
                <div className="workbook-embed">
                  {current === 5 && previewUrl && (
                    <iframe
                      key={frameNonce}
                      id="googleSheetPreview"
                      title={`Google Sheets workbook preview${firstEngine ? ` — ${firstEngine.name}` : ""}`}
                      referrerPolicy="strict-origin-when-cross-origin"
                      aria-describedby="workbookPreviewNote"
                      allowFullScreen
                      src={previewUrl}
                    />
                  )}
                </div>
              </div>
              <div className="wizard-footer">
                <button className="button secondary" data-wizard-back="4" onClick={() => goStage(4)}>
                  ← Back
                </button>
                <span className="phase-one-save-message" id="phaseOneSaveMessage">
                  {saveMessage}
                </span>
                <button className="button primary" type="button" id="savePhaseOne" disabled={saving} onClick={savePhaseOne}>
                  {saving ? "Saving…" : "Save & open CSV exports"} <span aria-hidden="true">→</span>
                </button>
              </div>
            </section>
          </section>
        </main>
      </div>

      {/* ---- dialogs ---- */}
      <Dialog id="briefDialog" labelledBy="intentReviewTitle" open={!!activeIntent} onClose={() => setActiveIntent(null)}>
        <div className="dialog-shell">
          <div className="dialog-top">
            <div>
              <div className="eyebrow">Step 03 · Intent only</div>
              <h2 id="intentReviewTitle">{activeIntent ? `Edit intent ${activeIntent.id}` : "Review guest intent"}</h2>
            </div>
            <button className="dialog-close" aria-label="Close intent review" data-close onClick={() => setActiveIntent(null)}>
              ×
            </button>
          </div>
          <div className="dialog-body">
            <div className="dialog-meta" id="intentReviewMeta">
              {activeIntent ? `Shared across all engines · ${activeIntent.id}` : ""}
            </div>
            <label className="field">
              Intent
              <textarea id="intentNeed" rows="2" maxLength="3000" value={activeIntent?.intent || ""} onChange={(event) => setActiveIntent({ ...activeIntent, intent: event.target.value, error: "" })} />
            </label>
            <label className="field">
              Audience
              <input id="intentAudience" maxLength="500" value={activeIntent?.audience || ""} onChange={(event) => setActiveIntent({ ...activeIntent, audience: event.target.value, error: "" })} />
            </label>
            <div className="dialog-note">Changes apply to the intent and audience across all engines. You can edit the linked prompts separately.</div>
            <p className="input-error" id="intentReviewError" role="alert">
              {activeIntent?.error}
            </p>
          </div>
        </div>
        <div className="dialog-actions">
          <button className="button secondary" data-close onClick={() => setActiveIntent(null)}>
            Cancel
          </button>
          <button className="button primary" id="saveIntent" onClick={saveIntent}>
            <CheckIcon />
            Save
          </button>
        </div>
      </Dialog>

      <Dialog id="reviewDialog" labelledBy="reviewTitle" open={!!activePrompt} onClose={() => setActivePrompt(null)}>
        <div className="dialog-shell">
          <div className="dialog-top">
            <div>
              <div className="eyebrow">Step 04 · Prompt only</div>
              <h2 id="reviewTitle">{activePrompt ? `Edit prompt ${activePrompt.item.promptId || activePrompt.item.id}` : "Review prompt"}</h2>
            </div>
            <button className="dialog-close" aria-label="Close prompt review" data-close onClick={() => setActivePrompt(null)}>
              ×
            </button>
          </div>
          <div className="dialog-body">
            <div className="dialog-meta" id="reviewMeta">
              {activePrompt ? `${engines.find((engine) => engine.id === activePrompt.engineId)?.name} · ${activePrompt.item.id} · ${intentValue(activePrompt.item).audience}` : ""}
            </div>
            <label className="field">
              Prompt wording
              <textarea id="promptText" rows="4" maxLength="3000" value={activePrompt?.text || ""} onChange={(event) => setActivePrompt({ ...activePrompt, text: event.target.value, error: "" })} />
            </label>
            {activePrompt && <PromptConfidenceSummary prompt={activePrompt} score={confidenceOf(activePrompt.engineId, activePrompt.item)} scoreLabel={confidenceTitle} />}
            <label className="field">
              Feedback
              <textarea
                id="promptFeedback"
                rows="3"
                maxLength="1000"
                placeholder="What should the next draft change?"
                value={activePrompt?.feedback || ""}
                onChange={(event) => setActivePrompt({ ...activePrompt, feedback: event.target.value, error: "" })}
              />
            </label>
            <div className="feedback-tools">
              <button className="button secondary" id="regeneratePrompt" type="button" disabled={activePrompt?.busy} onClick={regenerate}>
                {activePrompt?.busy ? "Regenerating…" : "Regenerate"}
              </button>
              <span className="small muted">{agentInfo.mode === "ai" ? "Prompt Writer agent" : "Rule-based rewrite · no AI key configured"}</span>
            </div>
            <p id="regenerationStatus" className="regeneration-status" role="status">
              {activePrompt?.status}
            </p>
            <details id="previousPrompt" className="feedback-history" hidden={!activePrompt?.previous}>
              <summary>Previous version</summary>
              <p id="previousPromptText">{activePrompt?.previous}</p>
            </details>
            <FeedbackHistory log={feedbackLog.current} prompt={activePrompt} />
            <div className="dialog-note">Save keeps your wording and optional feedback. Edited prompts can be exported directly.</div>
            <p className="input-error" id="promptReviewError" role="alert">
              {activePrompt?.error}
            </p>
          </div>
        </div>
        <div className="dialog-actions">
          <button className="button secondary" data-close onClick={() => setActivePrompt(null)}>
            Cancel
          </button>
          <button className="button primary" id="editPrompt" onClick={savePrompt}>
            <CheckIcon />
            Save
          </button>
        </div>
      </Dialog>

      <div className={`toast${toast ? " show" : ""}`} id="toast" role="status" aria-live="polite">
        {toast}
      </div>
    </div>
  );
}

function PromptConfidenceSummary({ prompt, score, scoreLabel }) {
  const changed = prompt.text.trim() !== prompt.originalText || prompt.feedback.trim() !== prompt.originalFeedback;
  const regenerated = prompt.generatedText !== null && prompt.generatedText === prompt.text;
  const value = regenerated ? prompt.generatedConfidence ?? null : changed ? null : score;
  return (
    <div id="promptConfidenceSummary" className="dialog-confidence">
      Confidence <ConfidenceBadge score={value} scoreLabel={scoreLabel} />
      <span>{value === null ? (regenerated ? "New draft · assessment required" : "Assessment required") : regenerated ? "New draft · scored" : scoreLabel}</span>
    </div>
  );
}

function FeedbackHistory({ log, prompt }) {
  const events = prompt ? log.filter((entry) => entry.engineId === prompt.engineId && entry.itemId === prompt.item.id) : [];
  return (
    <details id="feedbackHistory" className="feedback-history" hidden={!events.length}>
      <summary id="feedbackHistoryTitle">Saved feedback ({events.length})</summary>
      <ol id="feedbackHistoryRows">
        {events.map((entry, index) => (
          <li key={index}>
            <strong>
              Revision {entry.revision} · {entry.outcome}
            </strong>
            <br />
            {entry.feedback}
          </li>
        ))}
      </ol>
    </details>
  );
}
